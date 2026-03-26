import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { calculateWeeklyScores, persistWeeklyScores, getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'
import { checkAndAwardAchievements } from '@/lib/team/achievements'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/admin/backfill-scores
 *
 * Admin-only endpoint that:
 * 1. Backfills organization_id on existing data (commitments, missed_emails, etc.)
 * 2. Runs score calculations for the specified number of past weeks
 *
 * Query params:
 *   - weeks: number of weeks to backfill (default 8)
 */
export async function POST(request: NextRequest) {
  try {
    // Auth: require org_admin
    let userId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data } = await supabase.auth.getUser()
      userId = data?.user?.id || null
    } catch { /* no session */ }

    const admin = getAdminClient()

    if (!userId) {
      const body = await request.json().catch(() => ({}))
      if (body?.userId) {
        const { data: authUser } = await admin.auth.admin.getUserById(body.userId)
        if (authUser?.user) userId = authUser.user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify caller is org_admin
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .single()

    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can run backfill' }, { status: 403 })
    }

    const orgId = membership.organization_id
    const { searchParams } = new URL(request.url)
    const weeksToBackfill = parseInt(searchParams.get('weeks') || '8', 10)

    // ── Step 1: Backfill organization_id on existing data ─────────────────

    // Get all teams in this org
    const { data: orgTeams } = await admin
      .from('teams')
      .select('id')
      .eq('organization_id', orgId)

    const teamIds = (orgTeams || []).map((t: any) => t.id)

    // Also include teams linked via team_members for org members
    const { data: orgMembers } = await admin
      .from('organization_members')
      .select('user_id, team_id')
      .eq('organization_id', orgId)

    const memberUserIds = (orgMembers || []).map((m: any) => m.user_id)
    const memberTeamIds = [...new Set([...teamIds, ...(orgMembers || []).map((m: any) => m.team_id)])]

    const backfillResults: Record<string, number> = {}

    // Backfill commitments
    const { count: commitmentCount } = await admin
      .from('commitments')
      .update({ organization_id: orgId })
      .in('team_id', memberTeamIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.commitments = commitmentCount || 0

    // Also backfill by creator_id for commitments without team_id
    const { count: commitmentByUser } = await admin
      .from('commitments')
      .update({ organization_id: orgId })
      .in('creator_id', memberUserIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.commitments_by_user = commitmentByUser || 0

    // Backfill missed_emails
    const { count: missedEmailCount } = await admin
      .from('missed_emails')
      .update({ organization_id: orgId })
      .in('user_id', memberUserIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.missed_emails = missedEmailCount || 0

    // Backfill missed_chats
    const { count: missedChatCount } = await admin
      .from('missed_chats')
      .update({ organization_id: orgId })
      .in('user_id', memberUserIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.missed_chats = missedChatCount || 0

    // Backfill meeting_transcripts
    const { count: meetingCount } = await admin
      .from('meeting_transcripts')
      .update({ organization_id: orgId })
      .in('user_id', memberUserIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.meetings = meetingCount || 0

    // Backfill activities
    const { count: activityCount } = await admin
      .from('activities')
      .update({ organization_id: orgId })
      .in('user_id', memberUserIds)
      .is('organization_id', null)
      .select('id', { count: 'exact', head: true })
    backfillResults.activities = activityCount || 0

    // ── Step 2: Calculate scores for past weeks ───────────────────────────

    const currentWeek = getWeekStart()
    const weekResults: Array<{ week: string; scores: number; achievements: number }> = []

    // Build list of week starts going back N weeks
    const weeks: string[] = []
    let w = currentWeek
    for (let i = 0; i < weeksToBackfill; i++) {
      w = i === 0 ? getPreviousWeekStart(currentWeek) : getPreviousWeekStart(w)
      weeks.unshift(w) // oldest first
    }

    // Also include the current (partial) week
    weeks.push(currentWeek)

    for (const weekStart of weeks) {
      const scores = await calculateWeeklyScores(orgId, weekStart)
      if (scores.length > 0) {
        await persistWeeklyScores(scores)
        const achievements = await checkAndAwardAchievements(orgId, scores)
        weekResults.push({
          week: weekStart,
          scores: scores.length,
          achievements: achievements.length,
        })
      }
    }

    return NextResponse.json({
      success: true,
      backfill: backfillResults,
      scoreCalculation: {
        weeksProcessed: weekResults.length,
        weeks: weekResults,
      },
    })
  } catch (err: any) {
    console.error('Backfill error:', err)
    return NextResponse.json({ error: err.message || 'Backfill failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
