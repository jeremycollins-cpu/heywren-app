'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, TrendingDown, Minus, Clock, Target, BarChart3, Award, Lock, ShieldCheck } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Commitment {
  id: string
  status: string
  due_date: string | null
  created_at: string
  completed_at: string | null
  priority_score: number
  creator_id: string | null
  assignee_id: string | null
}

interface ScoreBreakdown {
  completionRate: number
  timelinessRate: number
  responsivenessScore: number
  consistencyScore: number
  overall: number
}

interface WeeklyScore {
  weekStart: string
  score: number
  completed: number
  created: number
}

interface Insight {
  text: string
  positive: boolean
}

interface Badge {
  name: string
  description: string
  icon: string
  earned: boolean
}

// ── Calculation helpers ─────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function calculateScore(commitments: Commitment[]): ScoreBreakdown {
  if (commitments.length === 0) {
    return { completionRate: 0, timelinessRate: 0, responsivenessScore: 0, consistencyScore: 0, overall: 0 }
  }

  const completed = commitments.filter(c => c.status === 'completed')
  const terminal = commitments.filter(c => ['completed', 'dropped', 'overdue'].includes(c.status))

  // Completion rate (40%)
  const completionRate = terminal.length > 0 ? (completed.length / terminal.length) * 100 : 100

  // Timeliness (30%) — % completed before due date
  const withDueDate = completed.filter(c => c.due_date && c.completed_at)
  let timelinessRate = 100
  if (withDueDate.length > 0) {
    const onTime = withDueDate.filter(c => new Date(c.completed_at!) <= new Date(c.due_date!))
    timelinessRate = (onTime.length / withDueDate.length) * 100
  }

  // Responsiveness (20%) — avg days to complete, mapped to 0-100
  let responsivenessScore = 50
  if (completed.length > 0) {
    const avgDays = completed.reduce((sum, c) => {
      const days = (new Date(c.completed_at || c.created_at).getTime() - new Date(c.created_at).getTime()) / 86400000
      return sum + days
    }, 0) / completed.length
    responsivenessScore = Math.max(0, Math.min(100, 100 - avgDays * 5))
  }

  // Consistency (10%) — low variance in weekly completions
  const weeklyMap = new Map<string, number>()
  completed.forEach(c => {
    const week = getWeekStart(new Date(c.completed_at || c.created_at))
    weeklyMap.set(week, (weeklyMap.get(week) || 0) + 1)
  })
  let consistencyScore = 50
  if (weeklyMap.size > 1) {
    const vals = Array.from(weeklyMap.values())
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length
    const stdDev = Math.sqrt(variance)
    consistencyScore = Math.max(0, Math.min(100, 100 - stdDev * 10))
  }

  const overall = Math.round(
    completionRate * 0.4 + timelinessRate * 0.3 + responsivenessScore * 0.2 + consistencyScore * 0.1
  )

  return {
    completionRate: Math.round(completionRate),
    timelinessRate: Math.round(timelinessRate),
    responsivenessScore: Math.round(responsivenessScore),
    consistencyScore: Math.round(consistencyScore),
    overall: Math.max(0, Math.min(100, overall)),
  }
}

function calculateWeeklyScores(commitments: Commitment[]): WeeklyScore[] {
  const weekMap = new Map<string, { completed: number; created: number; all: Commitment[] }>()

  // Seed last 8 weeks
  for (let i = 7; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    const week = getWeekStart(d)
    if (!weekMap.has(week)) weekMap.set(week, { completed: 0, created: 0, all: [] })
  }

  commitments.forEach(c => {
    const createdWeek = getWeekStart(new Date(c.created_at))
    if (weekMap.has(createdWeek)) {
      weekMap.get(createdWeek)!.created++
      weekMap.get(createdWeek)!.all.push(c)
    }
    if (c.completed_at) {
      const completedWeek = getWeekStart(new Date(c.completed_at))
      if (weekMap.has(completedWeek)) {
        weekMap.get(completedWeek)!.completed++
      }
    }
  })

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([weekStart, data]) => {
      const weekScore = data.all.length > 0 ? calculateScore(data.all).overall : 0
      return { weekStart, score: weekScore, completed: data.completed, created: data.created }
    })
}

