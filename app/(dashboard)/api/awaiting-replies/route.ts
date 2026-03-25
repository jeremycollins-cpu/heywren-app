// app/(dashboard)/api/awaiting-replies/route.ts
// API for "The Waiting Room" — items the user sent that haven't received a reply.
//
// GET:  Fetch waiting items for the current user's team
// PATCH: Update status (waiting → dismissed/snoozed/replied)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ items: [], count: 0 })
    }

    const admin = getAdminClient()

    const { data: items, error } = await admin
      .from('awaiting_replies')
      .select('*')
      .eq('team_id', teamId)
      .in('status', ['waiting', 'snoozed'])
      .order('urgency', { ascending: true }) // critical first
      .order('sent_at', { ascending: true }) // oldest first
      .limit(50)

    if (error) {
      // Table may not exist yet if migration 014 hasn't been run
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json({ items: [], count: 0 })
      }
      console.error('Failed to fetch awaiting replies:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Update days_waiting on the fly
    const now = Date.now()
    const enriched = (items || []).map(item => ({
      ...item,
      days_waiting: Math.floor((now - new Date(item.sent_at).getTime()) / 86400000),
    }))

    // Sort: critical first, then high, then by days waiting desc
    const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    enriched.sort((a, b) => {
      const ua = urgencyOrder[a.urgency] ?? 2
      const ub = urgencyOrder[b.urgency] ?? 2
      if (ua !== ub) return ua - ub
      return b.days_waiting - a.days_waiting
    })

    return NextResponse.json({ items: enriched, count: enriched.length })
  } catch (err: any) {
    console.error('Awaiting replies GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: Trigger an on-demand scan of sent items
export async function POST() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Import and run the scan
    const { scanTeamAwaitingReplies } = await import('@/inngest/functions/scan-awaiting-replies')
    const admin = getAdminClient()
    const result = await scanTeamAwaitingReplies(admin, teamId, userData.user.id)

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Awaiting replies scan error:', err)
    return NextResponse.json({ error: err.message || 'Scan failed' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status, snoozedUntil } = await request.json()

    if (!id || !status) {
      return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
    }

    if (!['waiting', 'dismissed', 'snoozed', 'replied'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const admin = getAdminClient()

    const updateFields: Record<string, any> = { status }
    if (status === 'snoozed' && snoozedUntil) {
      updateFields.snoozed_until = snoozedUntil
    }
    if (status === 'replied') {
      updateFields.replied_at = new Date().toISOString()
    }

    const { error } = await admin
      .from('awaiting_replies')
      .update(updateFields)
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Awaiting replies PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
