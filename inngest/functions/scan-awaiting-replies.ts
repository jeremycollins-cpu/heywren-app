// inngest/functions/scan-awaiting-replies.ts
// Scans sent emails and Slack messages to find items the user is waiting on a reply for.
// Runs daily at 7 AM PT, after Outlook sync (6 AM) and missed email scan (6:30 AM).
//
// Logic:
// 1. Fetch sent items from Outlook Graph API (sentItems folder)
// 2. Check each sent message for a reply in the conversation
// 3. For Slack: find user's messages that started threads but got no reply
// 4. Classify urgency and create awaiting_replies records

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

const MAX_SENT_PER_RUN = 100
const TIME_BUDGET_MS = 240000 // 4 minutes

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Simple urgency classification based on message content
function classifySentMessage(subject: string, body: string, daysSince: number): {
  urgency: string
  category: string
  waitReason: string
} {
  const text = `${subject} ${body}`.toLowerCase()

  // Urgency signals
  let urgency = 'medium'
  if (daysSince > 7) urgency = 'high'
  if (daysSince > 14) urgency = 'critical'
  if (text.includes('asap') || text.includes('urgent') || text.includes('eod') || text.includes('end of day')) urgency = 'high'
  if (text.includes('blocker') || text.includes('blocking') || text.includes('cannot proceed')) urgency = 'critical'

  // Category detection
  let category = 'follow_up'
  let waitReason = 'Waiting for response'

  if (text.includes('?') || text.includes('can you') || text.includes('could you') || text.includes('do you') || text.includes('would you')) {
    category = 'question'
    waitReason = 'Asked a question'
  }
  if (text.includes('approve') || text.includes('approval') || text.includes('sign off') || text.includes('sign-off')) {
    category = 'decision'
    waitReason = 'Requested approval'
  }
  if (text.includes('please review') || text.includes('take a look') || text.includes('feedback') || text.includes('thoughts on')) {
    category = 'request'
    waitReason = 'Requested review/feedback'
  }
  if (text.includes('proposal') || text.includes('contract') || text.includes('agreement') || text.includes('partnership')) {
    category = 'deliverable'
    waitReason = 'Sent deliverable — awaiting response'
  }
  if (text.includes('intro') || text.includes('meet') || text.includes('connect you')) {
    category = 'introduction'
    waitReason = 'Made introduction — awaiting follow-up'
  }
  if (text.includes('schedule') || text.includes('availability') || text.includes('when works') || text.includes('set up a time')) {
    category = 'request'
    waitReason = 'Requested meeting/time'
  }

  // Downgrade urgency for FYI-style messages
  if (text.includes('fyi') || text.includes('no rush') || text.includes('when you get a chance') || text.includes('low priority')) {
    urgency = 'low'
  }

  return { urgency, category, waitReason }
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
          scope: 'openid profile email Mail.Read Calendars.Read User.Read offline_access',
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

export async function scanTeamAwaitingReplies(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
) {
  const startTime = Date.now()

  // Get Outlook integration
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('team_id', teamId)
    .eq('provider', 'outlook')
    .single()

  if (!integration) return { success: true, teamId, scanned: 0, awaiting: 0 }

  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Get user's email for filtering
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()

  const userEmail = profile?.email?.toLowerCase() || ''

  // Fetch sent items from last 14 days
  const scanWindow = new Date(Date.now() - 14 * 86400000).toISOString()
  const filter = encodeURIComponent(`sentDateTime ge ${scanWindow} and isDraft eq false`)
  const selectFields = 'id,subject,bodyPreview,toRecipients,sentDateTime,conversationId,webLink'

  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages?$filter=${filter}&$select=${selectFields}&$orderby=sentDateTime desc&$top=50`

  // Get existing awaiting_replies to avoid duplicates
  const { data: existing } = await supabase
    .from('awaiting_replies')
    .select('source_message_id')
    .eq('team_id', teamId)

  const existingIds = new Set((existing || []).map(e => e.source_message_id))

  // Also get incoming emails (to check if conversation has a reply)
  const { data: inboxMessages } = await supabase
    .from('outlook_messages')
    .select('conversation_id, from_email, received_at')
    .eq('team_id', teamId)
    .gte('received_at', scanWindow)

  // Build a map of conversations that have incoming replies
  const repliedConversations = new Set<string>()
  for (const msg of inboxMessages || []) {
    if (msg.from_email?.toLowerCase() !== userEmail && msg.conversation_id) {
      repliedConversations.add(msg.conversation_id)
    }
  }

  let totalScanned = 0
  let totalAwaiting = 0

  while (nextLink && Date.now() - startTime < TIME_BUDGET_MS && totalScanned < MAX_SENT_PER_RUN) {
    const { data: pageData, token: updatedToken } = await graphFetch(
      nextLink, msToken, supabase, integrationId, refreshToken
    )
    msToken = updatedToken

    if (pageData.error) break

    const messages = pageData.value || []
    const toInsert: any[] = []

    for (const msg of messages) {
      totalScanned++
      const msgId = msg.id as string
      if (existingIds.has(msgId)) continue

      const conversationId = msg.conversationId || ''
      const subject = msg.subject || ''
      const bodyPreview = msg.bodyPreview || ''
      const sentAt = msg.sentDateTime || new Date().toISOString()
      const webLink = msg.webLink || ''

      // Skip if conversation already has a reply
      if (conversationId && repliedConversations.has(conversationId)) continue

      // Skip very short messages (likely auto-replies or forwards)
      if (bodyPreview.length < 20) continue

      // Skip calendar-related and automated subjects
      const subjectLower = subject.toLowerCase()
      if (subjectLower.startsWith('accepted:') || subjectLower.startsWith('declined:') ||
          subjectLower.startsWith('tentative:') || subjectLower.startsWith('canceled:') ||
          subjectLower.includes('out of office') || subjectLower.includes('automatic reply')) {
        continue
      }

      // Extract recipients
      const toRecipients = (msg.toRecipients || [])
        .map((r: any) => r.emailAddress?.address || '')
        .filter((e: string) => e)
      const toName = (msg.toRecipients || [])[0]?.emailAddress?.name || toRecipients[0] || ''

      if (toRecipients.length === 0) continue

      // Classify
      const daysSince = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000)
      const { urgency, category, waitReason } = classifySentMessage(subject, bodyPreview, daysSince)

      // Skip low-urgency items less than 2 days old
      if (urgency === 'low' && daysSince < 2) continue
      // Skip medium items less than 1 day old
      if (urgency === 'medium' && daysSince < 1) continue

      toInsert.push({
        team_id: teamId,
        user_id: userId,
        source: 'outlook',
        source_message_id: msgId,
        conversation_id: conversationId,
        permalink: webLink,
        to_recipients: toRecipients.join(', '),
        to_name: toName,
        subject,
        body_preview: bodyPreview.slice(0, 500),
        sent_at: sentAt,
        urgency,
        category,
        wait_reason: waitReason,
        days_waiting: daysSince,
        status: 'waiting',
      })
    }

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from('awaiting_replies')
        .upsert(toInsert, { onConflict: 'team_id,source_message_id' })

      if (insertErr) {
        console.error(`Team ${teamId}: Failed to insert awaiting replies:`, insertErr.message)
      } else {
        totalAwaiting += toInsert.length
      }
    }

    nextLink = pageData['@odata.nextLink'] || null
  }

  // Update days_waiting is handled by the enrichment in the API route (computed on read)

  // Mark items as replied if their conversation now has a response
  const { data: waitingItems } = await supabase
    .from('awaiting_replies')
    .select('id, conversation_id')
    .eq('team_id', teamId)
    .eq('status', 'waiting')
    .not('conversation_id', 'is', null)

  for (const item of waitingItems || []) {
    if (item.conversation_id && repliedConversations.has(item.conversation_id)) {
      await supabase
        .from('awaiting_replies')
        .update({ status: 'replied', replied_at: new Date().toISOString() })
        .eq('id', item.id)
    }
  }

  // Clean up old dismissed/replied items (>30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  await supabase
    .from('awaiting_replies')
    .delete()
    .eq('team_id', teamId)
    .in('status', ['dismissed', 'replied'])
    .lt('updated_at', thirtyDaysAgo)

  return {
    success: true,
    teamId,
    scanned: totalScanned,
    awaiting: totalAwaiting,
    duration: Date.now() - startTime,
  }
}

export const scanAwaitingReplies = inngest.createFunction(
  { id: 'scan-awaiting-replies', name: 'Scan for awaiting replies' },
  { cron: '0 14 * * *' }, // 7 AM PT (14:00 UTC)
  async ({ step }) => {
    const results = await step.run('scan-all-teams', async () => {
      const supabase = getAdminClient()

      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id')
        .eq('provider', 'outlook')

      if (!integrations || integrations.length === 0) {
        return { teamsProcessed: 0 }
      }

      const teamResults: any[] = []

      for (const int of integrations) {
        // Get team owner or first admin
        const { data: member } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', int.team_id)
          .in('role', ['owner', 'admin'])
          .limit(1)
          .single()

        if (!member) continue

        try {
          const result = await scanTeamAwaitingReplies(supabase, int.team_id, member.user_id)
          teamResults.push(result)
        } catch (err) {
          console.error(`Team ${int.team_id}: Scan failed:`, (err as Error).message)
          teamResults.push({ success: false, teamId: int.team_id, error: (err as Error).message })
        }
      }

      return { teamsProcessed: teamResults.length, results: teamResults }
    })

    return results
  }
)
