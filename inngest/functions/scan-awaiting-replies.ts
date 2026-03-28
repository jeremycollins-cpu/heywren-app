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
import { WebClient } from '@slack/web-api'
import { detectCommitmentsBatch, type UserContext } from '@/lib/ai/detect-commitments'

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

  // Get Outlook integration — try user-specific first, then fall back to any team integration
  let { data: integration } = await supabase
    .from('integrations')
    .select('id, user_id, access_token, refresh_token, config')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .single()

  if (!integration) {
    console.log(`Outlook scan: no integration found for user ${userId} on team ${teamId}`)
  }

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

  console.log(`Awaiting replies scan: userId=${userId}, teamId=${teamId}, userEmail=${userEmail}, hasIntegration=${!!integration}`)

  if (integration) {
  // ── Outlook Scanning ──
  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Determine who actually owns the Outlook token by calling Graph /me
  // This prevents attributing one user's emails to another user
  let tokenVerified = false
  try {
    let meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: 'Bearer ' + msToken },
    })
    // If token is expired, refresh and retry the /me call
    if (meRes.status === 401) {
      const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
      if (newToken) {
        msToken = newToken
        meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
          headers: { Authorization: 'Bearer ' + msToken },
        })
      }
    }
    if (meRes.ok) {
      const meData = await meRes.json()
      const tokenEmail = (meData.mail || meData.userPrincipalName || '').toLowerCase()
      if (tokenEmail) {
        // Verify the token belongs to the calling user by checking email match
        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', userId)
          .single()
        const callerEmail = callerProfile?.email?.toLowerCase() || ''

        if (callerEmail && tokenEmail === callerEmail) {
          tokenVerified = true
          userEmail = callerEmail
        } else if (!callerEmail) {
          // If we can't look up caller email, trust the token but use caller's userId
          tokenVerified = true
          userEmail = tokenEmail
        } else {
          // Token belongs to a different user — don't scan
          console.warn(`Token owner "${tokenEmail}" does not match caller "${callerEmail}" for userId=${userId} — skipping Outlook scan`)
        }
      }
    }
  } catch {
    // Cannot verify token owner — skip Outlook scan to prevent data leakage
  }

  // SAFETY: If we couldn't verify the token owner, skip Outlook scanning entirely.
  // This prevents attributing one user's emails to another user when the /me call fails.
  console.log(`Outlook token verification: tokenVerified=${tokenVerified}, userEmail=${userEmail}, userId=${userId}`)
  if (!tokenVerified) {
    console.warn(`Skipping Outlook scan for user ${userId} — could not verify token owner via Graph /me`)
  } else {

  // If we couldn't determine email from Graph, fall back to profile lookup
  if (!userEmail) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()
    userEmail = profile?.email?.toLowerCase() || ''
  }

  // Fetch sent items from last 30 days
  const scanWindow = new Date(Date.now() - 30 * 86400000).toISOString()
  const filter = encodeURIComponent(`sentDateTime ge ${scanWindow} and isDraft eq false`)
  const selectFields = 'id,subject,bodyPreview,toRecipients,sentDateTime,conversationId,webLink,meetingMessageType'

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

      // SAFETY: Verify the sender email matches the expected user
      // This prevents cross-user data leakage if a shared/delegated token returns other users' emails
      const senderEmail = (msg.sender?.emailAddress?.address || msg.from?.emailAddress?.address || '').toLowerCase()
      if (userEmail && senderEmail && senderEmail !== userEmail) continue

      const conversationId = msg.conversationId || ''
      const subject = msg.subject || ''
      const bodyPreview = msg.bodyPreview || ''
      const sentAt = msg.sentDateTime || new Date().toISOString()
      const webLink = msg.webLink || ''

      // Skip if conversation already has a reply
      if (conversationId && repliedConversations.has(conversationId)) continue

      // Skip very short messages (likely auto-replies or forwards)
      if (bodyPreview.length < 20) continue

      // Skip meeting/calendar messages — Graph API flags these with meetingMessageType
      if (msg.meetingMessageType && msg.meetingMessageType !== 'none') continue

      // Skip calendar-related and automated subjects
      const subjectLower = subject.toLowerCase()
      if (subjectLower.startsWith('accepted:') || subjectLower.startsWith('declined:') ||
          subjectLower.startsWith('tentative:') || subjectLower.startsWith('canceled:') ||
          subjectLower.startsWith('cancelled:') ||
          subjectLower.includes('out of office') || subjectLower.includes('automatic reply')) {
        continue
      }

      // Skip calendar/meeting invite emails (body contains meeting join links or agenda patterns)
      const bodyLower = bodyPreview.toLowerCase()
      if (bodyLower.includes('join the meeting now') || bodyLower.includes('microsoft teams meeting') ||
          bodyLower.includes('join zoom meeting') || bodyLower.includes('zoom.us/j/') ||
          bodyLower.includes('you updated the meeting for') || bodyLower.includes('meet.google.com/') ||
          bodyLower.includes('meeting id:') || bodyLower.includes('dial-in number') ||
          bodyLower.includes('join on your computer') || bodyLower.includes('click here to join')) {
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
    .eq('user_id', userId)
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

  } // end if (tokenVerified)
  } // end if (integration) — Outlook scanning

  // ── Slack Setup ──
  // Query Slack integration once and set up name resolution helpers
  const slackIntResult = await supabase
    .from('integrations')
    .select('config, access_token')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('provider', 'slack')
    .maybeSingle()

  const slackIntData = slackIntResult?.data
  const slackToken = slackIntData?.access_token
  const slack = slackToken ? new WebClient(slackToken) : null

  // Caches for resolving Slack user IDs → display names and channel IDs → names
  const userNameCache = new Map<string, string>()
  const channelNameCache = new Map<string, string>()

  async function resolveSlackUser(uid: string): Promise<string> {
    if (userNameCache.has(uid)) return userNameCache.get(uid)!
    if (!slack) return uid
    try {
      const result = await slack.users.info({ user: uid })
      const u = result.user
      const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name || uid
      userNameCache.set(uid, name)
      return name
    } catch { return uid }
  }

  async function resolveSlackChannel(chId: string): Promise<string> {
    if (channelNameCache.has(chId)) return channelNameCache.get(chId)!
    if (!slack) return chId
    try {
      const result = await slack.conversations.info({ channel: chId })
      const ch = result.channel as { name?: string; is_im?: boolean; user?: string }
      if (ch?.name) {
        channelNameCache.set(chId, ch.name)
        return ch.name
      } else if (ch?.is_im && ch?.user) {
        const dmName = await resolveSlackUser(ch.user)
        channelNameCache.set(chId, dmName)
        return dmName
      }
    } catch { /* skip */ }
    return chId
  }

  async function resolveSlackMentions(text: string): Promise<string> {
    const mentionPattern = /<@([A-Z0-9]+)>/g
    const matches = [...text.matchAll(mentionPattern)]
    if (matches.length === 0) return text
    let resolved = text
    for (const match of matches) {
      const name = await resolveSlackUser(match[1])
      resolved = resolved.replace(match[0], `@${name}`)
    }
    return resolved
  }

  // ── Slack Scanning ──
  // Find messages the user sent in DMs/group DMs/channels that got no reply
  let slackAwaiting = 0
  try {
    if (slackIntData) {
      let slackUserId = slackIntData.config?.authed_user_id || null
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
          // Find messages the user sent (DMs, group DMs, AND channels)
          const userMessages = slackMessages.filter(m =>
            m.user_id === slackUserId &&
            (m.message_text || '').trim().length >= 15
          )

          // Track thread replies (someone replied in the thread the user started)
          const repliedThreads = new Set<string>()
          for (const msg of slackMessages) {
            if (msg.user_id !== slackUserId && msg.thread_ts) {
              repliedThreads.add(msg.thread_ts)
            }
          }

          // For DMs/group DMs: any message from someone else counts as a reply
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
            .eq('user_id', userId)
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

            const isDM = msg.channel_id?.startsWith('D') || msg.channel_id?.startsWith('G')
            if (isDM) {
              // For DMs: any message from someone else after this counts as a reply
              const replies = channelReplies.get(msg.channel_id) || []
              const hasReplyAfter = replies.some(t => t > msgTime)
              if (hasReplyAfter) continue
            } else {
              // For channels: only a thread reply to THIS message counts
              // The user's message_ts becomes the thread_ts for replies
              if (repliedThreads.has(msg.message_ts)) continue
            }

            // No reply — this is awaiting
            const text = msg.message_text || ''
            const hasQuestion = /\?|can you|could you|would you|please|need/i.test(text)
            let urgency = 'medium'
            if (daysSince > 7) urgency = 'critical'
            else if (daysSince > 3 && hasQuestion) urgency = 'high'
            else if (hasQuestion) urgency = 'medium'
            else urgency = 'low'

            const permalink = msg.channel_id && msg.message_ts
              ? `https://slack.com/archives/${msg.channel_id}/p${msg.message_ts.replace('.', '')}`
              : null

            // Resolve channel/DM names to human-readable labels
            const channelName = await resolveSlackChannel(msg.channel_id)
            const resolvedText = await resolveSlackMentions(text)
            let recipientLabel: string
            let nameLabel: string
            if (isDM) {
              // For DMs, the channel name resolves to the other person's name
              recipientLabel = channelName !== msg.channel_id ? channelName : 'DM participant'
              nameLabel = recipientLabel
            } else {
              recipientLabel = channelName !== msg.channel_id ? `#${channelName}` : 'Channel member'
              nameLabel = channelName !== msg.channel_id ? channelName : msg.channel_id
            }

            slackToInsert.push({
              team_id: teamId,
              user_id: userId,
              source: 'slack',
              source_message_id: msg.message_ts,
              permalink,
              channel_id: msg.channel_id,
              channel_name: channelName !== msg.channel_id ? channelName : null,
              to_recipients: recipientLabel,
              to_name: nameLabel,
              subject: null,
              body_preview: resolvedText.slice(0, 500),
              sent_at: msg.created_at,
              urgency,
              category: hasQuestion ? 'question' : 'follow_up',
              wait_reason: hasQuestion ? 'Question sent — no reply' : 'Message sent — no reply',
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

  // ── AI-based Inbound Commitment Detection ──
  // Scan OTHER people's Slack messages for promises made TO the user
  // (e.g. "I will report back", "I'll reach out and let you know")
  let inboundDetected = 0
  try {
    const scanWindow = new Date(Date.now() - 30 * 86400000).toISOString()

    // Get user profile for AI context
    const { data: userProfile2 } = await supabase
      .from('profiles')
      .select('display_name, slack_user_id')
      .eq('id', userId)
      .single()

    if (userProfile2?.display_name || userProfile2?.slack_user_id) {
      const userName = userProfile2.display_name || 'the user'
      const userContext: UserContext = {
        userName,
        slackUserId: userProfile2.slack_user_id || null,
      }

      const userSlackId = userProfile2.slack_user_id

      // Get messages from OTHER people (not the user) that haven't been
      // checked for inbound commitments yet
      const { data: otherMessages } = await supabase
        .from('slack_messages')
        .select('id, channel_id, user_id, message_text, message_ts, created_at')
        .eq('team_id', teamId)
        .gte('created_at', scanWindow)
        .neq('user_id', userSlackId || '__none__')
        .order('created_at', { ascending: false })
        .limit(200)

      console.log(`Inbound scan: found ${otherMessages?.length || 0} messages from other people`)

      if (otherMessages && otherMessages.length > 0) {
        // Filter to messages with commitment-like language
        const candidates = otherMessages.filter(m => {
          const text = (m.message_text || '').toLowerCase()
          return text.length >= 15 && (
            /\bi('ll|'ll| will)\b/.test(text) ||
            /\blet me\b/.test(text) ||
            /\bi('m going to|'m going to)\b/.test(text) ||
            /\bget back to\b/.test(text) ||
            /\breport back\b/.test(text) ||
            /\bfollow[- ]?up\b/.test(text) ||
            /\breach out\b/.test(text) ||
            /\bwill (send|check|look|get|do|handle|take care)\b/.test(text)
          )
        })

        console.log(`Inbound scan: ${candidates.length} messages have commitment-like language`)

        if (candidates.length > 0) {
          // Get existing awaiting_replies to avoid duplicates
          const { data: existingAR } = await supabase
            .from('awaiting_replies')
            .select('source_message_id')
            .eq('team_id', teamId)
            .eq('source', 'slack')

          const existingIds = new Set((existingAR || []).map(e => e.source_message_id))
          const newCandidates = candidates.filter(m => !existingIds.has(m.message_ts))

          if (newCandidates.length > 0) {
            // Batch AI detection (up to 15 at a time)
            const batch = newCandidates.slice(0, 15).map(m => ({
              id: m.message_ts,
              text: m.message_text,
            }))

            const batchResults = await detectCommitmentsBatch(batch, userContext)

            for (const msg of newCandidates.slice(0, 15)) {
              const commitments = batchResults.get(msg.message_ts) || []
              const inbound = commitments.filter(c => c.direction === 'inbound')

              for (const commitment of inbound) {
                const permalink = msg.channel_id && msg.message_ts
                  ? `https://slack.com/archives/${msg.channel_id}/p${msg.message_ts.replace('.', '')}`
                  : null
                const daysSince = Math.floor((Date.now() - new Date(msg.created_at).getTime()) / 86400000)

                // Resolve the sender's name from their Slack user ID
                const senderName = await resolveSlackUser(msg.user_id)
                const rawPromiser = commitment.promiserName
                // Treat AI placeholders like "<UNKNOWN>", "Unknown", "Someone" as empty
                const isPlaceholder = !rawPromiser || /^(<?\s*unknown\s*>?|someone|they|them)$/i.test(rawPromiser)
                const promiserDisplay = isPlaceholder
                  ? (senderName !== msg.user_id ? senderName : 'Someone')
                  : rawPromiser
                const channelName = await resolveSlackChannel(msg.channel_id)
                const resolvedQuote = await resolveSlackMentions(
                  commitment.originalQuote || commitment.description || ''
                )

                const { error: insertErr } = await supabase
                  .from('awaiting_replies')
                  .upsert({
                    team_id: teamId,
                    user_id: userId,
                    source: 'slack',
                    source_message_id: msg.message_ts,
                    permalink,
                    channel_id: msg.channel_id,
                    channel_name: channelName !== msg.channel_id ? channelName : null,
                    to_recipients: promiserDisplay,
                    to_name: promiserDisplay,
                    subject: commitment.title,
                    body_preview: resolvedQuote.slice(0, 500),
                    sent_at: msg.created_at,
                    urgency: daysSince > 7 ? 'critical' : daysSince > 3 ? 'high' : 'medium',
                    category: 'follow_up',
                    wait_reason: `${promiserDisplay} promised: ${commitment.title}`,
                    days_waiting: daysSince,
                    status: 'waiting',
                  }, { onConflict: 'team_id,source_message_id' })

                if (!insertErr) inboundDetected++
              }
            }
          }
        }
      }
    }
  } catch (inboundErr) {
    console.error('Inbound commitment scan error:', (inboundErr as Error).message)
  }

  // ── Backfill: fix existing Slack awaiting_replies with raw IDs ──
  try {
    if (slack) {

      // Find Slack items with raw channel IDs as to_name (e.g. "C0AGV1G5FGA" or "DM")
      const { data: rawItems } = await supabase
        .from('awaiting_replies')
        .select('id, to_name, to_recipients, channel_id, body_preview, wait_reason')
        .eq('team_id', teamId)
        .eq('source', 'slack')
        .in('status', ['waiting', 'snoozed'])
        .limit(200)

      if (rawItems && rawItems.length > 0) {
        for (const item of rawItems) {
          const updates: Record<string, string> = {}

          // Fix to_name if it's a raw channel ID or generic label
          if (item.to_name && /^[CDG][A-Z0-9]{8,}$/.test(item.to_name)) {
            const resolved = await resolveSlackChannel(item.to_name)
            if (resolved !== item.to_name) {
              updates.to_name = resolved
              const isDM = item.to_name.startsWith('D') || item.to_name.startsWith('G')
              updates.to_recipients = isDM ? resolved : `#${resolved}`
              updates.channel_name = resolved
            }
          }

          // Fix to_recipients if it's a raw channel ID
          if (item.to_recipients && /^[CDG][A-Z0-9]{8,}$/.test(item.to_recipients) && item.channel_id) {
            const resolved = await resolveSlackChannel(item.channel_id)
            if (resolved !== item.channel_id) {
              updates.to_recipients = `#${resolved}`
              if (!updates.to_name) updates.to_name = resolved
            }
          }

          // Fix <@U...> mentions in body_preview
          if (item.body_preview && /<@[A-Z0-9]+>/.test(item.body_preview)) {
            const fixed = await resolveSlackMentions(item.body_preview)
            if (fixed !== item.body_preview) updates.body_preview = fixed
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from('awaiting_replies')
              .update(updates)
              .eq('id', item.id)
          }
        }
      }
    }
  } catch (backfillErr) {
    console.error('Backfill name resolution error:', (backfillErr as Error).message)
  }

  return {
    success: true,
    teamId,
    scanned: totalScanned,
    awaiting: totalAwaiting + slackAwaiting + inboundDetected,
    slackAwaiting,
    inboundDetected,
    duration: Date.now() - startTime,
  }
}

export const scanAwaitingReplies = inngest.createFunction(
  { id: 'scan-awaiting-replies', name: 'Scan for awaiting replies' },
  { cron: '0 14 * * *' }, // 7 AM PT (14:00 UTC)
  async ({ step }) => {
    const results = await step.run('scan-all-teams', async () => {
      const supabase = getAdminClient()

      // Get all users with Outlook integrations
      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      if (!integrations || integrations.length === 0) {
        return { teamsProcessed: 0 }
      }

      const teamResults: any[] = []

      for (const int of integrations) {
        try {
          const result = await scanTeamAwaitingReplies(supabase, int.team_id, int.user_id)
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