function generateInsights(commitments: Commitment[], currentScore: ScoreBreakdown, weeklyScores: WeeklyScore[]): Insight[] {
  const insights: Insight[] = []

  // Trend comparison
  if (weeklyScores.length >= 2) {
    const last = weeklyScores[weeklyScores.length - 1]
    const prev = weeklyScores[weeklyScores.length - 2]
    if (last.score > prev.score) {
      insights.push({ text: `Your score improved from ${prev.score} to ${last.score} this week.`, positive: true })
    } else if (last.score < prev.score) {
      insights.push({ text: `Your score dipped from ${prev.score} to ${last.score} this week.`, positive: false })
    }
  }

  // Deadline impact
  const withDeadline = commitments.filter(c => c.due_date)
  const withoutDeadline = commitments.filter(c => !c.due_date)
  if (withDeadline.length >= 3 && withoutDeadline.length >= 3) {
    const dlRate = withDeadline.filter(c => c.status === 'completed').length / withDeadline.length
    const noDlRate = withoutDeadline.filter(c => c.status === 'completed').length / withoutDeadline.length
    if (dlRate > noDlRate + 0.1) {
      insights.push({ text: `Commitments with deadlines are completed ${Math.round((dlRate / Math.max(noDlRate, 0.01)) * 10) / 10}x more often.`, positive: true })
    }
  }

  // Best day
  const dayMap = new Map<number, { total: number; completed: number }>()
  commitments.forEach(c => {
    const day = new Date(c.created_at).getDay()
    const entry = dayMap.get(day) || { total: 0, completed: 0 }
    entry.total++
    if (c.status === 'completed') entry.completed++
    dayMap.set(day, entry)
  })
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  let bestDay = -1, bestRate = 0
  dayMap.forEach((v, k) => {
    if (v.total >= 3) {
      const rate = v.completed / v.total
      if (rate > bestRate) { bestRate = rate; bestDay = k }
    }
  })
  if (bestDay >= 0) {
    insights.push({ text: `Your strongest follow-through day is ${days[bestDay]}.`, positive: true })
  }

  return insights.slice(0, 3)
}

function calculateBadges(commitments: Commitment[], score: number): Badge[] {
  const completed = commitments.filter(c => c.status === 'completed').length
  return [
    { name: 'First Steps', description: 'Complete your first commitment', icon: '🎯', earned: completed >= 1 },
    { name: 'Score 80+', description: 'Reach a Wren Score of 80', icon: '⭐', earned: score >= 80 },
    { name: 'Score 90+', description: 'Reach a Wren Score of 90', icon: '🏆', earned: score >= 90 },
    { name: 'Centurion', description: 'Complete 100 commitments', icon: '💯', earned: completed >= 100 },
    { name: 'Reliable', description: 'Complete 25 commitments', icon: '🤝', earned: completed >= 25 },
    { name: 'Prolific', description: 'Complete 50 commitments', icon: '🚀', earned: completed >= 50 },
  ]
}

function scoreLabel(score: number): { text: string; color: string } {
  if (score >= 90) return { text: 'Excellent', color: 'text-green-600 dark:text-green-400' }
  if (score >= 70) return { text: 'Strong', color: 'text-indigo-600 dark:text-indigo-400' }
  if (score >= 50) return { text: 'Needs Attention', color: 'text-amber-600 dark:text-amber-400' }
  return { text: 'At Risk', color: 'text-red-600 dark:text-red-400' }
}

function scoreRingColor(score: number): string {
  if (score >= 90) return '#16a34a'
  if (score >= 70) return '#4f46e5'
  if (score >= 50) return '#d97706'
  return '#dc2626'
}

// ── Component ───────────────────────────────────────────────────

