// app/(dashboard)/commitments/page.tsx
// Commitment Tracing v5 — ALL REAL DATA, zero mock/placeholder content
// Changes from v4: Removed simulated intermediate timeline events
// Timeline now shows only real events: origin (created) and current state

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_ref: string | null
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

function getSourceBadge(source: string | null): { label: string; color: string } {
  switch (source) {
    case 'slack': return { label: 'Slack', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' }
    case 'outlook': case 'email': return { label: 'Email', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' }
    case 'meeting': return { label: 'Meeting', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' }
    default: return { label: 'Manual', color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400' }
  }
}

function buildTimeline(c: Commitment): Array<{ date: string; source: string; text: string; isCurrent: boolean }> {
  const events: Array<{ date: string; source: string; text: string; isCurrent: boolean }> = []
  const createdDate = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const sourceBadge = getSourceBadge(c.source)
  const age = daysSince(c.created_at)

  // Origin event (real — from created_at)
  events.push({
    date: createdDate,
    source: sourceBadge.label,
    text: c.source === 'slack'
      ? 'Captured from Slack conversation'
      : c.source === 'outlook' || c.source === 'email'
        ? 'Detected in email thread'
        : c.source === 'meeting'
          ? 'Captured from meeting'
          : 'Manually created',
    isCurrent: false,
  })

  // Current state (real — computed from actual status and age)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (c.status === 'completed') {
    const completedDate = new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    events.push({
      date: completedDate,
      source: 'Resolved',
      text: 'Marked as completed',
      isCurrent: true,
    })
  } else if (age > 0) {
    events.push({
      date: today,
      source: 'Now',
      text: `Open for ${age} day${age !== 1 ? 's' : ''}. ${getCommitmentStatus(c).label}.`,
      isCurrent: true,
    })
  }

  return events
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

        // ── SECURITY: Get user's team_id first ──
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
      <div className="p-8">
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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commitment Tracing</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Every promise tracked from origin to resolution across your connected tools</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'active' as const, label: 'Active', count: openCommitments.length },
          { key: 'completed' as const, label: 'Completed', count: completedCommitments.length },
          { key: 'mentions' as const, label: '@HeyWren Mentions', count: slackMentions.length },
        ].map(tab => (
          <button
            key={tab.key}
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
          <div className="text-3xl mb-3">
            {activeTab === 'active' ? '✅' : activeTab === 'completed' ? '📋' : '💬'}
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
            const timeline = buildTimeline(c)
            const age = daysSince(c.created_at)
            const scoreColor = score >= 70 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700' : score >= 50 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700'

            return (
              <div key={c.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{c.title}</h3>
                  {c.status !== 'completed' && (
                    <button
                      onClick={() => updateStatus(c.id, 'completed')}
                      className="text-xs px-3 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 font-medium"
                    >
                      Mark Complete
                    </button>
                  )}
                </div>

                {/* Score + Status + Age */}
                <div className="flex items-center gap-2 mb-4">
                  <span className={`px-2 py-0.5 rounded border text-xs font-bold ${scoreColor}`}>
                    Score: {score}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${status.bgColor} ${status.color}`}>
                    {status.label}
                  </span>
                  <span className="text-xs text-gray-400">{age} day{age !== 1 ? 's' : ''}</span>
                </div>

                {/* Description if exists */}
                {c.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{c.description}</p>
                )}

                {/* Timeline (real events only) */}
                <div className="ml-2 space-y-0">
                  {timeline.map((event, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      {i < timeline.length - 1 && (
                        <div className="absolute left-[7px] top-4 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
                      )}
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 z-10 ${
                        event.isCurrent
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                      }`} />
                      <div className="pb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{event.date}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            event.source === 'Slack' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' :
                            event.source === 'Email' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                            event.source === 'Meeting' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                            event.source === 'Resolved' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            event.source === 'Now' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' :
                            'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                          }`}>
                            {event.source}
                          </span>
                        </div>
                        <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{event.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
