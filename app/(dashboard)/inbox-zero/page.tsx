'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Inbox, CheckCircle2, X, ChevronDown, ChevronUp, RefreshCw,
  Zap, Mail, Eye, ExternalLink, ArrowRight, SkipForward, Loader2,
  Trophy, Target,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Email {
  id: string
  subject: string
  from_name: string
  from_email: string
  received_at: string
  body_preview: string
  web_link: string
}

interface CategoryGroup {
  category: string
  emailCount: number
  senderCount: number
  emails: Email[]
}

// Color palette for category cards
const CATEGORY_COLORS: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  'Dev Tools': { bg: 'bg-gray-50 dark:bg-gray-800/50', border: 'border-gray-300 dark:border-gray-600', badge: 'bg-gray-600', icon: 'text-gray-600 dark:text-gray-400' },
  'Project Tools': { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-300 dark:border-blue-700', badge: 'bg-blue-600', icon: 'text-blue-600 dark:text-blue-400' },
  'Chat Notifications': { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-300 dark:border-purple-700', badge: 'bg-purple-600', icon: 'text-purple-600 dark:text-purple-400' },
  'Cloud & Infrastructure': { bg: 'bg-sky-50 dark:bg-sky-900/20', border: 'border-sky-300 dark:border-sky-700', badge: 'bg-sky-600', icon: 'text-sky-600 dark:text-sky-400' },
  'Monitoring & Alerts': { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-300 dark:border-red-700', badge: 'bg-red-600', icon: 'text-red-600 dark:text-red-400' },
  'LinkedIn': { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-400 dark:border-blue-600', badge: 'bg-blue-700', icon: 'text-blue-700 dark:text-blue-400' },
  'Social Media': { bg: 'bg-pink-50 dark:bg-pink-900/20', border: 'border-pink-300 dark:border-pink-700', badge: 'bg-pink-600', icon: 'text-pink-600 dark:text-pink-400' },
  'Shopping & Transactions': { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-300 dark:border-amber-700', badge: 'bg-amber-600', icon: 'text-amber-600 dark:text-amber-400' },
  'Newsletters & Updates': { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-300 dark:border-emerald-700', badge: 'bg-emerald-600', icon: 'text-emerald-600 dark:text-emerald-400' },
  'Calendar': { bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-300 dark:border-indigo-700', badge: 'bg-indigo-600', icon: 'text-indigo-600 dark:text-indigo-400' },
  'Security & Auth': { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-300 dark:border-orange-700', badge: 'bg-orange-600', icon: 'text-orange-600 dark:text-orange-400' },
  'SaaS & Subscriptions': { bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-300 dark:border-violet-700', badge: 'bg-violet-600', icon: 'text-violet-600 dark:text-violet-400' },
  'CRM & Support': { bg: 'bg-teal-50 dark:bg-teal-900/20', border: 'border-teal-300 dark:border-teal-700', badge: 'bg-teal-600', icon: 'text-teal-600 dark:text-teal-400' },
  'HR & Benefits': { bg: 'bg-lime-50 dark:bg-lime-900/20', border: 'border-lime-300 dark:border-lime-700', badge: 'bg-lime-600', icon: 'text-lime-600 dark:text-lime-400' },
  'Design Tools': { bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20', border: 'border-fuchsia-300 dark:border-fuchsia-700', badge: 'bg-fuchsia-600', icon: 'text-fuchsia-600 dark:text-fuchsia-400' },
  'System Notifications': { bg: 'bg-slate-50 dark:bg-slate-800/50', border: 'border-slate-300 dark:border-slate-600', badge: 'bg-slate-600', icon: 'text-slate-600 dark:text-slate-400' },
}

const DEFAULT_COLOR = { bg: 'bg-gray-50 dark:bg-gray-800/40', border: 'border-gray-300 dark:border-gray-600', badge: 'bg-gray-500', icon: 'text-gray-500 dark:text-gray-400' }

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] || DEFAULT_COLOR
}

export default function InboxZeroPage() {
  const [categories, setCategories] = useState<CategoryGroup[]>([])
  const [totalUnread, setTotalUnread] = useState(0)
  const [processedCount, setProcessedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [actioningCategory, setActioningCategory] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [completed, setCompleted] = useState(false)

  const loadEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox-zero')
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setCategories(data.categories || [])
        setTotalUnread(data.totalUnread || 0)
        setProcessedCount(0)
        setActiveIndex(0)
        setCompleted(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEmails()
  }, [loadEmails])

  // Keyboard shortcuts for speed
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (categories.length === 0 || completed) return

      const currentCategory = categories[activeIndex]
      if (!currentCategory) return

      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        disregardCategory(currentCategory)
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowRight') {
        e.preventDefault()
        skipCategory()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setExpandedCategory(prev => prev === currentCategory.category ? null : currentCategory.category)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [categories, activeIndex, completed])

  async function disregardCategory(group: CategoryGroup) {
    if (actioningCategory) return
    setActioningCategory(group.category)

    const messageIds = group.emails.map(e => e.id)

    try {
      const res = await fetch('/api/inbox-zero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds }),
      })
      const data = await res.json()

      if (res.ok) {
        const marked = data.marked ?? group.emailCount
        const failed = data.failed ?? 0

        setProcessedCount(prev => prev + marked)
        setCategories(prev => prev.filter(c => c.category !== group.category))
        setExpandedCategory(null)

        if (failed > 0 && marked > 0) {
          toast.success(`Marked ${marked} as read in Outlook (${failed} failed)`)
        } else if (failed > 0 && marked === 0) {
          toast.error(`Failed to mark emails as read in Outlook — check your Outlook connection`)
        } else {
          toast.success(`Marked ${marked} email${marked > 1 ? 's' : ''} as read in Outlook`)
        }

        // Check if we're done
        if (categories.length <= 1) {
          setCompleted(true)
        } else if (activeIndex >= categories.length - 1) {
          setActiveIndex(Math.max(0, categories.length - 2))
        }
      } else {
        toast.error(data.error || 'Failed to mark emails as read')
      }
    } catch {
      toast.error('Failed to disregard emails')
    } finally {
      setActioningCategory(null)
    }
  }

  async function disregardSingleEmail(email: Email, category: string) {
    try {
      const res = await fetch('/api/inbox-zero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: [email.id] }),
      })

      if (res.ok) {
        setProcessedCount(prev => prev + 1)
        setCategories(prev =>
          prev.map(c => {
            if (c.category !== category) return c
            const remaining = c.emails.filter(e => e.id !== email.id)
            if (remaining.length === 0) return c // will be filtered below
            return { ...c, emails: remaining, emailCount: remaining.length }
          }).filter(c => c.emailCount > 0)
        )
        toast.success('Marked as read')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to mark as read')
      }
    } catch {
      toast.error('Failed to mark as read')
    }
  }

  function skipCategory() {
    if (activeIndex < categories.length - 1) {
      setActiveIndex(prev => prev + 1)
      setExpandedCategory(null)
    } else {
      // All categories reviewed
      setCompleted(true)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    setLoading(true)
    setError(null)
    await loadEmails()
    setRefreshing(false)
  }

  const remainingCount = categories.reduce((sum, c) => sum + c.emailCount, 0)
  const progressPercent = totalUnread > 0 ? Math.round((processedCount / totalUnread) * 100) : 0

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  // Celebration screen when inbox is at zero (but NOT if there's an error)
  if (!error && (completed || categories.length === 0)) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-6 animate-bounce">
            <Trophy className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
            {processedCount > 0 ? 'Inbox Zero Achieved!' : 'Inbox Zero!'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-md mb-2">
            {processedCount > 0
              ? `You just processed ${processedCount} email${processedCount > 1 ? 's' : ''}. Your inbox is clean.`
              : 'No unread emails in your inbox. You\'re already at zero!'
            }
          </p>
          {remainingCount > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {remainingCount} email{remainingCount > 1 ? 's' : ''} skipped for later review.
            </p>
          )}
          <button
            onClick={handleRefresh}
            className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    )
  }

  const currentCategory = categories[activeIndex]

  // Error state with no data — show error + retry
  if (error && categories.length === 0) {
    return (
      <div className="space-y-6">
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
          <p className="text-sm font-medium">{error}</p>
        </div>
        <div className="flex justify-center">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Target className="w-7 h-7 text-indigo-500" />
            Inbox Zero
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Fly through your unread emails by category. Disregard to mark as read, skip to keep.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Progress Bar */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Inbox className="w-5 h-5 text-indigo-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {remainingCount} unread remaining
              </span>
            </div>
            {processedCount > 0 && (
              <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                {processedCount} cleared
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{progressPercent}%</span>
        </div>
        <div className="w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-green-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} to review
          </span>
          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">D</kbd> Disregard</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">S</kbd> Skip</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">&darr;</kbd> Expand</span>
          </div>
        </div>
      </div>

      {/* Active Category Card */}
      {currentCategory && (
        <ActiveCategoryCard
          group={currentCategory}
          isExpanded={expandedCategory === currentCategory.category}
          onToggleExpand={() => setExpandedCategory(prev =>
            prev === currentCategory.category ? null : currentCategory.category
          )}
          onDisregard={() => disregardCategory(currentCategory)}
          onDisregardSingle={(email) => disregardSingleEmail(email, currentCategory.category)}
          onSkip={skipCategory}
          isActioning={actioningCategory === currentCategory.category}
        />
      )}

      {/* Upcoming categories (queue) */}
      {categories.length > 1 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Up Next ({categories.length - 1} more)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map((group, idx) => {
              if (idx === activeIndex) return null
              const color = getCategoryColor(group.category)
              return (
                <button
                  key={group.category}
                  onClick={() => {
                    setActiveIndex(idx)
                    setExpandedCategory(null)
                  }}
                  className={`${color.bg} border ${color.border} rounded-lg p-4 text-left transition hover:shadow-md hover:scale-[1.02] active:scale-[0.98]`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white truncate pr-2">{group.category}</span>
                    <span className={`${color.badge} text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center`}>
                      {group.emailCount}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {group.senderCount} sender{group.senderCount > 1 ? 's' : ''}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ActiveCategoryCard({
  group,
  isExpanded,
  onToggleExpand,
  onDisregard,
  onDisregardSingle,
  onSkip,
  isActioning,
}: {
  group: CategoryGroup
  isExpanded: boolean
  onToggleExpand: () => void
  onDisregard: () => void
  onDisregardSingle: (email: Email) => void
  onSkip: () => void
  isActioning: boolean
}) {
  const color = getCategoryColor(group.category)

  // Show unique senders for the preview
  const senderMap = new Map<string, { name: string; count: number }>()
  for (const email of group.emails) {
    const key = email.from_email.toLowerCase()
    const existing = senderMap.get(key)
    if (existing) {
      existing.count++
    } else {
      senderMap.set(key, { name: email.from_name || email.from_email, count: 1 })
    }
  }
  const topSenders = Array.from(senderMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)

  return (
    <div className={`${color.bg} border-2 ${color.border} rounded-xl overflow-hidden shadow-lg transition-all`}>
      {/* Card Header */}
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${color.badge} bg-opacity-10 dark:bg-opacity-20 flex items-center justify-center`}>
              <Mail className={`w-6 h-6 ${color.icon}`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{group.category}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {group.emailCount} email{group.emailCount > 1 ? 's' : ''} from {group.senderCount} sender{group.senderCount > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <span className={`${color.badge} text-white text-lg font-bold px-4 py-1.5 rounded-full`}>
            {group.emailCount}
          </span>
        </div>

        {/* Top senders preview */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Top senders</p>
          <div className="flex flex-wrap gap-2">
            {topSenders.map(([email, { name, count }]) => (
              <span key={email} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/70 dark:bg-white/10 rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200/50 dark:border-white/10">
                {name}
                {count > 1 && <span className="text-gray-400 dark:text-gray-500">({count})</span>}
              </span>
            ))}
            {senderMap.size > 5 && (
              <span className="inline-flex items-center px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500">
                +{senderMap.size - 5} more
              </span>
            )}
          </div>
        </div>

        {/* Sample subjects */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Recent subjects</p>
          <div className="space-y-1">
            {group.emails.slice(0, 3).map(email => (
              <p key={email.id} className="text-sm text-gray-600 dark:text-gray-300 truncate">
                {email.subject}
              </p>
            ))}
            {group.emails.length > 3 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                +{group.emails.length - 3} more...
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={onDisregard}
            disabled={isActioning}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition font-semibold text-sm disabled:opacity-50 shadow-sm hover:shadow-md"
          >
            {isActioning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {isActioning ? 'Marking as read...' : `Disregard All (${group.emailCount})`}
          </button>
          <button
            onClick={onSkip}
            disabled={isActioning}
            className="flex items-center justify-center gap-2 px-5 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-white/50 dark:hover:bg-white/5 transition font-semibold text-sm disabled:opacity-50"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </button>
          <button
            onClick={onToggleExpand}
            className="flex items-center justify-center p-3 border-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl hover:bg-white/50 dark:hover:bg-white/5 transition"
            title="Review individual emails"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded: Individual emails */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-black/20 max-h-[400px] overflow-y-auto">
          {group.emails.map((email, idx) => (
            <div
              key={email.id}
              className={`flex items-start gap-3 px-6 py-3 hover:bg-white/80 dark:hover:bg-white/5 transition ${
                idx < group.emails.length - 1 ? 'border-b border-gray-100 dark:border-gray-800' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {email.from_name || email.from_email}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {new Date(email.received_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{email.subject}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{email.body_preview}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 pt-1">
                {email.web_link && (
                  <a
                    href={email.web_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Open in Outlook"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => onDisregardSingle(email)}
                  className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="Mark as read"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
