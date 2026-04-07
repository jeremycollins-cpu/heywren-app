'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  MailX, Check, X, Shield, Eye, EyeOff, Loader2,
  Inbox, AlertCircle, MailCheck, ChevronDown, ChevronUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import UpgradeGate from '@/components/upgrade-gate'

interface EmailSubscription {
  id: string
  from_name: string
  from_email: string
  sender_domain: string
  subject: string
  body_preview: string | null
  received_at: string
  is_read: boolean
  unsubscribe_url: string | null
  unsubscribe_mailto: string | null
  has_one_click: boolean
  detection_method: string
  email_count: number
  first_seen_at: string
  status: string
  unsubscribed_at: string | null
  unsubscribe_error: string | null
}

interface Stats {
  totalActive: number
  unreadCount: number
  oneClickCount: number
}

export default function UnsubscribePage() {
  const [subscriptions, setSubscriptions] = useState<EmailSubscription[]>([])
  const [handled, setHandled] = useState<EmailSubscription[]>([])
  const [stats, setStats] = useState<Stats>({ totalActive: 0, unreadCount: 0, oneClickCount: 0 })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({})
  const [showHandled, setShowHandled] = useState(false)

  const fetchSubscriptions = async () => {
    try {
      const res = await fetch('/api/email-subscriptions')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setSubscriptions(data.subscriptions || [])
      setHandled(data.handled || [])
      setStats(data.stats || { totalActive: 0, unreadCount: 0, oneClickCount: 0 })
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubscriptions()
  }, [])

  const handleAction = async (subscriptionId: string, action: 'unsubscribe' | 'keep') => {
    setActionLoading(prev => ({ ...prev, [subscriptionId]: action }))
    try {
      const res = await fetch('/api/email-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId, action }),
      })
      const result = await res.json()

      if (action === 'keep') {
        toast.success('Kept subscription')
      } else if (result.success) {
        toast.success('Unsubscribed successfully')
      } else {
        toast.error(result.error || 'Unsubscribe failed — try opening in Outlook')
      }

      // Move from active to handled
      setSubscriptions(prev => prev.filter(s => s.id !== subscriptionId))
      fetchSubscriptions()
    } catch (err) {
      toast.error('Something went wrong')
    } finally {
      setActionLoading(prev => {
        const next = { ...prev }
        delete next[subscriptionId]
        return next
      })
    }
  }

  const handleUnsubscribeAll = async () => {
    const oneClickSubs = subscriptions.filter(s => s.has_one_click || s.unsubscribe_url)
    if (oneClickSubs.length === 0) {
      toast.error('No subscriptions with one-click unsubscribe available')
      return
    }

    const confirmed = window.confirm(
      `Unsubscribe from ${oneClickSubs.length} email${oneClickSubs.length > 1 ? 's' : ''}? This will attempt to unsubscribe from all senders with an unsubscribe link.`
    )
    if (!confirmed) return

    let success = 0
    let failed = 0
    for (const sub of oneClickSubs) {
      try {
        const res = await fetch('/api/email-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptionId: sub.id, action: 'unsubscribe' }),
        })
        const result = await res.json()
        if (result.success) success++
        else failed++
      } catch {
        failed++
      }
    }

    toast.success(`Unsubscribed from ${success} sender${success !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}`)
    fetchSubscriptions()
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  if (loading) return <LoadingSkeleton variant="card" />

  return (
    <UpgradeGate featureKey="unsubscribe">
      <div className="max-w-4xl mx-auto space-y-6" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
              Unsubscribe
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
              Clean up your inbox — one-click unsubscribe from newsletters and marketing emails
            </p>
          </div>
          {subscriptions.length > 0 && (
            <button
              onClick={handleUnsubscribeAll}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)',
              }}
            >
              <MailX className="w-4 h-4" />
              Unsubscribe All ({stats.oneClickCount})
            </button>
          )}
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Inbox className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subscriptions</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalActive}</p>
            <p className="text-xs text-gray-500 mt-0.5">marketing senders detected</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <EyeOff className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Unread</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.unreadCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">you never even opened</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-green-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">One-Click</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.oneClickCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">instant unsubscribe available</p>
          </div>
        </div>

        {/* Empty state */}
        {subscriptions.length === 0 && !loading && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-12 text-center">
            <MailCheck className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Inbox is clean!</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm max-w-md mx-auto">
              No marketing subscriptions detected. We scan your inbox daily and will surface any new ones here.
            </p>
          </div>
        )}

        {/* Subscription list */}
        {subscriptions.length > 0 && (
          <div className="space-y-3">
            {subscriptions.map(sub => {
              const isActioning = actionLoading[sub.id]
              const canOneClick = sub.has_one_click || sub.unsubscribe_url

              return (
                <div
                  key={sub.id}
                  className={`bg-white dark:bg-gray-900 border rounded-xl p-4 transition-all ${
                    !sub.is_read
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10'
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                          {sub.from_name}
                        </span>
                        {!sub.is_read && (
                          <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded text-[10px] font-semibold uppercase">
                            <EyeOff className="w-2.5 h-2.5" />
                            Unread
                          </span>
                        )}
                        {canOneClick && (
                          <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-[10px] font-semibold uppercase">
                            <Shield className="w-2.5 h-2.5" />
                            One-Click
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {sub.from_email}
                      </p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 truncate">
                        {sub.subject}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span>{sub.email_count} email{sub.email_count !== 1 ? 's' : ''} in last 30 days</span>
                        <span>Last: {formatDate(sub.received_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleAction(sub.id, 'keep')}
                        disabled={!!isActioning}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40"
                        title="Keep this subscription"
                      >
                        {isActioning === 'keep' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        Keep
                      </button>
                      <button
                        onClick={() => handleAction(sub.id, 'unsubscribe')}
                        disabled={!!isActioning || !canOneClick}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition disabled:opacity-40 ${
                          canOneClick
                            ? 'text-white bg-red-600 hover:bg-red-700'
                            : 'text-gray-400 bg-gray-100 dark:bg-gray-800 cursor-not-allowed'
                        }`}
                        title={canOneClick ? 'Unsubscribe from this sender' : 'No unsubscribe link found — open in Outlook to unsubscribe manually'}
                      >
                        {isActioning === 'unsubscribe' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <MailX className="w-3.5 h-3.5" />
                        )}
                        Unsubscribe
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Handled section (collapsible) */}
        {handled.length > 0 && (
          <div>
            <button
              onClick={() => setShowHandled(!showHandled)}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition"
            >
              {showHandled ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {handled.length} handled subscription{handled.length !== 1 ? 's' : ''}
            </button>

            {showHandled && (
              <div className="mt-3 space-y-2">
                {handled.map(sub => (
                  <div
                    key={sub.id}
                    className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-xl p-3 opacity-70"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                          {sub.from_name}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          sub.status === 'unsubscribed'
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                            : sub.status === 'kept'
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                              : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                        }`}>
                          {sub.status === 'unsubscribed' && <Check className="w-2.5 h-2.5" />}
                          {sub.status === 'kept' && <Eye className="w-2.5 h-2.5" />}
                          {sub.status === 'failed' && <AlertCircle className="w-2.5 h-2.5" />}
                          {sub.status}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">{sub.from_email}</span>
                    </div>
                    {sub.status === 'failed' && sub.unsubscribe_error && (
                      <p className="text-xs text-red-500 mt-1">{sub.unsubscribe_error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </UpgradeGate>
  )
}
