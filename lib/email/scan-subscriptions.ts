// lib/email/scan-subscriptions.ts
// Scans a user's Outlook inbox via Microsoft Graph API for marketing/newsletter
// emails with List-Unsubscribe headers. Used by both the Inngest cron and
// the on-demand "Scan Now" API route.

import { createClient } from '@supabase/supabase-js'

const MAX_SENDERS_PER_USER = 50
const MAX_GRAPH_PAGES = 5

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function extractDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase()
}

function parseListUnsubscribe(header: string): { url: string | null; mailto: string | null } {
  let url: string | null = null
  let mailto: string | null = null

  const matches = header.match(/<([^>]+)>/g)
  if (matches) {
    for (const match of matches) {
      const value = match.slice(1, -1).trim()
      if (value.startsWith('http://') || value.startsWith('https://')) {
        url = value
      } else if (value.startsWith('mailto:')) {
        mailto = value
      }
    }
  }
  return { url, mailto }
}

async function graphFetch(
  url: string,
  accessToken: string,
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<{ data: any; token: string }> {
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 401) {
    const newToken = await refreshMicrosoftToken(supabase, integrationId, refreshToken)
    if (newToken) {
      accessToken = newToken
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    }
  }

  const data = await res.json()
  return { data, token: accessToken }
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
          client_id: process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
          client_secret: process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default offline_access',
        }),
      }
    )
    const tokenData = await tokenRes.json()
    if (tokenData.access_token) {
      await supabase
        .from('integrations')
        .update({
          config: {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || refreshToken,
            token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
          },
        })
        .eq('id', integrationId)
      return tokenData.access_token
    }
  } catch (err) {
    console.error('Token refresh failed:', err)
  }
  return null
}

interface SenderInfo {
  fromName: string
  fromEmail: string
  subject: string
  bodyPreview: string
  receivedAt: string
  messageId: string
  isRead: boolean
  count: number
  firstSeen: string
  unsubscribeUrl: string | null
  unsubscribeMailto: string | null
  hasOneClick: boolean
  detectionMethod: string
}

