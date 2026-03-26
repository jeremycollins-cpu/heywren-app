import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { calculateWeeklyScores, persistWeeklyScores, getPreviousWeekStart, getWeekStart } from '@/lib/team/calculate-scores'
import { checkAndAwardAchievements } from '@/lib/team/achievements'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Runs every Monday at 6 AM UTC — calculates the previous week's scores
 * for all organizations, updates streaks, awards achievements, and
 * updates leaderboard rankings.
 */
export const calculateWeeklyScoresJob = inngest.createFunction(
  { id: 'calculate-weekly-scores' },
  { cron: '0 6 * * 1' }, // Monday 6 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()

    // Calculate for the previous week (Monday to Sunday that just ended)
    const thisMonday = getWeekStart()
    const prevMonday = getPreviousWeekStart(thisMonday)

    // Get all organizations
    const orgs = await step.run('fetch-organizations', async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
      return data || []
    })

    let totalScoresCalculated = 0
    let totalAchievementsAwarded = 0

    for (const org of orgs) {
      // Calculate scores for this org
      const scores = await step.run(`calculate-scores-${org.id}`, async () => {
        return calculateWeeklyScores(org.id, prevMonday)
      })

      if (scores.length === 0) continue

      // Persist scores and update streaks/rankings
      await step.run(`persist-scores-${org.id}`, async () => {
        await persistWeeklyScores(scores)
      })

      // Check and award achievements
      const newAchievements = await step.run(`check-achievements-${org.id}`, async () => {
        return checkAndAwardAchievements(org.id, scores)
      })

      // Update team challenges progress
      await step.run(`update-challenges-${org.id}`, async () => {
        await updateChallengeProgress(org.id, prevMonday, scores)
      })

      totalScoresCalculated += scores.length
      totalAchievementsAwarded += newAchievements.length

      if (newAchievements.length > 0) {
        console.log(`[weekly-scores] ${org.name}: ${newAchievements.length} achievements awarded`)
      }
    }

    return {
      weekStart: prevMonday,
      organizationsProcessed: orgs.length,
      scoresCalculated: totalScoresCalculated,
      achievementsAwarded: totalAchievementsAwarded,
    }
  }
)

/**
 * Updates active team challenges with the week's progress.
 */
async function updateChallengeProgress(
  organizationId: string,
  weekStart: string,
  scores: Awaited<ReturnType<typeof calculateWeeklyScores>>
): Promise<void> {
  const supabase = getAdminClient()

  const { data: challenges } = await supabase
    .from('team_challenges')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())

  if (!challenges) return

  for (const challenge of challenges) {
    let currentValue = 0

    // Calculate based on target metric
    const relevantScores = scores.filter(s => {
      if (challenge.scope_type === 'organization') return true
      if (challenge.scope_type === 'department') return s.departmentId === challenge.scope_id
      if (challenge.scope_type === 'team') return s.teamId === challenge.scope_id
      return false
    })

    switch (challenge.target_metric) {
      case 'commitments_completed':
        currentValue = (challenge.current_value || 0) + relevantScores.reduce((s, r) => s + r.commitmentsCompleted, 0)
        break
      case 'points_earned':
        currentValue = (challenge.current_value || 0) + relevantScores.reduce((s, r) => s + r.totalPoints, 0)
        break
      case 'response_rate':
        currentValue = relevantScores.length > 0
          ? Math.round(relevantScores.reduce((s, r) => s + r.responseRate, 0) / relevantScores.length)
          : 0
        break
      case 'on_time_rate':
        currentValue = relevantScores.length > 0
          ? Math.round(relevantScores.reduce((s, r) => s + r.onTimeRate, 0) / relevantScores.length)
          : 0
        break
      case 'streak_members': {
        const { data: streakMembers } = await supabase
          .from('member_scores')
          .select('user_id')
          .eq('organization_id', organizationId)
          .gte('current_streak', 2)
        currentValue = streakMembers?.length || 0
        break
      }
    }

    const newStatus = currentValue >= challenge.target_value ? 'completed' : 'active'

    await supabase
      .from('team_challenges')
      .update({ current_value: currentValue, status: newStatus })
      .eq('id', challenge.id)
  }
}
