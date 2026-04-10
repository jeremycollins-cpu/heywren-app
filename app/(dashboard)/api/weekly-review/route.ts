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
 * GET /api/weekly-review
 * Returns the last 4 weeks of weekly review snapshots for a given team member.
 * Query params:
 *   - targetUserId: the member to fetch reviews for
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

    if (!targetUserId) {
      return NextResponse.json({ error: 'Missing targetUserId' }, { status: 400 })
    }

    // Verify caller is a manager in the same org
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
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

    // Fetch last 4 weeks of weekly_scores
    const { data: weeklyScores } = await admin
      .from('weekly_scores')
      .select(
        'week_start, commitments_created, commitments_completed, commitments_overdue, ' +
        'missed_emails_resolved, missed_chats_resolved, meetings_attended, ' +
        'response_rate, on_time_rate, total_points'
      )
      .eq('user_id', targetUserId)
      .eq('organization_id', callerMembership.organization_id)
      .order('week_start', { ascending: false })
      .limit(4)

    // Also fetch current week's live data from commitments/missed_emails
    const now = new Date()
    const dayOfWeek = now.getUTCDay()
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const currentWeekStart = new Date(now)
    currentWeekStart.setUTCDate(now.getUTCDate() - mondayOffset)
    currentWeekStart.setUTCHours(0, 0, 0, 0)
    const currentWeekStr = currentWeekStart.toISOString().split('T')[0]

    // Check if latest weekly_scores already covers current week
    const hasCurrentWeek = (weeklyScores || []).some(
      (ws: any) => ws.week_start === currentWeekStr
    )

    let liveWeek = null
    if (!hasCurrentWeek) {
      // Build a live snapshot for the current (in-progress) week
      const weekEnd = new Date(currentWeekStart)
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

      const [commitmentsRes, missedEmailsRes, missedChatsRes, meetingsRes] = await Promise.all([
        admin.from('commitments')
          .select('status, created_at, completed_at')
          .eq('creator_id', targetUserId)
          .gte('created_at', currentWeekStart.toISOString())
          .lt('created_at', weekEnd.toISOString()),

        admin.from('missed_emails')
          .select('status, received_at')
          .eq('user_id', targetUserId)
          .gte('received_at', currentWeekStart.toISOString())
          .lt('received_at', weekEnd.toISOString()),

        admin.from('missed_chats')
          .select('status, sent_at')
          .eq('user_id', targetUserId)
          .gte('sent_at', currentWeekStart.toISOString())
          .lt('sent_at', weekEnd.toISOString()),

        admin.from('meeting_transcripts')
          .select('id')
          .eq('user_id', targetUserId)
          .gte('start_time', currentWeekStart.toISOString())
          .lt('start_time', weekEnd.toISOString()),
      ])

      const commitments = commitmentsRes.data || []
      const missedEmails = missedEmailsRes.data || []
      const missedChats = missedChatsRes.data || []

      const created = commitments.length
      const completed = commitments.filter((c: any) => c.status === 'completed').length
      const overdue = commitments.filter((c: any) => c.status === 'overdue').length
      const emailsResolved = missedEmails.filter((e: any) =>
        e.status === 'replied' || e.status === 'dismissed'
      ).length
      const chatsResolved = missedChats.filter((c: any) =>
        c.status === 'replied'
      ).length
      const totalMissed = missedEmails.length + missedChats.length
      const totalResolved = emailsResolved + chatsResolved

      liveWeek = {
        week_start: currentWeekStr,
        commitments_created: created,
        commitments_completed: completed,
        commitments_overdue: overdue,
        missed_emails_resolved: emailsResolved,
        missed_chats_resolved: chatsResolved,
        meetings_attended: meetingsRes.data?.length || 0,
        response_rate: totalMissed > 0 ? Math.round(totalResolved / totalMissed * 100) : 0,
        on_time_rate: created > 0 ? Math.round(completed / created * 100) : 0,
        total_points: 0,
        is_live: true,
      }
    }

    // Combine: live week first (if exists), then historical
    const weeks = [
      ...(liveWeek ? [liveWeek] : []),
      ...(weeklyScores || []),
    ].slice(0, 4)

    return NextResponse.json({ weeks })
  } catch (err) {
    console.error('Weekly review error:', err)
    return NextResponse.json({ error: 'Failed to load weekly reviews' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
