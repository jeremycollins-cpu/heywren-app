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

const MAX_SENT_PER_RUN = 500
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

  let totalScanned = 0
  let totalAwaiting = 0
  let userEmail = ''

  // Get user email from profile for Slack scanning
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()
  userEmail = userProfile?.email?.toLowerCase() || ''

  if (integration) {
  // ── Outlook Scanning ──
  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Determine who actually owns the Outlook token by calling Graph /me
  // This prevents attributing one user's emails to another user
  let tokenOwnerUserId = userId
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: 'Bearer ' + msToken },
    })
    if (meRes.ok) {
      const meData = await meRes.json()
      const tokenEmail = (meData.mail || meData.userPrincipalName || '').toLowerCase()
      if (tokenEmail) {
        // Look up which user in our system owns this email
        const { data: tokenOwnerProfile } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('email', tokenEmail)
          .single()

        if (tokenOwnerProfile) {
          tokenOwnerUserId = tokenOwnerProfile.id
          userEmail = tokenOwnerProfile.email?.toLowerCase() || tokenEmail
        } else {
          userEmail = tokenEmail
        }
      }
    }
  } catch {
    // Fall back to the provided userId if /me call fails
  }

  // If we couldn't determine email from Graph, fall back to profile lookup
  if (!userEmail) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', tokenOwnerUserId)
      .single()
    userEmail = profile?.email?.toLowerCase() || ''
  }

  // Fetch sent items from last 30 days
  const scanWindow = new Date(Date.now() - 30 * 86400000).toISOString()
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
        user_id: tokenOwnerUserId,
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

  } // end if (integration) — Outlook scanning

  // ── Slack Scanning ──
  // Find messages the user sent in DMs/group DMs/channels that got no reply
  let slackAwaiting = 0
  try {
    const slackIntegration = await supabase
      .from('integrations')
      .select('config')
      .eq('team_id', teamId)
      .eq('provider', 'slack')
      .maybeSingle()

    if (slackIntegration?.data) {
      let slackUserId = slackIntegration.data.config?.authed_user_id || null
      const scanWindow = new Date(Date.now() - 30 * 86400000).toISOString()

      // If we don't have the authed user's Slack ID, try to find it from stored messages
      // by looking for the most frequent sender that's NOT a bot
      if (!slackUserId) {
        const { data: recentMsgs } = await supabase
          .from('slack_messages')
          .select('user_id')
          .eq('team_id', teamId)
          .gte('created_at', scanWindow)
          .limit(200)

        if (recentMsgs && recentMsgs.length > 0) {
          // Count messages per user_id, pick the most frequent human sender
          const counts = new Map<string, number>()
          for (const m of recentMsgs) {
            if (!m.user_id || m.user_id === 'unknown') continue
            // Bot IDs typically start with B, skip them
            if (m.user_id.startsWith('B')) continue
            counts.set(m.user_id, (counts.get(m.user_id) || 0) + 1)
          }
          // The user who connected Slack is likely the most active sender
          let maxCount = 0
          for (const [uid, count] of counts) {
            if (count > maxCount) {
              maxCount = count
              slackUserId = uid
            }
          }
        }
      }

      if (slackUserId) {
        // Get all stored Slack messages in the scan window
        const { data: slackMessages } = await supabase
          .from('slack_messages')
          .select('id, channel_id, user_id, message_text, message_ts, thread_ts, created_at')
          .eq('team_id', teamId)
          .gte('created_at', scanWindow)
          .order('created_at', { ascending: false })
          .limit(500)

        if (slackMessages && slackMessages.length > 0) {
          // Find messages the user sent that are in DMs/group DMs
          const userMessages = slackMessages.filter(m =>
            m.user_id === slackUserId &&
            (m.channel_id?.startsWith('D') || m.channel_id?.startsWith('G')) &&
            (m.message_text || '').trim().length >= 15
          )

          // Track which channels/threads got replies after user's message
          const repliedThreads = new Set<string>()
          for (const msg of slackMessages) {
            if (msg.user_id !== slackUserId) {
              if (msg.thread_ts) repliedThreads.add(msg.thread_ts)
              repliedThreads.add(msg.message_ts)
            }
          }

          // Check for replies after each user message in the same channel
          const channelReplies = new Map<string, number[]>()
          for (const msg of slackMessages) {
            if (msg.user_id !== slackUserId) {
              if (!channelReplies.has(msg.channel_id)) channelReplies.set(msg.channel_id, [])
              channelReplies.get(msg.channel_id)!.push(new Date(msg.created_at).getTime())
            }
          }

          // Get existing to avoid duplicates
          const { data: existingSlack } = await supabase
            .from('awaiting_replies')
            .select('source_message_id')
            .eq('team_id', teamId)
            .eq('source', 'slack')

          const existingSlackIds = new Set((existingSlack || []).map(e => e.source_message_id))

          const slackToInsert: any[] = []
          for (const msg of userMessages) {
            if (existingSlackIds.has(msg.message_ts)) continue

            // Check if anyone replied after this message in the same channel
            const msgTime = new Date(msg.created_at).getTime()
            const daysSince = Math.floor((Date.now() - msgTime) / 86400000)

            // Skip if less than 1 day old
            if (daysSince < 1) continue

            const replies = channelReplies.get(msg.channel_id) || []
            const hasReplyAfter = replies.some(t => t > msgTime)
            if (hasReplyAfter) continue

            // No reply — this is awaiting
            const text = msg.message_text || ''
            const hasQuestion = /\?|can you|could you|would you|please|need/i.test(text)
            let urgency = 'medium'
            if (daysSince > 3 && hasQuestion) urgency = 'high'
            else if (hasQuestion) urgency = 'medium'
            else urgency = 'low'

            const permalink = msg.channel_id && msg.message_ts
              ? `https://slack.com/archives/${msg.channel_id}/p${msg.message_ts.replace('.', '')}`
              : null

            slackToInsert.push({
              team_id: teamId,
              user_id: userId,
              sender_email: userEmail || null,
              source: 'slack',
              source_message_id: msg.message_ts,
              permalink,
              channel_id: msg.channel_id,
              to_recipients: 'DM participant',
              to_name: 'DM',
              subject: null,
              body_preview: text.slice(0, 500),
              sent_at: msg.created_at,
              urgency,
              category: hasQuestion ? 'question' : 'follow_up',
              wait_reason: hasQuestion ? 'Question sent with no reply' : 'Message sent with no reply',
              days_waiting: daysSince,
            })
          }

          if (slackToInsert.length > 0) {
            const { error: slackInsertErr } = await supabase
              .from('awaiting_replies')
              .upsert(slackToInsert, { onConflict: 'team_id,source_message_id' })
            if (!slackInsertErr) slackAwaiting = slackToInsert.length
          }
        }
      }
    }
  } catch (slackErr) {
    console.error('Slack awaiting scan error:', (slackErr as Error).message)
  }

  return {
    success: true,
    teamId,
    scanned: totalScanned,
    awaiting: totalAwaiting + slackAwaiting,
    slackAwaiting,
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
