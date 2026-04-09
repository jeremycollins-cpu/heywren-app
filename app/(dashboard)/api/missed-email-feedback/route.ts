export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTeamId } from '@/lib/team/resolve-team'

export async function POST(req: Request) {
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

  const body = await req.json()
  const { missed_email_id, from_email, feedback, reason } = body

  if (!from_email || !feedback) {
    return NextResponse.json({ error: 'Missing from_email or feedback' }, { status: 400 })
  }

  if (feedback !== 'valid' && feedback !== 'invalid') {
    return NextResponse.json({ error: 'Feedback must be "valid" or "invalid"' }, { status: 400 })
  }

  // Extract domain from email
  const from_domain = from_email.split('@')[1] || ''

  const { error } = await supabase
    .from('missed_email_feedback')
    .insert({
      team_id: teamId,
      user_id: user.id,
      missed_email_id: missed_email_id || null,
      from_email,
      from_domain,
      feedback,
      reason: reason || null,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // If marked invalid, dismiss this email AND all other pending emails from the same sender
  if (feedback === 'invalid') {
    if (missed_email_id) {
      await supabase
        .from('missed_emails')
        .update({ status: 'dismissed' })
        .eq('id', missed_email_id)
        .eq('user_id', user.id)
    }

    // Auto-dismiss all other pending emails from this sender
    await supabase
      .from('missed_emails')
      .update({ status: 'dismissed' })
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .eq('from_email', from_email)
      .eq('status', 'pending')

    // Check if this domain now has 2+ rejections — if so, dismiss ALL pending from that domain
    const { data: domainFeedback } = await supabase
      .from('missed_email_feedback')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .eq('from_domain', from_domain)
      .eq('feedback', 'invalid')

    if ((domainFeedback?.length || 0) >= 2) {
      await supabase
        .from('missed_emails')
        .update({ status: 'dismissed' })
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .ilike('from_email', `%@${from_domain}`)
    }
  }

  return NextResponse.json({ success: true })
}

// Get feedback stats for the settings page
export async function GET() {
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

  // Get feedback counts — scoped to current user only
  const { data: feedback } = await supabase
    .from('missed_email_feedback')
    .select('feedback, from_domain')
    .eq('team_id', teamId)
    .eq('user_id', user.id)

  const validCount = (feedback || []).filter(f => f.feedback === 'valid').length
  const invalidCount = (feedback || []).filter(f => f.feedback === 'invalid').length

  // Get frequently marked-invalid domains (potential auto-block candidates)
  const domainCounts: Record<string, number> = {}
  for (const f of (feedback || []).filter(f => f.feedback === 'invalid')) {
    domainCounts[f.from_domain] = (domainCounts[f.from_domain] || 0) + 1
  }
  const suggestedBlocks = Object.entries(domainCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }))

  return NextResponse.json({
    stats: { validCount, invalidCount, total: validCount + invalidCount },
    suggestedBlocks,
  })
}
