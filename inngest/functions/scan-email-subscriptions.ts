// inngest/functions/scan-email-subscriptions.ts
// Scans Outlook emails for marketing/newsletter senders with unsubscribe links.
// Fetches List-Unsubscribe headers from Microsoft Graph and surfaces them
// in the Unsubscribe dashboard for one-click cleanup.
//
// Runs daily at 7 AM PT — after sync-outlook has pulled the latest emails.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

const MAX_HEADERS_PER_RUN = 50
const TIME_BUDGET_MS = 240000 // 4 minutes

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Sender patterns that indicate marketing/newsletter emails ──────────
const MARKETING_SENDER_PATTERNS = [
  /noreply@/i, /no-reply@/i, /donotreply@/i, /do-not-reply@/i,
  /notifications?@/i, /newsletter@/i, /news@/i, /updates?@/i,
  /marketing@/i, /promo(tions)?@/i, /digest@/i, /automated@/i,
  /info@/i, /hello@/i, /team@/i, /support@/i, /sales@/i,
  /mailer@/i, /campaigns?@/i, /engage@/i, /outreach@/i,
  /announce@/i, /community@/i, /contact@/i, /email@/i,
  // Bulk-mail subdomains (NetSuite, Marketo, Pardot, Salesforce, Mailchimp, SendGrid, etc.)
  /@(na|eu|us|mail|email|bounces?|send|smtp|marketing|campaigns?|newsletter|notify)\./i,
  /@(mailer|mailgun|sendgrid|mailchimp|mandrill|postmark|mailjet|amazonses|sparkpost|netsuite|marketo|pardot|hubspot|customer\.io|intercom|klaviyo)\./i,
]

// Subject patterns indicating marketing/transactional emails
const MARKETING_SUBJECT_PATTERNS = [
  /\bnewsletter\b/i, /\bdigest\b/i, /\bweekly update\b/i,
  /\bdaily update\b/i, /\bmonthly update\b/i, /\brecap\b/i,
  /\bunsubscribe\b/i, /\bsubscription\b/i,
  /\b\d+% off\b/i, /\blimited time\b/i, /\bspecial offer\b/i,
  /\bdon't miss\b/i, /\blast chance\b/i, /\bact now\b/i,
  /\bfree (trial|demo|ebook|guide|webinar|report|whitepaper)\b/i,
  /\bnew (features?|release|version|update)\b/i,
  /\bproduct update\b/i, /\bwhat's new\b/i,
  /\byour (weekly|daily|monthly)\b/i,
  // Gated-content / lead-magnet marketing
  /\b(get|download|grab|claim) (your|the|my) /i,
  /\b(handbook|ebook|e-book|whitepaper|white paper|cheat sheet|playbook|toolkit)\b/i,
  /\b(we wrote|we created|we built) a /i,
  /\baccess (to |your |the |our )/i,
  /\bregister (now|today|for)/i,
  /\b(join us|save your (seat|spot)|rsvp)/i,
]

