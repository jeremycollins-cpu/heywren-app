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
 * GET /api/work-schedule
 * Returns the current user's work schedule, or defaults if none set.
 */
export async function GET() {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    // Get user's org
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    // Get existing schedule
    const { data: schedule } = await admin
      .from('work_schedules')
      .select('work_days, start_time, end_time, timezone, idle_threshold_minutes, after_hours_alert')
      .eq('organization_id', membership.organization_id)
      .eq('user_id', userId)
      .limit(1)
      .single()

    // Get org timezone as fallback
    const { data: org } = await admin
      .from('organizations')
      .select('timezone')
      .eq('id', membership.organization_id)
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
 * Create or update the current user's work schedule.
 */
export async function PUT(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const body = await request.json()

    // Get user's org
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
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
        organization_id: membership.organization_id,
        user_id: userId,
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
