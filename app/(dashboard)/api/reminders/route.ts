export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/monitoring/report-error'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/reminders
 * Returns active reminders for the current user.
 * ?status=active|completed|all (default: active)
 */
export async function GET(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const statusFilter = request.nextUrl.searchParams.get('status') || 'active'

    let query = admin
      .from('reminders')
      .select('*')
      .eq('user_id', callerId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data: reminders, error } = await query

    if (error) {
      console.error('Reminders GET error:', error)
      return NextResponse.json({ error: 'Failed to load reminders' }, { status: 500 })
    }

    return NextResponse.json({ reminders: reminders || [] })
  } catch (err) {
    console.error('Reminders GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/reminders
 * Create a reminder from a commitment, mention, or manually.
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const body = await request.json()
    const { title, note, sourceType, sourceId } = body as {
      title: string
      note?: string
      sourceType?: 'commitment' | 'mention' | 'manual'
      sourceId?: string
    }

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    // Get team
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', callerId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Prevent duplicate reminders for the same source
    if (sourceType && sourceId) {
      const { data: existing } = await admin
        .from('reminders')
        .select('id')
        .eq('user_id', callerId)
        .eq('source_type', sourceType)
        .eq('source_id', sourceId)
        .eq('status', 'active')
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ error: 'Reminder already exists for this item', existing: true }, { status: 409 })
      }
    }

    const { data: reminder, error } = await admin
      .from('reminders')
      .insert({
        user_id: callerId,
        team_id: profile.current_team_id,
        title: title.trim(),
        note: note?.trim() || null,
        source_type: sourceType || 'manual',
        source_id: sourceId || null,
        status: 'active',
      } as any)
      .select()
      .single()

    if (error) {
      console.error('Reminder insert error:', error)
      await reportError({ source: 'api/reminders', message: error.message, userId: callerId, errorKey: 'reminder_create_failed' })
      return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 })
    }

    return NextResponse.json({ reminder })
  } catch (err) {
    console.error('Reminders POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/reminders
 * Complete or dismiss a reminder.
 * Bidirectional sync: completing a reminder also completes the linked commitment.
 */
export async function PATCH(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const body = await request.json()
    const { id, status } = body as { id: string; status: 'completed' | 'dismissed' }

    if (!id || !status) {
      return NextResponse.json({ error: 'id and status required' }, { status: 400 })
    }

    if (!['completed', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Fetch the reminder first (for bidirectional sync)
    const { data: reminder } = await admin
      .from('reminders')
      .select('source_type, source_id')
      .eq('id', id)
      .eq('user_id', callerId)
      .single()

    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // Update the reminder
    const { error } = await admin
      .from('reminders')
      .update({
        status,
        completed_at: status === 'completed' ? now : null,
        updated_at: now,
      } as any)
      .eq('id', id)
      .eq('user_id', callerId)

    if (error) {
      return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 })
    }

    // Bidirectional sync: if completing, also complete the linked commitment
    if (status === 'completed' && reminder.source_type === 'commitment' && reminder.source_id) {
      const { error: commitError } = await admin
        .from('commitments')
        .update({ status: 'completed', updated_at: now })
        .eq('id', reminder.source_id)

      if (commitError) {
        console.error('Bidirectional sync error (reminder→commitment):', commitError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Reminders PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
