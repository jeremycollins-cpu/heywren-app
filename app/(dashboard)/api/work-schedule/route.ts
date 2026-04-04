import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager']

/**
 * GET /api/work-schedule
 * Returns a user's work schedule, or defaults if none set.
 * Query params:
 *   - targetUserId: (optional) view another user's schedule (managers only)
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
    const targetUserId = searchParams.get('targetUserId')

    // Get caller's org membership
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, team_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    // Determine whose schedule to fetch
    let scheduleUserId = callerId
    if (targetUserId && targetUserId !== callerId) {
      // Verify caller is a manager
      if (!MANAGER_ROLES.includes(callerMembership.role)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      // Verify target is in same org
      const { data: targetMembership } = await admin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', targetUserId)
        .eq('organization_id', callerMembership.organization_id)
        .limit(1)
        .single()
      if (!targetMembership) {
        return NextResponse.json({ error: 'User not in your organization' }, { status: 404 })
      }
      scheduleUserId = targetUserId
    }

    // Get existing schedule
    const { data: schedule } = await admin
      .from('work_schedules')
      .select('work_days, start_time, end_time, timezone, idle_threshold_minutes, after_hours_alert')
      .eq('organization_id', callerMembership.organization_id)
      .eq('user_id', scheduleUserId)
      .limit(1)
      .single()

    // Get org timezone as fallback
    const { data: org } = await admin
      .from('organizations')
      .select('timezone')
      .eq('id', callerMembership.organization_id)
      .single()

    const defaults = {
      work_days: [1, 2, 3, 4, 5],
      start_time: '08:00',
      end_time: '17:00',
      timezone: null as string | null,
      idle_threshold_minutes: 60,
      after_hours_alert: true,
    }

    return NextResponse.json({
      schedule: schedule || defaults,
      orgTimezone: org?.timezone || 'America/New_York',
      hasCustomSchedule: !!schedule,
    })
  } catch (err) {
    console.error('Work schedule GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

/**
 * PUT /api/work-schedule
 * Create or update a user's work schedule.
 * Body params:
 *   - targetUserId: (optional) edit another user's schedule (managers only)
 *   - work_days, start_time, end_time, timezone, idle_threshold_minutes, after_hours_alert
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

    // Get caller's org membership
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, team_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    // Determine whose schedule to update
    let scheduleUserId = callerId
    const targetUserId: string | undefined = body.targetUserId
    if (targetUserId && targetUserId !== callerId) {
      // Verify caller is a manager
      if (!MANAGER_ROLES.includes(callerMembership.role)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      // Verify target is in same org
      const { data: targetMembership } = await admin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', targetUserId)
        .eq('organization_id', callerMembership.organization_id)
        .limit(1)
        .single()
      if (!targetMembership) {
        return NextResponse.json({ error: 'User not in your organization' }, { status: 404 })
      }
      scheduleUserId = targetUserId
    }

    // Validate
    const workDays: number[] = body.work_days
    if (!Array.isArray(workDays) || workDays.some((d: number) => d < 0 || d > 6)) {
      return NextResponse.json({ error: 'Invalid work_days' }, { status: 400 })
    }

    const startTime: string = body.start_time
    const endTime: string = body.end_time
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return NextResponse.json({ error: 'Invalid time format' }, { status: 400 })
    }

    const { error } = await admin
      .from('work_schedules')
      .upsert({
        organization_id: callerMembership.organization_id,
        user_id: scheduleUserId,
        work_days: workDays,
        start_time: startTime,
        end_time: endTime,
        timezone: body.timezone || null,
        idle_threshold_minutes: Math.max(15, Math.min(480, body.idle_threshold_minutes || 60)),
        after_hours_alert: body.after_hours_alert !== false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id' })

    if (error) {
      console.error('Work schedule upsert error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Work schedule PUT error:', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
