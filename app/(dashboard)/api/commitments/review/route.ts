export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/commitments/review
 * Returns pending_review commitments grouped by source.
 */
export async function GET() {
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

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id, organization_id')
      .eq('id', callerId)
      .single()

    if (!profile?.current_team_id && !profile?.organization_id) {
      return NextResponse.json({ groups: [], total: 0 })
    }

    const scopeField = profile.organization_id ? 'organization_id' : 'team_id'
    const scopeValue = profile.organization_id || profile.current_team_id

    const { data: pending, error } = await admin
      .from('commitments')
      .select('id, title, description, source, source_ref, source_url, category, metadata, created_at')
      .eq(scopeField, scopeValue)
      .or(`creator_id.eq.${callerId},assignee_id.eq.${callerId}`)
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('Review GET error:', error)
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
    }

    // Group by source
    const groups: Array<{
      key: string
      label: string
      source: string
      sourceRef: string | null
      items: typeof pending
      created_at: string
    }> = []

    const groupMap = new Map<string, typeof groups[0]>()

    for (const item of pending || []) {
      // Group meetings by source_ref (transcript ID), others by source + date
      const meta = (item.metadata && typeof item.metadata === 'object') ? item.metadata as Record<string, any> : {}
      let groupKey: string
      let label: string

      if (item.source === 'recording') {
        groupKey = `recording:${item.source_ref || item.id}`
        label = meta.meetingTitle || 'Meeting'
      } else if (item.source === 'slack') {
        // Group by date for Slack
        const day = new Date(item.created_at).toISOString().split('T')[0]
        groupKey = `slack:${day}`
        label = `Slack conversations — ${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      } else if (item.source === 'outlook' || item.source === 'email') {
        const day = new Date(item.created_at).toISOString().split('T')[0]
        groupKey = `email:${day}`
        label = `Emails — ${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      } else {
        groupKey = `other:${item.id}`
        label = 'Other'
      }

      if (!groupMap.has(groupKey)) {
        const group = {
          key: groupKey,
          label,
          source: item.source || 'unknown',
          sourceRef: item.source_ref,
          items: [] as any[],
          created_at: item.created_at,
        }
        groupMap.set(groupKey, group)
        groups.push(group)
      }
      groupMap.get(groupKey)!.items.push(item)
    }

    return NextResponse.json({
      groups,
      total: (pending || []).length,
    })
  } catch (err) {
    console.error('Review GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/commitments/review
 * Accept, reject, or edit+accept commitments.
 * Body: { action: 'accept' | 'reject' | 'accept_all' | 'reject_all', ids: string[], title?: string }
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
    const { action, ids, title } = body as {
      action: 'accept' | 'reject' | 'accept_all' | 'reject_all'
      ids: string[]
      title?: string
    }

    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'action and ids required' }, { status: 400 })
    }

    const now = new Date().toISOString()

    if (action === 'accept' || action === 'accept_all') {
      // If editing title (single accept with title change)
      if (title && ids.length === 1) {
        const { error } = await admin
          .from('commitments')
          .update({ status: 'open', title: title.trim(), updated_at: now })
          .eq('id', ids[0])
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      } else {
        const { error } = await admin
          .from('commitments')
          .update({ status: 'open', updated_at: now })
          .in('id', ids)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, accepted: ids.length })
    }

    if (action === 'reject' || action === 'reject_all') {
      const { error } = await admin
        .from('commitments')
        .update({ status: 'dismissed', updated_at: now })
        .in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, rejected: ids.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    console.error('Review PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