export default function WrenScorePage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setLoading(false); return }

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        if (!profile?.current_team_id) { setLoading(false); return }

        const { data, error: fetchError } = await supabase
          .from('commitments')
          .select('id, status, due_date, created_at, completed_at, priority_score, creator_id, assignee_id')
          .eq('team_id', profile.current_team_id)
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1000)

        if (fetchError) throw fetchError
        setCommitments(data || [])
      } catch (err) {
        console.error('Error loading wren score data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        toast.error('Failed to load Wren Score data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSkeleton variant="dashboard" />

  const score = calculateScore(commitments)
  const weeklyScores = calculateWeeklyScores(commitments)
  const insights = generateInsights(commitments, score, weeklyScores)
  const badges = calculateBadges(commitments, score.overall)
  const label = scoreLabel(score.overall)
  const maxWeeklyScore = Math.max(...weeklyScores.map(w => w.score), 1)

  // Trend arrow
  let TrendIcon = Minus
  let trendColor = 'text-gray-400'
  if (weeklyScores.length >= 2) {
    const last = weeklyScores[weeklyScores.length - 1].score
    const prev = weeklyScores[weeklyScores.length - 2].score
    if (last > prev) { TrendIcon = TrendingUp; trendColor = 'text-green-500' }
    else if (last < prev) { TrendIcon = TrendingDown; trendColor = 'text-red-500' }
  }

  const ringRadius = 70
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference - (score.overall / 100) * ringCircumference

  return (
    <UpgradeGate featureKey="wren_score">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Wren Score</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Your personal reliability index — track how consistently you follow through
          </p>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
            <span className="text-sm font-medium">{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
          </div>
        )}

        {commitments.length < 5 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <Target className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Not enough data yet</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              Keep using HeyWren! Your Wren Score will appear once you have at least 5 commitments in your history.
            </p>
          </div>
        ) : (
          <>
            {/* Hero Score */}
            <div className="flex flex-col items-center py-6">
              <div className="relative w-48 h-48">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r={ringRadius} fill="none" strokeWidth="8"
                    className="stroke-gray-200 dark:stroke-gray-700" />
                  <circle cx="80" cy="80" r={ringRadius} fill="none" strokeWidth="8"
                    stroke={scoreRingColor(score.overall)}
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    className="transition-all duration-1000 ease-out" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-bold text-gray-900 dark:text-white">{score.overall}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendIcon aria-hidden="true" className={`w-4 h-4 ${trendColor}`} />
                    <span className={`text-sm font-semibold ${label.color}`}>{label.text}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Score breakdown */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Completion Rate', value: score.completionRate, weight: '40%', icon: Target, color: 'indigo' },
                { label: 'Timeliness', value: score.timelinessRate, weight: '30%', icon: Clock, color: 'violet' },
                { label: 'Responsiveness', value: score.responsivenessScore, weight: '20%', icon: TrendingUp, color: 'blue' },
                { label: 'Consistency', value: score.consistencyScore, weight: '10%', icon: BarChart3, color: 'emerald' },
              ].map(item => (
                <div key={item.label} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <item.icon aria-hidden="true" className={`w-4 h-4 text-${item.color}-500`} />
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">{item.weight}</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{item.value}%</p>
                  <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-${item.color}-500 transition-all duration-500`}
                      style={{ width: `${item.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Weekly trend */}
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Weekly Trend</h2>
              <div className="flex items-end gap-2 h-32">
                {weeklyScores.map((week, i) => {
                  const isLast = i === weeklyScores.length - 1
                  const height = maxWeeklyScore > 0 ? (week.score / maxWeeklyScore) * 100 : 0
                  const weekLabel = new Date(week.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  return (
                    <div key={week.weekStart} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{week.score}</span>
                      <div
                        className={`w-full rounded-t-md transition-all duration-300 ${
                          isLast
                            ? 'bg-gradient-to-t from-indigo-600 to-violet-500'
                            : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`Week of ${weekLabel}: Score ${week.score}`}
                      />
                      <span className="text-[9px] text-gray-400 dark:text-gray-500">{weekLabel}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Insights */}
            {insights.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Insights</h2>
                {insights.map((insight, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-4 rounded-xl border ${
                      insight.positive
                        ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/50'
                        : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50'
                    }`}
                  >
                    <span className={`mt-0.5 ${insight.positive ? 'text-green-600' : 'text-amber-600'}`}>
                      {insight.positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    </span>
                    <p className={`text-sm font-medium ${
                      insight.positive
                        ? 'text-green-800 dark:text-green-300'
                        : 'text-amber-800 dark:text-amber-300'
                    }`}>{insight.text}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Badges */}
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Milestones</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {badges.map(badge => (
                  <div
                    key={badge.name}
                    className={`flex flex-col items-center text-center p-4 rounded-xl border transition ${
                      badge.earned
                        ? 'bg-white dark:bg-surface-dark-secondary border-indigo-200 dark:border-indigo-800'
                        : 'bg-gray-50 dark:bg-surface-dark border-gray-200 dark:border-border-dark opacity-50'
                    }`}
                  >
                    <span className="text-2xl mb-2" aria-hidden="true">{badge.earned ? badge.icon : '🔒'}</span>
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">{badge.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{badge.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Privacy notice */}
            <div className="flex items-center gap-2 justify-center text-xs text-gray-400 dark:text-gray-500 pt-4">
              <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Your Wren Score is private. Only you can see it.</span>
            </div>
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
