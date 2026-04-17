import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatchViaBatchApi, getClassificationStats, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'
import { logAiUsage } from '@/lib/ai/persist-usage'
import { sendProactiveAlert as sendAlert } from '@/lib/notifications/send-proactive-alert'
import { sendEmail } from '@/lib/email/send'
import { buildRecipientGapAlertEmail } from '@/lib/email/templates/recipient-gap-alert'
import { startJobRun } from '@/lib/jobs/record-run'

const MAX_EMAILS_PER_RUN = 200
const TIME_BUDGET_MS = 300000 // 5 minutes
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

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
          scope: 'openid profile email Mail.Read Mail.ReadWrite Calendars.ReadWrite User.Read offline_access',
        }).toString(),
      }
    )

    const tokenData = await res.json()
    if (tokenData.error) return null

    // Fetch current config to preserve existing fields
    const { data: current } = await supabase
      .from('integrations')
      .select('config')
      .eq('id', integrationId)
      .single()

    await supabase
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        config: {
          ...(current?.config || {}),
          token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        },
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

async function scanTeamMissedEmails(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
) {
  const startTime = Date.now()

  // Load user preferences and feedback history
  const { data: prefsRow } = await supabase
    .from('email_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .maybeSingle()

  // Load feedback history — single invalid mark blocks sender, 2+ blocks entire domain
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

  const feedbackBlockedDomains = new Set(
    Object.entries(domainCounts).filter(([, c]) => c >= 2).map(([d]) => d)
  )
  const feedbackBlockedEmails = new Set(
    Object.entries(emailCounts).filter(([, c]) => c >= 1).map(([e]) => e)
  )

  const userPrefs: UserEmailPreferences = {
    vipContacts: prefsRow?.vip_contacts || [],
    blockedSenders: prefsRow?.blocked_senders || [],
    enabledCategories: prefsRow?.enabled_categories || ['question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'],
    minUrgency: prefsRow?.min_urgency || 'low',
    feedbackBlockedDomains,
    feedbackBlockedEmails,
  }

  const scanWindowDays = prefsRow?.scan_window_days || 7

  // Fetch the user's email and name so we can filter out sent emails and pass to classifier
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  const userEmail = profile?.email?.toLowerCase() || ''
  const userName = profile?.full_name || ''

  // Fetch conversation IDs from the user's sent items to detect replies
  const repliedConversations = await fetchRepliedConversationIds(supabase, userId, scanWindowDays)

  // Auto-mark existing pending missed emails as replied if the user has responded
  if (repliedConversations.size > 0) {
    // Get pending missed emails that have a matching outlook_message with a conversation_id
    const { data: pendingMissed } = await supabase
      .from('missed_emails')
      .select('id, outlook_message_id')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('status', 'pending')

    if (pendingMissed && pendingMissed.length > 0) {
      // Look up conversation_ids for these missed emails via outlook_messages
      const outlookIds = pendingMissed
        .map(m => m.outlook_message_id)
        .filter(Boolean)

      if (outlookIds.length > 0) {
        const { data: outlookMsgs } = await supabase
          .from('outlook_messages')
          .select('id, conversation_id')
          .in('id', outlookIds)

        const outlookIdToConversation = new Map<string, string>()
        for (const msg of outlookMsgs || []) {
          if (msg.conversation_id) {
            outlookIdToConversation.set(msg.id, msg.conversation_id)
          }
        }

        let autoReplied = 0
        for (const missed of pendingMissed) {
          if (!missed.outlook_message_id) continue
          const convId = outlookIdToConversation.get(missed.outlook_message_id)
          if (convId && repliedConversations.has(convId)) {
            await supabase
              .from('missed_emails')
              .update({ status: 'replied' })
              .eq('id', missed.id)
            autoReplied++
          }
        }

        if (autoReplied > 0) {
          console.log(`Team ${teamId}: Auto-marked ${autoReplied} missed email(s) as replied`)
        }
      }
    }
  }

  // Auto-resolve missed emails when the user had a meeting with the sender shortly after
  {
    const { data: pendingForMeeting } = await supabase
      .from('missed_emails')
      .select('id, from_email, from_name, received_at')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('status', 'pending')

    if (pendingForMeeting && pendingForMeeting.length > 0) {
      // Get calendar events from the scan window
      const calWindowStart = new Date(Date.now() - scanWindowDays * 86400000).toISOString()
      const { data: calEvents } = await supabase
        .from('outlook_calendar_events')
        .select('attendees, start_time, subject')
        .eq('team_id', teamId)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .gte('start_time', calWindowStart)

      if (calEvents && calEvents.length > 0) {
        let autoMeeting = 0
        for (const missed of pendingForMeeting) {
          const senderEmail = (missed.from_email || '').toLowerCase()
          const senderName = (missed.from_name || '').toLowerCase()
          const emailTime = new Date(missed.received_at).getTime()

          // Check if there's a calendar event within 4 hours after the email
          // where the sender is an attendee
          const hadMeeting = calEvents.some(evt => {
            const meetingTime = new Date(evt.start_time).getTime()
            // Meeting must be after the email and within 4 hours
            if (meetingTime < emailTime || meetingTime > emailTime + 4 * 3600000) return false

            const attendees = evt.attendees || []
            return attendees.some((a: any) => {
              const email = (a.emailAddress?.address || a.email || '').toLowerCase()
              const name = (a.emailAddress?.name || a.name || '').toLowerCase()
              return (email && email === senderEmail) || (senderName.length > 3 && name.includes(senderName))
            })
          })

          if (hadMeeting) {
            await supabase
              .from('missed_emails')
              .update({ status: 'replied', resolution_type: 'auto_meeting' })
              .eq('id', missed.id)
            autoMeeting++
          }
        }

        if (autoMeeting > 0) {
          console.log(`Team ${teamId}: Auto-resolved ${autoMeeting} missed email(s) via meeting detection`)
        }
      }
    }
  }

  // Fetch recent outlook_messages that haven't been classified for missed emails yet
  const scanWindowAgo = new Date(Date.now() - scanWindowDays * 24 * 60 * 60 * 1000).toISOString()

  // Load excluded folders from preferences
  const excludedFolders = new Set<string>(
    (prefsRow?.excluded_folders || []).map((f: string) => f.toLowerCase())
  )
  const priorityFolders = new Set<string>(
    (prefsRow?.priority_folders || []).map((f: string) => f.toLowerCase())
  )

  const { data: emails, error: fetchErr } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, cc_recipients, subject, body_preview, received_at, conversation_id, is_read, folder_name')
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .gte('received_at', scanWindowAgo)
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS_PER_RUN)

  if (fetchErr || !emails) {
    console.error(`Team ${teamId}: Failed to fetch emails:`, fetchErr?.message)
    return { success: false, error: fetchErr?.message }
  }

  // Filter out emails we've already classified
  const { data: existing } = await supabase
    .from('missed_emails')
    .select('message_id')
    .eq('team_id', teamId)

  const existingIds = new Set((existing || []).map(e => e.message_id))
  const newEmails = emails.filter(e => {
    if (existingIds.has(e.message_id)) return false
    // Exclude emails sent BY the user — they don't need to respond to their own messages
    if (userEmail && e.from_email?.toLowerCase() === userEmail) return false
    // Exclude emails in conversations the user has already replied to
    if (e.conversation_id && repliedConversations.has(e.conversation_id)) return false
    // Exclude emails from user-excluded folders
    if (e.folder_name && excludedFolders.has(e.folder_name.toLowerCase())) return false
    return true
  })

  if (newEmails.length === 0) {
    return { success: true, teamId, scanned: 0, missed: 0, duration: 0 }
  }

  let totalMissed = 0

  // Process in batches of 15
  for (let i = 0; i < newEmails.length; i += 15) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break

    const chunk = newEmails.slice(i, i + 15)
    const batchInput = chunk.map(email => {
      // Determine if user is CC-only (not in TO, but in CC)
      const toStr = (email.to_recipients || '').toLowerCase()
      const ccStr = (email.cc_recipients || '').toLowerCase()
      const isInTo = userEmail ? toStr.includes(userEmail) : true
      const isInCc = userEmail ? ccStr.includes(userEmail) : false
      const isCcOnly = !isInTo && isInCc

      // Skip read CC-only emails — if you're just copied and already read it,
      // it's noise unless you're specifically addressed by name
      if (isCcOnly && email.is_read) {
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
      const classifications = await classifyMissedEmailBatchViaBatchApi(batchInput, userPrefs)

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
            reason: classification.reason,
            question_summary: classification.questionSummary,
            category: classification.category,
            confidence: classification.confidence,
            expected_response_time: classification.expectedResponseTime || null,
            status: 'pending',
            is_read: email.is_read ?? true,
            folder_name: email.folder_name || null,
          })
        }
      }

      if (toUpsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('missed_emails')
          .upsert(toUpsert, { onConflict: 'team_id,message_id' })

        if (!insertErr) totalMissed += toUpsert.length

        // Proactive alerts for recipient_gap detections
        const recipientGaps = toUpsert.filter(e => e.category === 'recipient_gap')
        for (const gap of recipientGaps) {
          const fromName = gap.from_name || 'Someone'
          const subj = gap.subject || '(no subject)'
          const summary = gap.question_summary || gap.reason || 'A person was mentioned but not included as a recipient'
          const { subject: emailSubject, html: emailHtml } = buildRecipientGapAlertEmail({
            userName: userName || 'there',
            senderName: fromName,
            subject: subj,
            questionSummary: summary,
            missedEmailsUrl: `${APP_URL}/missed-emails`,
            unsubscribeUrl: `${APP_URL}/settings?tab=notifications`,
          })
          try {
            await sendAlert({
              teamId,
              userId,
              notificationType: 'missed_email',
              title: `Missing recipient in email from ${fromName}`,
              body: summary,
              link: '/missed-emails',
              slackText: `*Missing recipient detected*\n>*From:* ${fromName}\n>*Subject:* ${subj}\n>\n>${summary}`,
              emailSubject,
              emailHtml,
              emailType: 'recipient_gap_alert',
              idempotencyKey: `recipient-gap-${userId}-${subj.slice(0, 50)}-${new Date().toISOString().slice(0, 10)}`,
            })
          } catch (alertErr) {
            console.error('Proactive alert failed:', (alertErr as Error).message)
          }
        }
      }
    } catch (err) {
      console.error('Batch classification error:', (err as Error).message)
    }
  }

  // Auto-dismiss based on user preference
  const autoDismissDays = prefsRow?.auto_dismiss_days || 0
  if (autoDismissDays > 0) {
    const dismissCutoff = new Date(Date.now() - autoDismissDays * 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('missed_emails')
      .update({ status: 'dismissed' })
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .lt('received_at', dismissCutoff)
  }

  // Clean up: remove dismissed/replied emails older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('missed_emails')
    .delete()
    .eq('team_id', teamId)
    .in('status', ['dismissed', 'replied'])
    .lt('received_at', thirtyDaysAgo)

  const duration = Math.round((Date.now() - startTime) / 1000)
  const stats = getClassificationStats()

  await logAiUsage(supabase, { module: 'classify-missed-email', trigger: 'scan-missed-emails', teamId, userId, itemsProcessed: newEmails.length, metadata: stats })

  return {
    success: true,
    teamId,
    scanned: newEmails.length,
    missed: totalMissed,
    repliedConversationsFound: repliedConversations.size,
    stats,
    duration,
  }
}

