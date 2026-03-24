// app/(dashboard)/page.tsx
// Dashboard v6 — Refactored with Zustand store + extracted components

'use client'

import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useDashboardStore } from '@/lib/stores/dashboard-store'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { AlertBanner } from '@/components/ui/alert-banner'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { HeroStats } from '@/components/dashboard/hero-stats'
import { ForecastSection } from '@/components/dashboard/forecast-section'
import { MentionsSection } from '@/components/dashboard/mentions-section'
import { NudgeCard } from '@/components/dashboard/nudge-card'
import { TodaysFocus } from '@/components/dashboard/todays-focus'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function isThisWeek(dateStr: string): boolean {
  return daysSince(dateStr) <= 7
}

function getAvgScore(commitments: { status: string; created_at: string; source: string | null }[]): number {
  if (commitments.length === 0) return 0
  let total = 0
  commitments.forEach(c => {
    let score = 50
    if (c.status === 'completed') score += 30
    if (c.status === 'open' && daysSince(c.created_at) <= 3) score += 10
    if (c.status === 'open' && daysSince(c.created_at) > 7) score -= 20
    if (c.source === 'slack') score += 5
    if (c.source === 'outlook') score += 5
    total += Math.max(0, Math.min(100, score))
  })
  return Math.round(total / commitments.length)
}

