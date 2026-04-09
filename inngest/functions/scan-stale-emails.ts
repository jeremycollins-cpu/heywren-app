import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatch, getClassificationStats, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'

// Detect emails the user READ but never acted on — the "Rhonda problem":
// You open an email, intend to respond, get distracted, and it falls through the cracks.
// The existing scan-missed-emails only classifies unread/new emails. This scanner
// re-evaluates READ emails where the user never sent a reply in that conversation.

const MAX_EMAILS_PER_RUN = 150
const TIME_BUDGET_MS = 300000 // 5 minutes

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function refreshMicrosoftToken(
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
          client_secret: process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'openid profile email Mail.Read Calendars.ReadWrite User.Read offline_access',
        }).toString(),
      }
    )

    const tokenData = await res.json()
    if (tokenData.error) return null

    await supabase
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
      })
      .eq('id', integrationId)

    return tokenData.access_token
  } catch {
    return null
  }
}

async function graphFetch(
  url: string,
  token: string,
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<{ data: any; token: string }> {
  let currentToken = token

  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + currentToken },
  })

  if (res.status === 401) {
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (!newToken) return { data: { error: 'Token refresh failed' }, token: currentToken }
    currentToken = newToken
    const retryRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + currentToken },
    })
    return { data: await retryRes.json(), token: currentToken }
  }

  return { data: await res.json(), token: currentToken }
}