export async function scanUserSubscriptions(
  teamId: string,
  userId: string,
): Promise<{ found: number; errors: number }> {
  const supabase = getAdminClient()
  let found = 0
  let errors = 0

  // Get the user's Outlook integration
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, config')
    .eq('team_id', teamId)
    .eq('provider', 'outlook')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle()

  if (!integration?.config?.access_token) {
    return { found: 0, errors: 0 }
  }

  const integrationId = integration.id
  let msToken = integration.config.access_token as string
  const refreshToken = integration.config.refresh_token as string

  // Query Graph API for recent emails with internetMessageHeaders
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const filter = encodeURIComponent(`receivedDateTime ge ${thirtyDaysAgo} and isDraft eq false`)
  const select = 'id,subject,bodyPreview,from,receivedDateTime,isRead,internetMessageHeaders'

  const senderMap = new Map<string, SenderInfo>()

  let nextLink: string | null =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime desc&$top=50`
  let pages = 0

  while (nextLink && pages < MAX_GRAPH_PAGES) {
    pages++
    const { data: pageData, token: updatedToken } = await graphFetch(
      nextLink, msToken, supabase, integrationId, refreshToken
    )
    msToken = updatedToken

    if (pageData.error) {
      console.error('Graph API error:', pageData.error.message)
      errors++
      break
    }

    const emails = pageData.value || []

    for (const email of emails) {
      const fromEmail = (email.from?.emailAddress?.address || '').toLowerCase()
      const fromName = email.from?.emailAddress?.name || fromEmail
      const subject = email.subject || ''
      if (!fromEmail) continue

      // Check for List-Unsubscribe header
      let unsubUrl: string | null = null
      let unsubMailto: string | null = null
      let hasOneClick = false
      let detectionMethod = 'none'

      if (email.internetMessageHeaders) {
        for (const header of email.internetMessageHeaders) {
          const name = (header.name || '').toLowerCase()
          if (name === 'list-unsubscribe') {
            const parsed = parseListUnsubscribe(header.value || '')
            unsubUrl = parsed.url
            unsubMailto = parsed.mailto
            detectionMethod = 'header'
          }
          if (name === 'list-unsubscribe-post') {
            hasOneClick = true
          }
        }
      }

      // Fallback: check body preview for unsubscribe text
      if (!unsubUrl && !unsubMailto) {
        const bodyLower = (email.bodyPreview || '').toLowerCase()
        if (bodyLower.includes('unsubscribe') || bodyLower.includes('opt out') || bodyLower.includes('opt-out') || bodyLower.includes('email preferences')) {
          detectionMethod = 'body_link'
        }
      }

      if (detectionMethod === 'none') continue

      // Group by sender
      const key = fromEmail
      const existing = senderMap.get(key)
      if (existing) {
        existing.count++
        if (email.receivedDateTime < existing.firstSeen) {
          existing.firstSeen = email.receivedDateTime
        }
        if (email.receivedDateTime > existing.receivedAt) {
          existing.subject = subject
          existing.bodyPreview = email.bodyPreview || ''
          existing.receivedAt = email.receivedDateTime
          existing.messageId = email.id
          existing.isRead = email.isRead ?? true
        }
        if (detectionMethod === 'header' && existing.detectionMethod !== 'header') {
          existing.unsubscribeUrl = unsubUrl
          existing.unsubscribeMailto = unsubMailto
          existing.hasOneClick = hasOneClick
          existing.detectionMethod = 'header'
        }
      } else {
        senderMap.set(key, {
          fromName, fromEmail, subject,
          bodyPreview: email.bodyPreview || '',
          receivedAt: email.receivedDateTime,
          messageId: email.id,
          isRead: email.isRead ?? true,
          count: 1,
          firstSeen: email.receivedDateTime,
          unsubscribeUrl: unsubUrl,
          unsubscribeMailto: unsubMailto,
          hasOneClick,
          detectionMethod,
        })
      }
    }

    nextLink = pageData['@odata.nextLink'] || null
  }

  if (senderMap.size === 0) return { found: 0, errors }

  // Check which senders are already tracked
  const senderEmails = [...senderMap.keys()]
  const { data: existingSubs } = await supabase
    .from('email_subscriptions')
    .select('from_email, status')
    .eq('user_id', userId)
    .in('from_email', senderEmails)

  const trackedEmails = new Map<string, string>()
  for (const sub of existingSubs || []) {
    trackedEmails.set(sub.from_email.toLowerCase(), sub.status)
  }

  // Insert new subscriptions and update existing active ones
  let inserted = 0
  for (const [email, sender] of senderMap) {
    if (inserted >= MAX_SENDERS_PER_USER) break

    const existingStatus = trackedEmails.get(email)

    if (existingStatus === 'active') {
      await supabase
        .from('email_subscriptions')
        .update({
          email_count: sender.count,
          subject: sender.subject,
          body_preview: sender.bodyPreview,
          received_at: sender.receivedAt,
          is_read: sender.isRead,
          ...(sender.detectionMethod === 'header' ? {
            unsubscribe_url: sender.unsubscribeUrl,
            unsubscribe_mailto: sender.unsubscribeMailto,
            has_one_click: sender.hasOneClick,
            detection_method: 'header',
          } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('from_email', email)
        .eq('status', 'active')
      continue
    }

    if (existingStatus) continue // already handled (unsubscribed, kept)

    const { error: insertErr } = await supabase
      .from('email_subscriptions')
      .insert({
        team_id: teamId,
        user_id: userId,
        from_name: sender.fromName,
        from_email: sender.fromEmail,
        sender_domain: extractDomain(sender.fromEmail),
        subject: sender.subject,
        body_preview: sender.bodyPreview,
        received_at: sender.receivedAt,
        outlook_message_id: sender.messageId,
        is_read: sender.isRead,
        unsubscribe_url: sender.unsubscribeUrl,
        unsubscribe_mailto: sender.unsubscribeMailto,
        has_one_click: sender.hasOneClick,
        detection_method: sender.detectionMethod,
        email_count: sender.count,
        first_seen_at: sender.firstSeen,
      })

    if (!insertErr) {
      found++
      inserted++
    } else {
      errors++
    }
  }

  return { found, errors }
}
