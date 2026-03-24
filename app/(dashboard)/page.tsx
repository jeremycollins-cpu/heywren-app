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
      <div className="p-6 max-w-[1200px] mx-auto space-y-6">
        <PageHeader title="Welcome to HeyWren" description="Let's get you set up" />
        <EmptyState
          icon="🐦"
          title="Connect your first tool"
          description="Wren watches your Slack messages and Outlook emails to automatically detect commitments and track follow-through. Connect a tool to get started."
          actionLabel="Connect Slack or Outlook"
          actionHref="/integrations"
        />
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
