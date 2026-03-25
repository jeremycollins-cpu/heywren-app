// app/(dashboard)/waiting-room/page.tsx
// "The Waiting Room" — Emails and chats you sent that are waiting for a reply.
// Action: "Send a Nudge" generates a gentle follow-up.

'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Clock, Send, X, AlertTriangle, Mail, MessageSquare, ExternalLink, Hourglass, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

interface WaitingItem {
  id: string
  source: 'outlook' | 'slack'
  to_recipients: string
  to_name: string
  subject: string | null
  body_preview: string | null
  sent_at: string
  urgency: string
  category: string
  wait_reason: string
  days_waiting: number
  status: string
  permalink: string | null
  channel_name: string | null
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const urgencyConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-l-red-500', label: 'Critical' },
  high: { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-l-amber-500', label: 'High' },
  medium: { color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-l-blue-400', label: 'Medium' },
  low: { color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-l-gray-300', label: 'Low' },
}

const categoryLabels: Record<string, string> = {
  question: 'Question asked',
  request: 'Request sent',
  decision: 'Approval needed',
  follow_up: 'Follow-up',
  introduction: 'Introduction',
  deliverable: 'Deliverable sent',
}

export default function WaitingRoomPage() {
  const supabase = createClient()
  const [items, setItems] = useState<WaitingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [filter, setFilter] = useState<'all' | 'critical' | 'email' | 'slack'>('all')

  const fetchItems = useCallback(async () => {
    try {
      // Pass userId as fallback for server-side session issues
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      const url = userId ? `/api/awaiting-replies?userId=${userId}` : '/api/awaiting-replies'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setItems(data.items || [])
      return data.items?.length || 0
    } catch (err) {
      console.error('Failed to load waiting room:', err)
      toast.error('Failed to load waiting items')
      return 0
    } finally {
      setLoading(false)
    }
  }, [])

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const res = await fetch('/api/awaiting-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData?.user?.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      toast.success(`Scanned ${data.scanned || 0} sent messages — found ${data.awaiting || 0} awaiting reply`)
      await fetchItems()
    } catch (err: any) {
      toast.error(err.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [fetchItems])

  useEffect(() => {
    // Fetch items, then auto-scan if empty (first visit)
    fetchItems().then(count => {
      if (count === 0) runScan()
    })
  }, [fetchItems, runScan])

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch('/api/awaiting-replies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setItems(prev => prev.filter(i => i.id !== id))
      toast.success(status === 'replied' ? 'Marked as replied' : 'Dismissed')
    } catch {
      toast.error('Failed to update')
    }
  }

  const sendNudge = (item: WaitingItem) => {
    const recipient = item.to_name || item.to_recipients.split(',')[0].trim()
    const subject = item.subject
      ? (item.subject.toLowerCase().startsWith('re:') ? item.subject : `Re: ${item.subject}`)
      : 'Quick follow-up'
    const body = `Hi ${recipient.split(' ')[0] || 'there'},\n\nJust circling back on my ${item.category === 'question' ? 'question' : 'message'} from ${formatDate(item.sent_at)}. Wanted to make sure this didn't slip through — let me know if you need anything from my end.\n\nThanks!`

    if (item.source === 'outlook' && item.permalink) {
      // Open in Outlook web with pre-composed reply
      window.open(item.permalink, '_blank')
      toast.success('Opening in Outlook — send your nudge!')
    } else {
      // Fallback: open mailto
      const mailtoUrl = `mailto:${item.to_recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      window.open(mailtoUrl, '_blank')
      toast.success('Nudge drafted — send it!')
    }
  }

  const filteredItems = items.filter(item => {
    if (filter === 'critical') return item.urgency === 'critical' || item.urgency === 'high'
    if (filter === 'email') return item.source === 'outlook'
    if (filter === 'slack') return item.source === 'slack'
    return true
  })

  const criticalCount = items.filter(i => i.urgency === 'critical' || i.urgency === 'high').length
  const avgWait = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.days_waiting, 0) / items.length) : 0

  if (loading || (scanning && items.length === 0)) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true">
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)' }}>
            <Hourglass className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Scanning your sent messages...</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md text-center">
            Checking your Outlook sent items for messages that haven&apos;t received a reply yet. This may take a moment.
          </p>
        </div>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded"></div>
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)' }}>
              <Hourglass className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">The Waiting Room</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Messages you sent that are still waiting for a reply</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{items.length}</p>
            <p className="text-xs text-gray-500">waiting</p>
          </div>
          {criticalCount > 0 && (
            <>
              <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
              <div className="text-right">
                <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
                <p className="text-xs text-gray-500">urgent</p>
              </div>
            </>
          )}
          <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-600">{avgWait}d</p>
            <p className="text-xs text-gray-500">avg wait</p>
          </div>
          <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark rounded-lg p-0.5 w-fit">
        {([
          { key: 'all' as const, label: 'All' },
          { key: 'critical' as const, label: 'Urgent' },
          { key: 'email' as const, label: 'Email' },
          { key: 'slack' as const, label: 'Slack' },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              filter === f.key
                ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
          <Hourglass className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
            {items.length === 0 ? 'No one keeping you waiting' : 'No items match this filter'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {items.length === 0
              ? 'Wren scans your sent emails daily and surfaces messages that haven\'t received a reply. Check back after the next scan.'
              : 'Try a different filter to see other waiting items.'}
          </p>
        </div>
      )}

      {/* Waiting items */}
      <div className="space-y-3">
        {filteredItems.map(item => {
          const urg = urgencyConfig[item.urgency] || urgencyConfig.medium
          const catLabel = categoryLabels[item.category] || 'Message sent'
          const recipientDisplay = item.to_name || item.to_recipients.split(',')[0].trim()
          const daysText = item.days_waiting === 0 ? 'Today' : item.days_waiting === 1 ? '1 day' : `${item.days_waiting} days`

          return (
            <div key={item.id} className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${urg.border} rounded-xl p-5 transition hover:shadow-md`}>
              {/* Top row: badges + dismiss */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${urg.bg} ${urg.color}`}>
                    {urg.label.toUpperCase()}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {catLabel}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    item.source === 'slack' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                  }`}>
                    {item.source === 'slack' ? <MessageSquare className="w-3 h-3 inline mr-0.5" /> : <Mail className="w-3 h-3 inline mr-0.5" />}
                    {item.source === 'slack' ? 'SLACK' : 'EMAIL'}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {daysText} waiting
                  </span>
                </div>
                <button
                  onClick={() => updateStatus(item.id, 'dismissed')}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Recipient + subject */}
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    To: {recipientDisplay}
                  </span>
                  {item.to_recipients.includes(',') && (
                    <span className="text-xs text-gray-400">+{item.to_recipients.split(',').length - 1} more</span>
                  )}
                </div>
                {item.subject && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mt-0.5">{item.subject}</p>
                )}
              </div>

              {/* Wait reason */}
              <div className="flex items-center gap-1.5 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                  {item.wait_reason} — sent {formatDate(item.sent_at)}
                  {item.channel_name && <span className="text-gray-400 font-normal"> in #{item.channel_name}</span>}
                </span>
              </div>

              {/* Preview */}
              {item.body_preview && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2 leading-relaxed">
                  {item.body_preview}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => sendNudge(item)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg transition hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <Send className="w-3.5 h-3.5" />
                  Send a Nudge
                </button>
                <button
                  onClick={() => updateStatus(item.id, 'replied')}
                  className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Already replied
                </button>
                {item.permalink && (
                  <a
                    href={item.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open original
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
