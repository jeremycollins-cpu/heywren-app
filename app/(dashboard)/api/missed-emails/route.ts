import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
