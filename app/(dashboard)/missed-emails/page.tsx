'use client'

import { useEffect, useState } from 'react'
import {
  Mail, AlertTriangle, Clock, CheckCircle2, X, Eye, EyeOff,
  MailWarning, RefreshCw, ArrowRight, ChevronDown, ChevronUp,
  ThumbsUp, ThumbsDown, Star, Settings, MessageSquare, Phone, Forward,
  MailOpen, Folder, ListChecks
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import OrganizeEmailPopover from '@/components/organize-email-popover'
import { useTodo } from '@/lib/contexts/todo-context'
import { WrenSuggestionBanner } from '@/components/wren-suggestion-banner'

interface ThreadEmail {
  id: string
  from_name: string | null
  from_email: string
  subject: string | null
  received_at: string
  urgency: string
  body_preview: string | null
  question_summary: string | null
  category: string
}

interface MissedEmail {
  id: string
  from_name: string | null
  from_email: string
  subject: string | null
  body_preview: string | null
  received_at: string
  urgency: 'critical' | 'high' | 'medium' | 'low'
  reason: string | null
  question_summary: string | null
  category: string
  confidence: number
  status: string
  waiting_days: number
  is_vip?: boolean
  is_read?: boolean
  folder_name?: string | null
  // Thread grouping fields from API
  threadCount?: number
  threadEmailIds?: string[]
  threadHighestUrgency?: string
  threadEmails?: ThreadEmail[]
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
  introduction: 'Introduction',
  recipient_gap: 'Missing recipient',
}

export default function MissedEmailsPage() {
  const { addTodoFromPage } = useTodo()
  const [emails, setEmails] = useState<MissedEmail[]>([])
  const [totalEvaluated, setTotalEvaluated] = useState<number>(0)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 'valid' | 'invalid'>>({})
  const [feedbackModal, setFeedbackModal] = useState<{ email: MissedEmail; show: boolean } | null>(null)
  const [feedbackReason, setFeedbackReason] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActioning, setBulkActioning] = useState(false)

  async function submitFeedback(email: MissedEmail, feedback: 'valid' | 'invalid', reason?: string) {
    try {
      const res = await fetch('/api/missed-email-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missed_email_id: email.id,
          from_email: email.from_email,
          feedback,
          reason: reason || null,
        }),
      })
      if (res.ok) {
        setFeedbackGiven(prev => ({ ...prev, [email.id]: feedback }))
        setFeedbackModal(null)
        setFeedbackReason('')
        if (feedback === 'invalid') {
          setTimeout(() => {
            setEmails(prev => prev.filter(e => e.id !== email.id))
          }, 800)
        }
        toast.success(feedback === 'valid' ? 'Thanks! This helps improve detection.' : 'Got it — this feedback will improve the algorithm.')
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast.error(err.error || 'Failed to submit feedback')
      }
    } catch {
      toast.error('Failed to submit feedback')
    }
  }

  function handleThumbsDown(email: MissedEmail) {
    setFeedbackModal({ email, show: true })
    setFeedbackReason('')
  }

  async function loadEmails() {
    try {
      const res = await fetch('/api/missed-emails')
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        // Compute waiting_days client-side since it's not a DB column
        const enriched = (data.missedEmails || []).map((e: MissedEmail & { received_at: string }) => ({
          ...e,
          waiting_days: Math.max(0, Math.floor((Date.now() - new Date(e.received_at).getTime()) / (1000 * 60 * 60 * 24))),
        }))
        setEmails(enriched)
        if (data.totalEvaluated !== undefined) setTotalEvaluated(data.totalEvaluated)
        if (data.lastRefreshedAt) setLastRefreshedAt(data.lastRefreshedAt)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load missed emails'
      setError(message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadEmails()
  }, [])

  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set())

  async function markReplied(id: string, threadEmailIds?: string[], toastMsg?: string) {
    if (actioningIds.has(id)) return
    setActioningIds(prev => new Set(prev).add(id))
    const idsToRemove = new Set(threadEmailIds || [id])
    setEmails(prev => prev.filter(e => !idsToRemove.has(e.id)))
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'replied', threadEmailIds }),
      })
      if (res.ok) {
        toast.success(toastMsg || (threadEmailIds && threadEmailIds.length > 1 ? `Marked ${threadEmailIds.length} emails as replied` : 'Marked as replied'))
      }
    } catch {
      toast.error('Failed to update')
      loadEmails()
    } finally {
      setActioningIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function dismiss(id: string, threadEmailIds?: string[]) {
    if (actioningIds.has(id)) return
    setActioningIds(prev => new Set(prev).add(id))
    const idsToRemove = new Set(threadEmailIds || [id])
    setEmails(prev => prev.filter(e => !idsToRemove.has(e.id)))
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed', threadEmailIds }),
      })
      if (res.ok) {
        toast.success(threadEmailIds && threadEmailIds.length > 1 ? `Dismissed ${threadEmailIds.length} emails` : 'Dismissed')
      }
    } catch {
      toast.error('Failed to dismiss')
    }
  }

  async function snooze(id: string, threadEmailIds?: string[]) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'snoozed', snoozed_until: tomorrow, threadEmailIds }),
      })
      if (res.ok) {
        const idsToRemove = new Set(threadEmailIds || [id])
        setEmails(prev => prev.filter(e => !idsToRemove.has(e.id)))
        toast.success(threadEmailIds && threadEmailIds.length > 1 ? `Snoozed ${threadEmailIds.length} emails` : 'Snoozed until tomorrow')
      }
    } catch {
      toast.error('Failed to snooze')
    }
  }

  async function delegate(id: string, threadEmailIds?: string[]) {
    const name = prompt('Who did you forward this to?')
    if (!name) return
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'replied', resolution_type: 'delegated', delegated_to: name.trim(), threadEmailIds }),
      })
      if (res.ok) {
        const idsToRemove = new Set(threadEmailIds || [id])
        setEmails(prev => prev.filter(e => !idsToRemove.has(e.id)))
        toast.success(`Delegated to ${name.trim()}`)
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  async function triggerScan() {
    setScanning(true)
    setError(null)
    try {
      // Trigger an actual scan via the API
      const scanRes = await fetch('/api/missed-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!scanRes.ok) {
        const scanData = await scanRes.json().catch(() => ({}))
        // If POST is not supported (e.g. 405), fall back to refreshing data
        if (scanRes.status === 405) {
          await loadEmails()
          toast.success('Refreshed missed emails')
          return
        }
        throw new Error(scanData.error || 'Failed to trigger scan')
      }

      toast.success('Scan triggered — refreshing results...')
      // Reload the data after triggering the scan
      await loadEmails()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scan'
      setError(message)
      toast.error(message)
    } finally {
      setScanning(false)
    }
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
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ids[0], status, threadEmailIds: ids }),
      })
      if (res.ok) {
        const idsToRemove = new Set(ids)
        setEmails(prev => prev.filter(e => !idsToRemove.has(e.id)))
        toast.success(`${ids.length} email${ids.length > 1 ? 's' : ''} ${status === 'replied' ? 'marked as replied' : 'dismissed'}`)
        setSelectedIds(new Set())
      }
    } catch {
      toast.error('Failed to update')
    } finally {
      setBulkActioning(false)
    }
  }

  const filteredEmails = emails.filter(e => {
    if (filter !== 'all' && e.urgency !== filter) return false
    if (unreadOnly && e.is_read !== false) return false
    return true
  })

  const unreadCount = emails.filter(e => e.is_read === false).length

  const criticalCount = emails.filter(e => e.urgency === 'critical').length
  const highCount = emails.filter(e => e.urgency === 'high').length
  const mediumCount = emails.filter(e => e.urgency === 'medium').length
  const lowCount = emails.filter(e => e.urgency === 'low').length

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

      <WrenSuggestionBanner page="missed-emails" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Missed Emails</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Emails waiting for your response that may have slipped through the cracks. Sales and automated emails are filtered out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings#missed-emails"
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
          >
            <Settings aria-hidden="true" className="w-4 h-4" />
            Configure
          </Link>
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Evaluation context */}
      {totalEvaluated > 0 && (
        <div className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Mail aria-hidden="true" className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{emails.length}</span> missed of{' '}
              <span className="font-semibold text-gray-900 dark:text-white">{totalEvaluated.toLocaleString()}</span> emails evaluated
            </p>
          </div>
          {lastRefreshedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
              Last scanned {new Date(lastRefreshedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at{' '}
              {new Date(lastRefreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <button
          onClick={() => setFilter('critical')}
          className={`bg-white dark:bg-surface-dark-secondary border rounded-lg p-4 text-left transition hover:shadow-md ${
            filter === 'critical' ? 'border-red-400 ring-2 ring-red-200 dark:ring-red-800' : 'border-gray-200 dark:border-border-dark'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Critical</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
        </button>
        <button
          onClick={() => setFilter('high')}
          className={`bg-white dark:bg-surface-dark-secondary border rounded-lg p-4 text-left transition hover:shadow-md ${
            filter === 'high' ? 'border-orange-400 ring-2 ring-orange-200 dark:ring-orange-800' : 'border-gray-200 dark:border-border-dark'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-orange-500" aria-hidden="true"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">High</p>
          </div>
          <p className="text-2xl font-bold text-orange-600">{highCount}</p>
        </button>
        <button
          onClick={() => setFilter('medium')}
          className={`bg-white dark:bg-surface-dark-secondary border rounded-lg p-4 text-left transition hover:shadow-md ${
            filter === 'medium' ? 'border-yellow-400 ring-2 ring-yellow-200 dark:ring-yellow-800' : 'border-gray-200 dark:border-border-dark'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500" aria-hidden="true"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Medium</p>
          </div>
          <p className="text-2xl font-bold text-yellow-600">{mediumCount}</p>
        </button>
        <button
          onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}
          className={`bg-white dark:bg-surface-dark-secondary border rounded-lg p-4 text-left transition hover:shadow-md ${
            filter === 'low' ? 'border-gray-400 ring-2 ring-gray-200 dark:ring-gray-700' : 'border-gray-200 dark:border-border-dark'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-gray-400" aria-hidden="true"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Low</p>
          </div>
          <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{lowCount}</p>
        </button>
      </div>

      {/* Filter controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {filter !== 'all' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Showing {filter} priority emails
            </span>
            <button
              onClick={() => setFilter('all')}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Show all
            </button>
          </div>
        )}
        {unreadCount > 0 && (
          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition ${
              unreadOnly
                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            <MailOpen aria-hidden="true" className="w-4 h-4" />
            Unread only
            <span className={`ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white ${unreadOnly ? 'bg-blue-600' : 'bg-gray-400'} px-1`}>
              {unreadCount}
            </span>
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {filteredEmails.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
          <input
            type="checkbox"
            checked={selectedIds.size === filteredEmails.length && filteredEmails.length > 0}
            onChange={() => {
              if (selectedIds.size === filteredEmails.length) {
                setSelectedIds(new Set())
              } else {
                setSelectedIds(new Set(filteredEmails.map(e => e.id)))
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
            <span className="text-sm text-gray-500 dark:text-gray-400">Select emails for bulk actions</span>
          )}
        </div>
      )}

      {/* Email List */}
      <div className="space-y-3">
        {filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {filter !== 'all' ? `No ${filter} priority emails` : 'All caught up!'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              {filter !== 'all'
                ? 'Try checking other priority levels.'
                : 'No emails are waiting for your response. HeyWren scans daily to make sure nothing slips through.'
              }
            </p>
            {lastRefreshedAt && filter === 'all' && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                Last scanned {new Date(lastRefreshedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at{' '}
                {new Date(lastRefreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
          </div>
        ) : (
          filteredEmails.map((email) => {
            const config = urgencyConfig[email.urgency]
            const isExpanded = expandedId === email.id
            const isThreadExpanded = expandedThreadId === email.id
            const hasThread = (email.threadCount ?? 1) > 1

            return (
              <div
                key={email.id}
                className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${config.border} rounded-lg overflow-hidden transition hover:shadow-md`}
              >
                {/* Email header — clickable */}
                <div
                  className="p-5 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : email.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setExpandedId(isExpanded ? null : email.id)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(email.id)}
                      onChange={() => toggleSelect(email.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded cursor-pointer accent-indigo-600 mt-1 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {/* Top row: badges */}
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${config.color}`}>
                          {config.label}
                        </span>
                        {email.is_vip && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            <Star aria-hidden="true" className="w-3 h-3" />
                            VIP
                          </span>
                        )}
                        {email.is_read === false && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            <MailOpen aria-hidden="true" className="w-3 h-3" />
                            Unread
                          </span>
                        )}
                        {email.folder_name && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            <Folder aria-hidden="true" className="w-3 h-3" />
                            {email.folder_name}
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                          {categoryLabels[email.category] || email.category}
                        </span>
                        {hasThread && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            <MessageSquare aria-hidden="true" className="w-3 h-3" />
                            {email.threadCount} emails
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock aria-hidden="true" className="w-3 h-3" />
                          {email.waiting_days === 0
                            ? 'Today'
                            : email.waiting_days === 1
                              ? '1 day waiting'
                              : `${email.waiting_days} days waiting`
                          }
                        </span>
                      </div>

                      {/* Subject */}
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1">
                        {email.subject || '(no subject)'}
                      </h3>

                      {/* From */}
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        From: {email.from_name || email.from_email}
                        {email.from_name && (
                          <span className="text-gray-400 dark:text-gray-500"> &lt;{email.from_email}&gt;</span>
                        )}
                      </p>

                      {/* AI reason — the key insight */}
                      {email.question_summary && (
                        <div className="mt-2 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-md px-3 py-2">
                          <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-amber-800 dark:text-amber-300">
                            {email.question_summary}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Expand chevron */}
                    <div className="flex-shrink-0 mt-1">
                      {isExpanded ? (
                        <ChevronUp aria-hidden="true" className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown aria-hidden="true" className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-700">
                    {/* Body preview */}
                    {email.body_preview && (
                      <div className="mt-4 bg-gray-50 dark:bg-surface-dark rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {email.body_preview}
                      </div>
                    )}

                    {/* AI reason */}
                    {email.reason && (
                      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">Why this was flagged:</span> {email.reason}
                      </p>
                    )}

                    {/* Thread emails expandable section */}
                    {hasThread && email.threadEmails && (
                      <div className="mt-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedThreadId(isThreadExpanded ? null : email.id)
                          }}
                          className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition font-medium"
                        >
                          <MessageSquare aria-hidden="true" className="w-4 h-4" />
                          {isThreadExpanded ? 'Hide' : 'Show'} {(email.threadCount ?? 1) - 1} other email{(email.threadCount ?? 1) - 1 !== 1 ? 's' : ''} in this thread
                          {isThreadExpanded ? (
                            <ChevronUp aria-hidden="true" className="w-4 h-4" />
                          ) : (
                            <ChevronDown aria-hidden="true" className="w-4 h-4" />
                          )}
                        </button>

                        {isThreadExpanded && (
                          <div className="mt-3 space-y-2">
                            {email.threadEmails
                              .filter(te => te.id !== email.id)
                              .map((te) => {
                                const teUrgency = urgencyConfig[te.urgency as keyof typeof urgencyConfig] || urgencyConfig.low
                                return (
                                  <div
                                    key={te.id}
                                    className="flex items-start gap-3 bg-gray-50 dark:bg-surface-dark rounded-lg p-3 border border-gray-100 dark:border-gray-700"
                                  >
                                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${teUrgency.dot}`} aria-hidden="true"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                          {te.from_name || te.from_email}
                                        </span>
                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                          {new Date(te.received_at).toLocaleDateString(undefined, {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })}
                                        </span>
                                        <span className={`px-1.5 py-0.5 text-xs rounded-full ${teUrgency.color}`}>
                                          {teUrgency.label}
                                        </span>
                                      </div>
                                      {te.body_preview && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                          {te.body_preview}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {hasThread ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); markReplied(email.id, email.threadEmailIds) }}
                              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                            >
                              <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                              Reply to all ({email.threadCount})
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); markReplied(email.id, email.threadEmailIds, 'Marked as handled offline') }}
                              className="flex items-center gap-2 px-4 py-2 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition text-sm font-medium"
                            >
                              <Phone aria-hidden="true" className="w-4 h-4" />
                              Handled Offline
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); delegate(email.id, email.threadEmailIds) }}
                              className="flex items-center gap-2 px-4 py-2 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition text-sm font-medium"
                            >
                              <Forward aria-hidden="true" className="w-4 h-4" />
                              Forwarded
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); snooze(email.id, email.threadEmailIds) }}
                              className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                            >
                              <Clock aria-hidden="true" className="w-4 h-4" />
                              Snooze thread ({email.threadCount})
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); dismiss(email.id, email.threadEmailIds) }}
                              className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                              aria-label={`Dismiss thread of ${email.threadCount} emails`}
                            >
                              <X aria-hidden="true" className="w-4 h-4" />
                              Dismiss thread ({email.threadCount})
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); addTodoFromPage(`Reply to: ${email.subject}`, { type: 'missed_email', id: email.id }) }}
                              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition text-sm font-medium"
                            >
                              <ListChecks aria-hidden="true" className="w-4 h-4" />
                              To-Do
                            </button>
                            <OrganizeEmailPopover
                              fromEmail={email.from_email}
                              fromName={email.from_name}
                              fromDomain={email.from_email.split('@')[1] || ''}
                              subject={email.subject}
                              emailIds={email.threadEmailIds || [email.id]}
                              onComplete={loadEmails}
                            />
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); markReplied(email.id) }}
                              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                            >
                              <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                              Mark as Replied
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); markReplied(email.id, undefined, 'Marked as handled offline') }}
                              className="flex items-center gap-2 px-4 py-2 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition text-sm font-medium"
                            >
                              <Phone aria-hidden="true" className="w-4 h-4" />
                              Handled Offline
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); delegate(email.id) }}
                              className="flex items-center gap-2 px-4 py-2 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition text-sm font-medium"
                            >
                              <Forward aria-hidden="true" className="w-4 h-4" />
                              Forwarded
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); snooze(email.id) }}
                              className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                            >
                              <Clock aria-hidden="true" className="w-4 h-4" />
                              Snooze 1 Day
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); dismiss(email.id) }}
                              className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                              aria-label="Dismiss email"
                            >
                              <X aria-hidden="true" className="w-4 h-4" />
                              Dismiss
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); addTodoFromPage(`Reply to: ${email.subject}`, { type: 'missed_email', id: email.id }) }}
                              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition text-sm font-medium"
                            >
                              <ListChecks aria-hidden="true" className="w-4 h-4" />
                              To-Do
                            </button>
                            <OrganizeEmailPopover
                              fromEmail={email.from_email}
                              fromName={email.from_name}
                              fromDomain={email.from_email.split('@')[1] || ''}
                              subject={email.subject}
                              emailIds={[email.id]}
                              onComplete={loadEmails}
                            />
                          </>
                        )}
                      </div>

                      {/* Feedback buttons */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Was this helpful?</span>
                        {feedbackGiven[email.id] ? (
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                            feedbackGiven[email.id] === 'valid'
                              ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {feedbackGiven[email.id] === 'valid' ? 'Helpful' : 'Not helpful'}
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); submitFeedback(email, 'valid') }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 transition"
                              aria-label="Mark as valid — this email does need a response"
                              aria-pressed={feedbackGiven[email.id] === 'valid'}
                            >
                              <ThumbsUp aria-hidden="true" className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleThumbsDown(email) }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                              aria-label="Mark as invalid — this email should not have been flagged"
                              aria-pressed={feedbackGiven[email.id] === 'invalid'}
                            >
                              <ThumbsDown aria-hidden="true" className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 sm:p-6">
        <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 mb-2">How Missed Emails Works</h3>
        <p className="text-sm text-indigo-800 dark:text-indigo-300 mb-3">
          HeyWren uses AI to scan your inbox and surface emails where someone is waiting for your response.
          Sales pitches, newsletters, automated notifications, and mass emails are automatically filtered out.
        </p>
        <ul className="text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <li>&#10003; Prioritizes emails with direct questions and requests</li>
          <li>&#10003; Filters out sales, marketing, and automated emails</li>
          <li>&#10003; Highlights how long someone has been waiting</li>
          <li>&#10003; Extracts the specific question you need to answer</li>
          <li>&#10003; Groups emails from the same thread together</li>
          <li>&#10003; Scans daily after your Outlook sync at 6:30 AM PT</li>
        </ul>
      </div>

      {/* Feedback Reason Modal */}
      {feedbackModal?.show && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setFeedbackModal(null)}>
          <div className="bg-white dark:bg-surface-dark-secondary rounded-xl p-4 sm:p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Why isn&apos;t this helpful?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Your feedback trains the AI to be smarter for everyone.
            </p>

            <div className="space-y-2 mb-4">
              {[
                { value: 'not_my_email', label: 'This email isn\'t mine / wrong person' },
                { value: 'already_replied', label: 'I already responded to this' },
                { value: 'not_important', label: 'This doesn\'t need a response' },
                { value: 'spam_or_automated', label: 'This is spam, marketing, or automated' },
                { value: 'wrong_urgency', label: 'The urgency level is wrong' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setFeedbackReason(opt.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    feedbackReason === opt.value
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 border'
                      : 'border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setFeedbackModal(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (feedbackModal.email) {
                    submitFeedback(feedbackModal.email, 'invalid', feedbackReason || 'not_helpful')
                  }
                }}
                disabled={!feedbackReason}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
              >
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
