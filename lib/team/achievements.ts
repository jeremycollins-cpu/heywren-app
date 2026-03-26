// lib/team/achievements.ts
// Checks and awards achievements based on cumulative scores and weekly activity.
// All checks are numeric — no content is ever inspected.

import { createClient } from '@supabase/supabase-js'
import type { WeeklyMemberScore } from './calculate-scores'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface AchievementDef {
  id: string
  slug: string
  name: string
  category: string
  tier: string
  threshold: number
  points_reward: number
}

interface MemberCumulativeStats {
  userId: string
  organizationId: string
  totalCompletions: number
  totalMissedResolved: number
  currentStreak: number
  totalOnTime: number
  weeklyPoints: number
  avgDaysToClose: number | null
  responseRate: number
}

/**
 * Checks all achievements for members after a weekly score calculation.
 * Awards any newly-earned achievements.
 * Returns a list of newly awarded achievements for notification.
 */
export async function checkAndAwardAchievements(
  organizationId: string,
  weeklyScores: WeeklyMemberScore[]
): Promise<{ userId: string; achievementSlug: string; achievementName: string; tier: string }[]> {
  const supabase = getAdminClient()
  const newlyAwarded: { userId: string; achievementSlug: string; achievementName: string; tier: string }[] = []

  // Load all achievement definitions
  const { data: achievements } = await supabase
    .from('achievements')
    .select('id, slug, name, category, tier, threshold, points_reward')
    .order('sort_order')

  if (!achievements || achievements.length === 0) return newlyAwarded

  // Load cumulative scores for all members
  const userIds = weeklyScores.map(s => s.userId)
  const { data: memberScores } = await supabase
    .from('member_scores')
    .select('user_id, total_commitments_completed, total_missed_resolved, current_streak, total_on_time, total_points')
    .eq('organization_id', organizationId)
    .in('user_id', userIds)

  // Load already-earned achievements
  const { data: earnedAchievements } = await supabase
    .from('member_achievements')
    .select('user_id, achievement_id')
    .eq('organization_id', organizationId)
    .in('user_id', userIds)

  const earnedSet = new Set(
    (earnedAchievements || []).map((ea: any) => `${ea.user_id}:${ea.achievement_id}`)
  )

  const cumulativeMap = new Map(
    (memberScores || []).map((ms: any) => [ms.user_id, ms])
  )

  for (const weekScore of weeklyScores) {
    const cumulative = cumulativeMap.get(weekScore.userId) as any
    if (!cumulative) continue

    const stats: MemberCumulativeStats = {
      userId: weekScore.userId,
      organizationId,
      totalCompletions: cumulative.total_commitments_completed || 0,
      totalMissedResolved: cumulative.total_missed_resolved || 0,
      currentStreak: cumulative.current_streak || 0,
      totalOnTime: cumulative.total_on_time || 0,
      weeklyPoints: weekScore.totalPoints,
      avgDaysToClose: weekScore.avgDaysToClose,
      responseRate: weekScore.responseRate,
    }

    for (const achievement of achievements) {
      const key = `${weekScore.userId}:${achievement.id}`
      if (earnedSet.has(key)) continue

      if (isAchievementEarned(achievement, stats)) {
        // Award it
        const { error } = await supabase
          .from('member_achievements')
          .insert({
            organization_id: organizationId,
            user_id: weekScore.userId,
            achievement_id: achievement.id,
            week_earned: weekScore.weekStart,
          })

        if (!error) {
          earnedSet.add(key)
          newlyAwarded.push({
            userId: weekScore.userId,
            achievementSlug: achievement.slug,
            achievementName: achievement.name,
            tier: achievement.tier,
          })

          // Add bonus points for earning the achievement
          if (achievement.points_reward > 0) {
            await supabase
              .from('member_scores')
              .update({
                total_points: (cumulative.total_points || 0) + achievement.points_reward,
              })
              .eq('organization_id', organizationId)
              .eq('user_id', weekScore.userId)
          }
        }
      }
    }
  }

  return newlyAwarded
}

/**
 * Determines if a specific achievement has been earned based on stats.
 */
function isAchievementEarned(
  achievement: AchievementDef,
  stats: MemberCumulativeStats
): boolean {
  switch (achievement.category) {
    case 'completion':
      return stats.totalCompletions >= achievement.threshold

    case 'response':
      return stats.totalMissedResolved >= achievement.threshold

    case 'streak':
      return stats.currentStreak >= achievement.threshold

    case 'speed':
      if (achievement.slug === 'speed_demon') {
        return stats.avgDaysToClose !== null && stats.avgDaysToClose <= achievement.threshold
      }
      // early_bird achievements
      return stats.totalOnTime >= achievement.threshold

    case 'volume':
      return stats.weeklyPoints >= achievement.threshold

    case 'team':
      if (achievement.slug === 'team_player') {
        return stats.responseRate >= 100 && stats.totalMissedResolved > 0
      }
      // most_improved is calculated separately (needs week-over-week comparison)
      return false

    default:
      return false
  }
}
