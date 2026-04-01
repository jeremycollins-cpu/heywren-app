// app/(dashboard)/waiting-room/page.tsx
// "The Waiting Room" — Emails and chats you sent that are waiting for a reply.
// Action: "Send a Nudge" generates a gentle follow-up.

'use client'

import { useEffect, useState, useCallback } from 'react'
import { Clock, Send, X, AlertTriangle, Mail, MessageSquare, ExternalLink, Hourglass, RefreshCw, ChevronDown, ChevronUp, Layers, ArrowUpDown, CheckCircle2, Phone } from 'lucide-react'
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
  channel_id: string | null
  channel_name: string | null
  conversation_id: string | null
}

interface ConversationGroup {
  key: string
  primary: WaitingItem
  items: WaitingItem[]
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
  const [items, setItems] = useState<WaitingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [filter, setFilter] = useState<'all' | 'critical' | 'email' | 'slack'>('all')
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest' | 'urgency'>('urgency')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [bulkActioning, setBulkActioning] = useState(false)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/awaiting-replies')
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
      const res = await fetch('/api/awaiting-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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

  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set())

  const updateStatus = async (id: string, status: string, toastMsg?: string) => {
    if (actioningIds.has(id)) return
    setActioningIds(prev => new Set(prev).add(id))
    // Optimistically remove from UI immediately
    setItems(prev => prev.filter(i => i.id !== id))
    try {
      const res = await fetch('/api/awaiting-replies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(toastMsg || (status === 'replied' ? 'Marked as replied' : 'Dismissed'))
    } catch {
      toast.error('Failed to update')
      // Re-fetch on failure to restore state
      fetchItems()
    } finally {
      setActioningIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  const sendNudge = (item: WaitingItem) => {
    const rawRecipient = item.to_name || item.to_recipients.split(',')[0].trim()
    const recipient = /^(<?\s*unknown\s*>?|someone)$/i.test(rawRecipient) ? (item.channel_name || 'there') : rawRecipient
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

  const toggleSelectGroup = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function bulkAction(status: 'replied' | 'dismissed') {
    if (selectedKeys.size === 0) return
    setBulkActioning(true)
    // Collect all item IDs from selected groups
    const allIds: string[] = []
    for (const group of groups) {
      if (selectedKeys.has(group.key)) {
        for (const gi of group.items) allIds.push(gi.id)
      }
    }
    try {
      await Promise.all(allIds.map(id =>
        fetch('/api/awaiting-replies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        })
      ))
      const idsToRemove = new Set(allIds)
      setItems(prev => prev.filter(i => !idsToRemove.has(i.id)))
      toast.success(`${selectedKeys.size} item${selectedKeys.size > 1 ? 's' : ''} ${status === 'replied' ? 'marked as replied' : 'dismissed'}`)
      setSelectedKeys(new Set())
    } catch {
      toast.error('Failed to update')
    } finally {
      setBulkActioning(false)
    }
  }

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filteredItems = items.filter(item => {
    if (filter === 'critical') return item.urgency === 'critical' || item.urgency === 'high'
    if (filter === 'email') return item.source === 'outlook'
    if (filter === 'slack') return item.source === 'slack'
    return true
  })

  // Group items by thread: emails by conversation_id, Slack by channel_id
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const groups: ConversationGroup[] = (() => {
    const convMap = new Map<string, WaitingItem[]>()
    const ungrouped: WaitingItem[] = []

    for (const item of filteredItems) {
      // Group emails by conversation_id
      if (item.conversation_id && item.source === 'outlook') {
        const key = `outlook:${item.conversation_id}`
        const existing = convMap.get(key)
        if (existing) existing.push(item)
        else convMap.set(key, [item])
      // Group Slack messages by channel_id
      } else if (item.channel_id && item.source === 'slack') {
        const key = `slack:${item.channel_id}`
        const existing = convMap.get(key)
        if (existing) existing.push(item)
        else convMap.set(key, [item])
      } else {
        ungrouped.push(item)
      }
    }

    const result: ConversationGroup[] = []

    for (const [convId, convItems] of convMap) {
      // Sort by urgency then recency — most urgent/recent first
      convItems.sort((a, b) => {
        const ud = (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2)
        if (ud !== 0) return ud
        return b.days_waiting - a.days_waiting
      })
      result.push({ key: convId, primary: convItems[0], items: convItems })
    }

    for (const item of ungrouped) {
      result.push({ key: item.id, primary: item, items: [item] })
    }

    // Sort groups based on user-selected sort order
    if (sortOrder === 'oldest') {
      result.sort((a, b) => b.primary.days_waiting - a.primary.days_waiting)
    } else if (sortOrder === 'newest') {
      result.sort((a, b) => a.primary.days_waiting - b.primary.days_waiting)
    } else {
      // Default: urgency first, then longest waiting
      result.sort((a, b) => {
        const ua = urgencyOrder[a.primary.urgency] ?? 2
        const ub = urgencyOrder[b.primary.urgency] ?? 2
        if (ua !== ub) return ua - ub
        return b.primary.days_waiting - a.primary.days_waiting
      })
    }

    return result
  })()

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
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)' }}>
            <Hourglass className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">The Waiting Room</h1>
            <p className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm mt-0.5">Messages you sent that are still waiting for a reply</p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-center sm:text-right">
            <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{groups.length}</p>
            <p className="text-[10px] sm:text-xs text-gray-500">{groups.length !== items.length ? `threads (${items.length} msgs)` : 'waiting'}</p>
          </div>
          {criticalCount > 0 && (
            <>
              <div className="w-px h-8 sm:h-10 bg-gray-200 dark:bg-gray-700" />
              <div className="text-center sm:text-right">
                <p className="text-xl sm:text-2xl font-bold text-red-600">{criticalCount}</p>
                <p className="text-[10px] sm:text-xs text-gray-500">urgent</p>
              </div>
            </>
          )}
          <div className="w-px h-8 sm:h-10 bg-gray-200 dark:bg-gray-700" />
          <div className="text-center sm:text-right">
            <p className="text-xl sm:text-2xl font-bold text-amber-600">{avgWait}d</p>
            <p className="text-[10px] sm:text-xs text-gray-500">avg wait</p>
          </div>
          <div className="ml-auto">
            <button
              onClick={runScan}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{scanning ? 'Scanning...' : 'Scan Now'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters + Sort */}
      <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark rounded-lg p-0.5">
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
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark rounded-lg p-0.5">
          {([
            { key: 'urgency' as const, label: 'By Urgency' },
            { key: 'oldest' as const, label: 'Oldest First' },
            { key: 'newest' as const, label: 'Newest First' },
          ]).map(s => (
            <button
              key={s.key}
              onClick={() => setSortOrder(s.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${
                sortOrder === s.key
                  ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              {s.key === sortOrder && <ArrowUpDown className="w-3 h-3" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {groups.length === 0 && (
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

      {/* Bulk action bar */}
      {groups.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
          <input
            type="checkbox"
            checked={selectedKeys.size === groups.length && groups.length > 0}
            onChange={() => {
              if (selectedKeys.size === groups.length) {
                setSelectedKeys(new Set())
              } else {
                setSelectedKeys(new Set(groups.map(g => g.key)))
              }
            }}
            className="w-4 h-4 rounded cursor-pointer accent-indigo-600"
          />
          {selectedKeys.size > 0 ? (
            <>
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {selectedKeys.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => bulkAction('replied')}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Already Replied
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
            <span className="text-sm text-gray-500 dark:text-gray-400">Select items for bulk actions</span>
          )}
        </div>
      )}

      {/* Waiting items — grouped by conversation */}
      <div className="space-y-3">
        {groups.map(group => {
          const item = group.primary
          const isGrouped = group.items.length > 1
          const isExpanded = expandedGroups.has(group.key)
          // For grouped items, use the highest urgency across the group
          const groupUrgency = isGrouped
            ? (['critical', 'high', 'medium', 'low'] as const).find(u => group.items.some(i => i.urgency === u)) || item.urgency
            : item.urgency
          const urg = urgencyConfig[groupUrgency] || urgencyConfig.medium
          const catLabel = categoryLabels[item.category] || 'Message sent'
          const rawName = item.to_name || item.to_recipients.split(',')[0].trim()
          const recipientDisplay = /^(<?\s*unknown\s*>?|someone)$/i.test(rawName) ? (item.channel_name || 'Slack conversation') : rawName
          // For groups, show the longest waiting time
          const maxWait = isGrouped ? Math.max(...group.items.map(i => i.days_waiting)) : item.days_waiting
          const daysText = maxWait === 0 ? 'Today' : maxWait === 1 ? '1 day' : `${maxWait} days`
          // For grouped items, show the subject from the conversation (strip Re:/Fw: prefixes for cleaner display)
          const threadSubject = item.subject?.replace(/^(re:\s*|fw:\s*|fwd:\s*)+/i, '').trim() || null

          return (
            <div key={group.key} className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${urg.border} rounded-xl transition hover:shadow-md`}>
              <div className="p-4 sm:p-5">
                {/* Top row: checkbox + badges + group indicator + dismiss */}
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(group.key)}
                      onChange={() => toggleSelectGroup(group.key)}
                      className="w-4 h-4 rounded cursor-pointer accent-indigo-600 flex-shrink-0"
                    />
                    <span className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-bold ${urg.bg} ${urg.color}`}>
                      {urg.label.toUpperCase()}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {catLabel}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium ${
                      item.source === 'slack' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                    }`}>
                      {item.source === 'slack' ? <MessageSquare className="w-3 h-3 inline mr-0.5" /> : <Mail className="w-3 h-3 inline mr-0.5" />}
                      {item.source === 'slack' ? 'SLACK' : 'EMAIL'}
                    </span>
                    {isGrouped && (
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition cursor-pointer"
                      >
                        <Layers className="w-3 h-3" />
                        {group.items.length} msgs
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                    <span className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-400">
                      <Clock className="w-3 h-3" />
                      {daysText}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isGrouped && (
                      <button
                        onClick={() => toggleGroup(group.key)}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded"
                        title={isExpanded ? 'Collapse thread' : 'Expand thread'}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        for (const gi of group.items) updateStatus(gi.id, 'dismissed')
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded"
                      title={isGrouped ? 'Dismiss entire thread' : 'Dismiss'}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
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
                  {threadSubject && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mt-0.5">{isGrouped ? threadSubject : item.subject}</p>
                  )}
                </div>

                {/* Wait reason */}
                <div className="flex items-center gap-1.5 mb-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                    {item.wait_reason.replace(/<?\s*unknown\s*>?/gi, recipientDisplay)} — sent {formatDate(item.sent_at)}
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => sendNudge(item)}
                    className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-white rounded-lg transition hover:opacity-90"
                    style={{
                      background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                      boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
                    }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send a Nudge
                  </button>
                  <button
                    onClick={() => {
                      for (const gi of group.items) updateStatus(gi.id, 'replied')
                    }}
                    className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    Already replied
                  </button>
                  <button
                    onClick={() => {
                      for (const gi of group.items) updateStatus(gi.id, 'replied', 'Marked as handled offline')
                    }}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Handled Offline
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

              {/* Expanded: show other messages in this conversation thread */}
              {isGrouped && isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 rounded-b-xl">
                  {group.items.slice(1).map(sub => {
                    const subUrg = urgencyConfig[sub.urgency] || urgencyConfig.medium
                    const subCat = categoryLabels[sub.category] || 'Message sent'
                    return (
                      <div key={sub.id} className="px-5 py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-700/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${subUrg.bg} ${subUrg.color}`}>
                              {subUrg.label.toUpperCase()}
                            </span>
                            <span className="text-[10px] text-gray-400">{subCat}</span>
                            <span className="text-[10px] text-gray-400">sent {formatDate(sub.sent_at)}</span>
                          </div>
                          <button
                            onClick={() => updateStatus(sub.id, 'dismissed')}
                            className="p-0.5 text-gray-300 hover:text-gray-500 transition rounded"
                            title="Dismiss this message"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {sub.body_preview && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                            {sub.body_preview}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
