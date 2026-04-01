'use client'

import { useEffect, useState } from 'react'
import {
  MessageSquare, AlertTriangle, Clock, CheckCircle2, X,
  RefreshCw, ChevronDown, ChevronUp, Hash, ExternalLink,
  ThumbsUp, ThumbsDown, Phone,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface MissedChat {
  id: string
  channel_id: string
  channel_name: string | null
  sender_user_id: string
  sender_name: string | null
  message_text: string
  message_ts: string
  thread_ts: string | null
  permalink: string | null
  sent_at: string
  urgency: 'critical' | 'high' | 'medium' | 'low'
  reason: string | null
  question_summary: string | null
  category: string
  confidence: number
  status: string
  waiting_days: number
}

const urgencyConfig = {
  critical: {
    label: 'Critical',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    border: 'border-l-red-500',
    dot: 'bg-red-500',
  },
  high: {
    label: 'High',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    border: 'border-l-orange-500',
    dot: 'bg-orange-500',
  },
  medium: {
    label: 'Medium',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    border: 'border-l-yellow-500',
    dot: 'bg-yellow-500',
  },
  low: {
    label: 'Low',
    color: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400',
    border: 'border-l-gray-400',
    dot: 'bg-gray-400',
  },
}

const categoryLabels: Record<string, string> = {
  question: 'Question',
  request: 'Request',
  decision: 'Decision needed',
  follow_up: 'Follow-up',
  fyi: 'FYI',
}

export default function MissedChatsPage() {
  const [chats, setChats] = useState<MissedChat[]>([])
  const [totalEvaluated, setTotalEvaluated] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all')
  const [scanning, setScanning] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActioning, setBulkActioning] = useState(false)

  async function loadChats() {
    try {
      const res = await fetch('/api/missed-chats')
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        const enriched = (data.missedChats || []).map((c: MissedChat & { sent_at: string }) => ({
          ...c,
          waiting_days: Math.max(0, Math.floor((Date.now() - new Date(c.sent_at).getTime()) / (1000 * 60 * 60 * 24))),
        }))
        setChats(enriched)
        if (data.totalEvaluated !== undefined) setTotalEvaluated(data.totalEvaluated)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load missed chats'
      setError(message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadChats()
  }, [])

  async function markReplied(id: string) {
    try {
      const res = await fetch('/api/missed-chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'replied' }),
      })
      if (res.ok) {
        setChats(chats.filter(c => c.id !== id))
        toast.success('Marked as replied')
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  async function dismiss(id: string) {
    try {
      const res = await fetch('/api/missed-chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed' }),
      })
      if (res.ok) {
        setChats(chats.filter(c => c.id !== id))
        toast.success('Dismissed')
      }
    } catch {
      toast.error('Failed to dismiss')
    }
  }

  async function snooze(id: string) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    try {
      const res = await fetch('/api/missed-chats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'snoozed', snoozed_until: tomorrow }),
      })
      if (res.ok) {
        setChats(chats.filter(c => c.id !== id))
        toast.success('Snoozed until tomorrow')
      }
    } catch {
      toast.error('Failed to snooze')
    }
  }

  async function triggerScan() {
    setScanning(true)
    setError(null)
    try {
      const scanRes = await fetch('/api/missed-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const scanData = await scanRes.json()

      if (!scanRes.ok) {
        throw new Error(scanData.error || 'Failed to trigger scan')
      }

      toast.success(`Scan complete — found ${scanData.missed} new missed chat${scanData.missed !== 1 ? 's' : ''}`)
      await loadChats()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scan'
      setError(message)
      toast.error(message)
    } finally {
      setScanning(false)
    }
  }

  // Clean message text for display (remove Slack user IDs, keep readable)
  function formatMessage(text: string): string {
    return text
      .replace(/<@[A-Z0-9]+>/g, '@someone')
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
      .replace(/<(https?:\/\/[^>]+)>/g, '$1')
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkAction(status: 'replied' | 'dismissed') {
    if (selectedIds.size === 0) return
    setBulkActioning(true)
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map(id =>
        fetch('/api/missed-chats', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        })
      ))
      const idsToRemove = new Set(ids)
      setChats(prev => prev.filter(c => !idsToRemove.has(c.id)))
      toast.success(`${ids.length} chat${ids.length > 1 ? 's' : ''} ${status === 'replied' ? 'marked as replied' : 'dismissed'}`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Failed to update')
    } finally {
      setBulkActioning(false)
    }
  }

  const filteredChats = filter === 'all'
    ? chats
    : chats.filter(c => c.urgency === filter)

  const criticalCount = chats.filter(c => c.urgency === 'critical').length
  const highCount = chats.filter(c => c.urgency === 'high').length
  const mediumCount = chats.filter(c => c.urgency === 'medium').length
  const lowCount = chats.filter(c => c.urgency === 'low').length

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Missed Chats</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Slack @mentions and DMs you haven&apos;t responded to
          </p>
        </div>
        <button
          onClick={triggerScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {/* Evaluation context */}
      {totalEvaluated > 0 && (
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg px-4 py-2.5">
          <MessageSquare aria-hidden="true" className="w-4 h-4 text-purple-500 flex-shrink-0" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-white">{chats.length}</span> missed of{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{totalEvaluated.toLocaleString()}</span> Slack messages evaluated
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: 'critical' as const, label: 'Critical', count: criticalCount, dot: 'bg-red-500', textColor: 'text-red-600', borderColor: 'border-red-400 ring-red-200 dark:ring-red-800' },
          { key: 'high' as const, label: 'High', count: highCount, dot: 'bg-orange-500', textColor: 'text-orange-600', borderColor: 'border-orange-400 ring-orange-200 dark:ring-orange-800' },
          { key: 'medium' as const, label: 'Medium', count: mediumCount, dot: 'bg-yellow-500', textColor: 'text-yellow-600', borderColor: 'border-yellow-400 ring-yellow-200 dark:ring-yellow-800' },
          { key: 'low' as const, label: 'Low', count: lowCount, dot: 'bg-gray-400', textColor: 'text-gray-600 dark:text-gray-400', borderColor: 'border-gray-400 ring-gray-200 dark:ring-gray-700' },
        ]).map(stat => (
          <button
            key={stat.key}
            onClick={() => setFilter(filter === stat.key ? 'all' : stat.key)}
            className={`bg-white dark:bg-surface-dark-secondary border rounded-lg p-4 text-left transition hover:shadow-md ${
              filter === stat.key ? `${stat.borderColor} ring-2` : 'border-gray-200 dark:border-border-dark'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${stat.dot}`} aria-hidden="true"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</p>
            </div>
            <p className={`text-2xl font-bold ${stat.textColor}`}>{stat.count}</p>
          </button>
        ))}
      </div>

      {/* Filter indicator */}
      {filter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {filter} priority chats
          </span>
          <button onClick={() => setFilter('all')} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Show all
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {filteredChats.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
          <input
            type="checkbox"
            checked={selectedIds.size === filteredChats.length && filteredChats.length > 0}
            onChange={() => {
              if (selectedIds.size === filteredChats.length) {
                setSelectedIds(new Set())
              } else {
                setSelectedIds(new Set(filteredChats.map(c => c.id)))
              }
            }}
            className="w-4 h-4 rounded cursor-pointer accent-indigo-600"
          />
          {selectedIds.size > 0 ? (
            <>
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => bulkAction('replied')}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark as Replied
                </button>
                <button
                  onClick={() => { bulkAction('replied'); toast.success('Marked as handled offline') }}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Handled Offline
                </button>
                <button
                  onClick={() => bulkAction('dismissed')}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">Select chats for bulk actions</span>
          )}
        </div>
      )}

      {/* Chat List */}
      <div className="space-y-3">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {filter !== 'all' ? `No ${filter} priority chats` : 'All caught up!'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              {filter !== 'all'
                ? 'Try checking other priority levels.'
                : chats.length === 0
                  ? 'Click "Scan Now" to check for Slack mentions you may have missed.'
                  : 'No chats are waiting for your response. Great follow-through!'
              }
            </p>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const config = urgencyConfig[chat.urgency]
            const isExpanded = expandedId === chat.id

            return (
              <div
                key={chat.id}
                className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${config.border} rounded-lg overflow-hidden transition hover:shadow-md`}
              >
                {/* Chat header */}
                <div
                  className="p-5 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : chat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setExpandedId(isExpanded ? null : chat.id)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(chat.id)}
                      onChange={() => toggleSelect(chat.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded cursor-pointer accent-indigo-600 mt-1 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                          {categoryLabels[chat.category] || chat.category}
                        </span>
                        {chat.channel_name && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                            <Hash className="w-3 h-3" />
                            {chat.channel_name}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock aria-hidden="true" className="w-3 h-3" />
                          {chat.waiting_days === 0
                            ? 'Today'
                            : chat.waiting_days === 1
                              ? '1 day waiting'
                              : `${chat.waiting_days} days waiting`
                          }
                        </span>
                        {chat.permalink && (
                          <a
                            href={chat.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition"
                          >
                            <ExternalLink aria-hidden="true" className="w-3 h-3" />
                            Open in Slack
                          </a>
                        )}
                      </div>

                      {/* Sender */}
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {chat.sender_name || chat.sender_user_id}
                        <span className="font-normal text-gray-500 dark:text-gray-400"> mentioned you</span>
                      </p>

                      {/* Question summary */}
                      {chat.question_summary && (
                        <div className="mt-2 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-md px-3 py-2">
                          <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-amber-800 dark:text-amber-300">
                            {chat.question_summary}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex-shrink-0 mt-1">
                      {isExpanded
                        ? <ChevronUp aria-hidden="true" className="w-5 h-5 text-gray-400" />
                        : <ChevronDown aria-hidden="true" className="w-5 h-5 text-gray-400" />
                      }
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-700">
                    {/* Full message */}
                    <div className="mt-4 bg-gray-50 dark:bg-surface-dark rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {formatMessage(chat.message_text)}
                    </div>

                    {/* Metadata */}
                    <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                      {chat.reason && (
                        <span><span className="font-medium">Why flagged:</span> {chat.reason}</span>
                      )}
                      <span>
                        {new Date(chat.sent_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => { e.stopPropagation(); markReplied(chat.id) }}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                      >
                        <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                        Mark as Replied
                      </button>
                      {chat.permalink && (
                        <a
                          href={chat.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition text-sm font-medium"
                        >
                          <ExternalLink aria-hidden="true" className="w-4 h-4" />
                          Open in Slack
                        </a>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); markReplied(chat.id) }}
                        className="flex items-center gap-2 px-4 py-2 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition text-sm font-medium"
                      >
                        <Phone aria-hidden="true" className="w-4 h-4" />
                        Handled Offline
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); snooze(chat.id) }}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                      >
                        <Clock aria-hidden="true" className="w-4 h-4" />
                        Snooze 1 Day
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismiss(chat.id) }}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                        aria-label="Dismiss chat"
                      >
                        <X aria-hidden="true" className="w-4 h-4" />
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info Box */}
      <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/50 rounded-lg p-6">
        <h3 className="font-semibold text-purple-900 dark:text-purple-200 mb-2">How Missed Chats Works</h3>
        <p className="text-sm text-purple-800 dark:text-purple-300 mb-3">
          HeyWren scans your Slack channels for messages where you were @mentioned but never responded in the thread.
          These are conversations where someone is likely waiting for your input.
        </p>
        <ul className="text-sm text-purple-800 dark:text-purple-300 space-y-1">
          <li>&#10003; Detects @mentions where you haven&apos;t replied in the thread</li>
          <li>&#10003; Prioritizes messages with direct questions and deadlines</li>
          <li>&#10003; Extracts the specific question or ask you need to address</li>
          <li>&#10003; Links directly back to the Slack thread for quick response</li>
          <li>&#10003; Scans the last 14 days of Slack messages</li>
        </ul>
      </div>
    </div>
  )
}
