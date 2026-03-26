// app/(dashboard)/achievements/page.tsx
// Achievements page — DB-backed via /api/team-dashboard
// Shows user level/XP from member_scores, earned achievements, progress, streaks

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import {
  Trophy, Flame, Award, Zap, Timer, Clock, Inbox, Rocket,
  CheckCircle2, TrendingUp, Users, Star, MailCheck, Target,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Achievement {
  id: string
  slug: string
  name: string
  description: string
  category: string
  tier: string
  icon: string
  threshold: number
  earnedBy: number
  earnedByMe: boolean
}

interface MyAchievement {
  achievement_id: string
  earned_at: string
  name: string
  description: string
  tier: string
  icon: string
  category: string
}

interface LeaderboardEntry {
  userId: string
  totalPoints: number
  currentStreak: number
  longestStreak: number
  totalCompleted: number
}

interface DashboardData {
  leaderboard: LeaderboardEntry[]
  achievements: Achievement[]
  myAchievements: MyAchievement[]
}

// ── Level system ──────────────────────────────────────────────────────────────

const LEVELS = [
  { name: 'Getting Started', min: 0, max: 99 },
  { name: 'Contributor', min: 100, max: 299 },
  { name: 'Achiever', min: 300, max: 699 },
  { name: 'Expert', min: 700, max: 1499 },
  { name: 'Champion', min: 1500, max: 2999 },
  { name: 'Legend', min: 3000, max: Infinity },
]

function getLevel(points: number) {
  const level = LEVELS.find(l => points >= l.min && points <= l.max) || LEVELS[0]
  const nextLevel = LEVELS[LEVELS.indexOf(level) + 1]
  const progressInLevel = points - level.min
  const levelRange = (level.max === Infinity ? 1000 : level.max - level.min + 1)
  const progressPercent = Math.min(100, Math.round((progressInLevel / levelRange) * 100))
  return { ...level, progressPercent, nextLevel: nextLevel || null, pointsToNext: nextLevel ? nextLevel.min - points : 0 }
}

// ── Icon map ──────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, typeof Trophy> = {
  trophy: Trophy, flame: Flame, award: Award, zap: Zap, timer: Timer,
  clock: Clock, inbox: Inbox, rocket: Rocket, 'check-circle': CheckCircle2,
  'mail-check': MailCheck, mail: Inbox, 'trending-up': TrendingUp,
  users: Users, star: Star, target: Target,
}

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  bronze:   { bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-400',   border: 'border-orange-200 dark:border-orange-800', badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  silver:   { bg: 'bg-gray-50 dark:bg-gray-800',          text: 'text-gray-700 dark:text-gray-300',       border: 'border-gray-300 dark:border-gray-600',     badge: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
  gold:     { bg: 'bg-yellow-50 dark:bg-yellow-900/20',   text: 'text-yellow-700 dark:text-yellow-400',   border: 'border-yellow-200 dark:border-yellow-800', badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  platinum: { bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-400',   border: 'border-indigo-200 dark:border-indigo-800', badge: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' },
}

const CATEGORY_LABELS: Record<string, string> = {
  completion: 'Completion',
  response: 'Responsiveness',
  streak: 'Streaks',
  speed: 'Speed',
  volume: 'Volume',
  team: 'Teamwork',
}

const CATEGORY_ORDER = ['completion', 'response', 'streak', 'speed', 'volume', 'team']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [myAchievements, setMyAchievements] = useState<MyAchievement[]>([])
  const [totalPoints, setTotalPoints] = useState(0)
  const [currentStreak, setCurrentStreak] = useState(0)
  const [longestStreak, setLongestStreak] = useState(0)
  const [totalCompleted, setTotalCompleted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setLoading(false); return }

        const res = await fetch(`/api/team-dashboard?userId=${userData.user.id}`, { cache: 'no-store' })
        if (!res.ok) {
          setError('Failed to load achievements data')
          setLoading(false)
          return
        }

        const data: DashboardData = await res.json()

        setAchievements(data.achievements || [])
        setMyAchievements(data.myAchievements || [])

        // Find this user's scores from leaderboard
        const myEntry = (data.leaderboard || []).find(e => e.userId === userData.user!.id)
        if (myEntry) {
          setTotalPoints(myEntry.totalPoints)
          setCurrentStreak(myEntry.currentStreak)
          setLongestStreak(myEntry.longestStreak)
          setTotalCompleted(myEntry.totalCompleted)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load achievements'
        setError(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSkeleton variant="card" />

  const level = getLevel(totalPoints)
  const earnedIds = new Set(myAchievements.map(a => a.achievement_id))
  const earned = achievements.filter(a => earnedIds.has(a.id))
  const unearned = achievements.filter(a => !earnedIds.has(a.id))

  // Group earned by category
  const earnedByCategory = CATEGORY_ORDER
    .map(cat => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      achievements: earned.filter(a => a.category === cat),
    }))
    .filter(g => g.achievements.length > 0)

  // Build my achievements map for earned_at dates
  const myAchMap = new Map(myAchievements.map(a => [a.achievement_id, a]))

  const hasData = achievements.length > 0 || myAchievements.length > 0

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Achievements</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Milestones earned through consistent follow-through
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-sm text-red-800">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {!hasData && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Trophy className="w-12 h-12 text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No achievements yet</h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
            Start tracking commitments to unlock achievements and earn XP.
            Every commitment you complete brings you closer to your next milestone.
          </p>
          <a href="/commitments" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
            Start Tracking Commitments
          </a>
        </div>
      )}

      {hasData && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-indigo-600">{earned.length}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Unlocked</div>
            </div>
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-1">
                <Flame className="w-5 h-5 text-orange-500" />
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{currentStreak}</span>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Week streak</div>
              {longestStreak > currentStreak && (
                <div className="text-xs text-gray-400 mt-0.5">Best: {longestStreak}w</div>
              )}
            </div>
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{totalPoints.toLocaleString()}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Total Points</div>
            </div>
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-indigo-600">{level.name}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Current Level</div>
            </div>
          </div>

          {/* Level Progress */}
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-indigo-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">Level Progress</h3>
              </div>
              <span className="text-sm text-gray-500">
                {totalPoints.toLocaleString()} points
              </span>
            </div>
            <div className="w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${level.progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs font-medium text-indigo-600">{level.name}</span>
              {level.nextLevel ? (
                <span className="text-xs text-gray-400">
                  {level.pointsToNext.toLocaleString()} points to {level.nextLevel.name}
                </span>
              ) : (
                <span className="text-xs text-indigo-500 font-medium">Max level reached</span>
              )}
            </div>
          </div>

          {/* Streak Info */}
          {(currentStreak > 0 || longestStreak > 0) && (
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/10 dark:to-amber-900/10 border border-orange-200 dark:border-orange-800/30 rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <Flame className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {currentStreak > 0 ? `${currentStreak}-week streak active` : 'Build your streak'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {currentStreak > 0
                      ? `You've been productive for ${currentStreak} consecutive week${currentStreak !== 1 ? 's' : ''}. Keep it up!`
                      : `Your longest streak is ${longestStreak} week${longestStreak !== 1 ? 's' : ''}. Start a new one this week!`
                    }
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm text-gray-500">Longest</div>
                  <div className="text-lg font-bold text-orange-600">{longestStreak}w</div>
                </div>
              </div>
            </div>
          )}

          {/* Earned Achievements by Category */}
          {earnedByCategory.length > 0 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Earned Achievements</h2>
              {earnedByCategory.map(group => (
                <div key={group.category}>
                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3">
                    {group.label}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.achievements.map(a => {
                      const tierStyle = TIER_COLORS[a.tier] || TIER_COLORS.bronze
                      const Icon = ICON_MAP[a.icon] || Trophy
                      const myAch = myAchMap.get(a.id)
                      const earnedDate = myAch
                        ? new Date(myAch.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : null

                      return (
                        <div
                          key={a.id}
                          className={`${tierStyle.bg} border ${tierStyle.border} rounded-xl p-5 hover:shadow-md transition-shadow`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${tierStyle.bg} ${tierStyle.text}`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className={`text-sm font-semibold ${tierStyle.text}`}>{a.name}</h4>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${tierStyle.badge}`}>
                                  {a.tier}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{a.description}</p>
                              {earnedDate && (
                                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                                  Earned {earnedDate}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unearned / In Progress */}
          {unearned.length > 0 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">In Progress</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {unearned.map(a => {
                  const tierStyle = TIER_COLORS[a.tier] || TIER_COLORS.bronze
                  const Icon = ICON_MAP[a.icon] || Trophy

                  // Estimate progress based on category and user stats
                  let current = 0
                  let target = a.threshold
                  if (a.category === 'completion') {
                    current = Math.min(totalCompleted, target)
                  } else if (a.category === 'streak') {
                    current = Math.min(longestStreak, target)
                  }
                  // For response/speed/volume/team we don't have per-user data here,
                  // so show them as locked if not earned
                  const hasProgress = current > 0
                  const progressPercent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0

                  return (
                    <div
                      key={a.id}
                      className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 ${
                        hasProgress ? 'opacity-90' : 'opacity-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-400">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400">{a.name}</h4>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase bg-gray-100 dark:bg-gray-700 text-gray-400">
                              {a.tier}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{a.description}</p>
                          {hasProgress && (
                            <div className="mt-3">
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={target} aria-label={`${a.name}: ${current} of ${target}`}>
                                <div
                                  className="bg-indigo-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                              <div className="text-xs text-gray-400 mt-1">{current} / {target}</div>
                            </div>
                          )}
                          {!hasProgress && (
                            <p className="text-xs text-gray-300 dark:text-gray-600 mt-2">Locked</p>
                          )}
                          {a.earnedBy > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1">{a.earnedBy} team member{a.earnedBy !== 1 ? 's' : ''} earned</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