// Fetch conversation IDs from the user's sent items to detect replies
async function fetchRepliedConversationIds(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  scanWindowDays: number
): Promise<Set<string>> {
  const repliedConversations = new Set<string>()

  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .limit(1)
    .single()

  if (!integration) return repliedConversations

  const scanWindow = new Date(Date.now() - scanWindowDays * 86400000).toISOString()
  const filter = encodeURIComponent(`sentDateTime ge ${scanWindow} and isDraft eq false`)
  const selectFields = 'conversationId'

  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages?$filter=${filter}&$select=${selectFields}&$top=100`

  let msToken = integration.access_token

  while (nextLink) {
    try {
      const { data, token } = await graphFetch(
        nextLink, msToken, supabase, integration.id, integration.refresh_token || ''
      )
      msToken = token

      if (data.error) break

      for (const msg of data.value || []) {
        if (msg.conversationId) {
          repliedConversations.add(msg.conversationId)
        }
      }

      nextLink = data['@odata.nextLink'] || null
    } catch {
      break
    }
  }

  return repliedConversations
}

async function scanUserStaleEmails(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
) {
  const startTime = Date.now()

  // Load user preferences
  const { data: prefsRow } = await supabase
    .from('email_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .maybeSingle()

  // Load feedback history for auto-blocking
  const { data: feedbackRows } = await supabase
    .from('missed_email_feedback')
    .select('from_email, from_domain, feedback')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('feedback', 'invalid')

  const domainCounts: Record<string, number> = {}
  const emailCounts: Record<string, number> = {}
  for (const f of feedbackRows || []) {
    domainCounts[f.from_domain] = (domainCounts[f.from_domain] || 0) + 1
    emailCounts[f.from_email] = (emailCounts[f.from_email] || 0) + 1
  }

  const userPrefs: UserEmailPreferences = {
    vipContacts: prefsRow?.vip_contacts || [],
    blockedSenders: prefsRow?.blocked_senders || [],
    enabledCategories: prefsRow?.enabled_categories || ['question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'],
    minUrgency: prefsRow?.min_urgency || 'low',
    feedbackBlockedDomains: new Set(
      Object.entries(domainCounts).filter(([, c]) => c >= 2).map(([d]) => d)
    ),
    feedbackBlockedEmails: new Set(
      Object.entries(emailCounts).filter(([, c]) => c >= 1).map(([e]) => e)
    ),
  }

  // Stale window: emails read 1-14 days ago that haven't been replied to
  // Too fresh (<1 day) = user may still be planning to respond
  // Too old (>14 days) = diminishing returns
  const staleMinAge = 1 // days — minimum age before flagging as stale
  const staleMaxAge = 14 // days — maximum age to scan
  const staleMinCutoff = new Date(Date.now() - staleMinAge * 86400000).toISOString()
  const staleMaxCutoff = new Date(Date.now() - staleMaxAge * 86400000).toISOString()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  const userEmail = profile?.email?.toLowerCase() || ''
  const userName = profile?.full_name || ''

  // Fetch conversations the user has replied to
  const repliedConversations = await fetchRepliedConversationIds(supabase, userId, staleMaxAge)

  // Load excluded folders
  const excludedFolders = new Set<string>(
    (prefsRow?.excluded_folders || []).map((f: string) => f.toLowerCase())
  )

  // Fetch READ emails from the stale window that haven't been classified yet
  const { data: emails, error: fetchErr } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, cc_recipients, subject, body_preview, received_at, conversation_id, is_read, folder_name')
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('is_read', true)
    .lte('received_at', staleMinCutoff)
    .gte('received_at', staleMaxCutoff)
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS_PER_RUN)

  if (fetchErr || !emails) {
    console.error(`[stale-scan] Team ${teamId}: Failed to fetch emails:`, fetchErr?.message)
    return { success: false, error: fetchErr?.message }
  }

  // Filter out already classified emails (already in missed_emails table)
  const { data: existing } = await supabase
    .from('missed_emails')
    .select('message_id')
    .eq('team_id', teamId)
    .eq('user_id', userId)

  const existingIds = new Set((existing || []).map(e => e.message_id))

  const candidates = emails.filter(e => {
    // Skip already classified
    if (existingIds.has(e.message_id)) return false
    // Skip emails sent BY the user
    if (userEmail && e.from_email?.toLowerCase() === userEmail) return false
    // Skip emails in conversations the user already replied to — they acted on it
    if (e.conversation_id && repliedConversations.has(e.conversation_id)) return false
    // Skip excluded folders
    if (e.folder_name && excludedFolders.has(e.folder_name.toLowerCase())) return false
    return true
  })

  if (candidates.length === 0) {
    return { success: true, teamId, scanned: 0, stale: 0, duration: 0 }
  }

  let totalStale = 0

  // Process in batches of 15
  for (let i = 0; i < candidates.length; i += 15) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break

    const chunk = candidates.slice(i, i + 15)
    const batchInput = chunk.map(email => {
      const toStr = (email.to_recipients || '').toLowerCase()
      const ccStr = (email.cc_recipients || '').toLowerCase()
      const isInTo = userEmail ? toStr.includes(userEmail) : true
      const isInCc = userEmail ? ccStr.includes(userEmail) : false
      const isCcOnly = !isInTo && isInCc

      // Skip CC-only read emails unless user is @mentioned
      if (isCcOnly) {
        const bodyLower = (email.body_preview || '').toLowerCase()
        const nameLower = userName?.toLowerCase() || ''
        const isMentioned = nameLower.length > 2 && (bodyLower.includes(nameLower) || bodyLower.includes(`@${nameLower}`))
        if (!isMentioned) return null
      }

      return {
        id: email.message_id,
        fromEmail: email.from_email || '',
        fromName: email.from_name || '',
        subject: email.subject || '(no subject)',
        bodyPreview: email.body_preview || '',
        receivedAt: email.received_at,
        recipientEmail: userEmail,
        recipientName: userName,
        isCcOnly,
        toRecipients: email.to_recipients || '',
        ccRecipients: email.cc_recipients || '',
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)

    if (batchInput.length === 0) continue

    try {
      const classifications = await classifyMissedEmailBatch(batchInput, userPrefs)

      const toUpsert = []
      for (const email of chunk) {
        const classification = classifications.get(email.message_id)
        if (classification) {
          toUpsert.push({
            team_id: teamId,
            user_id: userId,
            outlook_message_id: email.id,
            message_id: email.message_id,
            from_name: email.from_name,
            from_email: email.from_email,
            to_recipients: email.to_recipients,
            subject: email.subject,
            body_preview: email.body_preview,
            received_at: email.received_at,
            urgency: classification.urgency,
            reason: `${classification.reason} (read but no reply sent)`,
            question_summary: classification.questionSummary,
            category: classification.category,
            confidence: classification.confidence,
            expected_response_time: classification.expectedResponseTime || null,
            status: 'pending',
            is_read: true,
            folder_name: email.folder_name || null,
          })
        }
      }

      if (toUpsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('missed_emails')
          .upsert(toUpsert, { onConflict: 'team_id,message_id' })

        if (!insertErr) totalStale += toUpsert.length
      }
    } catch (err) {
      console.error('[stale-scan] Batch classification error:', (err as Error).message)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  const stats = getClassificationStats()

  return {
    success: true,
    teamId,
    scanned: candidates.length,
    stale: totalStale,
    repliedConversationsFound: repliedConversations.size,
    stats,
    duration,
  }
}

// Run at 11 AM and 3 PM PT — offset from scan-missed-emails (6:30, 10:30, 2:30, 6:30)
// to spread AI load and catch stale emails during the workday
export const scanStaleEmails = inngest.createFunction(
  { id: 'scan-stale-emails' },
  { cron: 'TZ=America/Los_Angeles 0 11,15 * * 1-5' },
  async ({ step }) => {
    const integrations = await step.run('fetch-integrations', async () => {
      const supabase = getAdminClient()

      const { data, error } = await supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      if (error || !data) {
        console.error('[stale-scan] Failed to fetch integrations:', error)
        return []
      }

      console.log(`[stale-scan] ${data.length} user integration(s) to scan`)
      return data
    })

    if (integrations.length === 0) {
      return { success: false, error: 'No integrations found' }
    }

    const results = await Promise.all(
      integrations.map((integration) =>
        step.run(`stale-scan-${integration.team_id}-${integration.user_id}`, async () => {
          const supabase = getAdminClient()
          try {
            const result = await scanUserStaleEmails(
              supabase,
              integration.team_id,
              integration.user_id
            )
            console.log(`[stale-scan] Team ${integration.team_id}:`, result)
            return result
          } catch (err) {
            console.error(`[stale-scan] Team ${integration.team_id} failed:`, (err as Error).message)
            return { success: false, teamId: integration.team_id, error: (err as Error).message }
          }
        })
      )
    )

    return { success: true, teamsScanned: results.length, results }
  }
)
