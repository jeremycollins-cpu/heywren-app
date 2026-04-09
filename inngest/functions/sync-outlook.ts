import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, getDetectionStats, calculatePriorityScore } from '@/lib/ai/detect-commitments'
import { insertCommitmentIfNotDuplicate, buildCommitmentMetadata } from '@/lib/ai/dedup-commitments'

// Re-export so drain-outlook-backlog's existing import still works
export { insertCommitmentIfNotDuplicate, buildCommitmentMetadata }

const MAX_MESSAGES_PER_RUN = 100
const TIME_BUDGET_MS = 240000

// Pre-AI filter: skip emails that will never contain commitments
const SKIP_SENDER_PATTERNS = [
  /noreply@/i, /no-reply@/i, /donotreply@/i, /do-not-reply@/i,
  /notifications?@/i, /alerts?@/i, /mailer-daemon@/i, /postmaster@/i,
  /bounce@/i, /news@/i, /newsletter@/i, /updates?@/i, /marketing@/i,
  /promo(tions)?@/i, /digest@/i, /automated@/i, /system@/i,
]

const SKIP_SUBJECT_PATTERNS = [
  /\bunsubscribe\b/i, /\bnewsletter\b/i, /\bdigest\b/i,
  /\b(weekly|daily|monthly) (update|summary|recap|report)\b/i,
  /\bout of office\b/i, /\bautomatic reply\b/i, /\bautoreply\b/i,
  /\bpassword reset\b/i, /\bverify your (email|account)\b/i,
  /\bPR #\d+/i, /\b\[JIRA\]/i, /\b\[GitHub\]/i,
  /\bbuild (passed|failed)\b/i, /\bpipeline (passed|failed)\b/i,
  /\bCI\/CD\b/i, /\bdeployment (succeeded|failed)\b/i,
  /\breceipt for\b/i, /\binvoice #/i, /\border confirm/i,
]

function shouldSkipEmail(fromEmail: string, subject: string): boolean {
  if (SKIP_SENDER_PATTERNS.some(p => p.test(fromEmail))) return true
  if (SKIP_SUBJECT_PATTERNS.some(p => p.test(subject))) return true
  return false
}

// Pre-AI filter for calendar events: skip events unlikely to contain user-specific commitments
const SKIP_MEETING_PATTERNS = [
  /\ball[- ]?hands\b/i, /\btown hall\b/i, /\bcompany (meeting|update|sync)\b/i,
  /\bstandup\b/i, /\bstand-up\b/i, /\bdaily scrum\b/i,
  /\bhappy hour\b/i, /\blunch\b/i, /\bsocial\b/i, /\bcelebrat/i,
  /\bholiday\b/i, /\bbirthday\b/i, /\banniversary\b/i,
  /\btraining session\b/i, /\bwebinar\b/i, /\bworkshop\b/i,
  /\boffice hours\b/i, /\bopen forum\b/i,
  /\bblocked\b/i, /\bfocus time\b/i, /\bdo not book\b/i, /\bbusy\b/i,
  /\bout of office\b/i, /\bOOO\b/, /\bvacation\b/i, /\bPTO\b/,
]

const CONFERENCE_LINK_PATTERNS = [
  /https?:\/\/\S*(zoom|teams|meet|webex)\S*/gi,
  /join.*meeting/gi,
  /meeting id[:\s]*\d+/gi,
  /dial[- ]in/gi,
  /passcode/gi,
]

