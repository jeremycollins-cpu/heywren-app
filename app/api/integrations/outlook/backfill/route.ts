export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { detectCommitmentsBatch, getDetectionStats, calculatePriorityScore } from '@/lib/ai/detect-commitments'

// Process max 300 messages per request to stay within 300s timeout
const MAX_MESSAGES_PER_RUN = 300
const TIME_BUDGET_MS = 250000 // Stop at 250s, leaving 50s buffer

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isCalendarInviteEmail(subject: string, bodyPreview?: string): boolean {
  const s = subject.trim()
  if (/^(Accepted|Declined|Tentative|Cancell?ed):/i.test(s)) return true
  const lower = s.toLowerCase()
  if (lower.includes('out of office') || lower.includes('automatic reply')) return true

  // Name/Name pattern — "Jeremy/Leah (...)" — almost always a recurring meeting
  if (/^\w+\s*\/\s*\w+/i.test(s)) return true

  // FW: + onsite/meeting-logistics subjects
  if (/^(FW|Fwd):/i.test(s) && /\b(onsite|on-site|offsite|off-site)\b/i.test(s)) return true

  const body = (bodyPreview || '').toLowerCase()

  if (body) {
    const meetingSignatures = [
      'join the meeting now', 'meeting id:', 'microsoft teams meeting',
      'join zoom meeting', 'zoom.us/j/', 'meet.google.com/',
      'you updated the meeting', 'you have been invited to',
      'dial-in number', 'join on your computer', 'click here to join', 'passcode:',
    ]
    const signatureCount = meetingSignatures.filter(sig => body.includes(sig)).length
    if (signatureCount >= 2) return true
    if (body.includes('join the meeting now') || body.includes('microsoft teams meeting')) return true
    if (body.includes('join zoom meeting') || body.includes('zoom.us/j/')) return true
    if (body.includes('you updated the meeting for')) return true
    if (body.includes('meet.google.com/')) return true
    if (body.includes('meeting id:') && body.includes('passcode:')) return true

    // Meeting scheduling language
    const schedulingPatterns = [
      /any chance .{0,30}(works|free|available)/i,
      /\b(works for you|work for you)\b/i,
      /i'?ll send (a |the )?calendar/i,
      /let'?s (do|meet|schedule|connect)/i,
      /was just scheduled/i,
      /weekly agenda/i,
    ]
    if (schedulingPatterns.some(p => p.test(body))) return true

    // Strong meeting-name subjects — filter without body signals
    const strongMeetingPatterns = [
      /\bsync\b/i, /\bstandup\b/i, /\bstand-up\b/i, /\b1[:\-]1\b/i, /\bone.on.one\b/i,
      /\bweekly\b/i, /\bbiweekly\b/i, /\bmonthly\b/i, /\bdaily\b/i, /\brecurring\b/i,
      /\bhuddle\b/i, /\bcatch.up\b/i, /\btouchbase\b/i, /\btouch.base\b/i,
      /\bretro\b/i, /\bretrospective\b/i,
      /\bsales updates?\b/i, /\bstatus updates?\b/i, /\bproject updates?\b/i,
      /\bonsite\b/i, /\bon-site\b/i, /\boffsite\b/i, /\boff-site\b/i,
    ]
    if (strongMeetingPatterns.some(p => p.test(s))) return true

    // Weaker meeting subjects — need body signal
    const weakMeetingPatterns = [
      /\bcheck.in\b/i, /\bcheckin\b/i, /\breview\b/i,
      /\bplanning\b/i, /\bgrooming\b/i, /\brefinement\b/i, /\bkickoff\b/i, /\bkick.off\b/i,
    ]
    const hasWeakMeetingSubject = weakMeetingPatterns.some(p => p.test(s))
    if (hasWeakMeetingSubject && signatureCount >= 1) return true
    if (hasWeakMeetingSubject && body.includes('when:')) return true
  }

  return false
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
          scope: 'openid profile email Mail.Read Mail.ReadWrite Calendars.ReadWrite User.Read offline_access',
        }),
      }
    )

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      console.error('Token refresh failed:', tokenData.error_description || tokenData.error)
      return null
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    // Read existing config to preserve user metadata (microsoft_user_id, display_name, email)
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
        config: { ...(current?.config || {}), token_expires_at: expiresAt },
      })
      .eq('id', integrationId)

    console.log('Microsoft token refreshed, expires at', expiresAt)
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
      return { data: { error: 'Token refresh failed. Reconnect Outlook.' }, token: currentToken }
    }
    currentToken = newToken
    const retryRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + currentToken },
    })
    return { data: await retryRes.json(), token: currentToken }
  }

  return { data: await res.json(), token: currentToken }
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient()
  const startTime = Date.now()

  // Verify the caller is authenticated
  const sessionClient = await createSessionClient()
  const { data: sessionUser } = await sessionClient.auth.getUser()
  if (!sessionUser?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use the authenticated user's ID, not the one from the request body
  let userId: string = sessionUser.user.id
  let daysBack: number = 30

  try {
    const body = await request.json()
    daysBack = body.daysBack || 30
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Get user's team
  let teamId: string | null = null
  const { data: members } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
  if (members && members.length > 0) teamId = members[0].team_id
  if (!teamId) return NextResponse.json({ error: 'No team found' }, { status: 400 })

  // Get Outlook integration for this user
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .single()

  if (!integration || !integration.access_token) {
    return NextResponse.json({ error: 'Outlook not connected.' }, { status: 400 })
  }

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
      return NextResponse.json({ error: 'Token expired. Reconnect Outlook.' }, { status: 401 })
    }
  }

  // ================================================================
  // PHASE 1: Process previously stored but unprocessed messages
  // This is FAST — no Graph API calls, just AI processing
  // ================================================================
  const { data: unprocessed, count: unprocessedCount } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at', { count: 'exact' })
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  let totalCommitments = 0
  let processedMessages = 0

  if (unprocessed && unprocessed.length > 0) {
    console.log('Processing ' + unprocessed.length + ' unprocessed emails (of ' + unprocessedCount + ' total)')

    const batch: Array<{ id: string; text: string; dbId: string }> = []

    for (const msg of unprocessed) {
      const preview = msg.body_preview || ''
      if (preview.length < 20 || isCalendarInviteEmail(msg.subject || '', preview)) {
        await supabase
          .from('outlook_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', msg.id)
        processedMessages++
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

    // Process in chunks of 25
    for (let i = 0; i < batch.length; i += 25) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const chunk = batch.slice(i, i + 25)
      try {
        const batchInput = chunk.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        const commitmentRows: any[] = []
        const processedIds: { dbId: string; count: number }[] = []

        for (const item of chunk) {
          const commitments = batchResults.get(item.id) || []
          for (const commitment of commitments) {
            commitmentRows.push({
              team_id: teamId,
              creator_id: userId,
              title: commitment.title || 'Untitled commitment',
              description: commitment.description || null,
              status: 'open',
              priority_score: commitment.priority === 'high' ? 0.9 : commitment.priority === 'medium' ? 0.5 : 0.2,
              source: 'outlook',
              source_ref: item.dbId,
              metadata: {
                urgency: commitment.urgency || null,
                tone: commitment.tone || null,
                commitmentType: commitment.commitmentType || null,
                stakeholders: commitment.stakeholders || null,
                originalQuote: commitment.originalQuote || null,
                channelName: commitment.channelOrThread || null,
                confidence: commitment.confidence,
                assigneeName: commitment.assignee || null,
              },
            })
          }
          processedIds.push({ dbId: item.dbId, count: commitments.length })
        }

        // Batch insert commitments
        let commitInsertOk = true
        if (commitmentRows.length > 0) {
          const { error: commitErr } = await supabase.from('commitments').insert(commitmentRows)
          if (commitErr) {
            console.error('BATCH COMMITMENT INSERT FAILED:', commitErr.message, commitErr.details, commitErr.hint, 'Code:', commitErr.code, 'Row sample:', JSON.stringify(commitmentRows[0]))
            commitInsertOk = false
          } else {
            totalCommitments += commitmentRows.length
          }
        }

        // Only mark as processed if commitment inserts succeeded (or there were no commitments)
        if (commitInsertOk) {
          for (const { dbId, count } of processedIds) {
            await supabase
              .from('outlook_messages')
              .update({ processed: true, commitments_found: count })
              .eq('id', dbId)
            processedMessages++
          }
        } else {
          // Still count as processed for progress tracking, but don't mark in DB
          processedMessages += processedIds.length
        }
      } catch (batchErr) {
        console.error('Batch AI error:', (batchErr as Error).message)
      }
    }

    // If more unprocessed messages remain, return early
    const remainingUnprocessed = (unprocessedCount || 0) - processedMessages
    if (remainingUnprocessed > 0) {
      const aiStats = getDetectionStats()
      return NextResponse.json({
        success: true,
        summary: {
          emails_scanned: processedMessages,
          commitments_detected: totalCommitments,
          pages_processed: 0,
          remaining_unprocessed: remainingUnprocessed,
          ai_stats: {
            skipped_by_keyword_filter: aiStats.tier1_filtered,
            skipped_by_haiku_triage: aiStats.tier2_filtered,
            fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
            errors: aiStats.errors,
          },
          duration_seconds: Math.round((Date.now() - startTime) / 1000),
          errors: ['More emails to process. Click sync again to continue. (' + remainingUnprocessed + ' remaining)'],
        },
      })
    }
  }

  // ================================================================
  // PHASE 2: Fetch NEW emails from Graph API (only if Phase 1 done)
  // ================================================================
  if (Date.now() - startTime > TIME_BUDGET_MS) {
    const aiStats = getDetectionStats()
    return NextResponse.json({
      success: true,
      summary: {
        emails_scanned: processedMessages,
        commitments_detected: totalCommitments,
        pages_processed: 0,
        ai_stats: {
          skipped_by_keyword_filter: aiStats.tier1_filtered,
          skipped_by_haiku_triage: aiStats.tier2_filtered,
          fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
          errors: aiStats.errors,
        },
        duration_seconds: Math.round((Date.now() - startTime) / 1000),
        errors: ['Time budget used processing backlog. Click sync again to fetch new emails.'],
      },
    })
  }

  const oldestDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  let totalEmails = 0
  let totalNewEmails = 0
  let processedPages = 0
  const errors: string[] = []

  const baseFilter = encodeURIComponent(`receivedDateTime ge ${oldestDate} and isDraft eq false`)
  const selectFields = 'id,subject,bodyPreview,from,toRecipients,receivedDateTime,conversationId,isRead,parentFolderId'
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${baseFilter}&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`

  while (nextLink) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push('Processed ' + processedPages + ' pages. Click sync again to continue.')
      break
    }

    if (totalNewEmails >= MAX_MESSAGES_PER_RUN) {
      errors.push('Reached ' + MAX_MESSAGES_PER_RUN + ' new emails. Click sync again to continue.')
      break
    }

    const { data: pageData, token: updatedToken } = await graphFetch(
      nextLink, msToken, supabase, integrationId, refreshToken
    )
    msToken = updatedToken

    if (pageData.error) {
      errors.push('Graph API error: ' + (pageData.error.message || pageData.error.code || JSON.stringify(pageData.error)))
      break
    }

    const emails = pageData.value || []
    processedPages++
    console.log('Page ' + processedPages + ': ' + emails.length + ' emails')

    const batch: Array<{ id: string; text: string; dbId: string; email: any }> = []

    for (const email of emails) {
      totalEmails++

      const preview = email.bodyPreview || ''
      if (preview.length < 20) continue

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
      const subject = email.subject || '(no subject)'

      // Skip calendar invite response emails (reuse `preview` from line 381)
      if (isCalendarInviteEmail(subject, preview)) {
        if (existing && !existing.processed) {
          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: 0 })
            .eq('id', existing.id)
        } else if (!existing) {
          await supabase
            .from('outlook_messages')
            .insert({
              team_id: teamId,
              user_id: userId,
              message_id: email.id,
              conversation_id: email.conversationId || null,
              from_name: fromName,
              from_email: fromEmail,
              to_recipients: toList,
              subject: subject,
              body_preview: preview,
              received_at: email.receivedDateTime,
              processed: true,
              commitments_found: 0,
              is_read: email.isRead ?? true,
              folder_id: email.parentFolderId || null,
            })
        }
        continue
      }

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
            user_id: userId,
            message_id: email.id,
            conversation_id: email.conversationId || null,
            from_name: fromName,
            from_email: fromEmail,
            to_recipients: toList,
            subject: subject,
            body_preview: preview,
            received_at: email.receivedDateTime,
            processed: false,
            is_read: email.isRead ?? true,
            folder_id: email.parentFolderId || null,
          })
          .select()
          .single()

        if (msgErr) {
          console.error('Failed to store email:', msgErr.message)
          continue
        }
        dbId = messageData.id
      }

      totalNewEmails++
      batch.push({ id: email.id, text: messageText, dbId, email })
    }

    // Process batch through AI
    if (batch.length > 0) {
      try {
        const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        for (const item of batch) {
          const commitments = batchResults.get(item.id) || []

          let itemInsertOk = true
          for (const commitment of commitments) {
            const { error: commitErr } = await supabase.from('commitments').insert({
              team_id: teamId,
              creator_id: userId,
              title: commitment.title || 'Untitled commitment',
              description: commitment.description || null,
              status: 'open',
              priority_score: commitment.priority === 'high' ? 0.9 : commitment.priority === 'medium' ? 0.5 : 0.2,
              source: 'outlook',
              source_ref: item.dbId,
              metadata: {
                urgency: commitment.urgency || null,
                tone: commitment.tone || null,
                commitmentType: commitment.commitmentType || null,
                stakeholders: commitment.stakeholders || null,
                originalQuote: commitment.originalQuote || null,
                channelName: commitment.channelOrThread || null,
                confidence: commitment.confidence,
                assigneeName: commitment.assignee || null,
              },
            })
            if (commitErr) {
              console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                message: commitErr.message, details: commitErr.details,
                hint: commitErr.hint, code: commitErr.code,
              }))
              itemInsertOk = false
            } else {
              totalCommitments++
            }
          }

          // Only mark as processed if all commitment inserts succeeded
          if (itemInsertOk) {
            await supabase
              .from('outlook_messages')
              .update({ processed: true, commitments_found: commitments.length })
              .eq('id', item.dbId)
          }
        }
      } catch (batchErr) {
        console.error('Batch AI error:', (batchErr as Error).message)
        errors.push('AI error: ' + (batchErr as Error).message)
      }
    }

    nextLink = pageData['@odata.nextLink'] || null
    if (nextLink) await sleep(500)
  }

  // ================================================================
  // PHASE 3: Fetch calendar events from Graph API
  // ================================================================
  let calendarEventsScanned = 0
  let calendarEventsNew = 0
  let calendarCommitments = 0

  if (Date.now() - startTime < TIME_BUDGET_MS) {
    const now = new Date()
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString() // 2 weeks ahead

    const calendarUrl =
      `https://graph.microsoft.com/v1.0/me/calendarview` +
      `?startDateTime=${startDate}&endDateTime=${endDate}` +
      `&$select=id,subject,organizer,attendees,start,end,location,bodyPreview,isCancelled` +
      `&$orderby=start/dateTime desc&$top=50`

    let calNextLink: string | null = calendarUrl

    while (calNextLink) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        errors.push('Time budget reached during calendar sync. Click sync again to continue.')
        break
      }

      const { data: calData, token: updatedToken } = await graphFetch(
        calNextLink, msToken, supabase, integrationId, refreshToken
      )
      msToken = updatedToken

      if (calData.error) {
        errors.push('Calendar API error: ' + (calData.error.message || calData.error.code || JSON.stringify(calData.error)))
        break
      }

      const events = calData.value || []
      console.log('Calendar page: ' + events.length + ' events')

      const calBatch: Array<{ id: string; text: string; dbId: string }> = []

      for (const event of events) {
        calendarEventsScanned++

        const subject = event.subject || '(no subject)'
        const bodyPreview = event.bodyPreview || ''
        const isCancelled = event.isCancelled || false

        // Skip cancelled events
        if (isCancelled) continue

        const organizerName = event.organizer?.emailAddress?.name || ''
        const organizerEmail = event.organizer?.emailAddress?.address || ''
        const attendees = (event.attendees || []).map((a: any) => ({
          name: a.emailAddress?.name || '',
          email: a.emailAddress?.address || '',
          response: a.status?.response || 'none',
        }))
        // Graph API returns dateTime without timezone and timeZone separately.
        // Append 'Z' if the dateTime has no offset, since Graph defaults to UTC for calendarview.
        const rawStart = event.start?.dateTime || ''
        const rawEnd = event.end?.dateTime || ''
        const startTime = rawStart && !rawStart.endsWith('Z') && !rawStart.includes('+') ? rawStart + 'Z' : rawStart
        const endTime = rawEnd && !rawEnd.endsWith('Z') && !rawEnd.includes('+') ? rawEnd + 'Z' : rawEnd
        const location = event.location?.displayName || ''

        // Check if already stored
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
              start_time: startTime,
              end_time: endTime,
              location,
              body_preview: bodyPreview,
              is_cancelled: isCancelled,
              processed: false,
            })
            .select()
            .single()

          if (evErr) {
            console.error('Failed to store calendar event:', evErr.message)
            continue
          }
          dbId = eventData.id
        }

        calendarEventsNew++

        // Build text for AI analysis
        const attendeeList = attendees
          .map((a: { name: string; email: string }) => a.name || a.email)
          .join(', ')

        const eventText = [
          'Calendar Event: ' + subject,
          'Organizer: ' + organizerName + ' <' + organizerEmail + '>',
          'Attendees: ' + attendeeList,
          'When: ' + startTime + ' to ' + endTime,
          location ? 'Location: ' + location : '',
          '',
          bodyPreview,
        ].filter(Boolean).join('\n')

        calBatch.push({ id: event.id, text: eventText, dbId })
      }

      // Process calendar batch through AI
      if (calBatch.length > 0) {
        try {
          const batchInput = calBatch.map((b) => ({ id: b.id, text: b.text }))
          const batchResults = await detectCommitmentsBatch(batchInput)

          for (const item of calBatch) {
            const commitments = batchResults.get(item.id) || []

            let calInsertOk = true
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
                metadata: {
                  urgency: commitment.urgency || null,
                  tone: commitment.tone || null,
                  commitmentType: commitment.commitmentType || null,
                  stakeholders: commitment.stakeholders || null,
                  originalQuote: commitment.originalQuote || null,
                  channelName: commitment.channelOrThread || null,
                  confidence: commitment.confidence,
                  assigneeName: commitment.assignee || null,
                },
              })
              if (commitErr) {
                console.error('CALENDAR COMMITMENT INSERT FAILED:', JSON.stringify({
                  message: commitErr.message, details: commitErr.details,
                  hint: commitErr.hint, code: commitErr.code,
                }))
                calInsertOk = false
              } else {
                calendarCommitments++
                totalCommitments++
              }
            }

            // Only mark as processed if inserts succeeded
            if (calInsertOk) {
              await supabase
                .from('outlook_calendar_events')
                .update({ processed: true, commitments_found: commitments.length })
                .eq('id', item.dbId)
            }
          }
        } catch (batchErr) {
          console.error('Calendar batch AI error:', (batchErr as Error).message)
          errors.push('Calendar AI error: ' + (batchErr as Error).message)
        }
      }

      calNextLink = calData['@odata.nextLink'] || null
      if (calNextLink) await sleep(500)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  const aiStats = getDetectionStats()

  console.log('OUTLOOK BACKFILL DONE: ' + totalEmails + ' total, ' + totalNewEmails + ' new, ' +
    totalCommitments + ' commitments, duration: ' + duration + 's')

  return NextResponse.json({
    success: true,
    summary: {
      emails_scanned: totalEmails + processedMessages,
      new_emails_processed: totalNewEmails,
      commitments_detected: totalCommitments,
      pages_processed: processedPages,
      ai_stats: {
        skipped_by_keyword_filter: aiStats.tier1_filtered,
        skipped_by_haiku_triage: aiStats.tier2_filtered,
        fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
        errors: aiStats.errors,
      },
      calendar_events_scanned: calendarEventsScanned,
      calendar_events_new: calendarEventsNew,
      calendar_commitments: calendarCommitments,
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
