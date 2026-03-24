import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, getDetectionStats, calculatePriorityScore } from '@/lib/ai/detect-commitments'

const MAX_MESSAGES_PER_RUN = 100
const TIME_BUDGET_MS = 240000

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
          scope: 'openid profile email Mail.Read Calendars.Read User.Read offline_access',
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

async function syncTeamOutlook(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string,
  integration: { id: string; access_token: string; refresh_token: string; config: any }
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
      return { success: false, error: 'token_expired' }
    }
  }

  let totalCommitments = 0
  let totalEmails = 0
  let totalNewEmails = 0

  // Phase 1: Process unprocessed stored messages
  const { data: unprocessed } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at')
    .eq('team_id', teamId)
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  if (unprocessed && unprocessed.length > 0) {
    const batch: Array<{ id: string; text: string; dbId: string }> = []

    for (const msg of unprocessed) {
      const preview = msg.body_preview || ''
      if (preview.length < 20) {
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

      batch.push({ id: msg.message_id, text: messageText, dbId: msg.id })
    }

    for (let i = 0; i < batch.length; i += 15) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break
      const chunk = batch.slice(i, i + 15)
      try {
        const batchInput = chunk.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        for (const item of chunk) {
          const commitments = batchResults.get(item.id) || []
          for (const commitment of commitments) {
            const { error: commitErr } = await supabase.from('commitments').insert({
              team_id: teamId,
              creator_id: userId,
              title: commitment.title || 'Untitled commitment',
              description: commitment.description || null,
              status: 'open',
              priority_score: calculatePriorityScore(commitment),
              source: 'outlook',
              source_ref: item.dbId,
            })
            if (!commitErr) totalCommitments++
          }
          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: commitments.length })
            .eq('id', item.dbId)
          totalEmails++
        }
      } catch (err) {
        console.error('Batch AI error:', (err as Error).message)
      }
    }
  }

  // Phase 2: Fetch new emails (last 1 day for daily sync)
  if (Date.now() - startTime < TIME_BUDGET_MS) {
    const oldestDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const baseFilter = encodeURIComponent(`receivedDateTime ge ${oldestDate} and isDraft eq false`)
    const selectFields = 'id,subject,bodyPreview,from,toRecipients,receivedDateTime,conversationId,isRead'
    let nextLink: string | null =
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${baseFilter}&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`

    while (nextLink && Date.now() - startTime < TIME_BUDGET_MS && totalNewEmails < MAX_MESSAGES_PER_RUN) {
      const { data: pageData, token: updatedToken } = await graphFetch(
        nextLink, msToken, supabase, integrationId, refreshToken
      )
      msToken = updatedToken

      if (pageData.error) break

      const emails = pageData.value || []
      const batch: Array<{ id: string; text: string; dbId: string }> = []

      for (const email of emails) {
        totalEmails++
        const preview = email.bodyPreview || ''
        if (preview.length < 20) continue

        const { data: existing } = await supabase
          .from('outlook_messages')
          .select('id, processed')
          .eq('team_id', teamId)
          .eq('message_id', email.id)
          .maybeSingle()

        if (existing && existing.processed) continue

        const fromName = email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown'
        const fromEmail = email.from?.emailAddress?.address || ''
        const toList = (email.toRecipients || [])
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
          const { data: messageData, error: msgErr } = await supabase
            .from('outlook_messages')
            .insert({
              team_id: teamId,
              message_id: email.id,
              conversation_id: email.conversationId || null,
              from_name: fromName,
              from_email: fromEmail,
              to_recipients: toList,
              subject,
              body_preview: preview,
              received_at: email.receivedDateTime,
              processed: false,
            })
            .select()
            .single()

          if (msgErr) continue
          dbId = messageData.id
        }

        totalNewEmails++
        batch.push({ id: email.id, text: messageText, dbId })
      }

      if (batch.length > 0) {
        try {
          const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
          const batchResults = await detectCommitmentsBatch(batchInput)

          for (const item of batch) {
            const commitments = batchResults.get(item.id) || []
            for (const commitment of commitments) {
              const { error: commitErr } = await supabase.from('commitments').insert({
                team_id: teamId,
                creator_id: userId,
                title: commitment.title || 'Untitled commitment',
                description: commitment.description || null,
                status: 'open',
                source: 'outlook',
                source_ref: item.dbId,
              })
              if (!commitErr) totalCommitments++
            }
            await supabase
              .from('outlook_messages')
              .update({ processed: true, commitments_found: commitments.length })
              .eq('id', item.dbId)
          }
        } catch (err) {
          console.error('Batch AI error:', (err as Error).message)
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
    const startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const calendarUrl =
      `https://graph.microsoft.com/v1.0/me/calendarview` +
      `?startDateTime=${startDate}&endDateTime=${endDate}` +
      `&$select=id,subject,organizer,attendees,start,end,location,bodyPreview,isCancelled` +
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

        const { data: existing } = await supabase
          .from('outlook_calendar_events')
          .select('id, processed')
          .eq('team_id', teamId)
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

// 6:00 AM PT = 1:00 PM UTC (PT is UTC-7 during PDT, UTC-8 during PST)
// Using America/Los_Angeles timezone via Inngest's timezone support
export const syncOutlook = inngest.createFunction(
  { id: 'sync-outlook-daily' },
  { cron: 'TZ=America/Los_Angeles 0 6 * * *' },
  async () => {
    const supabase = getAdminClient()

    // Get all teams with active Outlook integrations
    const { data: integrations, error } = await supabase
      .from('integrations')
      .select('id, team_id, access_token, refresh_token, config')
      .eq('provider', 'outlook')

    if (error || !integrations) {
      console.error('Failed to fetch Outlook integrations:', error)
      return { success: false, error: error?.message }
    }

    console.log(`Outlook daily sync: ${integrations.length} team(s) to sync`)

    const results = []

    for (const integration of integrations) {
      // Get any team member to use as creator_id for commitments
      const { data: members } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', integration.team_id)
        .limit(1)

      if (!members || members.length === 0) {
        console.error(`Team ${integration.team_id}: No members found, skipping`)
        continue
      }

      try {
        const result = await syncTeamOutlook(supabase, integration.team_id, members[0].user_id, integration)
        results.push(result)
        console.log(`Team ${integration.team_id} sync complete:`, result)
      } catch (err) {
        console.error(`Team ${integration.team_id} sync failed:`, (err as Error).message)
        results.push({ success: false, teamId: integration.team_id, error: (err as Error).message })
      }
    }

    return { success: true, teamsSynced: results.length, results }
  }
)
