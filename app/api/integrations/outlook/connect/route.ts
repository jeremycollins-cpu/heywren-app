import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Refresh the Microsoft access token using the stored refresh_token.
 * Updates the integrations table with the new token and expiry.
 */
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

    // Update the stored tokens
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    await supabase
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken, // Microsoft may return a new refresh token
        config: {
          token_expires_at: expiresAt,
        },
      })
      .eq('id', integrationId)

    console.log('Microsoft token refreshed, expires at', expiresAt)
    return tokenData.access_token
  } catch (err) {
    console.error('Token refresh error:', (err as Error).message)
    return null
  }
}

/**
 * Fetch from Microsoft Graph API with automatic token refresh on 401.
 */
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

  // If token expired, refresh and retry once
  if (res.status === 401) {
    console.log('Microsoft token expired, refreshing...')
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (!newToken) {
      return { data: { error: 'Token refresh failed. Please reconnect Outlook.' }, token: currentToken }
    }
    currentToken = newToken

    const retryRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + currentToken },
    })
    const retryData = await retryRes.json()
    return { data: retryData, token: currentToken }
  }

  const data = await res.json()
  return { data, token: currentToken }
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

  if (members && members.length > 0) {
    teamId = members[0].team_id
  }

  if (!teamId) {
    return NextResponse.json({ error: 'No team found for user' }, { status: 400 })
  }

  // Get the Outlook integration with tokens
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('team_id', teamId)
    .eq('provider', 'outlook')
    .single()

  if (!integration || !integration.access_token) {
    return NextResponse.json(
      { error: 'Outlook not connected or missing access token. Please connect Outlook first.' },
      { status: 400 }
    )
  }

  let msToken = integration.access_token
  const refreshToken = integration.refresh_token || ''
  const integrationId = integration.id

  // Check if token is expired and refresh proactively
  const tokenExpiresAt = integration.config?.token_expires_at
  if (tokenExpiresAt && new Date(tokenExpiresAt) < new Date()) {
    console.log('Microsoft token expired, refreshing proactively...')
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (newToken) {
      msToken = newToken
    } else {
      return NextResponse.json(
        { error: 'Microsoft token expired and could not be refreshed. Please reconnect Outlook in Settings.' },
        { status: 401 }
      )
    }
  }

  const startTime = Date.now()
  const oldestDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  // Fetch emails using Microsoft Graph API
  // We'll page through results, processing each batch
  let totalEmails = 0
  let totalCommitments = 0
  let processedPages = 0
  const errors: string[] = []

  // Microsoft Graph: get messages from the last N days
  // Filter: receivedDateTime >= oldest date, only get emails (not calendar invites etc.)
  // Select only fields we need to reduce payload size
  const baseFilter = encodeURIComponent(
    `receivedDateTime ge ${oldestDate} and isDraft eq false`
  )
  const selectFields = 'id,subject,bodyPreview,from,toRecipients,receivedDateTime,conversationId,isRead'
  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${baseFilter}&$select=${selectFields}&$orderby=receivedDateTime desc&$top=50`

  while (nextLink) {
    // Time check: stop before 300s timeout (leave 30s buffer)
    if (Date.now() - startTime > 250000) {
      errors.push('Stopped early due to time limit. Processed ' + processedPages + ' pages of emails.')
      break
    }

    const { data: pageData, token: updatedToken } = await graphFetch(
      nextLink,
      msToken,
      supabase,
      integrationId,
      refreshToken
    )
    msToken = updatedToken

    if (pageData.error) {
      const errMsg = pageData.error.message || pageData.error.code || JSON.stringify(pageData.error)
      errors.push('Graph API error: ' + errMsg)
      break
    }

    const emails = pageData.value || []
    processedPages++

    console.log('Page ' + processedPages + ': fetched ' + emails.length + ' emails')

    for (const email of emails) {
      // Time check per email
      if (Date.now() - startTime > 250000) break

      totalEmails++

      // Skip very short emails (likely auto-replies, read receipts)
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

      // Build a text representation for AI analysis
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
        // If table doesn't exist yet, this will fail on the first insert
        if (msgErr.message?.includes('outlook_messages')) {
          errors.push('The outlook_messages table does not exist yet. Please run the migration SQL first.')
          nextLink = null
          break
        }
        console.error('Failed to store email:', msgErr.message)
        continue
      }

      // Detect commitments via AI
      try {
        const commitments = await detectCommitments(messageText)

        if (commitments && commitments.length > 0) {
          for (const commitment of commitments) {
            const { error: commitErr } = await supabase.from('commitments').insert({
              team_id: teamId,
              creator_id: null,
              title: commitment.title,
              description: commitment.description,
              status: 'pending',
              priority_score: commitment.confidence,
              source: 'outlook',
              source_message_id: messageData.id,
              due_date: commitment.dueDate || null,
            })

            if (!commitErr) totalCommitments++
          }
        }

        await supabase
          .from('outlook_messages')
          .update({ processed: true, commitments_found: commitments?.length || 0 })
          .eq('id', messageData.id)
      } catch (aiErr) {
        console.error('AI detection failed for email:', (aiErr as Error).message)
        await supabase
          .from('outlook_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', messageData.id)
      }

      // Small delay between Claude API calls
      await sleep(200)
    }

    // Get next page link (Microsoft Graph pagination)
    nextLink = pageData['@odata.nextLink'] || null

    // Small delay between pages
    if (nextLink) await sleep(500)
  }

  const duration = Math.round((Date.now() - startTime) / 1000)

  return NextResponse.json({
    success: true,
    summary: {
      emails_scanned: totalEmails,
      commitments_detected: totalCommitments,
      pages_processed: processedPages,
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
