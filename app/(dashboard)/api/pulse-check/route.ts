import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

/**
 * GET /api/pulse-check
 * Returns pulse survey data. Users see their own; managers see team aggregate.
 *
 * POST /api/pulse-check
 * Submit a weekly pulse check-in.
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
    const weeks = Math.min(12, Math.max(1, parseInt(searchParams.get('weeks') || '8', 10)))

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const orgId = callerMembership.organization_id
    const isManager = MANAGER_ROLES.includes(callerMembership.role)

    // Current week start
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1)
    weekStart.setUTCHours(0, 0, 0, 0)
    const currentWeekStr = weekStart.toISOString().split('T')[0]

    const rangeStart = new Date(weekStart)
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (weeks * 7))

    // Get user's own responses
    const { data: myResponses } = await admin
      .from('pulse_responses')
      .select('*')
      .eq('user_id', callerId)
      .eq('organization_id', orgId)
      .gte('week_start', rangeStart.toISOString().split('T')[0])
      .order('week_start', { ascending: false })

    const hasRespondedThisWeek = (myResponses || []).some(
      (r: { week_start: string }) => r.week_start === currentWeekStr
    )

    // Team aggregate (managers only)
    let teamAggregate = null
    if (isManager) {
      const { data: teamResponses } = await admin
        .from('pulse_responses')
        .select('week_start, energy_level, focus_rating, blocker, win')
        .eq('organization_id', orgId)
        .gte('week_start', rangeStart.toISOString().split('T')[0])
        .order('week_start', { ascending: true })

      if (teamResponses && teamResponses.length > 0) {
        type PulseRow = { week_start: string; energy_level: number | null; focus_rating: number | null; blocker: string | null; win: string | null }
        // Group by week
        const byWeek: Record<string, PulseRow[]> = {}
        for (const r of teamResponses as PulseRow[]) {
          if (!byWeek[r.week_start]) byWeek[r.week_start] = []
          byWeek[r.week_start].push(r)
        }

        const weeklyStats = Object.entries(byWeek)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, responses]) => {
            const energyScores = responses.filter((r: PulseRow) => r.energy_level != null).map((r: PulseRow) => r.energy_level!)
            const focusScores = responses.filter((r: PulseRow) => r.focus_rating != null).map((r: PulseRow) => r.focus_rating!)
            const blockers = responses.filter((r: PulseRow) => r.blocker && r.blocker.trim().length > 0).map((r: PulseRow) => r.blocker!)
            const wins = responses.filter((r: PulseRow) => r.win && r.win.trim().length > 0).map((r: PulseRow) => r.win!)

            return {
              week,
              respondents: responses.length,
              avgEnergy: energyScores.length > 0
                ? Math.round((energyScores.reduce((s: number, v: number) => s + v, 0) / energyScores.length) * 10) / 10
                : null,
              avgFocus: focusScores.length > 0
                ? Math.round((focusScores.reduce((s: number, v: number) => s + v, 0) / focusScores.length) * 10) / 10
                : null,
              blockerCount: blockers.length,
              winCount: wins.length,
              // Don't surface individual text to prevent identification
              topBlockerThemes: blockers.length >= 3 ? `${blockers.length} blockers reported` : null,
            }
          })

        // Current week snapshot
        const currentWeekData = weeklyStats.find(w => w.week === currentWeekStr)
        const totalRespondents = currentWeekData?.respondents || 0

        const { data: memberCount } = await admin
          .from('organization_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('organization_id', orgId)

        teamAggregate = {
          weeklyStats,
          currentWeek: {
            respondents: totalRespondents,
            totalMembers: memberCount?.length || 0,
            participationRate: (memberCount?.length || 0) > 0
              ? Math.round((totalRespondents / (memberCount?.length || 1)) * 100)
              : 0,
            avgEnergy: currentWeekData?.avgEnergy,
            avgFocus: currentWeekData?.avgFocus,
          },
        }
      }
    }

    return NextResponse.json({
      myResponses: myResponses || [],
      hasRespondedThisWeek,
      currentWeek: currentWeekStr,
      teamAggregate,
    })
  } catch (err) {
    console.error('Pulse check GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

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
    const { energyLevel, focusRating, blocker, win } = body as {
      energyLevel?: number
      focusRating?: number
      blocker?: string
      win?: string
    }

    // Validate
    if (energyLevel != null && (energyLevel < 1 || energyLevel > 5)) {
      return NextResponse.json({ error: 'Energy level must be 1-5' }, { status: 400 })
    }
    if (focusRating != null && (focusRating < 1 || focusRating > 5)) {
      return NextResponse.json({ error: 'Focus rating must be 1-5' }, { status: 400 })
    }

    // Current week start (Monday)
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1)
    weekStart.setUTCHours(0, 0, 0, 0)

    const { error } = await admin
      .from('pulse_responses')
      .upsert({
        organization_id: callerMembership.organization_id,
        user_id: callerId,
        week_start: weekStart.toISOString().split('T')[0],
        energy_level: energyLevel || null,
        focus_rating: focusRating || null,
        blocker: blocker?.trim() || null,
        win: win?.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id,week_start' })

    if (error) {
      console.error('Pulse upsert error:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Pulse check POST error:', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
