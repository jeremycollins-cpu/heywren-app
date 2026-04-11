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
 * GET /api/ooo
 * Returns OOO periods. Users see their own; managers see the whole org.
 * ?active=true — only active/current periods
 * ?userId=xxx — filter to a specific user (managers only)
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
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'
    const filterUserId = searchParams.get('userId')

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']
    const isManager = MANAGER_ROLES.includes(callerMembership.role)
    const orgId = callerMembership.organization_id

    // Fetch OOO periods (no profile join — user_id FK points to auth.users, not profiles)
    let query = admin
      .from('ooo_periods')
      .select('*')
      .eq('organization_id', orgId)
      .order('start_date', { ascending: false })

    if (activeOnly) {
      const today = new Date().toISOString().split('T')[0]
      query = query.eq('status', 'active').lte('start_date', today).gte('end_date', today)
    }

    if (filterUserId && isManager) {
      query = query.eq('user_id', filterUserId)
    } else if (!isManager) {
      query = query.eq('user_id', callerId)
    }

    const { data: periods, error: queryError } = await query

    if (queryError) {
      console.error('OOO query error:', queryError)
      await reportError({ source: 'api/ooo', message: queryError.message, userId: callerId, errorKey: 'ooo_query_failed' })
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
    }

    // Fetch profile info separately for display names / avatars
    const userIds = [...new Set((periods || []).flatMap((p: any) =>
      [p.user_id, p.backup_user_id].filter(Boolean)
    ))]

    const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>()
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)
      for (const p of profiles || []) {
        profileMap.set(p.id, p)
      }
    }

    // Enrich with display info
    const enriched = (periods || []).map((p: any) => {
      const profile = profileMap.get(p.user_id)
      const backup = p.backup_user_id ? profileMap.get(p.backup_user_id) : null
      return {
        id: p.id,
        userId: p.user_id,
        name: profile?.display_name || 'Unknown',
        avatar: profile?.avatar_url || null,
        startDate: p.start_date,
        endDate: p.end_date,
        oooType: p.ooo_type,
        note: p.note,
        backupUserId: p.backup_user_id,
        backupName: backup?.display_name || null,
        status: p.status,
        createdAt: p.created_at,
      }
    })

    return NextResponse.json({ periods: enriched })
  } catch (err) {
    console.error('OOO GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

/**
 * POST /api/ooo
 * Create a new OOO period for the current user.
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

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const body = await request.json()
    const { startDate, endDate, oooType, note, backupUserId } = body as {
      startDate: string
      endDate: string
      oooType: 'pto' | 'travel' | 'sick' | 'other'
      note?: string
      backupUserId?: string
    }

    if (!startDate || !endDate || !oooType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (new Date(endDate) < new Date(startDate)) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
    }

    const { data: period, error } = await admin
      .from('ooo_periods')
      .insert({
        organization_id: callerMembership.organization_id,
        user_id: callerId,
        start_date: startDate,
        end_date: endDate,
        ooo_type: oooType,
        note: note?.trim() || null,
        backup_user_id: backupUserId || null,
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      console.error('OOO insert error:', error)
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
    }

    // Return enriched format matching GET response
    return NextResponse.json({
      period: {
        id: period.id,
        userId: period.user_id,
        startDate: period.start_date,
        endDate: period.end_date,
        oooType: period.ooo_type,
        note: period.note,
        backupUserId: period.backup_user_id,
        status: period.status,
        createdAt: period.created_at,
      },
    })
  } catch (err) {
    console.error('OOO POST error:', err)
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}

/**
 * PUT /api/ooo
 * Update or cancel an OOO period. Users can only edit their own.
 */
export async function PUT(request: NextRequest) {
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
    const { id, endDate, note, backupUserId, status } = body as {
      id: string
      endDate?: string
      note?: string
      backupUserId?: string | null
      status?: 'active' | 'cancelled'
    }

    if (!id) {
      return NextResponse.json({ error: 'Missing OOO period id' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (endDate) updates.end_date = endDate
    if (note !== undefined) updates.note = note?.trim() || null
    if (backupUserId !== undefined) updates.backup_user_id = backupUserId || null
    if (status) updates.status = status

    const { error } = await admin
      .from('ooo_periods')
      .update(updates)
      .eq('id', id)
      .eq('user_id', callerId)

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('OOO PUT error:', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
