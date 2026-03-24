// app/(dashboard)/commitments/page.tsx
// Commitment Tracing v6 — Rich context cards with deep links, urgency, stakeholders, and original quotes

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface CommitmentStakeholder {
  name: string
  role: 'owner' | 'assignee' | 'stakeholder'
}

interface CommitmentMetadata {
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  tone?: 'casual' | 'professional' | 'urgent' | 'demanding'
  commitmentType?: 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'
  stakeholders?: CommitmentStakeholder[]
  originalQuote?: string
  channelName?: string
}

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_ref: string | null
  source_url: string | null
  metadata: CommitmentMetadata | null
  created_at: string
  updated_at: string
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function getCommitmentScore(c: Commitment): number {
  let score = 70
  const age = daysSince(c.created_at)
  if (c.status === 'completed') score += 20
  if (age > 14) score -= 25
  else if (age > 7) score -= 15
  else if (age > 3) score -= 5
  if (c.source === 'slack') score += 3
  if (c.source === 'outlook' || c.source === 'email') score += 3
  if (c.description && c.description.length > 20) score += 5
  return Math.max(20, Math.min(99, score))
}

function getCommitmentStatus(c: Commitment): { label: string; color: string; bgColor: string } {
  if (c.status === 'completed') return { label: 'COMPLETED', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30' }
  if (c.status === 'overdue') return { label: 'OVERDUE', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30' }
  const age = daysSince(c.created_at)
  if (age > 7) return { label: 'AT RISK', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30' }
  if (age > 3) return { label: 'STALLED', color: 'text-yellow-700 dark:text-yellow-400', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30' }
  return { label: 'ACTIVE', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30' }
}

function getSourceBadge(source: string | null): { label: string; color: string; icon: string } {
  switch (source) {
    case 'slack': return { label: 'Slack', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', icon: '#' }
    case 'outlook': case 'email': return { label: 'Email', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', icon: '@' }
    case 'meeting': case 'calendar': return { label: 'Calendar', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', icon: '\u{1F4C5}' }
    default: return { label: 'Manual', color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400', icon: '+' }
  }
}

function getUrgencyConfig(urgency?: string): { label: string; color: string; dotColor: string } | null {
  switch (urgency) {
    case 'critical': return { label: 'Critical', color: 'text-red-600 dark:text-red-400', dotColor: 'bg-red-500' }
    case 'high': return { label: 'High', color: 'text-orange-600 dark:text-orange-400', dotColor: 'bg-orange-500' }
    case 'medium': return { label: 'Medium', color: 'text-yellow-600 dark:text-yellow-400', dotColor: 'bg-yellow-500' }
    case 'low': return { label: 'Low', color: 'text-gray-500 dark:text-gray-400', dotColor: 'bg-gray-400' }
    default: return null
  }
}

function getCommitmentTypeLabel(type?: string): string | null {
  switch (type) {
    case 'deliverable': return 'Deliverable'
    case 'meeting': return 'Meeting'
    case 'follow_up': return 'Follow-up'
    case 'decision': return 'Decision'
    case 'review': return 'Review'
    case 'request': return 'Request'
    default: return null
  }
}

function getToneLabel(tone?: string): string | null {
  switch (tone) {
    case 'demanding': return 'Demanding tone'
    case 'urgent': return 'Urgent tone'
    case 'professional': return null // Don't show — it's the default
    case 'casual': return null
    default: return null
  }
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'mentions'>('active')

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()

        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) {
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        const teamId = profile?.current_team_id
        if (!teamId) {
          setLoading(false)
          return
        }

        const { data } = await supabase
          .from('commitments')
          .select('*')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })

        if (data) setCommitments(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load commitments'
        setError(message)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function updateStatus(id: string, newStatus: string) {
    const supabase = createClient()
    await supabase.from('commitments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    setCommitments(prev => prev.map(c => c.id === id ? { ...c, status: newStatus, updated_at: new Date().toISOString() } : c))
  }

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading commitments">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 dark:bg-gray-800 rounded"></div>)}
        </div>
      </div>
    )
  }

  const openCommitments = commitments.filter(c => c.status !== 'completed')
  const completedCommitments = commitments.filter(c => c.status === 'completed')
  const slackMentions = commitments.filter(c => c.source === 'slack')

  const displayedCommitments = activeTab === 'active'
    ? openCommitments
    : activeTab === 'completed'
    ? completedCommitments
    : slackMentions

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commitment Tracing</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Every promise tracked from origin to resolution across your connected tools</p>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex gap-6 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'active' as const, label: 'Active', count: openCommitments.length },
          { key: 'completed' as const, label: 'Completed', count: completedCommitments.length },
          { key: 'mentions' as const, label: '@HeyWren Mentions', count: slackMentions.length },
        ].map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Commitment Trace Cards */}
      {displayedCommitments.length === 0 ? (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
          <div className="text-3xl mb-3" aria-hidden="true">
            {activeTab === 'active' ? '\u2705' : activeTab === 'completed' ? '\u{1F4CB}' : '\u{1F4AC}'}
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {activeTab === 'active' ? 'No active commitments' : activeTab === 'completed' ? 'No completed commitments yet' : 'No @HeyWren mentions yet'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            {activeTab === 'active'
              ? 'Commitments will appear here as Wren detects them from your connected Slack and Outlook.'
              : activeTab === 'completed'
                ? 'Mark commitments as complete to track your follow-through rate.'
                : 'Tag @HeyWren in any Slack conversation to capture commitments directly.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedCommitments.map(c => {
            const score = getCommitmentScore(c)
            const status = getCommitmentStatus(c)
            const age = daysSince(c.created_at)
            const sourceBadge = getSourceBadge(c.source)
            const meta = c.metadata || {}
            const urgency = getUrgencyConfig(meta.urgency)
            const commitmentType = getCommitmentTypeLabel(meta.commitmentType)
            const toneNote = getToneLabel(meta.tone)
            const scoreColor = score >= 70
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700'
              : score >= 50
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700'

            return (
              <div key={c.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
                {/* Row 1: Header with title + actions */}
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-snug">{c.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.source_url && (
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 font-medium transition-colors"
                      >
                        View in {sourceBadge.label}
                      </a>
                    )}
                    {c.status !== 'completed' && (
                      <button
                        onClick={() => updateStatus(c.id, 'completed')}
                        className="text-xs px-3 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 font-medium transition-colors"
                      >
                        Mark Complete
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 2: Badges — score, status, urgency, type, source, age */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className={`px-2 py-0.5 rounded border text-xs font-bold ${scoreColor}`}>
                    Score: {score}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${status.bgColor} ${status.color}`}>
                    {status.label}
                  </span>
                  {urgency && (
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 ${urgency.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${urgency.dotColor}`} aria-hidden="true" />
                      {urgency.label} urgency
                    </span>
                  )}
                  {commitmentType && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {commitmentType}
                    </span>
                  )}
                  {toneNote && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                      {toneNote}
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceBadge.color}`}>
                    {sourceBadge.label}
                  </span>
                  <span className="text-xs text-gray-400">{age} day{age !== 1 ? 's' : ''}</span>
                </div>

                {/* Row 3: Description */}
                {c.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">{c.description}</p>
                )}

                {/* Row 4: Original quote (if available) */}
                {meta.originalQuote && (
                  <div className="border-l-3 border-gray-300 dark:border-gray-600 pl-3 mb-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic leading-relaxed">
                      &ldquo;{meta.originalQuote}&rdquo;
                    </p>
                  </div>
                )}

                {/* Row 5: Stakeholders + Source origin line */}
                <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    {/* Stakeholders */}
                    {meta.stakeholders && meta.stakeholders.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        {meta.stakeholders.map((s, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              s.role === 'owner'
                                ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                                : s.role === 'assignee'
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            <span className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-[10px] text-white font-bold" aria-hidden="true">
                              {s.name.charAt(0).toUpperCase()}
                            </span>
                            {s.name}
                            {s.role === 'owner' && <span className="text-[10px] opacity-60">owner</span>}
                            {s.role === 'assignee' && <span className="text-[10px] opacity-60">assigned</span>}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Origin timestamp */}
                  <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                    <span>{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sourceBadge.color}`}>
                      {sourceBadge.label}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
