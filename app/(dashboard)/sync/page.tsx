import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { detectCommitmentsBatch, getDetectionStats } from '@/lib/ai/detect-commitments'

// Process max 100 messages per request to stay within 300s timeout
const MAX_MESSAGES_PER_RUN = 100
const TIME_BUDGET_MS = 240000 // Stop at 240s, leaving 60s buffer

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

    // Preserve existing config fields and add token_expires_at
    const { data: currentIntegration } = await supabase
      .from('integrations')
      .select('config')
      .eq('id', integrationId)
      .single()

    const existingConfig = currentIntegration?.config || {}

    await supabase
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        config: { ...existingConfig, token_expires_at: expiresAt },
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
    console.log('Graph API returned 401, attempting token refresh...')
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (!newToken) {
      return { data: { error: { message: 'Token refresh failed. Please reconnect Outlook.', code: 'TokenRefreshFailed' } }, token: currentToken }
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
  // ================================================================
  // STEP 1: Authenticate the user from their session cookie
  // This prevents unauthorized access to the backfill endpoint
  // ================================================================
  const cookieStore = await cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore — cookies can't be set in route handlers after streaming starts
          }
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    console.error('Outlook backfill auth failed:', authError?.message || 'No user session')
    return NextResponse.json({ error: 'Unauthorized. Please log in again.' }, { status: 401 })
  }

  const userId = user.id

  // ================================================================
  // STEP 2: Use service role key for all data operations (bypasses RLS)
  // ================================================================
  const supabase = getAdminClient()
  const startTime = Date.now()

  let daysBack: number = 30

  try {
    const body = await request.json()
    daysBack = body.daysBack || 30
  } catch (e) {
    // Use defaults
  }

  // Get user's team
  let teamId: string | null = null
  const { data: members } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
  if (members && members.length > 0) teamId = members[0].team_id
  if (!teamId) return NextResponse.json({ error: 'No team found' }, { status: 400 })

  // Get Outlook integration
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('team_id', teamId)
    .eq('provider', 'outlook')
    .single()

  if (!integration || !integration.access_token) {
    return NextResponse.json({ error: 'Outlook not connected. Please connect Outlook first.' }, { status: 400 })
  }

  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Proactive token refresh if expired or about to expire (within 5 min)
  const tokenExpiresAt = integration.config?.token_expires_at
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)
  if (tokenExpiresAt && new Date(tokenExpiresAt) < fiveMinutesFromNow) {
    console.log('Outlook token expired or expiring soon, refreshing...')
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (newToken) {
      msToken = newToken
    } else {
      return NextResponse.json({ error: 'Outlook token expired and refresh failed. Please reconnect Outlook in Settings.' }, { status: 401 })
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
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  let totalCommitments = 0
  let processedMessages = 0

  if (unprocessed && unprocessed.length > 0) {
    console.log('Processing ' + unprocessed.length + ' unprocessed emails (of ' + unprocessedCount + ' total)')

    const batch: Array<{ id: string; text: string; dbId: string }> = []

    for (const msg of unprocessed) {
      const preview = msg.body_preview || ''
      if (preview.length < 20) {
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

    // Process in chunks of 15
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
              source: 'outlook',
              source_ref: item.dbId,
            })
            if (commitErr) {
              console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                message: commitErr.message, details: commitErr.details,
                hint: commitErr.hint, code: commitErr.code,
              }))
            } else {
              totalCommitments++
            }
          }

          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: commitments.length })
            .eq('id', item.dbId)
          processedMessages++
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
  const selectFields = 'id,subject,bodyPreview,from,toRecipients,receivedDateTime,conversationId,isRead'
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
      const errMsg = pageData.error.message || pageData.error.code || JSON.stringify(pageData.error)
      console.error('Graph API error:', errMsg)
      errors.push('Graph API error: ' + errMsg)
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
            subject: subject,
            body_preview: preview,
            received_at: email.receivedDateTime,
            processed: false,
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
            if (commitErr) {
              console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                message: commitErr.message, details: commitErr.details,
                hint: commitErr.hint, code: commitErr.code,
              }))
            } else {
              totalCommitments++
            }
          }

          await supabase
            .from('outlook_messages')
            .update({ processed: true, commitments_found: commitments.length })
            .eq('id', item.dbId)
        }
      } catch (batchErr) {
        console.error('Batch AI error:', (batchErr as Error).message)
        errors.push('AI error: ' + (batchErr as Error).message)
      }
    }

    nextLink = pageData['@odata.nextLink'] || null
    if (nextLink) await sleep(500)
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
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