// Body-preview signals that strongly indicate marketing/cold outreach even
// when the footer (with "unsubscribe") doesn't fit in the preview window.
const MARKETING_BODY_SIGNALS = [
  /unsubscribe/i, /opt[- ]?out/i,
  /view (this )?(email |message )?(online|in (your )?browser)/i,
  /having trouble (reading|viewing) this email/i,
  /you (are )?receiv(ing|ed) this (email|message) because/i,
  /to stop receiving/i, /manage (your )?preferences/i,
  // Cold sales outreach tells
  /\bnot a fit\b/i,
  /\breply with ["']?not (interested|a fit)["']?/i,
  /\bif (i'?m|this is) off (here|base)\b/i,
  /\bwon'?t follow up\b/i,
  /\bquick (question|favor|intro)\b/i,
  /\bworth a (quick |brief )?(chat|call|convo)/i,
]

function isLikelyMarketing(fromEmail: string, subject: string, bodyPreview?: string): boolean {
  if (MARKETING_SENDER_PATTERNS.some(p => p.test(fromEmail))) return true
  if (MARKETING_SUBJECT_PATTERNS.some(p => p.test(subject))) return true
  if (bodyPreview && MARKETING_BODY_SIGNALS.some(p => p.test(bodyPreview))) return true
  return false
}

function extractDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase()
}

// ── Parse List-Unsubscribe header ──────────────────────────────────────
// Format: <https://example.com/unsub>, <mailto:unsub@example.com>
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

// ── Microsoft Graph API helper ─────────────────────────────────────────
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
    // Refresh token and retry
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

// ── Fetch List-Unsubscribe headers for a specific message ──────────────
async function fetchUnsubscribeHeaders(
  messageId: string,
  accessToken: string,
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<{ url: string | null; mailto: string | null; hasOneClick: boolean; token: string }> {
  // Microsoft Graph: internetMessageHeaders contains all RFC headers
  const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=internetMessageHeaders`

  const { data, token } = await graphFetch(graphUrl, accessToken, supabase, integrationId, refreshToken)

  let url: string | null = null
  let mailto: string | null = null
  let hasOneClick = false

  if (data.internetMessageHeaders) {
    for (const header of data.internetMessageHeaders) {
      const name = header.name?.toLowerCase()
      if (name === 'list-unsubscribe') {
        const parsed = parseListUnsubscribe(header.value || '')
        url = parsed.url
        mailto = parsed.mailto
      }
      if (name === 'list-unsubscribe-post') {
        // RFC 8058: presence of this header means one-click is supported
        hasOneClick = true
      }
    }
  }

  return { url, mailto, hasOneClick, token }
}

// ============================================================
// MAIN FUNCTION
// ============================================================

export const scanEmailSubscriptions = inngest.createFunction(
  { id: 'scan-email-subscriptions' },
  [
    { cron: 'TZ=America/Los_Angeles 0 7 * * *' }, // 7 AM PT daily
    { event: 'subscriptions/scan' },              // on-demand trigger
  ],
  async ({ step, event }) => {
    const supabase = getAdminClient()
    const startTime = Date.now()

    // On-demand runs can target a single user's teams
    const targetUserId = (event as any)?.data?.userId || null

    // Get all teams with active Outlook integrations (optionally filtered to one user)
    const teams = await step.run('get-outlook-teams', async () => {
      let query = supabase
        .from('integrations')
        .select('id, team_id, config')
        .eq('provider', 'outlook')
        .eq('status', 'connected')

      if (targetUserId) query = query.eq('user_id', targetUserId)

      const { data } = await query

      return (data || []).map(i => ({
        integrationId: i.id,
        teamId: i.team_id,
        accessToken: i.config?.access_token as string,
        refreshToken: i.config?.refresh_token as string,
      }))
    })

    const results: Array<{ teamId: string; found: number; errors: number }> = []

    for (const team of teams) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const result = await step.run(`scan-team-${team.teamId}`, async () => {
        let found = 0
        let errors = 0
        let msToken = team.accessToken

        // Get team members with Outlook connected
        const { data: members } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', team.teamId)

        if (!members?.length) return { teamId: team.teamId, found: 0, errors: 0 }

        for (const member of members) {
          const userId = member.user_id

          // Find recent marketing-pattern emails (last 30 days) not yet tracked
          const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
          const { data: emails } = await supabase
            .from('outlook_messages')
            .select('message_id, from_name, from_email, subject, body_preview, received_at, is_read')
            .eq('team_id', team.teamId)
            .or(`user_id.eq.${userId},user_id.is.null`)
            .gte('received_at', thirtyDaysAgo)
            .order('received_at', { ascending: false })
            .limit(500)

          if (!emails?.length) continue

          // Filter to marketing-pattern emails and group by sender
          const senderMap = new Map<string, {
            fromName: string
            fromEmail: string
            subject: string
            bodyPreview: string
            receivedAt: string
            messageId: string
            isRead: boolean
            count: number
            firstSeen: string
          }>()

          for (const email of emails) {
            if (!isLikelyMarketing(email.from_email, email.subject, email.body_preview)) continue

            const key = email.from_email.toLowerCase()
            const existing = senderMap.get(key)
            if (existing) {
              existing.count++
              if (email.received_at < existing.firstSeen) {
                existing.firstSeen = email.received_at
              }
              // Keep the most recent email as the sample
              if (email.received_at > existing.receivedAt) {
                existing.subject = email.subject
                existing.bodyPreview = email.body_preview
                existing.receivedAt = email.received_at
                existing.messageId = email.message_id
                existing.isRead = email.is_read
              }
            } else {
              senderMap.set(key, {
                fromName: email.from_name,
                fromEmail: email.from_email,
                subject: email.subject,
                bodyPreview: email.body_preview || '',
                receivedAt: email.received_at,
                messageId: email.message_id,
                isRead: email.is_read ?? true,
                count: 1,
                firstSeen: email.received_at,
              })
            }
          }

          // Check which senders are already tracked and shouldn't be re-surfaced.
          // - active: currently showing in the UI
          // - unsubscribed: user already unsubscribed (if it worked, no new emails arrive;
          //   if it didn't, the sender ignored it — but we don't spam the user with retries)
          // - kept: user explicitly chose to keep this subscription
          // Only 'failed' senders are re-discovered, since the unsubscribe attempt
          // didn't work and the user will keep receiving emails.
          const { data: existingSubs } = await supabase
            .from('email_subscriptions')
            .select('from_email, status')
            .eq('user_id', userId)
            .in('status', ['active', 'unsubscribed', 'kept'])
            .in('from_email', [...senderMap.keys()])

          const trackedEmails = new Set(
            (existingSubs || []).map(s => s.from_email.toLowerCase())
          )

          // Fetch unsubscribe headers for new marketing senders
          let headersFetched = 0
          for (const [, sender] of senderMap) {
            if (trackedEmails.has(sender.fromEmail.toLowerCase())) {
              // Update email count for existing active subscriptions
              await supabase
                .from('email_subscriptions')
                .update({
                  email_count: sender.count,
                  subject: sender.subject,
                  body_preview: sender.bodyPreview,
                  received_at: sender.receivedAt,
                  is_read: sender.isRead,
                  updated_at: new Date().toISOString(),
                })
                .eq('user_id', userId)
                .eq('from_email', sender.fromEmail.toLowerCase())
                .eq('status', 'active')
              continue
            }

            if (headersFetched >= MAX_HEADERS_PER_RUN) break

            try {
              const { url, mailto, hasOneClick, token } = await fetchUnsubscribeHeaders(
                sender.messageId, msToken, supabase, team.integrationId, team.refreshToken
              )
              msToken = token
              headersFetched++

              // Determine detection method (header > body_link > sender_pattern)
              let detectionMethod = 'sender_pattern'
              if (url || mailto) {
                detectionMethod = 'header'
              } else if (MARKETING_BODY_SIGNALS.some(p => p.test(sender.bodyPreview))) {
                detectionMethod = 'body_link'
              }

              // Surface any sender matched as marketing, even without an unsubscribe link.
              // The UI disables the one-click button and tells the user to unsubscribe
              // manually in Outlook — that's still better than hiding the sender entirely.
              const { error: insertErr } = await supabase
                .from('email_subscriptions')
                .insert({
                  team_id: team.teamId,
                  user_id: userId,
                  from_name: sender.fromName,
                  from_email: sender.fromEmail.toLowerCase(),
                  sender_domain: extractDomain(sender.fromEmail),
                  subject: sender.subject,
                  body_preview: sender.bodyPreview,
                  received_at: sender.receivedAt,
                  outlook_message_id: sender.messageId,
                  is_read: sender.isRead,
                  unsubscribe_url: url,
                  unsubscribe_mailto: mailto,
                  has_one_click: hasOneClick,
                  detection_method: detectionMethod,
                  email_count: sender.count,
                  first_seen_at: sender.firstSeen,
                })

              if (!insertErr) found++
            } catch (err) {
              errors++
              console.error(`Failed to fetch headers for ${sender.messageId}:`, (err as Error).message)
            }
          }
        }

        return { teamId: team.teamId, found, errors }
      })

      results.push(result)
    }

    const totalFound = results.reduce((s, r) => s + r.found, 0)
    const totalErrors = results.reduce((s, r) => s + r.errors, 0)
    console.log(`Subscription scan complete: ${totalFound} new subscriptions found, ${totalErrors} errors`)

    return { teams: results.length, totalFound, totalErrors }
  }
)
