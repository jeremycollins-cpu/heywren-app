import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatch, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'
import { getOutlookIntegration, markReadAndArchive, markMessageAsRead } from '@/lib/outlook/graph-client'
import { resolveTeamId } from '@/lib/team/resolve-team'

function normalizeSubject(subject: string | null): string {
  if (!subject) return '(no subject)'
  // Strip Re:/Fwd:/RE:/FW:/Fw: prefixes (possibly repeated)
  return subject.replace(/^(re:\s*|fwd?:\s*|fw:\s*)+/i, '').trim().toLowerCase()
}

const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const urgencyLabels = ['critical', 'high', 'medium', 'low'] as const

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get user's team (self-heals if current_team_id is null)
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id, wren_preferences')
      .eq('id', user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Sensitivity → confidence threshold mapping
    const sensitivity = (profile?.wren_preferences as any)?.sensitivity || 'balanced'
    const minConfidence = sensitivity === 'focused' ? 0.8 : sensitivity === 'comprehensive' ? 0.4 : 0.6

    // Fetch pending and snoozed missed emails — scoped to THIS user only.
    // Join outlook_messages to pull Graph's authoritative webLink, which deep-links
    // to the exact thread. Reconstructing a URL from message_id alone lands users
    // on the Outlook inbox root instead of the specific message.
    const { data: missedEmails, error } = await supabase
      .from('missed_emails')
      .select('*, outlook_messages(web_link)')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .in('status', ['pending', 'snoozed'])
      .gte('confidence', minConfidence)
      .order('received_at', { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Prefer Graph's webLink (stable deeplink). Fall back to the deeplink/read
    // route for legacy rows where webLink wasn't captured at sync time.
    const emailsWithLinks = (missedEmails || []).map((email: any) => {
      const joinedLink = email.outlook_messages?.web_link as string | null | undefined
      const fallback = email.message_id
        ? `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(email.message_id)}`
        : null
      const { outlook_messages: _om, ...rest } = email
      return { ...rest, web_link: joinedLink || fallback }
    })

    // Group emails by normalized subject line
    const threadMap = new Map<string, Array<any>>()

    for (const email of emailsWithLinks) {
      const key = normalizeSubject(email.subject)
      const group = threadMap.get(key)
      if (group) {
        group.push(email)
      } else {
        threadMap.set(key, [email])
      }
    }

    // Build thread groups
    const threadGroups = Array.from(threadMap.values()).map((emails) => {
      // Sort by urgency then recency within the group
      emails.sort((a, b) => {
        const urgDiff = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
        if (urgDiff !== 0) return urgDiff
        return new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
      })

      const primary = emails[0]

      // Find highest urgency in thread
      let highestUrgencyIdx = 4
      for (const e of emails) {
        const idx = urgencyOrder[e.urgency] ?? 4
        if (idx < highestUrgencyIdx) highestUrgencyIdx = idx
      }
      const threadHighestUrgency = urgencyLabels[highestUrgencyIdx] || primary.urgency

      // Combine unique question summaries
      const summaries = emails
        .map(e => e.question_summary)
        .filter((s): s is string => !!s)
      const uniqueSummaries = [...new Set(summaries)]
      const combinedQuestionSummary = uniqueSummaries.join(' | ')

      return {
        ...primary,
        // Override urgency with highest in thread for display
        urgency: threadHighestUrgency,
        question_summary: combinedQuestionSummary || primary.question_summary,
        // Thread metadata
        threadCount: emails.length,
        threadEmailIds: emails.map(e => e.id),
        threadHighestUrgency,
        threadEmails: emails.map(e => ({
          id: e.id,
          from_name: e.from_name,
          from_email: e.from_email,
          subject: e.subject,
          received_at: e.received_at,
          urgency: e.urgency,
          body_preview: e.body_preview,
          question_summary: e.question_summary,
          category: e.category,
          is_read: e.is_read,
          folder_name: e.folder_name,
        })),
      }
    })

    // Sort thread groups by highest urgency then most recent email
    threadGroups.sort((a, b) => {
      const urgDiff = (urgencyOrder[a.threadHighestUrgency] ?? 4) - (urgencyOrder[b.threadHighestUrgency] ?? 4)
      if (urgDiff !== 0) return urgDiff
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
    })

    // Get total evaluated count from missed_emails (already classified) instead of
    // scanning outlook_messages with expensive ILIKE pattern matching
    const { count: totalEvaluated } = await supabase
      .from('missed_emails')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('user_id', user.id)

    // Get the most recent classification timestamp to show when data was last refreshed
    const { data: latestRecord } = await supabase
      .from('missed_emails')
      .select('created_at')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      missedEmails: threadGroups,
      totalEvaluated: totalEvaluated || 0,
      lastRefreshedAt: latestRecord?.created_at || null,
    })
  } catch (err) {
    console.error('GET /api/missed-emails error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
  if (!teamId) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const adminDb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Load user preferences
  const { data: prefsRow } = await adminDb
    .from('email_preferences')
    .select('*')
    .eq('user_id', user.id)
    .eq('team_id', teamId)
    .maybeSingle()

  // Load feedback history for auto-blocking — scoped to this user
  const { data: feedbackRows } = await adminDb
    .from('missed_email_feedback')
    .select('from_email, from_domain, feedback')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .eq('feedback', 'invalid')

  const domainCounts: Record<string, number> = {}
  const emailCounts: Record<string, number> = {}
  for (const f of feedbackRows || []) {
    domainCounts[f.from_domain] = (domainCounts[f.from_domain] || 0) + 1
    emailCounts[f.from_email] = (emailCounts[f.from_email] || 0) + 1
  }

  const userPrefs: UserEmailPreferences = {
    vipContacts: prefsRow?.vip_contacts || [],
    blockedSenders: prefsRow?.blocked_senders || [],
    enabledCategories: prefsRow?.enabled_categories || ['question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'],
    minUrgency: prefsRow?.min_urgency || 'low',
    feedbackBlockedDomains: new Set(
      Object.entries(domainCounts).filter(([, c]) => c >= 2).map(([d]) => d)
    ),
    feedbackBlockedEmails: new Set(
      Object.entries(emailCounts).filter(([, c]) => c >= 1).map(([e]) => e)
    ),
  }

  const scanWindowDays = prefsRow?.scan_window_days || 7
  const scanWindowAgo = new Date(Date.now() - scanWindowDays * 24 * 60 * 60 * 1000).toISOString()

  // Fetch recent emails — scoped to emails relevant to this user
  const userEmail = user.email?.toLowerCase() || ''
  const userName = user.user_metadata?.full_name || ''
  let { data: emails, error: fetchErr } = await adminDb
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at')
    .eq('team_id', teamId)
    .gte('received_at', scanWindowAgo)
    .order('received_at', { ascending: false })
    .limit(200)

  // If no emails found, check if user has Outlook connected and trigger a sync
  if ((!emails || emails.length === 0) && !fetchErr) {
    const { data: outlookIntegration } = await adminDb
      .from('integrations')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .eq('provider', 'outlook')
      .limit(1)
      .maybeSingle()

    if (outlookIntegration) {
      try {
        // Trigger the backfill to pull emails from Outlook API
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'
        const backfillRes = await fetch(`${baseUrl}/api/integrations/outlook/backfill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, daysBack: scanWindowDays }),
        })
        if (backfillRes.ok) {
          // Re-fetch emails after backfill
          const refetch = await adminDb
            .from('outlook_messages')
            .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at')
            .eq('team_id', teamId)
            .gte('received_at', scanWindowAgo)
            .order('received_at', { ascending: false })
            .limit(200)
          emails = refetch.data
          fetchErr = refetch.error
        }
      } catch (e) {
        console.warn('Failed to trigger Outlook backfill:', e)
      }
    }
  }

  if (fetchErr || !emails) {
    return NextResponse.json({ error: fetchErr?.message || 'Failed to fetch emails' }, { status: 500 })
  }

  // Filter out already classified
  const { data: existing } = await adminDb
    .from('missed_emails')
    .select('message_id')
    .eq('team_id', teamId)
    .eq('user_id', user.id)

  const existingIds = new Set((existing || []).map(e => e.message_id))

  // Only scan emails where this user is a recipient (not sender), to avoid cross-user data leaks
  const relevantEmails = emails.filter(e => {
    if (!userEmail) return false
    // Skip emails FROM the user (they don't need to reply to themselves)
    if (e.from_email?.toLowerCase() === userEmail) return false
    // Check if user is in to_recipients
    const recipients = JSON.stringify(e.to_recipients || '').toLowerCase()
    return recipients.includes(userEmail)
  })

  const newEmails = relevantEmails.filter(e => !existingIds.has(e.message_id))

  if (newEmails.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, missed: 0 })
  }

  let totalMissed = 0

  // Process in batches of 15
  for (let i = 0; i < newEmails.length; i += 15) {
    const chunk = newEmails.slice(i, i + 15)
    const batchInput = chunk.map(email => ({
      id: email.message_id,
      fromEmail: email.from_email || '',
      fromName: email.from_name || '',
      subject: email.subject || '(no subject)',
      bodyPreview: email.body_preview || '',
      receivedAt: email.received_at,
      recipientEmail: userEmail,
      recipientName: userName,
    }))

    try {
      const classifications = await classifyMissedEmailBatch(batchInput, userPrefs)

      for (const email of chunk) {
        const classification = classifications.get(email.message_id)
        if (classification) {
          const { error: insertErr } = await adminDb
            .from('missed_emails')
            .upsert({
              team_id: teamId,
              user_id: user.id,
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
              status: 'pending',
            }, { onConflict: 'team_id,message_id' })

          if (!insertErr) totalMissed++
        }
      }
    } catch (err) {
      console.error('Batch classification error:', (err as Error).message)
    }
  }

  return NextResponse.json({ success: true, scanned: newEmails.length, missed: totalMissed })
}

export async function PATCH(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await req.json()
  const { id, status, snoozed_until, threadEmailIds, resolution_type, delegated_to } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = { status }
  if (snoozed_until) {
    updateData.snoozed_until = snoozed_until
  }
  if (resolution_type) {
    updateData.resolution_type = resolution_type
  }
  if (delegated_to) {
    updateData.delegated_to = delegated_to
  }

  // If threadEmailIds provided, bulk update all emails in the thread
  // SECURITY: Always scope to current user to prevent cross-user data manipulation
  if (threadEmailIds && Array.isArray(threadEmailIds) && threadEmailIds.length > 0) {
    const { error } = await supabase
      .from('missed_emails')
      .update(updateData)
      .in('id', threadEmailIds)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, updated: threadEmailIds.length })
  }

  // Single email update
  const { error } = await supabase
    .from('missed_emails')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Sync action to Outlook (mark as read / archive) ──
  // Fire-and-forget so we don't block the UI response
  if (status === 'replied' || status === 'dismissed') {
    syncEmailToOutlook(user.id, id, status, threadEmailIds).catch(err =>
      console.warn('[missed-emails] Outlook sync failed:', err)
    )
  }

  return NextResponse.json({ success: true })
}

async function syncEmailToOutlook(
  userId: string,
  missedEmailId: string,
  status: string,
  threadEmailIds?: string[],
) {
  const adminDb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Get the user's profile and integration
  const { data: profile } = await adminDb
    .from('profiles')
    .select('current_team_id')
    .eq('id', userId)
    .single()

  const resolvedTeamId = profile?.current_team_id || await resolveTeamId(adminDb, userId)
  if (!resolvedTeamId) return

  const integration = await getOutlookIntegration(resolvedTeamId, userId)
  if (!integration) return

  const ctx = {
    supabase: adminDb,
    integrationId: integration.id,
    refreshToken: integration.refresh_token,
  }

  // Get Graph message IDs from the missed_emails records
  const ids = threadEmailIds?.length ? threadEmailIds : [missedEmailId]
  const { data: emails } = await adminDb
    .from('missed_emails')
    .select('message_id')
    .in('id', ids)

  if (!emails?.length) return

  let token = integration.access_token
  for (const email of emails) {
    if (!email.message_id) continue
    try {
      if (status === 'dismissed') {
        // Dismissed → mark as read and archive
        const result = await markReadAndArchive(email.message_id, token, ctx)
        token = result.token
      } else {
        // Replied → just mark as read (user already responded)
        const result = await markMessageAsRead(email.message_id, token, ctx)
        token = result.token
      }
    } catch {
      // Non-critical — don't fail the HeyWren action if Outlook sync fails
    }
  }
}

export const dynamic = 'force-dynamic'