export default function DashboardPage() {
  const {
    commitments, mentions, integrationCount,
    loading, error,
    fetchDashboard, markDone, snooze, dismiss, clearError,
  } = useDashboardStore()

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  if (loading) return <LoadingSkeleton />

  const openCommitments = commitments.filter(c => c.status === 'open')
  const completedCommitments = commitments.filter(c => c.status === 'completed')
  const urgentCount = commitments.filter(c => c.status === 'open' && daysSince(c.created_at) > 5).length
  const overdueCount = commitments.filter(c => c.status === 'overdue').length
  const avgScore = getAvgScore(commitments)
  const staleItems = openCommitments.filter(c => daysSince(c.created_at) > 7).length
  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length

  const anomalies: { type: string; message: string }[] = []
  if (urgentCount > 2) {
    anomalies.push({ type: 'Response gap', message: `${urgentCount} commitments have been open for over 5 days without updates` })
  }
  if (openCommitments.length > 20 && completedCommitments.length === 0) {
    anomalies.push({ type: 'Completion gap', message: `${openCommitments.length} open commitments but none completed. Consider closing resolved items.` })
  }
  if (slackCount > 0 && outlookCount === 0 && integrationCount < 2) {
    anomalies.push({ type: 'Single source', message: 'All commitments are from Slack. Connect Outlook to get a complete picture.' })
  }

  if (commitments.length === 0 && mentions.length === 0 && integrationCount === 0) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-6 animate-fade-in-up">
        <PageHeader title="Welcome to HeyWren" description="Let's get your AI follow-through engine running" />

        {/* Getting Started Hero */}
        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
              <span className="text-3xl text-white" aria-hidden="true">W</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connect a tool to get started</h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
              Wren watches your Slack messages and Outlook emails to automatically detect commitments. Connect your first tool and results appear within minutes.
            </p>
          </div>

          {/* Quick value props */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-4 text-center">
              <p className="text-2xl mb-1" aria-hidden="true">1</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Connect Slack or Email</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Takes less than 60 seconds</p>
            </div>
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-4 text-center">
              <p className="text-2xl mb-1" aria-hidden="true">2</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Wren scans your messages</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">AI finds promises and follow-ups</p>
            </div>
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-4 text-center">
              <p className="text-2xl mb-1" aria-hidden="true">3</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Never drop the ball</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Get nudges before things slip</p>
            </div>
          </div>

          <div className="text-center">
            <a
              href="/integrations"
              className="inline-flex items-center gap-2 px-6 py-3 text-white font-semibold rounded-xl text-sm transition hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 8px 24px rgba(79, 70, 229, 0.3)',
              }}
            >
              Connect Slack or Outlook
            </a>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Quick tips to get value faster</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold flex-shrink-0" aria-hidden="true">1</span>
              <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-900 dark:text-white">Connect both Slack and email</span> for a complete picture of your commitments across all channels.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold flex-shrink-0" aria-hidden="true">2</span>
              <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-900 dark:text-white">Select your most active Slack channels</span> so Wren focuses on conversations that matter most.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold flex-shrink-0" aria-hidden="true">3</span>
              <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-900 dark:text-white">Rate alerts as helpful or not</span> to train Wren on what matters to you.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (commitments.length === 0 && integrationCount > 0) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-6 animate-fade-in-up">
        <PageHeader title="Wren is scanning your messages..." description={`${integrationCount} tool${integrationCount > 1 ? 's' : ''} connected`} />
        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Analyzing your conversations</h3>
          <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
            Wren is reading through your recent Slack messages and emails to find commitments, questions, and follow-ups. Your first results typically appear within minutes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto text-left">
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-3">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Step 1</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">Scanning messages</p>
            </div>
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400">Step 2</p>
              <p className="text-sm text-gray-500">Detecting commitments</p>
            </div>
            <div className="bg-white/80 dark:bg-white/10 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400">Step 3</p>
              <p className="text-sm text-gray-500">Building your score</p>
            </div>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This page auto-refreshes. You can also check back in a few minutes.
          </p>
        </div>
      </div>
    )
  }

  async function handleAction(action: (id: string) => Promise<void>, id: string, successMsg: string) {
    try {
      await action(id)
      toast.success(successMsg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6 animate-fade-in-up">
      {error && <AlertBanner variant="error" message={error} onDismiss={clearError} />}

      <PageHeader
        title="Here's what Wren found"
        titleSuffix={
          <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full" aria-hidden="true" /> Live
          </span>
        }
        description={
          integrationCount > 0
            ? `${integrationCount} connected tool${integrationCount > 1 ? 's' : ''} watching for commitments`
            : 'Connect your tools to start tracking commitments'
        }
      />

      <HeroStats commitments={commitments} />

      <TodaysFocus
        commitments={commitments}
        integrationCount={integrationCount}
        onMarkDone={id => handleAction(markDone, id, 'Marked as done!')}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Items" value={openCommitments.length} color="#6366f1" barPercent={Math.min(openCommitments.length / 20 * 100, 100)} />
        <StatCard label="Urgent" value={urgentCount} color="#f59e0b" barPercent={Math.min(urgentCount / 10 * 100, 100)} />
        <StatCard label="Overdue" value={overdueCount} color="#ef4444" barPercent={Math.min(overdueCount / 5 * 100, 100)} />
        <StatCard label="Avg Score" value={avgScore} color="#22c55e" barPercent={avgScore} />
      </div>

      {anomalies.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-brand p-5" role="alert">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-3">
            <span aria-hidden="true">⚠</span> {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} detected
          </div>
          {anomalies.map((a, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <span className="font-semibold text-red-800">{a.type}:</span>{' '}
              <span className="text-red-700">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sources connected"
          value={integrationCount}
          status={integrationCount >= 2 ? 'Healthy' : integrationCount === 1 ? 'Limited' : 'None'}
          statusColor={integrationCount >= 2 ? 'text-green-600 bg-green-50' : integrationCount === 1 ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50'}
        />
        <StatCard
          label="New this week"
          value={commitments.filter(c => isThisWeek(c.created_at)).length}
          status={commitments.filter(c => isThisWeek(c.created_at)).length > 0 ? 'Active' : 'Quiet'}
          statusColor={commitments.filter(c => isThisWeek(c.created_at)).length > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-600 bg-gray-50'}
        />
        <StatCard
          label="Completed"
          value={completedCommitments.length}
          status={completedCommitments.length === 0 && commitments.length > 0 ? 'Needs attention' : completedCommitments.length > 0 ? 'Good' : '—'}
          statusColor={completedCommitments.length === 0 && commitments.length > 0 ? 'text-red-600 bg-red-50' : completedCommitments.length > 0 ? 'text-green-600 bg-green-50' : 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800'}
        />
        <StatCard
          label="Stale (7+ days)"
          value={staleItems}
          status={staleItems > 5 ? 'High' : staleItems > 0 ? 'Medium' : 'Healthy'}
          statusColor={staleItems > 5 ? 'text-red-600 bg-red-50' : staleItems > 0 ? 'text-yellow-600 bg-yellow-50' : 'text-green-600 bg-green-50'}
        />
      </div>

      <ForecastSection commitments={commitments} />
      <MentionsSection mentions={mentions} />

      {openCommitments.filter(c => daysSince(c.created_at) > 3).length > 0 && (
        <section className="space-y-4" aria-label="Items needing follow-through">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Needs Follow-through</h2>
          {openCommitments
            .filter(c => daysSince(c.created_at) > 3)
            .slice(0, 3)
            .map(c => (
              <NudgeCard
                key={c.id}
                commitment={c}
                onDone={id => handleAction(markDone, id, 'Marked as done!')}
                onSnooze={id => handleAction(snooze, id, 'Snoozed — timer reset')}
                onDismiss={id => handleAction(dismiss, id, 'Dismissed')}
              />
            ))}
        </section>
      )}
    </div>
  )
}