function shouldSkipCalendarEvent(subject: string, attendeeCount: number, bodyPreview: string, eventType?: string): boolean {
  // Skip recurring meetings — they happen automatically and won't slip through the cracks
  // Microsoft Graph: type="occurrence" for recurring instances, "seriesMaster" for the series definition
  if (eventType === 'occurrence' || eventType === 'seriesMaster') return true

  // Skip large meetings (6+ attendees) — too generic for personal commitments
  if (attendeeCount >= 6) return true

  // Skip known non-commitment meeting types
  if (SKIP_MEETING_PATTERNS.some(p => p.test(subject))) return true

  // Skip meetings where body is only conference links / no real content
  if (bodyPreview) {
    let stripped = bodyPreview
    for (const p of CONFERENCE_LINK_PATTERNS) {
      stripped = stripped.replace(p, '')
    }
    // After stripping links, if less than 30 chars of real content, skip
    stripped = stripped.replace(/\s+/g, ' ').trim()
    if (stripped.length < 30) return true
  } else {
    // No body at all — nothing to extract commitments from
    return true
  }

  return false
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshMicrosoftToken(
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const tokenRes = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.AZURE_AD_CLIENT_ID!,
          client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'openid profile email Mail.Read Calendars.ReadWrite User.Read offline_access',
        }),
      }
    )

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      console.error('Token refresh failed:', tokenData.error_description || tokenData.error)
      return null
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    await supabase
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        config: { token_expires_at: expiresAt },
      })
      .eq('id', integrationId)

    return tokenData.access_token
  } catch (err) {
    console.error('Token refresh error:', (err as Error).message)
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
    if (!newToken) {
      return { data: { error: 'Token refresh failed' }, token: currentToken }
    }
    currentToken = newToken
    const retryRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + currentToken },
    })
    return { data: await retryRes.json(), token: currentToken }
  }

  return { data: await res.json(), token: currentToken }
}

