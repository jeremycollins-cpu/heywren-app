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

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null
    let teamId: string | null = null

    // Try server-side session
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session read failed */ }

    const admin = getAdminClient()

    // If server-side session failed, try userId from query param
    if (!userId) {
      const { searchParams } = new URL(request.url)
      const qUserId = searchParams.get('userId')
      if (qUserId) {
        // Validate the userId exists
        const { data: authUser } = await admin.auth.admin.getUserById(qUserId)
        if (authUser?.user) userId = authUser.user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ items: [], count: 0 })
    }

    // Get user's email for matching sent items
    const { data: userProfile } = await admin
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()
    teamId = userProfile?.current_team_id || null
    const userEmail = userProfile?.email?.toLowerCase() || ''

    if (!teamId) {
      return NextResponse.json({ items: [], count: 0 })
    }

    // Only show items that belong to THIS user.
    // Primary filter: match by sender_email (most reliable — set from Graph /me).
    // Fallback filter: match by user_id (for items before sender_email was added).
    // This prevents User A from seeing User B's sent emails on the same team.
    let allItems: any[] = []

    if (userEmail) {
      // Try sender_email match first (most accurate)
      const { data: emailItems, error: emailErr } = await admin
        .from('awaiting_replies')
        .select('*')
        .eq('team_id', teamId)
        .eq('sender_email', userEmail)
        .in('status', ['waiting', 'snoozed'])
        .order('urgency', { ascending: true })
        .order('sent_at', { ascending: true })
        .limit(50)

      if (!emailErr && emailItems && emailItems.length > 0) {
        allItems = emailItems
      }
    }

    // Fallback: items without sender_email that match user_id
    if (allItems.length === 0) {
      const { data: idItems, error: idErr } = await admin
        .from('awaiting_replies')
        .select('*')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .is('sender_email', null)
        .in('status', ['waiting', 'snoozed'])
        .order('urgency', { ascending: true })
        .order('sent_at', { ascending: true })
        .limit(50)

      if (!idErr) allItems = idItems || []
    }

    const items = allItems

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

    // Verify user's team ownership
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
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
      .eq('team_id', teamId)
      .eq('user_id', userData.user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Awaiting replies PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
