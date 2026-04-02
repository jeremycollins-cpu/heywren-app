import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatch, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'

function normalizeSubject(subject: string | null): string {
  if (!subject) return '(no subject)'
  // Strip Re:/Fwd:/RE:/FW:/Fw: prefixes (possibly repeated)
  return subject.replace(/^(re:\s*|fwd?:\s*|fw:\s*)+/i, '').trim().toLowerCase()
}

const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const urgencyLabels = ['critical', 'high', 'medium', 'low'] as const

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get user's team
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  // Fetch pending and snoozed missed emails — scoped to THIS user only
  const { data: missedEmails, error } = await supabase
    .from('missed_emails')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at, urgency, reason, question_summary, category, confidence, expected_response_time, status, is_read, folder_name')
    .eq('team_id', profile.current_team_id)
    .eq('user_id', user.id)
    .in('status', ['pending', 'snoozed'])
    .order('received_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group emails by normalized subject line
  const threadMap = new Map<string, Array<typeof missedEmails[number]>>()

  for (const email of missedEmails || []) {
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
    .eq('team_id', profile.current_team_id)
    .eq('user_id', user.id)

  return NextResponse.json({
    missedEmails: threadGroups,
    totalEvaluated: totalEvaluated || 0,
  })
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

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const teamId = profile.current_team_id
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
    enabledCategories: prefsRow?.enabled_categories || ['question', 'request', 'decision', 'follow_up', 'introduction'],
    minUrgency: prefsRow?.min_urgency || 'low',
    feedbackBlockedDomains: new Set(
      Object.entries(domainCounts).filter(([, c]) => c >= 3).map(([d]) => d)
    ),
    feedbackBlockedEmails: new Set(
      Object.entries(emailCounts).filter(([, c]) => c >= 3).map(([e]) => e)
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

  return NextResponse.json({ success: true })
}

export const dynamic = 'force-dynamic'