export async function syncTeamOutlook(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string,
  integration: { id: string; access_token: string; refresh_token: string; config: any },
  options?: { daysBack?: number }
) {
  const startTime = Date.now()
  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Proactive token refresh
  const tokenExpiresAt = integration.config?.token_expires_at
  if (tokenExpiresAt && new Date(tokenExpiresAt) < new Date()) {
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (newToken) {
      msToken = newToken
    } else {
      console.error(`Team ${teamId}: Token expired, skipping`)

      // Notify the user their Outlook connection needs re-authorization
      await supabase.from('notifications').insert({
        user_id: userId,
        team_id: teamId,
        type: 'integration_error',
        title: 'Outlook connection expired',
        body: 'Your Outlook token has expired. Please reconnect your account so Wren can continue scanning your emails and calendar.',
        link: '/integrations',
        read: false,
      })

      return { success: false, error: 'token_expired' }
    }
  }

  let totalCommitments = 0
  let totalEmails = 0
  let totalNewEmails = 0

  // Phase 1: Process unprocessed stored messages
  const { data: unprocessed } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at, web_link, conversation_id')
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  if (unprocessed && unprocessed.length > 0) {
    const batch: Array<{ id: string; text: string; dbId: string; webLink?: string; conversationId?: string }> = []

    for (const msg of unprocessed) {
      const preview = msg.body_preview || ''
      // Skip short messages, automated senders, and newsletter subjects
      if (preview.length < 20 || shouldSkipEmail(msg.from_email || '', msg.subject || '')) {
        await supabase
          .from('outlook_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', msg.id)
        totalEmails++
        continue
      }

      const messageText = [
        'From: ' + (msg.from_name || '') + ' <' + (msg.from_email || '') + '>',
        'To: ' + (msg.to_recipients || ''),
        'Subject: ' + (msg.subject || '(no subject)'),
        'Date: ' + msg.received_at,
        '',
        preview,
      ].join('\n')

      batch.push({ id: msg.message_id, text: messageText, dbId: msg.id, webLink: msg.web_link || undefined, conversationId: msg.conversation_id || undefined })
    }

    for (let i = 0; i < batch.length; i += 15) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break
      const chunk = batch.slice(i, i + 15)
      try {
        const batchInput = chunk.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        for (const item of chunk) {
          const commitments = batchResults.get(item.id) || []
          let inserted = 0
          for (const commitment of commitments) {
            const ok = await insertCommitmentIfNotDuplicate(supabase, commitment, {
              teamId,
              userId,
              source: 'outlook',
              sourceRef: item.dbId,
              sourceUrl: item.webLink,
              conversationId: item.conversationId,
            })
            if (ok) inserted++
          }
          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: inserted })
            .eq('id', item.dbId)
          totalEmails++
          totalCommitments += inserted
        }
      } catch (err) {
        console.error('Batch AI error:', (err as Error).message)
        // Mark failed messages as processed to prevent infinite retry loop
        for (const item of chunk) {
          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: 0 })
            .eq('id', item.dbId)
          totalEmails++
        }
      }
    }
  }

  // Phase 1b: Process unprocessed Slack messages for this user's team
  try {
    const { data: slackProfile } = await supabase
      .from('profiles')
      .select('slack_user_id')
      .eq('id', userId)
      .single()

    if (slackProfile?.slack_user_id) {
      const { data: unprocessedSlack } = await supabase
        .from('slack_messages')
        .select('id, message_text, user_id')
        .eq('team_id', teamId)
        .eq('processed', false)
        .limit(50)

      if (unprocessedSlack?.length) {
        for (const msg of unprocessedSlack) {
          // Mark short/empty messages as processed
          if (!msg.message_text || msg.message_text.trim().length < 15) {
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', msg.id)
          }
          // Longer messages that are stuck — mark processed to clear backlog
          // (they should have been processed by the real-time event handler)
          else {
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', msg.id)
          }
        }
      }
    }
  } catch {
    console.warn('Slack backlog cleanup skipped')
  }

  // Folder name cache — resolves Graph folder IDs to display names
  const folderNameCache = new Map<string, string>()
  async function resolveFolderName(folderId: string | undefined | null): Promise<string | null> {
    if (!folderId) return null
    if (folderNameCache.has(folderId)) return folderNameCache.get(folderId) || null
    try {
      const { data: folderData, token: updatedToken } = await graphFetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}?$select=displayName`,
        msToken, supabase, integrationId, refreshToken
      )
      msToken = updatedToken
      const name = folderData?.displayName || null
      folderNameCache.set(folderId, name || '')
      return name
    } catch {
      folderNameCache.set(folderId, '')
      return null
    }
  }

  // Phase 2: Fetch new emails (default 1 day for daily sync, configurable for backfill)
  if (Date.now() - startTime < TIME_BUDGET_MS) {
    const syncDays = options?.daysBack || 1
    const oldestDate = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000).toISOString()
    const baseFilter = encodeURIComponent(`receivedDateTime ge ${oldestDate} and isDraft eq false`)
    const selectFields = 'id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,conversationId,isRead,webLink,parentFolderId'
    let nextLink: string | null =
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${baseFilter}&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`

    while (nextLink && Date.now() - startTime < TIME_BUDGET_MS && totalNewEmails < MAX_MESSAGES_PER_RUN) {
      const { data: pageData, token: updatedToken } = await graphFetch(
        nextLink, msToken, supabase, integrationId, refreshToken
      )
      msToken = updatedToken

      if (pageData.error) break

      const emails = pageData.value || []
      const batch: Array<{ id: string; text: string; dbId: string; webLink?: string; conversationId?: string }> = []

      for (const email of emails) {
        totalEmails++
        const preview = email.bodyPreview || ''
        const emailFrom = email.from?.emailAddress?.address || ''
        const emailSubject = email.subject || ''
        if (preview.length < 20 || shouldSkipEmail(emailFrom, emailSubject)) continue

        const { data: existing } = await supabase
          .from('outlook_messages')
          .select('id, processed')
          .eq('team_id', teamId)
          .eq('user_id', userId)
          .eq('message_id', email.id)
          .maybeSingle()

        if (existing && existing.processed) continue

        const fromName = email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown'
        const fromEmail = email.from?.emailAddress?.address || ''
        const toList = (email.toRecipients || [])
          .map((r: any) => r.emailAddress?.name || r.emailAddress?.address || '')
          .join(', ')
        const ccList = (email.ccRecipients || [])
          .map((r: any) => r.emailAddress?.name || r.emailAddress?.address || '')
          .join(', ')
        const subject = email.subject || '(no subject)'

        const messageText = [
          'From: ' + fromName + ' <' + fromEmail + '>',
          'To: ' + toList,
          'Subject: ' + subject,
          'Date: ' + email.receivedDateTime,
          '',
          preview,
        ].join('\n')

        let dbId: string
        if (existing && !existing.processed) {
          dbId = existing.id
        } else {
          const folderName = await resolveFolderName(email.parentFolderId)
          const { data: messageData, error: msgErr } = await supabase
            .from('outlook_messages')
            .insert({
              team_id: teamId,
              user_id: userId,
              message_id: email.id,
              conversation_id: email.conversationId || null,
              from_name: fromName,
              from_email: fromEmail,
              to_recipients: toList,
              cc_recipients: ccList || null,
              subject,
              body_preview: preview,
              received_at: email.receivedDateTime,
              processed: false,
              is_read: email.isRead ?? true,
              folder_id: email.parentFolderId || null,
              folder_name: folderName,
            })
            .select()
            .single()

          if (msgErr) continue
          dbId = messageData.id
        }

        totalNewEmails++
        batch.push({ id: email.id, text: messageText, dbId, webLink: email.webLink || undefined, conversationId: email.conversationId || undefined })
      }

      if (batch.length > 0) {
        try {
          const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
          const batchResults = await detectCommitmentsBatch(batchInput)

          for (const item of batch) {
            const commitments = batchResults.get(item.id) || []
            let inserted = 0
            for (const commitment of commitments) {
              const ok = await insertCommitmentIfNotDuplicate(supabase, commitment, {
                teamId,
                userId,
                source: 'outlook',
                sourceRef: item.dbId,
                sourceUrl: item.webLink,
                conversationId: item.conversationId,
              })
              if (ok) inserted++
            }
            totalCommitments += inserted
            await supabase
              .from('outlook_messages')
              .update({ processed: true, commitments_found: inserted })
              .eq('id', item.dbId)
          }
        } catch (err) {
          console.error('Batch AI error:', (err as Error).message)
          // Mark failed messages as processed to prevent infinite retry loop
          for (const item of batch) {
            await supabase
              .from('outlook_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', item.dbId)
          }
        }
      }

      nextLink = pageData['@odata.nextLink'] || null
      if (nextLink) await sleep(500)
    }
  }

  // Phase 3: Calendar events (next 2 weeks)
  let calendarCommitments = 0
  let calendarEventsScanned = 0

  if (Date.now() - startTime < TIME_BUDGET_MS) {
    const now = new Date()
    const calDaysBack = options?.daysBack || 1
    const startDate = new Date(now.getTime() - calDaysBack * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const calendarUrl =
      `https://graph.microsoft.com/v1.0/me/calendarview` +
      `?startDateTime=${startDate}&endDateTime=${endDate}` +
      `&$select=id,subject,organizer,attendees,start,end,location,bodyPreview,isCancelled,type,seriesMasterId` +
      `&$orderby=start/dateTime desc&$top=50`

    let calNextLink: string | null = calendarUrl

    while (calNextLink && Date.now() - startTime < TIME_BUDGET_MS) {
      const { data: calData, token: updatedToken } = await graphFetch(
        calNextLink, msToken, supabase, integrationId, refreshToken
      )
      msToken = updatedToken

      if (calData.error) break

      const events = calData.value || []
      const calBatch: Array<{ id: string; text: string; dbId: string }> = []

      for (const event of events) {
        calendarEventsScanned++
        if (event.isCancelled) continue

        const subject = event.subject || '(no subject)'
        const bodyPreview = event.bodyPreview || ''
        const organizerName = event.organizer?.emailAddress?.name || ''
        const organizerEmail = event.organizer?.emailAddress?.address || ''
        const attendees = (event.attendees || []).map((a: any) => ({
          name: a.emailAddress?.name || '',
          email: a.emailAddress?.address || '',
          response: a.status?.response || 'none',
        }))
        const eventStartTime = event.start?.dateTime || ''
        const endTime = event.end?.dateTime || ''
        const location = event.location?.displayName || ''

        // Pre-AI filter: skip recurring, large meetings, blocked time, and events with no real body
        if (shouldSkipCalendarEvent(subject, attendees.length, bodyPreview, event.type)) {
          // Still store the event for display, but mark as processed immediately
          const { data: existing } = await supabase
            .from('outlook_calendar_events')
            .select('id')
            .eq('team_id', teamId)
            .eq('user_id', userId)
            .eq('event_id', event.id)
            .maybeSingle()

          if (!existing) {
            await supabase.from('outlook_calendar_events').insert({
              team_id: teamId, user_id: userId, event_id: event.id,
              subject, organizer_name: organizerName, organizer_email: organizerEmail,
              attendees, start_time: eventStartTime, end_time: endTime,
              location, body_preview: bodyPreview, is_cancelled: false,
              processed: true, commitments_found: 0,
            })
          }
          continue
        }

        const { data: existing } = await supabase
          .from('outlook_calendar_events')
          .select('id, processed')
          .eq('team_id', teamId)
          .eq('user_id', userId)
          .eq('event_id', event.id)
          .maybeSingle()

        if (existing && existing.processed) continue

        let dbId: string
        if (existing && !existing.processed) {
          dbId = existing.id
        } else {
          const { data: eventData, error: evErr } = await supabase
            .from('outlook_calendar_events')
            .insert({
              team_id: teamId,
              user_id: userId,
              event_id: event.id,
              subject,
              organizer_name: organizerName,
              organizer_email: organizerEmail,
              attendees,
              start_time: eventStartTime,
              end_time: endTime,
              location,
              body_preview: bodyPreview,
              is_cancelled: false,
              processed: false,
            })
            .select()
            .single()

          if (evErr) continue
          dbId = eventData.id
        }

        const attendeeList = attendees
          .map((a: { name: string; email: string }) => a.name || a.email)
          .join(', ')

        const eventText = [
          'Calendar Event: ' + subject,
          'Organizer: ' + organizerName + ' <' + organizerEmail + '>',
          'Attendees: ' + attendeeList,
          'When: ' + eventStartTime + ' to ' + endTime,
          location ? 'Location: ' + location : '',
          '',
          bodyPreview,
        ].filter(Boolean).join('\n')

        calBatch.push({ id: event.id, text: eventText, dbId })
      }

      if (calBatch.length > 0) {
        try {
          const batchInput = calBatch.map((b) => ({ id: b.id, text: b.text }))
          const batchResults = await detectCommitmentsBatch(batchInput)

          for (const item of calBatch) {
            const commitments = batchResults.get(item.id) || []
            for (const commitment of commitments) {
              const { error: commitErr } = await supabase.from('commitments').insert({
                team_id: teamId,
                creator_id: userId,
                title: commitment.title || 'Untitled commitment',
                description: commitment.description || null,
                status: 'open',
                priority_score: calculatePriorityScore(commitment),
                source: 'calendar',
                source_ref: item.dbId,
                category: commitment.commitmentType || null,
                metadata: buildCommitmentMetadata(commitment),
              })
              if (!commitErr) {
                calendarCommitments++
                totalCommitments++
              }
            }
            await supabase
              .from('outlook_calendar_events')
              .update({ processed: true, commitments_found: commitments.length })
              .eq('id', item.dbId)
          }
        } catch (err) {
          console.error('Calendar batch AI error:', (err as Error).message)
          for (const item of calBatch) {
            await supabase
              .from('outlook_calendar_events')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', item.dbId)
          }
        }
      }

      calNextLink = calData['@odata.nextLink'] || null
      if (calNextLink) await sleep(500)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  return {
    success: true,
    teamId,
    emails: totalEmails,
    newEmails: totalNewEmails,
    calendarEvents: calendarEventsScanned,
    calendarCommitments,
    totalCommitments,
    duration,
  }
}

// Sync every 4 hours during business hours (6 AM, 10 AM, 2 PM, 6 PM PT)
// so new emails are picked up within hours, not the next morning.
export const syncOutlook = inngest.createFunction(
  { id: 'sync-outlook-daily' },
  { cron: 'TZ=America/Los_Angeles 0 6,10,14,18 * * *' },
  async () => {
    const supabase = getAdminClient()

    // Get all users with active Outlook integrations
    const { data: integrations, error } = await supabase
      .from('integrations')
      .select('id, team_id, user_id, access_token, refresh_token, config')
      .eq('provider', 'outlook')

    if (error || !integrations) {
      console.error('Failed to fetch Outlook integrations:', error)
      return { success: false, error: error?.message }
    }

    console.log(`Outlook daily sync: ${integrations.length} user integration(s) to sync`)

    const results = []
    let hasBacklog = false

    for (const integration of integrations) {
      const syncUserId = integration.user_id

      try {
        const result = await syncTeamOutlook(supabase, integration.team_id, syncUserId, integration)
        results.push(result)
        console.log(`User ${syncUserId} (team ${integration.team_id}) sync complete:`, result)

        // Check if there are still unprocessed messages after this run
        const { count } = await supabase
          .from('outlook_messages')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', integration.team_id)
          .or(`user_id.eq.${syncUserId},user_id.is.null`)
          .eq('processed', false)
        if (count && count > 0) hasBacklog = true
      } catch (err) {
        console.error(`User ${syncUserId} (team ${integration.team_id}) sync failed:`, (err as Error).message)
        results.push({ success: false, teamId: integration.team_id, userId: syncUserId, error: (err as Error).message })
      }
    }

    // If any user still has unprocessed messages, trigger the backlog drain
    if (hasBacklog) {
      console.log('Outlook sync: backlog detected, triggering drain job')
      await inngest.send({ name: 'outlook/drain-backlog', data: {} })
    }

    return { success: true, teamsSynced: results.length, results }
  }
)

// Background full resync triggered by admin dashboard
export const adminFullResync = inngest.createFunction(
  { id: 'admin-full-resync', retries: 1 },
  { event: 'admin/full-resync' },
  async ({ event }) => {
    const { userId, teamId } = event.data
    const supabase = getAdminClient()

    console.log(`[Admin Resync] Starting 90-day full resync for user ${userId}`)

    const { data: integrations } = await supabase
      .from('integrations')
      .select('id, team_id, user_id, provider, access_token, refresh_token, config')
      .eq('user_id', userId)

    if (!integrations?.length) {
      console.error(`[Admin Resync] No integrations found for user ${userId}`)
      return { success: false, error: 'No integrations' }
    }

    const results: string[] = []
    const errors: string[] = []
    const RESYNC_DAYS = 90

    for (const integration of integrations) {
      if (integration.provider === 'outlook' || integration.provider === 'microsoft') {
        try {
          const result = await syncTeamOutlook(supabase, integration.team_id, userId, integration, { daysBack: RESYNC_DAYS })
          const r = result as any
          results.push(`Outlook: ${r.newEmails || r.emails || 0} emails, ${r.calendarEvents || 0} calendar events`)
          console.log(`[Admin Resync] User ${userId} Outlook sync complete:`, result)
        } catch (err) {
          errors.push(`Outlook sync failed: ${(err as Error).message}`)
          console.error(`[Admin Resync] User ${userId} Outlook sync failed:`, (err as Error).message)
        }
      }

      if (integration.provider === 'slack') {
        results.push('Slack: requires user dashboard for full backfill')
      }
    }

    console.log(`[Admin Resync] User ${userId} complete: ${[...results, ...errors].join('; ')}`)
    return { success: errors.length === 0, results, errors }
  }
)