// Run 30 min after each Outlook sync (6:30 AM, 10:30 AM, 2:30 PM, 6:30 PM PT)
// so new emails are classified within hours, not the next morning.
export const scanMissedEmails = inngest.createFunction(
  { id: 'scan-missed-emails' },
  { cron: 'TZ=America/Los_Angeles 30 6,10,14,18 * * *' },
  async ({ step }) => {
    const run = startJobRun('scan-missed-emails')

    const integrations = await step.run('fetch-integrations', async () => {
      const supabase = getAdminClient()

      const { data, error } = await supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      if (error || !data) {
        console.error('Failed to fetch Outlook integrations:', error)
        return []
      }

      console.log(`Missed email scan: ${data.length} user integration(s) to scan`)
      return data
    })

    run.meta({ integrations_found: integrations.length })

    if (integrations.length === 0) {
      await run.finish()
      return { success: false, error: 'No integrations found' }
    }

    const results = await Promise.all(
      integrations.map((integration) =>
        step.run(`scan-team-${integration.team_id}-${integration.user_id}`, async () => {
          const supabase = getAdminClient()
          try {
            const result = await scanTeamMissedEmails(
              supabase,
              integration.team_id,
              integration.user_id
            )
            console.log(`Team ${integration.team_id} missed email scan:`, result)
            if (result.success === false) {
              run.tally('failed')
            } else if ((result.missed || 0) > 0) {
              run.tally('sent', result.missed)
            } else if ((result.scanned || 0) === 0) {
              run.tally('no_data')
            } else {
              run.tally('skipped')
            }
            return result
          } catch (err) {
            console.error(`Team ${integration.team_id} scan failed:`, (err as Error).message)
            run.tally('failed')
            return { success: false, teamId: integration.team_id, error: (err as Error).message }
          }
        })
      )
    )

    await run.finish()
    return { success: true, teamsScanned: results.length, results }
  }
)
