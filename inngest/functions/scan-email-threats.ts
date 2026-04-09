// inngest/functions/scan-email-threats.ts
// Scans recent emails for phishing, scam, and social engineering threats.
// Two-tier detection: header analysis (free) → AI content analysis (only suspicious emails).
// Runs daily at 7:30 AM PT — after sync-outlook (6 AM) pulls latest emails.
// Only creates alerts for threats with confidence >= 0.75 to maintain trust.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import {
  tier1Analysis,
  tier2Analysis,
  type EmailForThreatAnalysis,
  type ThreatAssessment,
} from '@/lib/ai/detect-email-threats'
import { graphFetch as graphFetchWithRefresh, getOutlookIntegration } from '@/lib/outlook/graph-client'
import { sendProactiveAlert } from '@/lib/notifications/send-proactive-alert'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MAX_EMAILS_PER_USER = 50
const MIN_CONFIDENCE_TO_ALERT = 0.75
const TIME_BUDGET_MS = 240000 // 4 minutes

// Thin wrapper around the graph-client's token-refreshing graphFetch
async function fetchFromGraph(
  url: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ data: any; token: string }> {
  return graphFetchWithRefresh(url, { token }, ctx)
}

export const scanEmailThreats = inngest.createFunction(
  { id: 'scan-email-threats', retries: 2, concurrency: { limit: 3 } },
  { cron: 'TZ=America/Los_Angeles 30 7 * * *' }, // 7:30 AM PT daily
  async ({ step }) => {
    const supabase = getAdminClient()
    const startTime = Date.now()

    // Get all users with Outlook integration
    const integrations = await step.run('fetch-integrations', async () => {
      const { data } = await supabase
        .from('integrations')
        .select('id, team_id, user_id, access_token, refresh_token')
        .eq('provider', 'outlook')

      return data || []
    })

    let totalScanned = 0
    let totalThreats = 0

    for (const integration of integrations) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      await step.run(`scan-${integration.user_id}`, async () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()

        // Build token refresh context for Graph API calls
        const ctx = {
          supabase,
          integrationId: integration.id,
          refreshToken: integration.refresh_token,
        }
        let currentToken = integration.access_token

        // Fetch recent emails from our cached table
        const { data: emails } = await supabase
          .from('outlook_messages')
          .select('message_id, from_name, from_email, subject, body_preview, received_at, to_recipients, cc_recipients')
          .eq('team_id', integration.team_id)
          .eq('user_id', integration.user_id)
          .gte('received_at', twoDaysAgo)
          .order('received_at', { ascending: false })
          .limit(MAX_EMAILS_PER_USER)

        if (!emails || emails.length === 0) return

        // Check which emails already have alerts (avoid re-scanning)
        const { data: existingAlerts } = await supabase
          .from('email_threat_alerts')
          .select('outlook_message_id')
          .eq('team_id', integration.team_id)
          .eq('user_id', integration.user_id)
          .in('outlook_message_id', emails.map(e => e.message_id))

        const existingIds = new Set((existingAlerts || []).map(a => a.outlook_message_id))
        const newEmails = emails.filter(e => !existingIds.has(e.message_id))

        for (const email of newEmails) {
          if (Date.now() - startTime > TIME_BUDGET_MS) break

          const emailInput: EmailForThreatAnalysis = {
            messageId: email.message_id,
            fromEmail: email.from_email,
            fromName: email.from_name || '',
            subject: email.subject || '',
            bodyPreview: email.body_preview || '',
            receivedAt: email.received_at,
            toRecipients: email.to_recipients,
            ccRecipients: email.cc_recipients,
          }

          // Fetch headers from Graph API (with automatic token refresh on 401)
          let headersLoaded = false
          try {
            const { data: headerData, token: newToken } = await fetchFromGraph(
              `https://graph.microsoft.com/v1.0/me/messages/${email.message_id}?$select=internetMessageHeaders,replyTo,sender,hasAttachments`,
              currentToken,
              ctx
            )
            currentToken = newToken

            if (headerData && !headerData.error) {
              headersLoaded = true
              emailInput.headers = headerData.internetMessageHeaders || []
              emailInput.hasAttachments = headerData.hasAttachments || false
              if (headerData.replyTo?.length > 0) {
                emailInput.replyTo = headerData.replyTo[0]?.emailAddress?.address
              }
              if (headerData.sender?.emailAddress?.address) {
                emailInput.sender = headerData.sender.emailAddress.address
              }
            }
          } catch {
            // Continue without headers
          }

          // ── Tier 1: Header & pattern analysis ──
          const tier1 = tier1Analysis(emailInput)
          totalScanned++

          // If tier 1 found nothing AND we had full header data, skip tier 2.
          // But if headers failed to load, run tier 2 anyway since we can't
          // trust that the email is clean without authentication checks.
          if (tier1.skipTier2 && headersLoaded) continue

          // ── Tier 2: AI content analysis ──
          const assessment = await tier2Analysis(emailInput, tier1.signals)
          if (!assessment) continue

          // Apply tier 1 header results
          assessment.spfResult = tier1.spfResult
          assessment.dkimResult = tier1.dkimResult
          assessment.dmarcResult = tier1.dmarcResult
          assessment.replyToMismatch = tier1.replyToMismatch
          assessment.senderMismatch = tier1.senderMismatch

          // Only create alert if above confidence threshold AND flagged as threat
          if (!assessment.isThreat || assessment.confidence < MIN_CONFIDENCE_TO_ALERT) continue

          const { error } = await supabase
            .from('email_threat_alerts')
            .upsert(
              {
                team_id: integration.team_id,
                user_id: integration.user_id,
                outlook_message_id: email.message_id,
                from_name: email.from_name,
                from_email: email.from_email,
                subject: email.subject,
                received_at: email.received_at,
                threat_level: assessment.threatLevel,
                threat_type: assessment.threatType,
                confidence: assessment.confidence,
                signals: assessment.signals,
                spf_result: assessment.spfResult,
                dkim_result: assessment.dkimResult,
                dmarc_result: assessment.dmarcResult,
                reply_to_mismatch: assessment.replyToMismatch,
                sender_mismatch: assessment.senderMismatch,
                explanation: assessment.explanation,
                recommended_actions: assessment.recommendedActions,
                do_not_actions: assessment.doNotActions,
                status: 'unreviewed',
              },
              { onConflict: 'team_id,user_id,outlook_message_id' }
            )

          if (!error) {
            totalThreats++

            // Proactive alert for high/critical threats
            if (assessment.threatLevel === 'critical' || assessment.threatLevel === 'high') {
              try {
                await sendProactiveAlert({
                  teamId: integration.team_id,
                  userId: integration.user_id,
                  notificationType: 'security_alert',
                  title: `${assessment.threatLevel === 'critical' ? 'CRITICAL' : 'High'} security threat: "${email.subject}"`,
                  body: assessment.explanation || `Suspicious email from ${email.from_email} detected as ${assessment.threatType}`,
                  link: '/security-alerts',
                  slackText: `*:rotating_light: ${assessment.threatLevel.toUpperCase()} security threat detected*\n>*From:* ${email.from_name || email.from_email}\n>*Subject:* ${email.subject}\n>\n>${assessment.explanation || 'Review this email in Security Alerts before interacting.'}`,
                  idempotencyKey: `threat-${integration.user_id}-${email.message_id}`,
                })
              } catch {
                // Alert is best-effort
              }
            }
          }
        }
      })
    }

    return { success: true, scanned: totalScanned, threats: totalThreats, users: integrations.length }
  }
)
