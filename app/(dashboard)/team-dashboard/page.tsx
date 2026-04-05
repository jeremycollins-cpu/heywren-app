'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Trophy, Flame, TrendingUp, TrendingDown, Minus,
  Medal, Star, Crown, Shield, Users, Building2,
  CheckCircle2, BarChart3, Heart, Target,
  ChevronUp, ChevronDown, Award, Zap, Timer,
  Clock, Inbox, Rocket, MailCheck, Download, Plus, X,
  AlertTriangle, Sparkles, ArrowUp, ArrowDown,
  Smile, Frown, Meh, MessageCircle, ThermometerSun,
  Bell, Check, XCircle, Eye, Battery, Brain,
} from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  userId: string
  displayName: string
  avatarUrl: string | null
  jobTitle: string | null
  role: string
  totalPoints: number
  totalCompleted: number
  totalOnTime: number
  totalMissedResolved: number
  weeksActive: number
  currentStreak: number
  longestStreak: number
  rank: number
  prevRank: number
  rankDelta: number
  achievementCount: number
}

interface WeekTrend {
  weekStart: string
  totalPoints: number
  completions: number
  overdue: number
  avgResponseRate: number
  avgOnTimeRate: number
  memberCount: number
  totalMissedResolved: number
  meetingsAttended: number
}

interface Spotlight {
  type: string
  label: string
  userId: string
  displayName: string
  avatarUrl: string | null
  value: string
  detail: string
}

