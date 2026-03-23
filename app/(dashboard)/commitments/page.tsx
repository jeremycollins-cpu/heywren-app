// app/(dashboard)/commitments/page.tsx
// Commitment Tracing v3 — Timeline view with scores, status, tabs
// Matches demo: Active Traces / Delegated / @HeyWren Mentions

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
  if (c.status === 'completed') return { label: 'COMPLETED', color: 'text-green-700', bgColor: 'bg-green-100' }
  if (c.status === 'overdue') return { label: 'OVERDUE', color: 'text-red-700', bgColor: 'bg-red-100' }
  const age = daysSince(c.created_at)
  if (age > 7) return { label: 'AT RISK', color: 'text-red-700', bgColor: 'bg-red-100' }
  if (age > 3) return { label: 'STALLED', color: 'text-yellow-700', bgColor: 'bg-yellow-100' }
  return { label: 'ACTIVE', color: 'text-green-700', bgColor: 'bg-green-100' }
}

function getSourceBadge(source: string | null): { label: string; color: string } {
  switch (source) {
    case 'slack': return { label: 'Slack', color: 'bg-purple-100 text-purple-700' }
    case 'outlook': case 'email': return { label: 'Email', color: 'bg-blue-100 text-blue-700' }
    case 'meeting': return { label: 'Meeting', color: 'bg-orange-100 text-orange-700' }
    default: return { label: 'Manual', color: 'bg-gray-100 text-gray-700' }
  }
}

function buildTimeline(c: Commitment): Array<{ date: string; source: string; text: string; isCurrent: boolean }> {
  const events: Array<{ date: string; source: string; text: string; isCurrent: boolean }> = []
  const createdDate = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const sourceBadge = getSourceBadge(c.source)

  // Origin event
  events.push({
    date: createdDate,
    source: sourceBadge.label,
    text: c.source === 'slack' ? 'Captured from Slack conversation' : c.source === 'outlook' || c.source === 'email' ? 'Detected in email thread' : 'Manually created',
    isCurrent: false,
  })

  // Simulate intermediate events based on age
  const age = daysSince(c.created_at)
  if (age > 3) {
    const midDate = new Date(new Date(c.created_at).getTime() + 3 * 24 * 60 * 60 * 1000)
    events.push({
      date: midDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      source: 'Today',
      text: age > 7 ? `No follow-up in ${age} days. ${getCommitmentStatus(c).label === 'AT RISK' ? 'At risk.' : 'Stalled.'}` : 'Tracking in progress',
      isCurrent: false,
    })
  }

  // Current state
  events.push({
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    source: 'Today',
    text: c.status === 'completed'
      ? 'Completed successfully'
      : `${age} days tracked. ${c.status === 'open' ? `${getCommitmentStatus(c).label}.` : ''}`,
    isCurrent: true,
  })

  return events
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'active' | 'delegated' | 'mentions'>('active')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('commitments')
        .select('*')
        .order('created_at', { ascending: false })

      if (data) setCommitments(data)
      setLoading(false)
    }
    load()
  }, [])

  async function updateStatus(id: string, newStatus: string) {
    const supabase = createClient()
    await supabase.from('commitments').update({ status: newStatus }).eq('id', id)
    setCommitments(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c))
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 rounded"></div>)}
        </div>
      </div>
    )
  }

  const openCommitments = commitments.filter(c => c.status !== 'completed')
  const slackMentions = commitments.filter(c => c.source === 'slack')

  // For "delegated" tab, show commitments with assignee info (simulated for now)
  const delegated = commitments.filter(c => c.description?.toLowerCase().includes('delegate') || c.description?.toLowerCase().includes('assign'))

  const displayedCommitments = activeTab === 'active'
    ? openCommitments
    : activeTab === 'mentions'
    ? slackMentions
    : delegated

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commitment Tracing</h1>
        <p className="text-gray-500 text-sm mt-1">Every promise tracked from origin to resolution across your connected tools</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-gray-200">
        {[
          { key: 'active' as const, label: 'Active Traces', count: openCommitments.length },
          { key: 'delegated' as const, label: 'Delegated', count: delegated.length },
          { key: 'mentions' as const, label: '@HeyWren Mentions', count: slackMentions.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Commitment Trace Cards */}
      {displayedCommitments.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No {activeTab === 'active' ? 'active traces' : activeTab === 'mentions' ? '@HeyWren mentions' : 'delegated items'} yet</p>
          <p className="text-sm mt-1">Commitments will appear here as they&apos;re detected from your connected tools</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedCommitments.map(c => {
            const score = getCommitmentScore(c)
            const status = getCommitmentStatus(c)
            const timeline = buildTimeline(c)
            const age = daysSince(c.created_at)
            const sourceBadge = getSourceBadge(c.source)
            const scoreColor = score >= 70 ? 'bg-green-100 text-green-700 border-green-300' : score >= 50 ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-red-100 text-red-700 border-red-300'

            return (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-lg font-bold text-gray-900">{c.title}</h3>
                  {c.status !== 'completed' && (
                    <button
                      onClick={() => updateStatus(c.id, 'completed')}
                      className="text-xs px-3 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium"
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
                  <span className="text-xs text-gray-400">{age} days</span>
                  {c.description?.toLowerCase().includes('customer') && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 border border-orange-300">
                      Customer Promise
                    </span>
                  )}
                </div>

                {/* Timeline */}
                <div className="ml-2 space-y-0">
                  {timeline.map((event, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      {/* Vertical line */}
                      {i < timeline.length - 1 && (
                        <div className="absolute left-[7px] top-4 bottom-0 w-0.5 bg-gray-200" />
                      )}
                      {/* Dot */}
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 z-10 ${
                        event.isCurrent
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'bg-white border-gray-300'
                      }`} />
                      {/* Content */}
                      <div className="pb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{event.date}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            event.source === 'Slack' ? 'bg-purple-100 text-purple-700' :
                            event.source === 'Email' ? 'bg-blue-100 text-blue-700' :
                            event.source === 'Meeting' ? 'bg-orange-100 text-orange-700' :
                            event.source === 'Today' ? 'bg-indigo-100 text-indigo-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {event.source}
                          </span>
                        </div>
                        <div className="text-sm text-gray-700 mt-0.5">{event.text}</div>
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
