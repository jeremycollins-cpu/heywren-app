// app/(dashboard)/coach/page.tsx
// Executive Coach v5 — Interactive insights with accept, dismiss, and progress tracking

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, X, Target, TrendingUp, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  created_at: string
  updated_at: string
}

interface Insight {
  id: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'GROWTH'
  title: string
  description: string
  action: string
  link?: { href: string; label: string }
  metric?: { value: string | number; label: string }
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function generateInsights(commitments: Commitment[]): Insight[] {
  const insights: Insight[] = []
  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const stale = open.filter(c => daysSince(c.created_at) > 7)
  const veryStale = open.filter(c => daysSince(c.created_at) > 14)
  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0
  const thisWeek = commitments.filter(c => daysSince(c.created_at) <= 7)

  if (veryStale.length >= 3) {
    insights.push({
      id: 'backlog',
      priority: 'CRITICAL',
      title: 'Commitment backlog building',
      description: `${veryStale.length} commitments have gone 14+ days without resolution. This erodes team trust over time.`,
      action: 'Block 30 minutes to triage your oldest commitments. Close what\'s done, delegate what you can.',
      link: { href: '/commitments', label: 'Triage now' },
      metric: { value: veryStale.length, label: 'items 14+ days old' },
    })
  }

  if (open.length > 50 && completed.length === 0) {
    insights.push({
      id: 'zero-followthrough',
      priority: 'CRITICAL',
      title: 'Zero follow-through detected',
      description: `${open.length} tracked commitments but none marked complete. Start closing items to establish your baseline.`,
      action: 'Mark your 5 most recent done items as complete to build your score.',
      link: { href: '/commitments', label: 'Mark items complete' },
      metric: { value: open.length, label: 'open items' },
    })
  }

  if (stale.length >= 5) {
    insights.push({
      id: 'stale',
      priority: 'HIGH',
      title: `${stale.length} items stale for 7+ days`,
      description: `Research shows commitments not acted on within 7 days have a 60% lower completion rate. Review and update or close.`,
      action: 'Set a concrete next step for each stale item, or close with a status update to stakeholders.',
      link: { href: '/commitments', label: 'Review stale items' },
      metric: { value: stale.length, label: 'stale items' },
    })
  }

  if (slackCount > 0 && outlookCount > 0 && Math.abs(slackCount - outlookCount) / Math.max(slackCount, outlookCount) > 0.7) {
    const dominant = slackCount > outlookCount ? 'Slack' : 'Outlook'
    const weak = slackCount > outlookCount ? 'Outlook' : 'Slack'
    insights.push({
      id: 'source-imbalance',
      priority: 'HIGH',
      title: 'Imbalanced source coverage',
      description: `${Math.round(Math.max(slackCount, outlookCount) / commitments.length * 100)}% of commitments come from ${dominant}. You may be missing ${weak} commitments.`,
      action: `Review recent ${weak} conversations and run a backfill sync.`,
      link: { href: '/sync', label: `Sync ${weak}` },
      metric: { value: `${Math.round(Math.max(slackCount, outlookCount) / commitments.length * 100)}%`, label: `from ${dominant}` },
    })
  }

  if (followThrough < 30 && commitments.length > 10) {
    insights.push({
      id: 'low-followthrough',
      priority: 'HIGH',
      title: 'Follow-through below threshold',
      description: `${followThrough}% follow-through. High-performing leaders maintain 70%+. Every completed item builds momentum.`,
      action: 'Set a goal to complete 3 commitments this week. Start with quick wins.',
      link: { href: '/commitments', label: 'Find quick wins' },
      metric: { value: `${followThrough}%`, label: 'follow-through' },
    })
  }

  if (thisWeek.length > 15) {
    insights.push({
      id: 'high-volume',
      priority: 'MEDIUM',
      title: 'High volume week',
      description: `${thisWeek.length} new commitments this week. Above average — could lead to overcommitment if not managed.`,
      action: 'Prioritize the top 5 and delegate or defer the rest.',
      metric: { value: thisWeek.length, label: 'this week' },
    })
  }

  if (open.length > 0 && stale.length / open.length > 0.5) {
    insights.push({
      id: 'velocity',
      priority: 'MEDIUM',
      title: 'Commitment velocity declining',
      description: 'More than half your open items are over a week old. Close 2 items for every 1 new commitment this week.',
      action: 'Aim to reduce your backlog by 20% this week.',
      metric: { value: `${Math.round(stale.length / open.length * 100)}%`, label: 'items stale' },
    })
  }

  if (followThrough >= 70) {
    insights.push({
      id: 'strong-momentum',
      priority: 'GROWTH',
      title: 'Strong follow-through momentum',
      description: `${followThrough}% puts you in the top tier. Maintaining this consistency is what separates great leaders.`,
      action: 'Challenge yourself to increase total commitment volume by 20% next week while keeping this rate.',
      metric: { value: `${followThrough}%`, label: 'follow-through' },
    })
  }

  if (commitments.length < 20) {
    insights.push({
      id: 'baseline',
      priority: 'GROWTH',
      title: 'Building your commitment baseline',
      description: `${commitments.length} items tracked so far. The first 50 establish your baseline for better coaching.`,
      action: 'Keep using @HeyWren in Slack and ensure both Slack and Outlook are syncing.',
      link: { href: '/sync', label: 'Check sync status' },
      metric: { value: commitments.length, label: 'items tracked' },
    })
  }

  if (slackCount > 0 && outlookCount === 0) {
    insights.push({
      id: 'expand-sources',
      priority: 'GROWTH',
      title: 'Expand your commitment sources',
      description: 'Only tracking Slack. Many critical commitments happen over email — connect Outlook for a complete picture.',
      action: 'Connect your Outlook account.',
      link: { href: '/integrations', label: 'Connect Outlook' },
    })
  }

  if (insights.length === 0) {
    insights.push({
      id: 'getting-started',
      priority: 'GROWTH',
      title: 'Getting started with Wren',
      description: 'Connect your tools and start tracking commitments to unlock personalized coaching.',
      action: 'Tag @HeyWren in your next Slack conversation where someone makes a commitment.',
      link: { href: '/integrations', label: 'Connect tools' },
    })
  }

  return insights
}

const priorityConfig = {
  CRITICAL: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400', dot: 'bg-red-500', icon: AlertTriangle },
  HIGH: { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400', dot: 'bg-orange-500', icon: Target },
  MEDIUM: { border: 'border-l-yellow-500', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400', dot: 'bg-yellow-500', icon: TrendingUp },
  GROWTH: { border: 'border-l-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400', dot: 'bg-green-500', icon: Sparkles },
}

export default function CoachPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set())

  // Load persisted state from localStorage
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem('coach-dismissed')
      const accepted = localStorage.getItem('coach-accepted')
      if (dismissed) setDismissedIds(new Set(JSON.parse(dismissed)))
      if (accepted) setAcceptedIds(new Set(JSON.parse(accepted)))
    } catch {}
  }, [])

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

        const teamId = profile?.current_team_id
        if (!teamId) { setLoading(false); return }

        const { data, error: fetchError } = await supabase
          .from('commitments')
          .select('*')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })

        if (fetchError) throw fetchError
        if (data) setCommitments(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load coaching insights'
        setError(message)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const dismissInsight = (id: string) => {
    const next = new Set(dismissedIds)
    next.add(id)
    setDismissedIds(next)
    localStorage.setItem('coach-dismissed', JSON.stringify([...next]))
    toast('Insight dismissed', { icon: '\u{1F44D}' })
  }

  const acceptInsight = (id: string) => {
    const next = new Set(acceptedIds)
    next.add(id)
    setAcceptedIds(next)
    localStorage.setItem('coach-accepted', JSON.stringify([...next]))
    toast.success('Challenge accepted! Track your progress this week.')
  }

  const resetDismissed = () => {
    setDismissedIds(new Set())
    setAcceptedIds(new Set())
    localStorage.removeItem('coach-dismissed')
    localStorage.removeItem('coach-accepted')
  }

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading coaching insights">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded"></div>)}
        </div>
      </div>
    )
  }

  const allInsights = generateInsights(commitments)
  const activeInsights = allInsights.filter(i => !dismissedIds.has(i.id))
  const acceptedInsights = activeInsights.filter(i => acceptedIds.has(i.id))
  const pendingInsights = activeInsights.filter(i => !acceptedIds.has(i.id))
  const dismissedCount = allInsights.length - activeInsights.length

  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const stale = open.filter(c => daysSince(c.created_at) > 7)
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0

  const watchingFor: string[] = []
  if (stale.length > 3) watchingFor.push('Stale patterns')
  if (completed.length === 0) watchingFor.push('Completion gaps')
  if (open.length > 30) watchingFor.push('Over-commitment')
  if (watchingFor.length === 0) watchingFor.push('Building baseline')

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Executive Coach</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Personalized insights based on your real behavioral patterns</p>
      </div>

      {/* Score overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Follow-through</p>
          <p className={`text-2xl font-bold ${followThrough >= 70 ? 'text-green-600' : followThrough >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{followThrough}%</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{followThrough >= 70 ? 'Top tier' : followThrough >= 40 ? 'Room to grow' : 'Needs work'}</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Open Items</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{open.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{stale.length} stale 7+ days</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Completed</p>
          <p className="text-2xl font-bold text-green-600">{completed.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">all time</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Active Insights</p>
          <p className="text-2xl font-bold text-indigo-600">{activeInsights.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{acceptedInsights.length} accepted</p>
        </div>
      </div>

      {/* Coach Header Card */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-violet-950/50 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Wren Coach</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Watching: {watchingFor.join(' \u00B7 ')}
              </div>
            </div>
          </div>
          {dismissedCount > 0 && (
            <button
              onClick={resetDismissed}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Show {dismissedCount} dismissed
            </button>
          )}
        </div>
      </div>

      {/* Accepted challenges */}
      {acceptedInsights.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-indigo-600" />
            Your Active Challenges
          </h2>
          <div className="space-y-2">
            {acceptedInsights.map(insight => {
              const config = priorityConfig[insight.priority]
              return (
                <div key={insight.id} className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800/50 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{insight.title}</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">{insight.action}</p>
                  </div>
                  {insight.metric && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{insight.metric.value}</p>
                      <p className="text-[10px] text-gray-400">{insight.metric.label}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pending Insights */}
      <div className="space-y-4">
        {pendingInsights.map(insight => {
          const config = priorityConfig[insight.priority]
          const PriorityIcon = config.icon
          return (
            <article key={insight.id} className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${config.border} rounded-xl p-5`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${config.badge}`}>
                    {insight.priority}
                  </span>
                  {insight.metric && (
                    <span className="text-xs text-gray-400">
                      {insight.metric.value} {insight.metric.label}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => dismissInsight(insight.id)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded"
                  title="Dismiss this insight"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-bold text-gray-900 dark:text-white text-base mb-2">{insight.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{insight.description}</p>

              <div className="bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg p-3 mb-3">
                <div className="flex items-start gap-2">
                  <PriorityIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700 dark:text-gray-300">{insight.action}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => acceptInsight(insight.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  <Target className="w-3.5 h-3.5" />
                  Accept Challenge
                </button>
                {insight.link && (
                  <Link
                    href={insight.link.href}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {insight.link.label}
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {pendingInsights.length === 0 && acceptedInsights.length === 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">All caught up!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {dismissedCount > 0
              ? `You've dismissed ${dismissedCount} insight${dismissedCount > 1 ? 's' : ''}. New insights generate weekly based on your latest patterns.`
              : 'New insights will appear as Wren learns more about your patterns.'}
          </p>
        </div>
      )}
    </div>
  )
}
