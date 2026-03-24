'use client'

import { useEffect, useState } from 'react'
import {
  Mail, AlertTriangle, Clock, CheckCircle2, X, Eye, EyeOff,
  MailWarning, RefreshCw, ArrowRight, ChevronDown, ChevronUp
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

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
}

export default function MissedEmailsPage() {
  const [emails, setEmails] = useState<MissedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all')
  const [scanning, setScanning] = useState(false)

  async function loadEmails() {
    try {
      const res = await fetch('/api/missed-emails')
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setEmails(data.missedEmails || [])
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

  async function markReplied(id: string) {
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'replied' }),
      })
      if (res.ok) {
        setEmails(emails.filter(e => e.id !== id))
        toast.success('Marked as replied')
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  async function dismiss(id: string) {
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed' }),
      })
      if (res.ok) {
        setEmails(emails.filter(e => e.id !== id))
        toast.success('Dismissed')
      }
    } catch {
      toast.error('Failed to dismiss')
    }
  }

  async function snooze(id: string) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    try {
      const res = await fetch('/api/missed-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'snoozed', snoozed_until: tomorrow }),
      })
      if (res.ok) {
        setEmails(emails.filter(e => e.id !== id))
        toast.success('Snoozed until tomorrow')
      }
    } catch {
      toast.error('Failed to snooze')
    }
  }

  async function triggerScan() {
    setScanning(true)
    try {
      // This would trigger the Inngest function via API
      // For now, just refresh the data
      await loadEmails()
      toast.success('Refreshed missed emails')
    } catch {
      toast.error('Failed to scan')
    }
    setScanning(false)
  }

  const filteredEmails = filter === 'all'
    ? emails
    : emails.filter(e => e.urgency === filter)

  const criticalCount = emails.filter(e => e.urgency === 'critical').length
  const highCount = emails.filter(e => e.urgency === 'high').length
  const mediumCount = emails.filter(e => e.urgency === 'medium').length
  const lowCount = emails.filter(e => e.urgency === 'low').length

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading missed emails">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-lg"></div>)}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg"></div>)}
          </div>
        </div>
      </div>
    )
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Missed Emails</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Emails waiting for your response that may have slipped through the cracks. Sales and automated emails are filtered out.
          </p>
        </div>
        <button
          onClick={triggerScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

      {/* Filter indicator */}
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
          </div>
        ) : (
          filteredEmails.map((email) => {
            const config = urgencyConfig[email.urgency]
            const isExpanded = expandedId === email.id

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
                    <div className="flex-1 min-w-0">
                      {/* Top row: badges */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                          {categoryLabels[email.category] || email.category}
                        </span>
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

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => { e.stopPropagation(); markReplied(email.id) }}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                      >
                        <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                        Mark as Replied
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
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6">
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
          <li>&#10003; Scans daily after your Outlook sync at 6:30 AM PT</li>
        </ul>
      </div>
    </div>
  )
}
