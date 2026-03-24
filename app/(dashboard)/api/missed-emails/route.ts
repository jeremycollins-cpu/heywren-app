import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { classifyMissedEmailBatch, type UserEmailPreferences } from '@/lib/ai/classify-missed-email'

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

  // Fetch pending and snoozed missed emails
  const { data: missedEmails, error } = await supabase
    .from('missed_emails')
    .select('*')
    .eq('team_id', profile.current_team_id)
    .in('status', ['pending', 'snoozed'])
    .order('urgency', { ascending: true })  // critical first
    .order('received_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Re-sort with custom urgency order since Supabase sorts alphabetically
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = (missedEmails || []).sort((a: { urgency: string; received_at: string }, b: { urgency: string; received_at: string }) => {
    const urgDiff = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
    if (urgDiff !== 0) return urgDiff
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
  })

  return NextResponse.json({ missedEmails: sorted })
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

  // Load feedback history for auto-blocking
  const { data: feedbackRows } = await adminDb
    .from('missed_email_feedback')
    .select('from_email, from_domain, feedback')
    .eq('team_id', teamId)
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

  // Fetch recent emails
  const { data: emails, error: fetchErr } = await adminDb
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at')
    .eq('team_id', teamId)
    .gte('received_at', scanWindowAgo)
    .order('received_at', { ascending: false })
    .limit(200)

  if (fetchErr || !emails) {
    return NextResponse.json({ error: fetchErr?.message || 'Failed to fetch emails' }, { status: 500 })
  }

  // Filter out already classified
  const { data: existing } = await adminDb
    .from('missed_emails')
    .select('message_id')
    .eq('team_id', teamId)

  const existingIds = new Set((existing || []).map(e => e.message_id))
  const newEmails = emails.filter(e => !existingIds.has(e.message_id))

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
  const { id, status, snoozed_until } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = { status }
  if (snoozed_until) {
    updateData.snoozed_until = snoozed_until
  }

  const { error } = await supabase
    .from('missed_emails')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
