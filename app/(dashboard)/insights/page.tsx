'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  TrendingUp, TrendingDown, Calendar, Target, Clock, AlertTriangle,
  BarChart3, Hash, Mail, PenLine, Lightbulb,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface CommitmentMetadata {
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  commitmentType?: 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'
  channelName?: string
  direction?: 'inbound' | 'outbound'
}

interface Commitment {
  id: string
  title: string
  status: string
  source: string | null
  due_date: string | null
  created_at: string
  completed_at: string | null
  priority_score: number
  creator_id: string | null
  assignee_id: string | null
  category: string | null
  metadata: CommitmentMetadata | null
}

interface InsightCard {
  icon: typeof TrendingUp
  title: string
  description: string
  recommendation: string
  type: 'positive' | 'warning' | 'danger'
}

interface CategoryStat {
  name: string
  total: number
  completed: number
  open: number
  overdue: number
  completionRate: number
}

// ── Helpers ─────────────────────────────────────────────────────

function getWeekStart(date: Date): string {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CATEGORY_COLORS: Record<string, string> = {
  deliverable: 'bg-indigo-500',
  meeting: 'bg-orange-500',
  follow_up: 'bg-violet-500',
  decision: 'bg-blue-500',
  review: 'bg-emerald-500',
  request: 'bg-amber-500',
}

function generateInsights(commitments: Commitment[]): InsightCard[] {
  const insights: InsightCard[] = []
  const completed = commitments.filter(c => c.status === 'completed')

  // 1. Overcommitment detection
  const weekMap = new Map<string, number>()
  commitments.forEach(c => {
    const week = getWeekStart(new Date(c.created_at))
    weekMap.set(week, (weekMap.get(week) || 0) + 1)
  })
  const weekCounts = Array.from(weekMap.values())
  if (weekCounts.length >= 3) {
    const avg = weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length
    const stdDev = Math.sqrt(weekCounts.reduce((sum, v) => sum + (v - avg) ** 2, 0) / weekCounts.length)
    const lastWeekCount = weekCounts[weekCounts.length - 1]
    if (lastWeekCount > avg + stdDev) {
      insights.push({
        icon: AlertTriangle,
        title: 'Overcommitment Alert',
        description: `You took on ${lastWeekCount} commitments last week — above your average of ${Math.round(avg)}.`,
        recommendation: `Try to keep under ${Math.round(avg + stdDev)} per week for sustainable follow-through.`,
        type: 'warning',
      })
    }
  }

  // 2. Day-of-week pattern
  const dayCreated = new Map<number, number>()
  const dayCompleted = new Map<number, { total: number; done: number }>()
  commitments.forEach(c => {
    const day = new Date(c.created_at).getDay()
    dayCreated.set(day, (dayCreated.get(day) || 0) + 1)
    const entry = dayCompleted.get(day) || { total: 0, done: 0 }
    entry.total++
    if (c.status === 'completed') entry.done++
    dayCompleted.set(day, entry)
  })
  let busiestDay = 0, busiestCount = 0, bestDay = -1, bestRate = 0
  dayCreated.forEach((count, day) => { if (count > busiestCount) { busiestCount = count; busiestDay = day } })
  dayCompleted.forEach((v, day) => {
    if (v.total >= 3) {
      const rate = v.done / v.total
      if (rate > bestRate) { bestRate = rate; bestDay = day }
    }
  })
  if (bestDay >= 0 && busiestDay !== bestDay) {
    insights.push({
      icon: Calendar,
      title: 'Day-of-Week Pattern',
      description: `You create most commitments on ${DAY_NAMES[busiestDay]}s, but your best follow-through is on ${DAY_NAMES[bestDay]}s (${Math.round(bestRate * 100)}%).`,
      recommendation: `Consider batching new commitments to ${DAY_NAMES[bestDay]}s when possible.`,
      type: 'positive',
    })
  }

  // 3. Category weakness
  const catMap = new Map<string, { total: number; completed: number }>()
  commitments.forEach(c => {
    const cat = c.category || c.metadata?.commitmentType || 'other'
    const entry = catMap.get(cat) || { total: 0, completed: 0 }
    entry.total++
    if (c.status === 'completed') entry.completed++
    catMap.set(cat, entry)
  })
  let weakestCat = '', weakestRate = 1, strongestCat = '', strongestRate = 0
  catMap.forEach((v, cat) => {
    if (v.total >= 3) {
      const rate = v.completed / v.total
      if (rate < weakestRate) { weakestRate = rate; weakestCat = cat }
      if (rate > strongestRate) { strongestRate = rate; strongestCat = cat }
    }
  })
  if (weakestCat && strongestCat && weakestCat !== strongestCat && strongestRate - weakestRate > 0.15) {
    insights.push({
      icon: Target,
      title: 'Category Gap',
      description: `Your "${weakestCat}" commitments have a ${Math.round(weakestRate * 100)}% completion rate vs ${Math.round(strongestRate * 100)}% for "${strongestCat}".`,
      recommendation: `Break "${weakestCat}" items into smaller, more actionable commitments.`,
      type: 'warning',
    })
  }

  // 4. Deadline impact
  const withDL = commitments.filter(c => c.due_date)
  const withoutDL = commitments.filter(c => !c.due_date)
  if (withDL.length >= 3 && withoutDL.length >= 3) {
    const dlRate = withDL.filter(c => c.status === 'completed').length / withDL.length
    const noDlRate = withoutDL.filter(c => c.status === 'completed').length / withoutDL.length
    if (dlRate > noDlRate + 0.1) {
      insights.push({
        icon: Clock,
        title: 'Deadlines Drive Results',
        description: `Commitments with deadlines are completed ${Math.round(dlRate * 100)}% of the time vs ${Math.round(noDlRate * 100)}% without.`,
        recommendation: 'Always set a due date — even a rough one — to boost follow-through.',
        type: 'positive',
      })
    }
  }

  // 5. Source effectiveness
  const srcMap = new Map<string, { total: number; completed: number }>()
  commitments.forEach(c => {
    const src = c.source || 'manual'
    const entry = srcMap.get(src) || { total: 0, completed: 0 }
    entry.total++
    if (c.status === 'completed') entry.completed++
    srcMap.set(src, entry)
  })
  let bestSrc = '', bestSrcRate = 0, worstSrc = '', worstSrcRate = 1
  srcMap.forEach((v, src) => {
    if (v.total >= 3) {
      const rate = v.completed / v.total
      if (rate > bestSrcRate) { bestSrcRate = rate; bestSrc = src }
      if (rate < worstSrcRate) { worstSrcRate = rate; worstSrc = src }
    }
  })
  if (bestSrc && worstSrc && bestSrc !== worstSrc && bestSrcRate - worstSrcRate > 0.15) {
    insights.push({
      icon: TrendingUp,
      title: 'Source Effectiveness',
      description: `Commitments from ${bestSrc} have a ${Math.round(bestSrcRate * 100)}% completion rate vs ${Math.round(worstSrcRate * 100)}% from ${worstSrc}.`,
      recommendation: `Pay extra attention to commitments coming from ${worstSrc}.`,
      type: 'positive',
    })
  }

  // 6. Aging analysis
  const sortedWeeks = Array.from(weekMap.keys()).sort()
  if (sortedWeeks.length >= 4 && completed.length >= 5) {
    const recentCompleted = completed.filter(c => {
      const week = getWeekStart(new Date(c.created_at))
      return sortedWeeks.slice(-2).includes(week)
    })
    const olderCompleted = completed.filter(c => {
      const week = getWeekStart(new Date(c.created_at))
      return sortedWeeks.slice(-4, -2).includes(week)
    })
    if (recentCompleted.length >= 2 && olderCompleted.length >= 2) {
      const recentAvg = recentCompleted.reduce((sum, c) => sum + daysBetween(c.created_at, c.completed_at || c.created_at), 0) / recentCompleted.length
      const olderAvg = olderCompleted.reduce((sum, c) => sum + daysBetween(c.created_at, c.completed_at || c.created_at), 0) / olderCompleted.length
      if (recentAvg < olderAvg - 0.5) {
        insights.push({
          icon: TrendingUp,
          title: 'Getting Faster',
          description: `Your average resolution time improved from ${olderAvg.toFixed(1)} days to ${recentAvg.toFixed(1)} days.`,
          recommendation: 'Great momentum — keep it up!',
          type: 'positive',
        })
      } else if (recentAvg > olderAvg + 0.5) {
        insights.push({
          icon: TrendingDown,
          title: 'Slowing Down',
          description: `Your average resolution time increased from ${olderAvg.toFixed(1)} days to ${recentAvg.toFixed(1)} days.`,
          recommendation: 'Consider using Triage mode to clear your backlog.',
          type: 'danger',
        })
      }
    }
  }

  return insights.slice(0, 5)
}

function getCategoryStats(commitments: Commitment[]): CategoryStat[] {
  const map = new Map<string, CategoryStat>()
  commitments.forEach(c => {
    const name = c.category || c.metadata?.commitmentType || 'other'
    const entry = map.get(name) || { name, total: 0, completed: 0, open: 0, overdue: 0, completionRate: 0 }
    entry.total++
    if (c.status === 'completed') entry.completed++
    else if (c.status === 'overdue') entry.overdue++
    else entry.open++
    map.set(name, entry)
  })
  const stats = Array.from(map.values())
  stats.forEach(s => { s.completionRate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0 })
  stats.sort((a, b) => b.total - a.total)
  return stats
}

function getTimeDistribution(commitments: Commitment[]): Array<{ label: string; count: number }> {
  const buckets = [
    { label: 'Same day', max: 1, count: 0 },
    { label: '1-2 days', max: 3, count: 0 },
    { label: '3-5 days', max: 6, count: 0 },
    { label: '1-2 weeks', max: 15, count: 0 },
    { label: '2+ weeks', max: Infinity, count: 0 },
  ]
  commitments
    .filter(c => c.status === 'completed' && c.completed_at)
    .forEach(c => {
      const days = daysBetween(c.created_at, c.completed_at!)
      const bucket = buckets.find(b => days < b.max)
      if (bucket) bucket.count++
    })
  return buckets
}

// ── Component ───────────────────────────────────────────────────

export default function InsightsPage() {
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
          .select('*')
          .eq('team_id', profile.current_team_id)
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .order('created_at', { ascending: false })
          .limit(1000)

        if (fetchError) throw fetchError
        setCommitments(data || [])
      } catch (err) {
        console.error('Error loading insights data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        toast.error('Failed to load insights')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <LoadingSkeleton variant="dashboard" />

  const completed = commitments.filter(c => c.status === 'completed')
  const avgDaysToComplete = completed.length > 0
    ? completed.reduce((sum, c) => sum + daysBetween(c.created_at, c.completed_at || c.created_at), 0) / completed.length
    : 0
  const onTimeCount = completed.filter(c => c.due_date && c.completed_at && new Date(c.completed_at) <= new Date(c.due_date)).length
  const withDueDateCompleted = completed.filter(c => c.due_date).length
  const onTimeRate = withDueDateCompleted > 0 ? Math.round((onTimeCount / withDueDateCompleted) * 100) : 100

  // Most active day
  const dayCount = new Map<number, number>()
  commitments.forEach(c => {
    const day = new Date(c.created_at).getDay()
    dayCount.set(day, (dayCount.get(day) || 0) + 1)
  })
  let mostActiveDay = 'N/A'
  let maxDayCount = 0
  dayCount.forEach((count, day) => { if (count > maxDayCount) { maxDayCount = count; mostActiveDay = DAY_NAMES[day] } })

  const insights = generateInsights(commitments)
  const categoryStats = getCategoryStats(commitments)
  const timeDist = getTimeDistribution(commitments)
  const maxTimeDist = Math.max(...timeDist.map(b => b.count), 1)

  // Weekly heatmap (last 12 weeks)
  const weeklyActivity: Array<{ week: string; created: number; completed: number }> = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    const week = getWeekStart(d)
    const created = commitments.filter(c => getWeekStart(new Date(c.created_at)) === week).length
    const done = commitments.filter(c => c.completed_at && getWeekStart(new Date(c.completed_at)) === week).length
    weeklyActivity.push({ week, created, completed: done })
  }
  const maxActivity = Math.max(...weeklyActivity.flatMap(w => [w.created, w.completed]), 1)

  const maxCategoryTotal = Math.max(...categoryStats.map(c => c.total), 1)

  const insightStyles = {
    positive: 'bg-green-50 dark:bg-green-900/10 border-l-green-500',
    warning: 'bg-amber-50 dark:bg-amber-900/10 border-l-amber-500',
    danger: 'bg-red-50 dark:bg-red-900/10 border-l-red-500',
  }
  const insightIconColors = {
    positive: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
  }

  return (
    <UpgradeGate featureKey="insights">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Insights</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Behavioral patterns and actionable insights from your commitment history
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
              <Lightbulb className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Not enough data yet</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              Keep using HeyWren! Insights will appear once you have more commitment history.
            </p>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Analyzed</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{commitments.length}</p>
              </div>
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Avg Days to Complete</p>
                <p className="text-2xl font-bold text-indigo-600">{avgDaysToComplete.toFixed(1)}</p>
              </div>
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">On-Time Rate</p>
                <p className={`text-2xl font-bold ${onTimeRate >= 80 ? 'text-green-600' : onTimeRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{onTimeRate}%</p>
              </div>
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Most Active Day</p>
                <p className="text-2xl font-bold text-violet-600">{mostActiveDay}</p>
              </div>
            </div>

            {/* Key Insights */}
            {insights.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Lightbulb aria-hidden="true" className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Key Insights</h2>
                </div>
                {insights.map((insight, i) => {
                  const Icon = insight.icon
                  return (
                    <div
                      key={i}
                      className={`border-l-4 rounded-xl p-4 border border-gray-200 dark:border-gray-700 ${insightStyles[insight.type]}`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon aria-hidden="true" className={`w-5 h-5 mt-0.5 flex-shrink-0 ${insightIconColors[insight.type]}`} />
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{insight.title}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{insight.description}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">{insight.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Weekly activity heatmap */}
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 aria-hidden="true" className="w-5 h-5 text-indigo-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Weekly Activity</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400 w-16 text-right mr-2">Created</span>
                  {weeklyActivity.map(w => {
                    const intensity = maxActivity > 0 ? w.created / maxActivity : 0
                    return (
                      <div
                        key={`c-${w.week}`}
                        className="flex-1 h-8 rounded"
                        style={{ backgroundColor: `rgba(99, 102, 241, ${Math.max(intensity, 0.05)})` }}
                        title={`Week of ${w.week}: ${w.created} created`}
                      />
                    )
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400 w-16 text-right mr-2">Completed</span>
                  {weeklyActivity.map(w => {
                    const intensity = maxActivity > 0 ? w.completed / maxActivity : 0
                    return (
                      <div
                        key={`d-${w.week}`}
                        className="flex-1 h-8 rounded"
                        style={{ backgroundColor: `rgba(16, 185, 129, ${Math.max(intensity, 0.05)})` }}
                        title={`Week of ${w.week}: ${w.completed} completed`}
                      />
                    )
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-16 mr-2" />
                  {weeklyActivity.map((w, i) => (
                    <span key={w.week} className="flex-1 text-center text-[8px] text-gray-400 dark:text-gray-500">
                      {i % 3 === 0 ? new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Category breakdown */}
            {categoryStats.length > 0 && (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Target aria-hidden="true" className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">By Category</h2>
                </div>
                <div className="space-y-3">
                  {categoryStats.map(cat => (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{cat.name.replace('_', ' ')}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{cat.completionRate}% complete ({cat.total} total)</span>
                      </div>
                      <div className="w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
                        <div
                          className="h-full bg-green-500 transition-all duration-300"
                          style={{ width: `${(cat.completed / maxCategoryTotal) * 100}%` }}
                          title={`${cat.completed} completed`}
                        />
                        <div
                          className="h-full bg-indigo-400 transition-all duration-300"
                          style={{ width: `${(cat.open / maxCategoryTotal) * 100}%` }}
                          title={`${cat.open} open`}
                        />
                        <div
                          className="h-full bg-red-400 transition-all duration-300"
                          style={{ width: `${(cat.overdue / maxCategoryTotal) * 100}%` }}
                          title={`${cat.overdue} overdue`}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-4 pt-2 text-[10px] text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Completed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400" /> Open</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Overdue</span>
                  </div>
                </div>
              </div>
            )}

            {/* Time-to-complete distribution */}
            {completed.length >= 3 && (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Clock aria-hidden="true" className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Time to Complete</h2>
                </div>
                <div className="flex items-end gap-3 h-32">
                  {timeDist.map(bucket => {
                    const height = maxTimeDist > 0 ? (bucket.count / maxTimeDist) * 100 : 0
                    const isMax = bucket.count === maxTimeDist && bucket.count > 0
                    return (
                      <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{bucket.count}</span>
                        <div
                          className={`w-full rounded-t-md transition-all duration-300 ${
                            isMax
                              ? 'bg-gradient-to-t from-indigo-600 to-violet-500'
                              : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 text-center">{bucket.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
