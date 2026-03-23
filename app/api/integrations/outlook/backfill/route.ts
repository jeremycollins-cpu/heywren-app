import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, getDetectionStats } from '@/lib/ai/detect-commitments'

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

  let userId: string
  let daysBack: number = 30

  try {
    const body = await request.json()
    userId = body.userId
    daysBack = body.daysBack || 30
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }
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

  // Get Outlook integration
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('team_id', teamId)
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

  const startTime = Date.now()
  const oldestDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  let totalEmails = 0
  let totalCommitments = 0
  let processedPages = 0
  const errors: string[] = []

  const baseFilter = encodeURIComponent(`receivedDateTime ge ${oldestDate} and isDraft eq false`)
  const selectFields = 'id,subject,bodyPreview,from,toRecipients,receivedDateTime,conversationId,isRead'
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${baseFilter}&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`

  while (nextLink) {
    if (Date.now() - startTime > 250000) {
      errors.push('Time limit reached at page ' + processedPages)
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

    // Collect batch of new emails
    const batch: Array<{ id: string; text: string; dbId: string; email: any }> = []

    for (const email of emails) {
      totalEmails++

      const preview = email.bodyPreview || ''
      if (preview.length < 20) continue

      // Skip already processed
      const { data: existing } = await supabase
        .from('outlook_messages')
        .select('id')
        .eq('team_id', teamId)
        .eq('message_id', email.id)
        .maybeSingle()

      if (existing) continue

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

      // Store the email
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
        if (msgErr.message?.includes('outlook_messages')) {
          errors.push('outlook_messages table missing. Run the migration SQL first.')
          nextLink = null
          break
        }
        continue
      }

      batch.push({ id: email.id, text: messageText, dbId: messageData.id, email })
    }

    // Process batch through 3-tier AI pipeline
    if (batch.length > 0) {
      try {
        const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        for (const item of batch) {
          const commitments = batchResults.get(item.id) || []

          if (commitments.length > 0) {
            for (const commitment of commitments) {
              const { error: commitErr } = await supabase.from('commitments').insert({
                team_id: teamId,
                creator_id: null,
                title: commitment.title,
                description: commitment.description,
                status: 'pending',
                priority_score: commitment.confidence,
                source: 'outlook',
                source_message_id: item.dbId,
                due_date: commitment.dueDate || null,
              })
              if (!commitErr) totalCommitments++
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

  console.log('OUTLOOK BACKFILL DONE: ' + totalEmails + ' emails, ' + totalCommitments + ' commitments, ' +
    'Tier1: ' + aiStats.tier1_filtered + ', Tier2: ' + aiStats.tier2_filtered +
    ', Tier3: ' + aiStats.tier3_analyzed + ', errors: ' + aiStats.errors)

  return NextResponse.json({
    success: true,
    summary: {
      emails_scanned: totalEmails,
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
