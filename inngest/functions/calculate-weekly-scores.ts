import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { calculateWeeklyScores, persistWeeklyScores, getPreviousWeekStart, getWeekStart } from '@/lib/team/calculate-scores'
import { checkAndAwardAchievements } from '@/lib/team/achievements'
import {
  celebrateAchievement,
  celebrateStreak,
  celebrateLeaderboardChange,
  celebrateChallengeCompleted,
} from '@/lib/slack/celebrations'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Streak milestones that trigger a Slack celebration. */
const STREAK_MILESTONES = new Set([2, 4, 8, 12, 16, 24, 52])

/**
 * Runs every Monday at 6 AM UTC -- calculates the previous week's scores
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
      const completedChallenges = await step.run(`update-challenges-${org.id}`, async () => {
        return updateChallengeProgress(org.id, prevMonday, scores)
      })

      totalScoresCalculated += scores.length
      totalAchievementsAwarded += newAchievements.length

      // -- Post celebration notifications to Slack --------------------------
      await step.run(`celebrations-${org.id}`, async () => {
        // Resolve user names and team IDs for celebration posts
        const userIds = [...new Set([
          ...newAchievements.map(a => a.userId),
          ...scores.map(s => s.userId),
        ])]

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds)

        const nameMap = new Map(
          (profiles || []).map(p => [p.id, p.full_name || 'Someone'])
        )

        // Map user IDs to their team IDs for Slack integration lookup
        const userTeamMap = new Map(scores.map(s => [s.userId, s.teamId]))

        // 1. Celebrate new achievements
        for (const achievement of newAchievements) {
          const teamId = userTeamMap.get(achievement.userId)
          if (!teamId) continue

          await celebrateAchievement(teamId, {
            userName: nameMap.get(achievement.userId) || 'Someone',
            achievementName: achievement.achievementName,
            tier: achievement.tier,
          })
        }

        // 2. Celebrate streak milestones
        // Fetch updated streaks after persistWeeklyScores ran
        const { data: memberScores } = await supabase
          .from('member_scores')
          .select('user_id, current_streak')
          .eq('organization_id', org.id)
          .in('user_id', scores.map(s => s.userId))

        for (const ms of memberScores || []) {
          if (STREAK_MILESTONES.has(ms.current_streak)) {
            const teamId = userTeamMap.get(ms.user_id)
            if (!teamId) continue

            await celebrateStreak(teamId, {
              userName: nameMap.get(ms.user_id) || 'Someone',
              streakWeeks: ms.current_streak,
            })
          }
        }

        // 3. Celebrate notable leaderboard moves (top 3 biggest jumps)
        const { data: rankChanges } = await supabase
          .from('member_scores')
          .select('user_id, org_rank, prev_org_rank')
          .eq('organization_id', org.id)
          .in('user_id', scores.map(s => s.userId))
          .not('prev_org_rank', 'is', null)

        const movers = (rankChanges || [])
          .filter(r => r.prev_org_rank != null && r.org_rank != null && r.prev_org_rank > r.org_rank)
          .map(r => ({
            userId: r.user_id,
            newRank: r.org_rank as number,
            previousRank: r.prev_org_rank as number,
            jump: (r.prev_org_rank as number) - (r.org_rank as number),
          }))
          .sort((a, b) => b.jump - a.jump)
          .slice(0, 3) // Top 3 biggest moves

        for (const mover of movers) {
          const teamId = userTeamMap.get(mover.userId)
          if (!teamId) continue

          await celebrateLeaderboardChange(teamId, {
            userName: nameMap.get(mover.userId) || 'Someone',
            newRank: mover.newRank,
            previousRank: mover.previousRank,
          })
        }

        // 4. Celebrate completed team challenges
        for (const challenge of completedChallenges) {
          // Post to the team that scoped the challenge, or the first team in the org
          const targetTeamId = challenge.scopeType === 'team' && challenge.scopeId
            ? challenge.scopeId
            : scores[0]?.teamId

          if (targetTeamId) {
            await celebrateChallengeCompleted(targetTeamId, {
              challengeTitle: challenge.title,
            })
          }
        }
      })

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
 * Returns a list of challenges that were completed this cycle.
 */
async function updateChallengeProgress(
  organizationId: string,
  weekStart: string,
  scores: Awaited<ReturnType<typeof calculateWeeklyScores>>
): Promise<{ id: string; title: string; scopeType: string; scopeId: string | null }[]> {
  const supabase = getAdminClient()
  const completedChallenges: { id: string; title: string; scopeType: string; scopeId: string | null }[] = []

  const { data: challenges } = await supabase
    .from('team_challenges')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())

  if (!challenges) return completedChallenges

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

    const wasActive = challenge.status === 'active'
    const newStatus = currentValue >= challenge.target_value ? 'completed' : 'active'

    await supabase
      .from('team_challenges')
      .update({ current_value: currentValue, status: newStatus })
      .eq('id', challenge.id)

    if (wasActive && newStatus === 'completed') {
      completedChallenges.push({
        id: challenge.id,
        title: challenge.title || challenge.target_metric,
        scopeType: challenge.scope_type,
        scopeId: challenge.scope_id,
      })
    }
  }

  return completedChallenges
}
