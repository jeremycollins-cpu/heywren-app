import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { buildManagerBriefingEmail } from '@/lib/email/templates/manager-briefing'
import { getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Sends a weekly briefing email to managers (org_admin, dept_manager).
 * Runs Monday at 9 AM UTC — after scores (6 AM) and the Slack digest (8 AM).
 */
export const emailManagerBriefing = inngest.createFunction(
  { id: 'email-manager-briefing' },
  { cron: '0 9 * * 1' }, // Monday 9 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'

    const thisMonday = getWeekStart()
    const prevMonday = getPreviousWeekStart(thisMonday)
    const twoWeeksAgo = getPreviousWeekStart(prevMonday)

    const weekStart = new Date(prevMonday)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

    const orgs = await step.run('fetch-orgs', async () => {
      const { data } = await supabase.from('organizations').select('id, name')
      return data || []
    })

    let emailsSent = 0

    for (const org of orgs) {
      await step.run(`briefing-${org.id}`, async () => {
        // Find managers
        const { data: managers } = await supabase
          .from('organization_members')
          .select('user_id, role, department_id')
          .eq('organization_id', org.id)
          .in('role', ['org_admin', 'dept_manager'])

        if (!managers || managers.length === 0) return

        // Check email preferences
        const managerIds = managers.map(m => m.user_id)
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('user_id, email_manager_briefing')
          .in('user_id', managerIds)

        const prefsMap = new Map((prefs || []).map(p => [p.user_id, p]))

        // Fetch profiles
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', managerIds)

        const profilesMap = new Map((profilesData || []).map(p => [p.id, p]))

        // This week's scores
        const { data: thisWeekScores } = await supabase
          .from('weekly_scores')
          .select('user_id, department_id, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate')
          .eq('organization_id', org.id)
          .eq('week_start', prevMonday)

        // Previous week for comparison
        const { data: lastWeekScores } = await supabase
          .from('weekly_scores')
          .select('user_id, total_points')
          .eq('organization_id', org.id)
          .eq('week_start', twoWeeksAgo)

        // Member scores for streaks
        const { data: memberScores } = await supabase
          .from('member_scores')
          .select('user_id, current_streak')
          .eq('organization_id', org.id)

        // Achievements this week
        const { data: newAchievements } = await supabase
          .from('member_achievements')
          .select('user_id')
          .eq('organization_id', org.id)
          .eq('week_earned', prevMonday)

        // Manager alerts
        const { data: alerts } = await supabase
          .from('manager_alerts')
          .select('alert_type, status')
          .eq('organization_id', org.id)
          .in('status', ['new', 'acknowledged'])

        // All user names for top performers
        const allUserIds = [...new Set((thisWeekScores || []).map(s => s.user_id))]
        const { data: allProfiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', allUserIds)

        const nameMap = new Map((allProfiles || []).map(p => [p.id, p.full_name || 'Unknown']))

        const scores = thisWeekScores || []
        const prevScores = lastWeekScores || []

        for (const manager of managers) {
          const pref = prefsMap.get(manager.user_id)
          if (pref?.email_manager_briefing === false) continue

          const profile = profilesMap.get(manager.user_id)
          if (!profile?.email) continue

          // Scope scores by role
          const scopedScores = manager.role === 'org_admin'
            ? scores
            : scores.filter(s => s.department_id === manager.department_id)

          if (scopedScores.length === 0) continue

          const scopedPrevScores = manager.role === 'org_admin'
            ? prevScores
            : prevScores.filter(s => {
                const current = scores.find(cs => cs.user_id === s.user_id)
                return current?.department_id === manager.department_id
              })

          // Calculate aggregates
          const totalPoints = scopedScores.reduce((s, sc) => s + (sc.total_points || 0), 0)
          const prevTotalPoints = scopedPrevScores.reduce((s, sc) => s + (sc.total_points || 0), 0)
          const pointsDeltaPct = prevTotalPoints > 0
            ? Math.round((totalPoints - prevTotalPoints) / prevTotalPoints * 100)
            : 0
          const totalCompleted = scopedScores.reduce((s, sc) => s + (sc.commitments_completed || 0), 0)
          const totalOverdue = scopedScores.reduce((s, sc) => s + (sc.commitments_overdue || 0), 0)
          const avgResponseRate = Math.round(scopedScores.reduce((s, sc) => s + (sc.response_rate || 0), 0) / scopedScores.length)
          const avgOnTimeRate = Math.round(scopedScores.reduce((s, sc) => s + (sc.on_time_rate || 0), 0) / scopedScores.length)

          const activeStreaks = (memberScores || []).filter(ms => {
            if (manager.role !== 'org_admin') {
              const inScope = scopedScores.some(ss => ss.user_id === ms.user_id)
              if (!inScope) return false
            }
            return ms.current_streak >= 2
          }).length

          const top3 = [...scopedScores]
            .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
            .slice(0, 3)
            .map(t => ({
              name: nameMap.get(t.user_id) || 'Unknown',
              points: t.total_points || 0,
            }))

          const burnoutAlerts = (alerts || []).filter(a => a.alert_type === 'burnout_risk').length
          const unresolvedAlerts = (alerts || []).filter(a => a.status === 'new').length

          const { subject, html } = buildManagerBriefingEmail({
            managerName: profile.full_name?.split(' ')[0] || 'there',
            orgName: org.name,
            weekLabel,
            memberCount: scopedScores.length,
            totalPoints,
            pointsDeltaPct,
            totalCompleted,
            totalOverdue,
            avgResponseRate,
            avgOnTimeRate,
            activeStreaks,
            topPerformers: top3,
            burnoutAlerts,
            unresolvedAlerts,
            newAchievements: (newAchievements || []).length,
            dashboardUrl: `${appUrl}/team-dashboard`,
            peopleInsightsUrl: `${appUrl}/people-insights`,
            unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
          })

          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            emailType: 'manager_briefing',
            userId: manager.user_id,
            idempotencyKey: `manager_briefing_${manager.user_id}_${prevMonday}`,
          })

          if (result.success) emailsSent++
        }
      })
    }

    return { success: true, emailsSent, organizationsProcessed: orgs.length }
  }
)
