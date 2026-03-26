'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Trophy, Flame, TrendingUp, TrendingDown, Minus,
  Medal, Star, Crown, Shield, Users, Building2,
  CheckCircle2, BarChart3, Heart, Target,
  ChevronUp, ChevronDown, Award, Zap, Timer,
  Clock, Inbox, Rocket, MailCheck,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: string
  totalPoints: number
  totalCompleted: number
  currentStreak: number
  longestStreak: number
  rank: number
  prevRank: number
  rankDelta: number
}

interface WeekTrend {
  weekStart: string
  totalPoints: number
  completions: number
  overdue: number
  avgResponseRate: number
  avgOnTimeRate: number
  memberCount: number
}

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

interface Challenge {
  id: string
  title: string
  description: string
  target_metric: string
  target_value: number
  current_value: number
  progress: number
  starts_at: string
  ends_at: string
  status: string
}

interface DashboardData {
  organization: { id: string; name: string }
  callerRole: string
  scope: string
  leaderboard: LeaderboardEntry[]
  trends: WeekTrend[]
  achievements: Achievement[]
  myAchievements: MyAchievement[]
  challenges: Challenge[]
  healthScore: number
  healthScoreDelta: number | null
  currentWeek: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  bronze:   { bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-400',   border: 'border-orange-200 dark:border-orange-800' },
  silver:   { bg: 'bg-gray-50 dark:bg-gray-800',          text: 'text-gray-700 dark:text-gray-300',       border: 'border-gray-200 dark:border-gray-700' },
  gold:     { bg: 'bg-yellow-50 dark:bg-yellow-900/20',   text: 'text-yellow-700 dark:text-yellow-400',   border: 'border-yellow-200 dark:border-yellow-800' },
  platinum: { bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-400',   border: 'border-indigo-200 dark:border-indigo-800' },
}

const ICON_MAP: Record<string, typeof Trophy> = {
  trophy: Trophy, flame: Flame, award: Award, zap: Zap, timer: Timer,
  clock: Clock, inbox: Inbox, rocket: Rocket, 'check-circle': CheckCircle2,
  'mail-check': MailCheck, mail: Inbox, 'trending-up': TrendingUp,
  users: Users, star: Star,
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TeamDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'achievements' | 'challenges'>('leaderboard')
  const supabase = createClient()

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDashboard = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      const res = await fetch(`/api/team-dashboard?userId=${user.user.id}`, { cache: 'no-store' })
      if (!res.ok) { setLoading(false); return }
      const dashData = await res.json()
      setData(dashData)
    } catch (err) {
      console.error('Error loading team dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <LoadingSkeleton variant="dashboard" />
  if (!data) return <EmptyState />

  const { leaderboard, trends, achievements, myAchievements, challenges, healthScore, healthScoreDelta } = data

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Team Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {data.organization?.name} · Weekly performance, leaderboards, and achievements
        </p>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Team Health Score */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-rose-500" />
            <p className="text-xs font-medium text-gray-500">Team Health</p>
          </div>
          <div className="flex items-end gap-2">
            <p className={`text-3xl font-bold ${
              healthScore >= 70 ? 'text-green-600' : healthScore >= 40 ? 'text-amber-600' : 'text-red-600'
            }`}>
              {healthScore}
            </p>
            <span className="text-sm text-gray-400 mb-1">/100</span>
            {healthScoreDelta !== null && (
              <span className={`text-xs font-medium mb-1 ${
                healthScoreDelta > 0 ? 'text-green-600' : healthScoreDelta < 0 ? 'text-red-600' : 'text-gray-400'
              }`}>
                {healthScoreDelta > 0 ? '+' : ''}{healthScoreDelta}
              </span>
            )}
          </div>
          <HealthBar score={healthScore} />
        </div>

        {/* Total Points This Period */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-violet-500" />
            <p className="text-xs font-medium text-gray-500">Points This Week</p>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {trends.length > 0 ? trends[trends.length - 1].totalPoints.toLocaleString() : '0'}
          </p>
          <WeekDelta trends={trends} field="totalPoints" />
        </div>

        {/* Completions This Week */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <p className="text-xs font-medium text-gray-500">Completed This Week</p>
          </div>
          <p className="text-3xl font-bold text-green-600">
            {trends.length > 0 ? trends[trends.length - 1].completions : 0}
          </p>
          <WeekDelta trends={trends} field="completions" />
        </div>

        {/* Active Streaks */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-orange-500" />
            <p className="text-xs font-medium text-gray-500">Active Streaks</p>
          </div>
          <p className="text-3xl font-bold text-orange-600">
            {leaderboard.filter(m => m.currentStreak >= 2).length}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            of {leaderboard.length} members on 2+ week streaks
          </p>
        </div>
      </div>

      {/* Trend Sparkline Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart
          title="Weekly Output"
          subtitle="Total points earned per week"
          data={trends}
          field="totalPoints"
          color="indigo"
        />
        <TrendChart
          title="Completion Rate"
          subtitle="Commitments completed per week"
          data={trends}
          field="completions"
          color="green"
        />
      </div>

      {/* Tabs: Leaderboard / Achievements / Challenges */}
      <div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
          {(['leaderboard', 'achievements', 'challenges'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                activeTab === tab
                  ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab === 'leaderboard' ? 'Leaderboard' : tab === 'achievements' ? 'Achievements' : 'Challenges'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {activeTab === 'leaderboard' && (
            <LeaderboardSection leaderboard={leaderboard} />
          )}
          {activeTab === 'achievements' && (
            <AchievementsSection
              achievements={achievements}
              myAchievements={myAchievements}
            />
          )}
          {activeTab === 'challenges' && (
            <ChallengesSection challenges={challenges} />
          )}
        </div>
      </div>
    </div>
    </UpgradeGate>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full mt-2 overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${score}%` }} />
    </div>
  )
}

function WeekDelta({ trends, field }: { trends: WeekTrend[]; field: keyof WeekTrend }) {
  if (trends.length < 2) return <p className="text-xs text-gray-400 mt-1">No prior week data</p>
  const current = trends[trends.length - 1][field] as number
  const prev = trends[trends.length - 2][field] as number
  const delta = current - prev
  const pct = prev > 0 ? Math.round(delta / prev * 100) : 0

  return (
    <p className={`text-xs font-medium mt-1 flex items-center gap-1 ${
      delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'
    }`}>
      {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {delta > 0 ? '+' : ''}{delta} ({pct > 0 ? '+' : ''}{pct}%) vs last week
    </p>
  )
}

function TrendChart({ title, subtitle, data, field, color }: {
  title: string
  subtitle: string
  data: WeekTrend[]
  field: keyof WeekTrend
  color: 'indigo' | 'green'
}) {
  if (data.length === 0) return null

  const values = data.map(d => d[field] as number)
  const max = Math.max(...values, 1)
  const barColor = color === 'indigo' ? 'bg-indigo-500' : 'bg-green-500'

  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      <div className="flex items-end gap-1 h-24">
        {data.map((week, i) => (
          <div key={week.weekStart} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
              <div
                className={`w-full max-w-[32px] ${barColor} rounded-t-sm transition-all duration-300 ${
                  i === data.length - 1 ? 'opacity-100' : 'opacity-60'
                }`}
                style={{ height: `${Math.max(4, (values[i] / max) * 80)}px` }}
              />
            </div>
            <span className="text-[9px] text-gray-400 whitespace-nowrap">{formatWeekLabel(week.weekStart)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderboardSection({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  if (leaderboard.length === 0) {
    return (
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
        <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No scores recorded yet</p>
        <p className="text-sm text-gray-400 mt-1">Leaderboard will populate after the first weekly score calculation</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {leaderboard.map((entry, i) => {
        const bgColor = AVATAR_COLORS[entry.displayName.charCodeAt(0) % AVATAR_COLORS.length]
        const isTop3 = i < 3

        return (
          <div
            key={entry.userId}
            className={`flex items-center gap-4 p-4 rounded-xl border transition ${
              isTop3
                ? 'bg-gradient-to-r from-white to-amber-50/50 dark:from-surface-dark-secondary dark:to-amber-900/10 border-amber-200/50 dark:border-amber-800/30'
                : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark'
            }`}
          >
            {/* Rank */}
            <div className="w-10 text-center flex-shrink-0">
              {i === 0 ? (
                <span className="text-2xl">&#129351;</span>
              ) : i === 1 ? (
                <span className="text-2xl">&#129352;</span>
              ) : i === 2 ? (
                <span className="text-2xl">&#129353;</span>
              ) : (
                <span className="text-lg font-bold text-gray-400">#{i + 1}</span>
              )}
            </div>

            {/* Avatar */}
            <div className={`w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
              {getInitials(entry.displayName)}
            </div>

            {/* Name + Streak */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">{entry.displayName}</h3>
                {entry.currentStreak >= 2 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 dark:bg-orange-900/20 text-orange-600">
                    <Flame className="w-3 h-3" />
                    {entry.currentStreak}w
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {entry.totalCompleted} completed · {entry.longestStreak}w best streak
              </p>
            </div>

            {/* Rank Delta */}
            <div className="flex-shrink-0 w-12 text-center">
              {entry.rankDelta > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600">
                  <ChevronUp className="w-3 h-3" />
                  {entry.rankDelta}
                </span>
              ) : entry.rankDelta < 0 ? (
                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600">
                  <ChevronDown className="w-3 h-3" />
                  {Math.abs(entry.rankDelta)}
                </span>
              ) : (
                <span className="text-xs text-gray-400">-</span>
              )}
            </div>

            {/* Points */}
            <div className="flex-shrink-0 text-right">
              <p className="text-lg font-bold text-gray-900 dark:text-white">{entry.totalPoints.toLocaleString()}</p>
              <p className="text-[10px] text-gray-400 font-medium">points</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AchievementsSection({ achievements, myAchievements }: {
  achievements: Achievement[]
  myAchievements: MyAchievement[]
}) {
  const categories = ['completion', 'response', 'streak', 'speed', 'volume', 'team']
  const categoryLabels: Record<string, string> = {
    completion: 'Completion',
    response: 'Responsiveness',
    streak: 'Streaks',
    speed: 'Speed',
    volume: 'Volume',
    team: 'Teamwork',
  }

  return (
    <div className="space-y-6">
      {/* My Recent Achievements */}
      {myAchievements.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">My Achievements</h3>
          <div className="flex flex-wrap gap-2">
            {myAchievements.slice(0, 8).map(a => {
              const tierStyle = TIER_COLORS[a.tier] || TIER_COLORS.bronze
              const Icon = ICON_MAP[a.icon] || Trophy
              return (
                <div
                  key={a.achievement_id}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${tierStyle.bg} ${tierStyle.border} ${tierStyle.text}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{a.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Achievements by Category */}
      {categories.map(cat => {
        const catAchievements = achievements.filter(a => a.category === cat)
        if (catAchievements.length === 0) return null

        return (
          <div key={cat}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{categoryLabels[cat]}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {catAchievements.map(a => {
                const tierStyle = TIER_COLORS[a.tier] || TIER_COLORS.bronze
                const Icon = ICON_MAP[a.icon] || Trophy
                const earned = a.earnedByMe

                return (
                  <div
                    key={a.id}
                    className={`flex items-start gap-3 p-4 rounded-xl border transition ${
                      earned
                        ? `${tierStyle.bg} ${tierStyle.border}`
                        : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      earned
                        ? `${tierStyle.bg} ${tierStyle.text}`
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`text-sm font-semibold ${earned ? tierStyle.text : 'text-gray-500'}`}>
                          {a.name}
                        </h4>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${
                          earned ? `${tierStyle.bg} ${tierStyle.text}` : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                        }`}>
                          {a.tier}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{a.description}</p>
                      {a.earnedBy > 0 && (
                        <p className="text-[10px] text-gray-400 mt-1">{a.earnedBy} team member{a.earnedBy !== 1 ? 's' : ''} earned</p>
                      )}
                    </div>
                    {earned && <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChallengesSection({ challenges }: { challenges: Challenge[] }) {
  if (challenges.length === 0) {
    return (
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
        <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No active challenges</p>
        <p className="text-sm text-gray-400 mt-1">Org admins can create team challenges to drive engagement</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {challenges.map(c => {
        const isComplete = c.status === 'completed'
        const daysLeft = Math.max(0, Math.ceil((new Date(c.ends_at).getTime() - Date.now()) / 86400000))

        return (
          <div
            key={c.id}
            className={`p-5 rounded-xl border transition ${
              isComplete
                ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{c.title}</h3>
                  {isComplete && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-3 h-3" />
                      Complete
                    </span>
                  )}
                </div>
                {c.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{c.description}</p>
                )}
              </div>
              {!isComplete && (
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isComplete ? 'bg-green-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${c.progress}%` }}
                />
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
                {c.current_value} / {c.target_value}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Team Dashboard</h2>
        <p className="text-gray-500">
          Join an organization to see team leaderboards, achievements, and performance trends.
        </p>
      </div>
    </div>
  )
}
