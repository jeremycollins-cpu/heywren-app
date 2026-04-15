import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { getOooUserIdsForDate } from '@/lib/team/ooo'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface WeeklyScoreRow {
  user_id: string
  week_start: string
  response_rate: number | null
  commitments_overdue: number | null
  total_points: number | null
  meetings_attended: number | null
}

interface SentimentRow {
  user_id: string
  month_start: string
  avg_sentiment: number
}

interface MemberProfile {
  user_id: string
  profiles: any // eslint-disable-line
}

/**
 * Runs every Monday at 7 AM UTC — generates proactive alerts for managers
 * by analyzing team data for notable patterns.
 *
 * Alert types:
 * - burnout_risk: high after-hours / meeting overload
 * - response_drop: response rate declined significantly
 * - sentiment_shift: sentiment dropped month-over-month
 * - overloaded: too many open/overdue commitments
 * - siloed_employee: very few interactions
 * - disconnect_pattern: consistent after-hours work
 */
export const generateManagerAlerts = inngest.createFunction(
  { id: 'generate-manager-alerts' },
  { cron: '0 7 * * 1' }, // Monday 7 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()

    const orgs = await step.run('fetch-organizations', async () => {
      const { data } = await supabase.from('organizations').select('id')
      return data || []
    })

    let totalAlerts = 0

    for (const org of orgs) {
      const orgId = org.id

      const orgData = await step.run(`fetch-data-${orgId}`, async () => {
        const members = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', orgId)

        const memberIds = (members.data || []).map((m: { user_id: string }) => m.user_id)

        // Fetch profiles separately (user_id FK points to auth.users, not profiles)
        const profileResults = memberIds.length > 0
          ? await supabase.from('profiles').select('id, display_name').in('id', memberIds)
          : { data: [] }
        const profileLookup = new Map<string, string>()
        for (const p of profileResults.data || []) {
          if (p.display_name) profileLookup.set(p.id, p.display_name)
        }
        // Attach profiles to members for downstream code
        const membersWithProfiles = (members.data || []).map((m: any) => ({
          ...m,
          profiles: { display_name: profileLookup.get(m.user_id) || null },
        }))
        if (memberIds.length === 0) return null

        const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0]

        const [weeklyResult, sentimentResult, commitmentsResult, calendarResult] = await Promise.all([
          supabase
            .from('weekly_scores')
            .select('user_id, week_start, response_rate, commitments_overdue, total_points, meetings_attended')
            .in('user_id', memberIds)
            .gte('week_start', fourWeeksAgo)
            .order('week_start', { ascending: true }),
          supabase
            .from('user_sentiment_scores')
            .select('user_id, month_start, avg_sentiment')
            .eq('organization_id', orgId)
            .order('month_start', { ascending: true }),
          supabase
            .from('commitments')
            .select('assignee_id, status')
            .in('assignee_id', memberIds)
            .in('status', ['pending', 'in_progress', 'overdue', 'open']),
          supabase
            .from('outlook_calendar_events')
            .select('user_id, start_time, end_time, is_all_day, attendees')
            .in('user_id', memberIds)
            .gte('start_time', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .lte('start_time', new Date().toISOString())
            .eq('is_cancelled', false),
        ])

        return {
          members: membersWithProfiles as MemberProfile[],
          weeklyScores: (weeklyResult.data || []) as WeeklyScoreRow[],
          sentiments: (sentimentResult.data || []) as SentimentRow[],
          commitments: (commitmentsResult.data || []) as Array<{ assignee_id: string; status: string }>,
          calendar: (calendarResult.data || []) as Array<{ user_id: string; start_time: string; end_time: string; is_all_day: boolean; attendees: any[] }>,
        }
      })

      if (!orgData) continue

      // Skip OOO users — don't generate alerts about them
      const oooUsers = await step.run(`ooo-check-${orgId}`, async () => {
        const today = new Date().toISOString().split('T')[0]
        const oooSet = await getOooUserIdsForDate(orgId, today)
        return [...oooSet]
      })
      const oooSet = new Set(oooUsers)

      const alerts = await step.run(`generate-alerts-${orgId}`, async () => {
        const newAlerts: Array<{
          organization_id: string
          target_user_id: string
          alert_type: string
          title: string
          body: string
          severity: string
          data: Record<string, unknown>
          expires_at: string
        }> = []

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        const nameMap = new Map<string, string>()
        for (const m of orgData.members) {
          const profile = m.profiles as { display_name: string } | { display_name: string }[] | null
          const displayName = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name
          nameMap.set(m.user_id, displayName || 'Unknown')
        }

        for (const member of orgData.members) {
          const userId = member.user_id
          if (oooSet.has(userId)) continue // Skip OOO users
          const name = nameMap.get(userId) || 'Unknown'

          // 1. Response rate drop
          const userWeekly = orgData.weeklyScores
            .filter((w: WeeklyScoreRow) => w.user_id === userId)
            .sort((a: WeeklyScoreRow, b: WeeklyScoreRow) => a.week_start.localeCompare(b.week_start))

          if (userWeekly.length >= 2) {
            const recent = userWeekly[userWeekly.length - 1]
            const previous = userWeekly[userWeekly.length - 2]
            const rateDrop = (previous.response_rate || 0) - (recent.response_rate || 0)
            if (rateDrop >= 20) {
              newAlerts.push({
                organization_id: orgId,
                target_user_id: userId,
                alert_type: 'response_drop',
                title: `${name}'s response rate dropped ${Math.round(rateDrop)}%`,
                body: `Response rate went from ${Math.round(previous.response_rate || 0)}% to ${Math.round(recent.response_rate || 0)}% this week. This could indicate overload, disengagement, or competing priorities.`,
                severity: rateDrop >= 40 ? 'critical' : 'warning',
                data: { previous: previous.response_rate, current: recent.response_rate, drop: rateDrop },
                expires_at: expiresAt,
              })
            }
          }

          // 2. Sentiment shift
          const userSentiment = orgData.sentiments
            .filter((s: SentimentRow) => s.user_id === userId)
            .sort((a: SentimentRow, b: SentimentRow) => a.month_start.localeCompare(b.month_start))

          if (userSentiment.length >= 2) {
            const current = userSentiment[userSentiment.length - 1]
            const previous = userSentiment[userSentiment.length - 2]
            const decline = previous.avg_sentiment - current.avg_sentiment
            if (decline >= 0.3) {
              newAlerts.push({
                organization_id: orgId,
                target_user_id: userId,
                alert_type: 'sentiment_shift',
                title: `${name}'s communication tone has shifted negatively`,
                body: `Sentiment score dropped from ${previous.avg_sentiment.toFixed(2)} to ${current.avg_sentiment.toFixed(2)}. Consider checking in — this could reflect frustration or stress.`,
                severity: decline >= 0.5 ? 'critical' : 'warning',
                data: { previous: previous.avg_sentiment, current: current.avg_sentiment, decline },
                expires_at: expiresAt,
              })
            }
          }

          // 3. Commitment overload
          const userCommitments = orgData.commitments.filter(
            (c: { assignee_id: string }) => c.assignee_id === userId
          )
          const openCount = userCommitments.length
          const overdueCount = userCommitments.filter(
            (c: { status: string }) => c.status === 'overdue'
          ).length

          if (openCount >= 10 || overdueCount >= 3) {
            newAlerts.push({
              organization_id: orgId,
              target_user_id: userId,
              alert_type: 'overloaded',
              title: `${name} has ${openCount} open items (${overdueCount} overdue)`,
              body: overdueCount >= 3
                ? `${name} is falling behind with ${overdueCount} overdue commitments. Consider reprioritizing or redistributing work.`
                : `${name} has a heavy workload with ${openCount} active items. Monitor for signs of overload.`,
              severity: overdueCount >= 5 ? 'critical' : overdueCount >= 3 ? 'warning' : 'info',
              data: { open: openCount, overdue: overdueCount },
              expires_at: expiresAt,
            })
          }

          // 4. Meeting overload (last 7 days)
          // Only count real meetings: not all-day events, and at least 2 attendees
          // (user + someone else). Solo calendar blocks (focus time, travel, etc.)
          // are not meetings.
          const userMeetings = orgData.calendar.filter(
            (e: { user_id: string; is_all_day: boolean; attendees: any[] }) =>
              e.user_id === userId && !e.is_all_day && Array.isArray(e.attendees) && e.attendees.length >= 2
          )
          let meetingHours = 0
          for (const m of userMeetings) {
            const start = new Date(m.start_time).getTime()
            const end = new Date(m.end_time).getTime()
            if (!start || !end || isNaN(start) || isNaN(end)) continue
            const hours = (end - start) / (1000 * 60 * 60)
            // Sanity check: skip events longer than 12 hours (likely data errors)
            if (hours > 0 && hours <= 12) meetingHours += hours
          }
          if (meetingHours >= 30) {
            newAlerts.push({
              organization_id: orgId,
              target_user_id: userId,
              alert_type: 'burnout_risk',
              title: `${name} spent ${Math.round(meetingHours)}h in meetings this week`,
              body: `That's ${Math.round(meetingHours / 40 * 100)}% of a standard work week. ${name} may not have enough focus time for deep work.`,
              severity: meetingHours >= 35 ? 'critical' : 'warning',
              data: { meetingHours: Math.round(meetingHours) },
              expires_at: expiresAt,
            })
          }
        }

        // Deduplicate: don't create alerts that already exist (active, same type + target + this week)
        if (newAlerts.length > 0) {
          const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const { data: existingAlerts } = await supabase
            .from('manager_alerts')
            .select('target_user_id, alert_type')
            .eq('organization_id', orgId)
            .eq('status', 'active')
            .gte('created_at', weekAgo)

          const existingKeys = new Set(
            (existingAlerts || []).map((a: { target_user_id: string; alert_type: string }) =>
              `${a.target_user_id}|${a.alert_type}`
            )
          )

          const deduped = newAlerts.filter(a => !existingKeys.has(`${a.target_user_id}|${a.alert_type}`))

          if (deduped.length > 0) {
            await supabase.from('manager_alerts').insert(deduped)
          }

          return deduped.length
        }

        return 0
      })

      totalAlerts += alerts
    }

    return { organizationsProcessed: orgs.length, alertsCreated: totalAlerts }
  }
)
