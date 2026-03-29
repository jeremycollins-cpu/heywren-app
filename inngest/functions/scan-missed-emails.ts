import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatch, getClassificationStats, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'

const MAX_EMAILS_PER_RUN = 200
const TIME_BUDGET_MS = 300000 // 5 minutes

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function scanTeamMissedEmails(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
) {
  const startTime = Date.now()

  // Load user preferences and feedback history
  const { data: prefsRow } = await supabase
    .from('email_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .maybeSingle()

  // Load feedback history — domains/emails with 3+ invalid marks get auto-blocked
  const { data: feedbackRows } = await supabase
    .from('missed_email_feedback')
    .select('from_email, from_domain, feedback')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('feedback', 'invalid')

  const domainCounts: Record<string, number> = {}
  const emailCounts: Record<string, number> = {}
  for (const f of feedbackRows || []) {
    domainCounts[f.from_domain] = (domainCounts[f.from_domain] || 0) + 1
    emailCounts[f.from_email] = (emailCounts[f.from_email] || 0) + 1
  }

  const feedbackBlockedDomains = new Set(
    Object.entries(domainCounts).filter(([, c]) => c >= 3).map(([d]) => d)
  )
  const feedbackBlockedEmails = new Set(
    Object.entries(emailCounts).filter(([, c]) => c >= 3).map(([e]) => e)
  )

  const userPrefs: UserEmailPreferences = {
    vipContacts: prefsRow?.vip_contacts || [],
    blockedSenders: prefsRow?.blocked_senders || [],
    enabledCategories: prefsRow?.enabled_categories || ['question', 'request', 'decision', 'follow_up', 'introduction'],
    minUrgency: prefsRow?.min_urgency || 'low',
    feedbackBlockedDomains,
    feedbackBlockedEmails,
  }

  const scanWindowDays = prefsRow?.scan_window_days || 7

  // Fetch recent outlook_messages that haven't been classified for missed emails yet
  const scanWindowAgo = new Date(Date.now() - scanWindowDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: emails, error: fetchErr } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at')
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .gte('received_at', scanWindowAgo)
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS_PER_RUN)

  if (fetchErr || !emails) {
    console.error(`Team ${teamId}: Failed to fetch emails:`, fetchErr?.message)
    return { success: false, error: fetchErr?.message }
  }

  // Filter out emails we've already classified
  const { data: existing } = await supabase
    .from('missed_emails')
    .select('message_id')
    .eq('team_id', teamId)

  const existingIds = new Set((existing || []).map(e => e.message_id))
  const newEmails = emails.filter(e => !existingIds.has(e.message_id))

  if (newEmails.length === 0) {
    return { success: true, teamId, scanned: 0, missed: 0, duration: 0 }
  }

  let totalMissed = 0

  // Process in batches of 15
  for (let i = 0; i < newEmails.length; i += 15) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break

    const chunk = newEmails.slice(i, i + 15)
    const batchInput = chunk.map(email => ({
      id: email.message_id,
      fromEmail: email.from_email || '',
      fromName: email.from_name || '',
      subject: email.subject || '(no subject)',
      bodyPreview: email.body_preview || '',
      receivedAt: email.received_at,
    }))

    try {
      const classifications = await classifyMissedEmailBatch(batchInput, userPrefs)

      for (const email of chunk) {
        const classification = classifications.get(email.message_id)
        if (classification) {
          const { error: insertErr } = await supabase
            .from('missed_emails')
            .upsert({
              team_id: teamId,
              user_id: userId,
              outlook_message_id: email.id,
              message_id: email.message_id,
              from_name: email.from_name,
              from_email: email.from_email,
              to_recipients: email.to_recipients,
              subject: email.subject,
              body_preview: email.body_preview,
              received_at: email.received_at,
              urgency: classification.urgency,
              reason: classification.reason,
              question_summary: classification.questionSummary,
              category: classification.category,
              confidence: classification.confidence,
              expected_response_time: classification.expectedResponseTime || null,
              status: 'pending',
            }, { onConflict: 'team_id,message_id' })

          if (!insertErr) totalMissed++
        }
      }
    } catch (err) {
      console.error('Batch classification error:', (err as Error).message)
    }
  }

  // Auto-dismiss based on user preference
  const autoDismissDays = prefsRow?.auto_dismiss_days || 0
  if (autoDismissDays > 0) {
    const dismissCutoff = new Date(Date.now() - autoDismissDays * 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('missed_emails')
      .update({ status: 'dismissed' })
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .lt('received_at', dismissCutoff)
  }

  // Clean up: remove dismissed/replied emails older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('missed_emails')
    .delete()
    .eq('team_id', teamId)
    .in('status', ['dismissed', 'replied'])
    .lt('received_at', thirtyDaysAgo)

  const duration = Math.round((Date.now() - startTime) / 1000)
  const stats = getClassificationStats()

  return {
    success: true,
    teamId,
    scanned: newEmails.length,
    missed: totalMissed,
    stats,
    duration,
  }
}

// Run 30 min after each Outlook sync (6:30 AM, 10:30 AM, 2:30 PM, 6:30 PM PT)
// so new emails are classified within hours, not the next morning.
export const scanMissedEmails = inngest.createFunction(
  { id: 'scan-missed-emails' },
  { cron: 'TZ=America/Los_Angeles 30 6,10,14,18 * * *' },
  async () => {
    const supabase = getAdminClient()

    // Get all users with Outlook integrations
    const { data: integrations, error } = await supabase
      .from('integrations')
      .select('team_id, user_id')
      .eq('provider', 'outlook')

    if (error || !integrations) {
      console.error('Failed to fetch Outlook integrations:', error)
      return { success: false, error: error?.message }
    }

    console.log(`Missed email scan: ${integrations.length} user integration(s) to scan`)

    const results = []

    for (const integration of integrations) {
      try {
        const result = await scanTeamMissedEmails(
          supabase,
          integration.team_id,
          integration.user_id
        )
        results.push(result)
        console.log(`Team ${integration.team_id} missed email scan:`, result)
      } catch (err) {
        console.error(`Team ${integration.team_id} scan failed:`, (err as Error).message)
        results.push({ success: false, teamId: integration.team_id, error: (err as Error).message })
      }
    }

    return { success: true, teamsScanned: results.length, results }
  }
)