interface Theme {
  icon: string
  text: string
  sentiment: 'positive' | 'neutral' | 'negative'
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

interface Pulse {
  totalMembers: number
  activeThisWeek: number
  activeStreaks: number
  totalPointsThisWeek: number
  completionsThisWeek: number
  avgResponseRate: number
  avgOnTimeRate: number
}

interface CultureInsights {
  currentToneIndex: number
  currentLabel: 'positive' | 'neutral' | 'negative'
  sampleCount: number
  distribution: { positive: number; neutral: number; negative: number }
  currentMonth: string
  topThemes: Array<{ theme: string; count: number; percentage: number }>
  monthlyTrend: Array<{
    month: string
    toneIndex: number
    sampleCount: number
    themes: Record<string, number>
    distribution: { positive: number; neutral: number; negative: number }
  }>
  individuals: Array<{
    userId: string
    name: string
    avatar: string | null
    avgSentiment: number
    messageCount: number
    label: 'positive' | 'neutral' | 'negative'
    topThemes: string[]
    trend: Array<{ month: string; avg: number }>
  }>
  notableShifts: Array<{
    userId: string
    name: string
    avatar: string | null
    previousAvg: number
    currentAvg: number
    delta: number
    direction: 'improving' | 'declining'
  }>
}

interface ManagerAlert {
  id: string
  target_user_id: string | null
  alert_type: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'critical'
  data: Record<string, unknown>
  status: string
  created_at: string
  targetName: string | null
  targetAvatar: string | null
}

interface AlertsData {
  alerts: ManagerAlert[]
  summary: { total: number; critical: number; warning: number; info: number }
}

interface PulseData {
  hasRespondedThisWeek: boolean
  currentWeek: string
  teamAggregate: {
    weeklyStats: Array<{
      week: string
      respondents: number
      avgEnergy: number | null
      avgFocus: number | null
      blockerCount: number
      winCount: number
    }>
    currentWeek: {
      respondents: number
      totalMembers: number
      participationRate: number
      avgEnergy: number | null
      avgFocus: number | null
    }
  } | null
}

interface DashboardData {
  organization: { id: string; name: string }
  callerRole: string
  scope: string
  pulse: Pulse
  leaderboard: LeaderboardEntry[]
  spotlights: Spotlight[]
  themes: Theme[]
  trends: WeekTrend[]
  achievements: Achievement[]
  myAchievements: MyAchievement[]
  challenges: Challenge[]
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
  'trending-down': TrendingDown, users: Users, star: Star,
  'alert-triangle': AlertTriangle,
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

const SPOTLIGHT_STYLES: Record<string, { gradient: string; iconBg: string; icon: typeof Trophy }> = {
  top_performer: { gradient: 'from-amber-500/10 to-orange-500/10 dark:from-amber-900/20 dark:to-orange-900/20', iconBg: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600', icon: Crown },
  streak_leader: { gradient: 'from-orange-500/10 to-red-500/10 dark:from-orange-900/20 dark:to-red-900/20', iconBg: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600', icon: Flame },
  most_improved: { gradient: 'from-green-500/10 to-emerald-500/10 dark:from-green-900/20 dark:to-emerald-900/20', iconBg: 'bg-green-100 dark:bg-green-900/30 text-green-600', icon: TrendingUp },
  most_responsive: { gradient: 'from-blue-500/10 to-indigo-500/10 dark:from-blue-900/20 dark:to-indigo-900/20', iconBg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600', icon: MailCheck },
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const METRIC_LABELS: Record<string, string> = {
  commitments_completed: 'Commitments Completed',
  points_earned: 'Points Earned',
  response_rate: 'Response Rate (%)',
  on_time_rate: 'On-Time Rate (%)',
  streak_members: 'Members on Streaks',
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TeamDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [showCreateChallenge, setShowCreateChallenge] = useState(false)
  const [secondaryTab, setSecondaryTab] = useState<'achievements' | 'challenges'>('achievements')
  const [cultureInsights, setCultureInsights] = useState<CultureInsights | null>(null)
  const [alertsData, setAlertsData] = useState<AlertsData | null>(null)
  const [pulseData, setPulseData] = useState<PulseData | null>(null)
  const supabase = createClient()

  const handleExportReport = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return
      const res = await fetch(`/api/team-report?userId=${user.user.id}&format=html`)
      if (!res.ok) throw new Error('Failed to generate report')
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch {
      toast.error('Failed to export report')
    }
  }

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDashboard = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      // Use allSettled so one failing API doesn't block the others
      const results = await Promise.allSettled([
        fetch(`/api/team-dashboard?userId=${user.user.id}`, { cache: 'no-store' }),
        fetch('/api/culture-insights', { cache: 'no-store' }),
        fetch('/api/manager-alerts', { cache: 'no-store' }),
        fetch('/api/pulse-check', { cache: 'no-store' }),
      ])

      // Team dashboard (required)
      const res = results[0].status === 'fulfilled' ? results[0].value : null
      if (!res?.ok) { setLoading(false); return }
      const dashData = await res.json()
      setData(dashData)

      // Optional APIs — each wrapped individually so one failure doesn't break the page
      try {
        const cultureRes = results[1].status === 'fulfilled' ? results[1].value : null
        if (cultureRes?.ok) {
          const d = await cultureRes.json()
          if (!d.error) setCultureInsights(d)
        }
      } catch { /* non-fatal */ }
      try {
        const alertsRes = results[2].status === 'fulfilled' ? results[2].value : null
        if (alertsRes?.ok) {
          const d = await alertsRes.json()
          if (!d.error) setAlertsData(d)
        }
      } catch { /* non-fatal */ }
      try {
        const pulseRes = results[3].status === 'fulfilled' ? results[3].value : null
        if (pulseRes?.ok) {
          const d = await pulseRes.json()
          if (!d.error) setPulseData(d)
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      console.error('Error loading team dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <LoadingSkeleton variant="dashboard" />
  if (!data) return <EmptyState />

  const { pulse, leaderboard, spotlights, themes, trends, achievements, myAchievements, challenges } = data

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Team Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {data.organization?.name} · People, performance, and momentum
          </p>
        </div>
        <button
          onClick={handleExportReport}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>

      {/* ── Manager Alerts ────────────────────────────────────────────── */}
      {alertsData && alertsData.alerts.length > 0 && (
        <ManagerAlertsPanel alerts={alertsData.alerts} summary={alertsData.summary} onUpdate={loadDashboard} />
      )}

      {/* ── Pulse Check-in ─────────────────────────────────────────────── */}
      {pulseData && (
        <PulseCheckInPanel pulse={pulseData} onSubmit={loadDashboard} />
      )}

      {/* ── Company Pulse ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PulseStat
          icon={<Users className="w-4 h-4 text-indigo-500" />}
          label="Team Members"
          value={pulse.totalMembers}
          detail={`${pulse.activeThisWeek} active this week`}
        />
        <PulseStat
          icon={<Zap className="w-4 h-4 text-violet-500" />}
          label="Points This Week"
          value={pulse.totalPointsThisWeek.toLocaleString()}
          detail={<WeekDeltaInline trends={trends} field="totalPoints" />}
        />
        <PulseStat
          icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          label="Completed"
          value={pulse.completionsThisWeek}
          detail={<WeekDeltaInline trends={trends} field="completions" />}
        />
        <PulseStat
          icon={<Flame className="w-4 h-4 text-orange-500" />}
          label="Active Streaks"
          value={pulse.activeStreaks}
          detail={`of ${pulse.totalMembers} on 2+ week streaks`}
        />
      </div>

      {/* ── Spotlights ──────────────────────────────────────────────────── */}
      {spotlights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {spotlights.map(s => {
            const style = SPOTLIGHT_STYLES[s.type] || SPOTLIGHT_STYLES.top_performer
            const Icon = style.icon
            const bgColor = AVATAR_COLORS[s.displayName.charCodeAt(0) % AVATAR_COLORS.length]
            return (
              <div
                key={s.type}
                className={`relative overflow-hidden rounded-xl border border-gray-200 dark:border-border-dark bg-gradient-to-br ${style.gradient} p-4`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${style.iconBg}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{s.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  {s.avatarUrl ? (
                    <img src={s.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className={`w-9 h-9 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-xs`}>
                      {getInitials(s.displayName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{s.displayName}</p>
                    <p className="text-xs text-gray-500">{s.value}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">{s.detail}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Company Themes ──────────────────────────────────────────────── */}
      {themes.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">This Week&apos;s Themes</h2>
          </div>
          <div className="space-y-2.5">
            {themes.map((theme, i) => {
              const Icon = ICON_MAP[theme.icon] || Sparkles
              const sentimentColor = theme.sentiment === 'positive'
                ? 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                : theme.sentiment === 'negative'
                ? 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
                : 'text-gray-500 bg-gray-50 dark:bg-gray-800 dark:text-gray-400'
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${sentimentColor}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 pt-1">{theme.text}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── People Leaderboard (primary content) ────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Rankings</h2>
          </div>
          <span className="text-xs text-gray-400">{leaderboard.length} member{leaderboard.length !== 1 ? 's' : ''}</span>
        </div>

        {leaderboard.length === 0 ? (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No scores recorded yet</p>
            <p className="text-sm text-gray-400 mt-1">Rankings will populate after the first weekly score calculation</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((entry, i) => {
              const bgColor = AVATAR_COLORS[entry.displayName.charCodeAt(0) % AVATAR_COLORS.length]
              const isTop3 = i < 3
              const isExpanded = expandedMember === entry.userId

              return (
                <div key={entry.userId}>
                  <button
                    onClick={() => setExpandedMember(isExpanded ? null : entry.userId)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition text-left ${
                      isTop3
                        ? 'bg-gradient-to-r from-white to-amber-50/50 dark:from-surface-dark-secondary dark:to-amber-900/10 border-amber-200/50 dark:border-amber-800/30'
                        : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {/* Rank */}
                    <div className="w-8 text-center flex-shrink-0">
                      {i === 0 ? (
                        <span className="text-xl">&#129351;</span>
                      ) : i === 1 ? (
                        <span className="text-xl">&#129352;</span>
                      ) : i === 2 ? (
                        <span className="text-xl">&#129353;</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400">#{i + 1}</span>
                      )}
                    </div>

                    {/* Avatar */}
                    {entry.avatarUrl ? (
                      <img src={entry.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                        {getInitials(entry.displayName)}
                      </div>
                    )}

                    {/* Name + Meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white truncate">{entry.displayName}</h3>
                        {entry.currentStreak >= 2 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 dark:bg-orange-900/20 text-orange-600">
                            <Flame className="w-3 h-3" />
                            {entry.currentStreak}w
                          </span>
                        )}
                        {entry.achievementCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">
                            <Award className="w-3 h-3" />
                            {entry.achievementCount}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {entry.jobTitle || entry.role.replace('_', ' ')}
                        {entry.weeksActive > 0 && ` · ${entry.weeksActive}w active`}
                      </p>
                    </div>

                    {/* Rank Delta */}
                    <div className="flex-shrink-0 w-10 text-center">
                      {entry.rankDelta > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600">
                          <ArrowUp className="w-3 h-3" />
                          {entry.rankDelta}
                        </span>
                      ) : entry.rankDelta < 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600">
                          <ArrowDown className="w-3 h-3" />
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
                  </button>

                  {/* Expanded stats */}
                  {isExpanded && (
                    <div className="mx-4 -mt-1 mb-1 p-4 bg-gray-50 dark:bg-gray-800/50 border border-t-0 border-gray-200 dark:border-border-dark rounded-b-xl">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{entry.totalCompleted}</p>
                          <p className="text-[11px] text-gray-500">Completed</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {entry.totalCompleted > 0 ? Math.round((entry.totalOnTime / entry.totalCompleted) * 100) : 0}%
                          </p>
                          <p className="text-[11px] text-gray-500">On Time</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{entry.totalMissedResolved}</p>
                          <p className="text-[11px] text-gray-500">Msgs Addressed</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{entry.longestStreak}w</p>
                          <p className="text-[11px] text-gray-500">Best Streak</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Momentum Trends ─────────────────────────────────────────────── */}
      {trends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TrendChart
            title="Team Output"
            subtitle="Total points earned per week"
            data={trends}
            field="totalPoints"
            color="indigo"
          />
          <TrendChart
            title="Completion Trend"
            subtitle="Items completed per week"
            data={trends}
            field="completions"
            color="green"
          />
        </div>
      )}

      {/* ── Culture & Tone Insights ─────────────────────────────────────── */}
      {cultureInsights && cultureInsights.sampleCount > 0 && (
        <CultureInsightsSection insights={cultureInsights} />
      )}

      {/* ── Achievements & Challenges (secondary) ──────────────────────── */}
      <div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit mb-4">
          {(['achievements', 'challenges'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSecondaryTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                secondaryTab === tab
                  ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab === 'achievements' ? 'Achievements' : 'Challenges'}
            </button>
          ))}
        </div>

        {secondaryTab === 'achievements' && (
          <AchievementsSection achievements={achievements} myAchievements={myAchievements} />
        )}
        {secondaryTab === 'challenges' && (
          <ChallengesSection
            challenges={challenges}
            callerRole={data.callerRole}
            showCreate={showCreateChallenge}
            onToggleCreate={() => setShowCreateChallenge(!showCreateChallenge)}
            organizationId={data.organization?.id}
            onChallengeCreated={loadDashboard}
          />
        )}
      </div>
    </div>
    </UpgradeGate>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PulseStat({ icon, label, value, detail }: {
  icon: React.ReactNode
  label: string
  value: string | number
  detail: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <div className="text-xs text-gray-400 mt-1">{detail}</div>
    </div>
  )
}

function WeekDeltaInline({ trends, field }: { trends: WeekTrend[]; field: keyof WeekTrend }) {
  if (trends.length < 2) return <span>No prior week data</span>
  const current = trends[trends.length - 1][field] as number
  const prev = trends[trends.length - 2][field] as number
  const delta = current - prev
  const pct = prev > 0 ? Math.round(delta / prev * 100) : 0

  return (
    <span className={`inline-flex items-center gap-0.5 ${
      delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'
    }`}>
      {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {delta > 0 ? '+' : ''}{delta} ({pct > 0 ? '+' : ''}{pct}%) vs last week
    </span>
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

function ChallengesSection({ challenges, callerRole, showCreate, onToggleCreate, organizationId, onChallengeCreated }: {
  challenges: Challenge[]
  callerRole: string
  showCreate: boolean
  onToggleCreate: () => void
  organizationId?: string
  onChallengeCreated: () => void
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    scopeType: 'organization' as string,
    targetMetric: 'commitments_completed' as string,
    targetValue: 50,
    duration: '7',
  })
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = async () => {
    if (!form.title || !organizationId) return
    setSubmitting(true)
    try {
      const now = new Date()
      const endsAt = new Date(now)
      endsAt.setDate(endsAt.getDate() + parseInt(form.duration))

      const res = await fetch('/api/team-challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          scopeType: form.scopeType,
          scopeId: organizationId,
          targetMetric: form.targetMetric,
          targetValue: form.targetValue,
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      })
      if (!res.ok) throw new Error('Failed to create challenge')
      toast.success('Challenge created!')
      onToggleCreate()
      setForm({ title: '', description: '', scopeType: 'organization', targetMetric: 'commitments_completed', targetValue: 50, duration: '7' })
      onChallengeCreated()
    } catch {
      toast.error('Failed to create challenge')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {callerRole === 'org_admin' && (
        <div className="flex justify-end">
          <button
            onClick={onToggleCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Create Challenge'}
          </button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-indigo-200 dark:border-indigo-800/50 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">New Team Challenge</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Complete 100 items this week"
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Description (optional)</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What's the goal?"
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Scope</label>
              <select
                value={form.scopeType}
                onChange={e => setForm({ ...form, scopeType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              >
                <option value="organization">Whole Organization</option>
                <option value="department">Department</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Metric</label>
              <select
                value={form.targetMetric}
                onChange={e => setForm({ ...form, targetMetric: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              >
                {Object.entries(METRIC_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Target Value</label>
              <input
                type="number"
                min={1}
                value={form.targetValue}
                onChange={e => setForm({ ...form, targetValue: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Duration</label>
              <select
                value={form.duration}
                onChange={e => setForm({ ...form, duration: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
              >
                <option value="7">1 Week</option>
                <option value="14">2 Weeks</option>
                <option value="30">1 Month</option>
                <option value="90">1 Quarter</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!form.title || submitting}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {submitting ? 'Creating...' : 'Create Challenge'}
            </button>
          </div>
        </div>
      )}

      {challenges.length === 0 && !showCreate ? (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
          <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No active challenges</p>
          <p className="text-sm text-gray-400 mt-1">
            {callerRole === 'org_admin' ? 'Create a challenge to drive team engagement' : 'Org admins can create team challenges'}
          </p>
        </div>
      ) : (
        challenges.map(c => {
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
        })
      )}
    </div>
  )
}

// ── Culture & Tone Insights ──────────────────────────────────────────────────

const TONE_THEME_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  gratitude:     { bg: 'bg-green-50 dark:bg-green-900/20',   text: 'text-green-700 dark:text-green-400',     icon: '🙏' },
  urgency:       { bg: 'bg-amber-50 dark:bg-amber-900/20',   text: 'text-amber-700 dark:text-amber-400',     icon: '⚡' },
  frustration:   { bg: 'bg-red-50 dark:bg-red-900/20',       text: 'text-red-700 dark:text-red-400',         icon: '😤' },
  collaboration: { bg: 'bg-blue-50 dark:bg-blue-900/20',     text: 'text-blue-700 dark:text-blue-400',       icon: '🤝' },
  confusion:     { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-400',   icon: '❓' },
  celebration:   { bg: 'bg-pink-50 dark:bg-pink-900/20',     text: 'text-pink-700 dark:text-pink-400',       icon: '🎉' },
  concern:       { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-400',   icon: '⚠️' },
  encouragement: { bg: 'bg-teal-50 dark:bg-teal-900/20',     text: 'text-teal-700 dark:text-teal-400',       icon: '💪' },
  formality:     { bg: 'bg-gray-50 dark:bg-gray-800',        text: 'text-gray-700 dark:text-gray-300',       icon: '📋' },
  casual:        { bg: 'bg-cyan-50 dark:bg-cyan-900/20',     text: 'text-cyan-700 dark:text-cyan-400',       icon: '😊' },
}

// ── Manager Alerts Panel ─────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: typeof AlertTriangle; iconColor: string }> = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-800', icon: AlertTriangle, iconColor: 'text-red-500' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-900/10', border: 'border-amber-200 dark:border-amber-800', icon: Bell, iconColor: 'text-amber-500' },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/10', border: 'border-blue-200 dark:border-blue-800', icon: Eye, iconColor: 'text-blue-500' },
}

function ManagerAlertsPanel({ alerts, summary, onUpdate }: {
  alerts: ManagerAlert[]
  summary: { total: number; critical: number; warning: number; info: number }
  onUpdate: () => void
}) {
  const [dismissing, setDismissing] = useState<string | null>(null)

  const handleAction = async (alertId: string, action: 'acknowledged' | 'dismissed') => {
    setDismissing(alertId)
    try {
      const res = await fetch('/api/manager-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, action }),
      })
      if (res.ok) onUpdate()
    } catch { /* ignore */ }
    setDismissing(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-indigo-500" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Alerts</h2>
        {summary.critical > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
            {summary.critical} critical
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">{summary.total} active</span>
      </div>
      {alerts.slice(0, 5).map(alert => {
        const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info
        const Icon = style.icon
        return (
          <div key={alert.id} className={`${style.bg} border ${style.border} rounded-xl p-4 flex items-start gap-3`}>
            <Icon className={`w-5 h-5 ${style.iconColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{alert.title}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{alert.body}</p>
              <p className="text-[10px] text-gray-400 mt-1">
                {new Date(alert.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {alert.targetName && ` · ${alert.targetName}`}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => handleAction(alert.id, 'acknowledged')}
                disabled={dismissing === alert.id}
                className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-gray-800 transition"
                title="Acknowledge"
              >
                <Check className="w-4 h-4 text-green-600" />
              </button>
              <button
                onClick={() => handleAction(alert.id, 'dismissed')}
                disabled={dismissing === alert.id}
                className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-gray-800 transition"
                title="Dismiss"
              >
                <XCircle className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Pulse Check-in Panel ────────────────────────────────────────────────────

function PulseCheckInPanel({ pulse, onSubmit }: { pulse: PulseData; onSubmit: () => void }) {
  const [energy, setEnergy] = useState<number>(0)
  const [focus, setFocus] = useState<number>(0)
  const [blocker, setBlocker] = useState('')
  const [win, setWin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(pulse.hasRespondedThisWeek)

  const handleSubmit = async () => {
    if (energy === 0 && focus === 0) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/pulse-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          energyLevel: energy || undefined,
          focusRating: focus || undefined,
          blocker: blocker || undefined,
          win: win || undefined,
        }),
      })
      if (res.ok) {
        setSubmitted(true)
        onSubmit()
      }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const teamStats = pulse.teamAggregate?.currentWeek

  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Battery className="w-5 h-5 text-green-500" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Weekly Pulse</h2>
        {teamStats && (
          <span className="text-xs text-gray-400 ml-auto">
            {teamStats.participationRate}% team participation
          </span>
        )}
      </div>

      {submitted ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="w-4 h-4" />
            <span>You&apos;ve checked in this week</span>
          </div>
          {/* Show team aggregate if available */}
          {teamStats && teamStats.avgEnergy != null && (
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Team energy: <strong className="text-gray-700 dark:text-gray-300">{teamStats.avgEnergy}/5</strong></span>
              {teamStats.avgFocus != null && (
                <span>Team focus: <strong className="text-gray-700 dark:text-gray-300">{teamStats.avgFocus}/5</strong></span>
              )}
              <span>{teamStats.respondents}/{teamStats.totalMembers} responded</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Energy level</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setEnergy(n)}
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition ${
                      energy === n
                        ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 font-bold'
                        : 'border-gray-200 dark:border-border-dark text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-0.5">
                <span>Drained</span><span>Energized</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Focus level</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setFocus(n)}
                    className={`flex-1 py-1.5 text-sm rounded-lg border transition ${
                      focus === n
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400 font-bold'
                        : 'border-gray-200 dark:border-border-dark text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-0.5">
                <span>Scattered</span><span>Locked in</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Biggest blocker?"
              value={blocker}
              onChange={e => setBlocker(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="One win this week?"
              value={win}
              onChange={e => setWin(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark placeholder-gray-400"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || (energy === 0 && focus === 0)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {submitting ? 'Submitting...' : 'Submit Check-in'}
          </button>
        </div>
      )}
    </div>
  )
}

function formatMonthLabel(monthStart: string): string {
  const d = new Date(monthStart + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function CultureInsightsSection({ insights }: { insights: CultureInsights }) {
  const { currentToneIndex, currentLabel, sampleCount, distribution, topThemes, monthlyTrend, individuals, notableShifts } = insights

  const toneColor = currentLabel === 'positive'
    ? 'text-green-600 dark:text-green-400'
    : currentLabel === 'negative'
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-600 dark:text-gray-400'

  const ToneIcon = currentLabel === 'positive' ? Smile : currentLabel === 'negative' ? Frown : Meh

  const total = distribution.positive + distribution.neutral + distribution.negative
  const positivePct = total > 0 ? Math.round((distribution.positive / total) * 100) : 0
  const neutralPct = total > 0 ? Math.round((distribution.neutral / total) * 100) : 0
  const negativePct = total > 0 ? Math.round((distribution.negative / total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ThermometerSun className="w-5 h-5 text-indigo-500" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Culture & Tone</h2>
        <span className="text-xs text-gray-400 ml-auto">{sampleCount} messages this month</span>
      </div>

      {/* Tone Index + Distribution */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Company Tone Index */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <ToneIcon className={`w-6 h-6 ${toneColor}`} />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Company Tone</span>
          </div>
          <p className={`text-3xl font-bold ${toneColor}`}>
            {currentToneIndex > 0 ? '+' : ''}{currentToneIndex.toFixed(2)}
          </p>
          <p className="text-xs text-gray-400 mt-1 capitalize">{currentLabel} overall sentiment</p>
        </div>

        {/* Sentiment Distribution */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Sentiment Mix</p>
          <div className="flex h-4 rounded-full overflow-hidden mb-2">
            {positivePct > 0 && <div className="bg-green-500" style={{ width: `${positivePct}%` }} />}
            {neutralPct > 0 && <div className="bg-gray-300 dark:bg-gray-600" style={{ width: `${neutralPct}%` }} />}
            {negativePct > 0 && <div className="bg-red-500" style={{ width: `${negativePct}%` }} />}
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-green-600">{positivePct}% positive</span>
            <span className="text-gray-400">{neutralPct}% neutral</span>
            <span className="text-red-500">{negativePct}% negative</span>
          </div>
        </div>

        {/* Notable Shifts */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Notable Shifts</p>
          {notableShifts.length === 0 ? (
            <p className="text-sm text-gray-400">No significant sentiment changes this period</p>
          ) : (
            <div className="space-y-2">
              {notableShifts.slice(0, 3).map(shift => (
                <div key={shift.userId} className="flex items-center gap-2 text-sm">
                  {shift.direction === 'improving' ? (
                    <ArrowUp className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <ArrowDown className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  )}
                  <span className="text-gray-700 dark:text-gray-300 truncate">{shift.name}</span>
                  <span className={`text-xs font-medium ml-auto ${
                    shift.direction === 'improving' ? 'text-green-600' : 'text-red-500'
                  }`}>
                    {shift.delta > 0 ? '+' : ''}{shift.delta.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Themes */}
      {topThemes.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Culture Themes</p>
          <div className="flex flex-wrap gap-2">
            {topThemes.map(t => {
              const style = TONE_THEME_STYLES[t.theme] || TONE_THEME_STYLES.formality
              return (
                <span
                  key={t.theme}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${style.bg} ${style.text}`}
                >
                  <span>{style.icon}</span>
                  <span className="capitalize">{t.theme}</span>
                  <span className="opacity-60">{t.percentage}%</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Monthly Tone Trend Chart */}
      {monthlyTrend.length > 1 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Monthly Tone Trend</h3>
            <p className="text-xs text-gray-400">Company sentiment month over month</p>
          </div>
          <div className="flex items-end gap-2 h-24">
            {monthlyTrend.map((m, i) => {
              // Normalize -1..1 to 0..100 for bar height
              const normalized = ((m.toneIndex + 1) / 2) * 100
              const barHeight = Math.max(4, normalized)
              const isPositive = m.toneIndex >= 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div className="w-full relative flex flex-col justify-end h-24">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isPositive
                          ? 'bg-green-400 dark:bg-green-500'
                          : 'bg-red-400 dark:bg-red-500'
                      } group-hover:opacity-80`}
                      style={{ height: `${barHeight}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 leading-none">
                    {formatMonthLabel(m.month)}
                  </span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                      <p className="font-medium">{m.toneIndex > 0 ? '+' : ''}{m.toneIndex.toFixed(2)}</p>
                      <p className="text-gray-300">{m.sampleCount} messages</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Individual Sentiment */}
      {individuals.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Individual Sentiment</p>
          <div className="space-y-2">
            {individuals.slice(0, 8).map(person => {
              const sentColor = person.label === 'positive'
                ? 'text-green-600 dark:text-green-400'
                : person.label === 'negative'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500'
              const barWidth = Math.round(((person.avgSentiment + 1) / 2) * 100)
              const barColor = person.label === 'positive'
                ? 'bg-green-400'
                : person.label === 'negative'
                  ? 'bg-red-400'
                  : 'bg-gray-300 dark:bg-gray-600'

              return (
                <div key={person.userId} className="flex items-center gap-3">
                  {person.avatar ? (
                    <img src={person.avatar} alt="" className="w-7 h-7 rounded-full" />
                  ) : (
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      AVATAR_COLORS[person.name.charCodeAt(0) % AVATAR_COLORS.length]
                    }`}>
                      {getInitials(person.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{person.name}</span>
                      {person.topThemes.slice(0, 2).map(theme => (
                        <span key={theme} className="text-[10px] text-gray-400 capitalize">{theme}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                      </div>
                      <span className={`text-xs font-medium ${sentColor} w-10 text-right`}>
                        {person.avgSentiment > 0 ? '+' : ''}{person.avgSentiment.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400">{person.messageCount} msgs</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Team Dashboard</h2>
        <p className="text-gray-500">
          Join an organization to see team rankings, achievements, and company-wide trends.
        </p>
      </div>
    </div>
  )
}
