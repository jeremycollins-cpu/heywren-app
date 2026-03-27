// app/(dashboard)/commitments/page.tsx
// Commitment Tracing v7 — Search, filters, bulk actions, rich context cards

'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Search, Filter, CheckCircle2, X, ChevronDown, Plus, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

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
  creator_id: string | null
  assignee_id: string | null
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
  if (c.status === 'likely_complete') return { label: 'LIKELY DONE', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30' }
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
    case 'professional': return null
    case 'casual': return null
    default: return null
  }
}

type FilterSource = 'all' | 'slack' | 'outlook' | 'recording' | 'manual'
type FilterUrgency = 'all' | 'critical' | 'high' | 'medium' | 'low'
type FilterHealth = 'all' | 'at_risk' | 'stalled' | 'active'
type SortBy = 'newest' | 'oldest' | 'score' | 'urgency'

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'for_you' | 'all_team' | 'completed'>('for_you')

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState<FilterSource>('all')
  const [filterUrgency, setFilterUrgency] = useState<FilterUrgency>('all')
  const [filterHealth, setFilterHealth] = useState<FilterHealth>('all')
  const [sortBy, setSortBy] = useState<SortBy>('newest')
  const [showFilters, setShowFilters] = useState(false)

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActioning, setBulkActioning] = useState(false)

  // Quick add
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickUrgency, setQuickUrgency] = useState<'high' | 'medium' | 'low'>('medium')
  const [quickSubmitting, setQuickSubmitting] = useState(false)

  // User identity for personal relevance matching
  const [userName, setUserName] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [userId, setUserId] = useState<string>('')

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setLoading(false); return }

        setUserId(userData.user.id)
        setUserEmail(userData.user.email || '')

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id, display_name')
          .eq('id', userData.user.id)
          .single()

        let teamId = profile?.current_team_id || null

        // Fallback: get team from team_members
        if (!teamId) {
          const { data: membership } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', userData.user.id)
            .limit(1)
            .single()
          teamId = membership?.team_id || null
        }

        if (!teamId) { setLoading(false); return }

        // Store user's name for personal relevance matching
        const name = profile?.display_name || userData.user.email?.split('@')[0] || ''
        setUserName(name)

        // Fetch ALL team commitments — personal filtering happens client-side
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

  // Determine if a commitment is personally relevant to the current user.
  // Only shows items where the user is directly involved — not all team items.
  const isPersonallyRelevant = (c: Commitment): boolean => {
    // 1. User is the assignee or creator
    if (c.assignee_id === userId) return true
    if (c.creator_id === userId) return true

    // 2. User's name appears in stakeholders, title, description, or quote
    const nameLower = userName.toLowerCase()
    const firstName = nameLower.split(' ')[0]
    if (firstName && firstName.length >= 3) {
      const stakeholders = c.metadata?.stakeholders
      if (Array.isArray(stakeholders)) {
        for (const s of stakeholders) {
          if (!s.name) continue
          const sLower = s.name.toLowerCase()
          if (sLower === nameLower || sLower.includes(firstName) || nameLower.includes(sLower)) {
            return true
          }
        }
      }

      const combined = (c.title + ' ' + (c.description || '') + ' ' + (c.metadata?.originalQuote || '')).toLowerCase()
      if (combined.includes(firstName)) return true
    }

    return false
  }

  async function updateStatus(id: string, newStatus: string) {
    const supabase = createClient()
    await supabase.from('commitments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    setCommitments(prev => prev.map(c => c.id === id ? { ...c, status: newStatus, updated_at: new Date().toISOString() } : c))
  }

  async function bulkComplete() {
    if (selectedIds.size === 0) return
    setBulkActioning(true)
    try {
      const supabase = createClient()
      const now = new Date().toISOString()
      const ids = Array.from(selectedIds)
      await supabase.from('commitments').update({ status: 'completed', updated_at: now }).in('id', ids)
      setCommitments(prev => prev.map(c => ids.includes(c.id) ? { ...c, status: 'completed', updated_at: now } : c))
      toast.success(`${ids.length} commitment${ids.length > 1 ? 's' : ''} marked complete`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Failed to update commitments')
    } finally {
      setBulkActioning(false)
    }
  }

  async function bulkDismiss() {
    if (selectedIds.size === 0) return
    setBulkActioning(true)
    try {
      const supabase = createClient()
      const now = new Date().toISOString()
      const ids = Array.from(selectedIds)
      await supabase.from('commitments').update({ status: 'dismissed', updated_at: now }).in('id', ids)
      setCommitments(prev => prev.map(c => ids.includes(c.id) ? { ...c, status: 'dismissed', updated_at: now } : c))
      toast.success(`${ids.length} commitment${ids.length > 1 ? 's' : ''} dismissed`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Failed to dismiss commitments')
    } finally {
      setBulkActioning(false)
    }
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!quickTitle.trim()) return
    setQuickSubmitting(true)
    try {
      const res = await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quickTitle.trim(),
          urgency: quickUrgency,
          userId,
        }),
      })
      if (res.ok) {
        const { commitment } = await res.json()
        setCommitments(prev => [commitment, ...prev])
        setQuickTitle('')
        setQuickUrgency('medium')
        setShowQuickAdd(false)
        toast.success('Commitment added!')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create')
      }
    } catch {
      toast.error('Failed to create commitment')
    } finally {
      setQuickSubmitting(false)
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

  const openCommitments = commitments.filter(c => c.status !== 'completed' && c.status !== 'dismissed')
  const likelyCompleteCommitments = commitments.filter(c => c.status === 'likely_complete')
  const completedCommitments = commitments.filter(c => c.status === 'completed')
  const forYouCommitments = openCommitments.filter(isPersonallyRelevant)

  const baseList = activeTab === 'for_you'
    ? forYouCommitments
    : activeTab === 'all_team'
    ? openCommitments
    : completedCommitments

  const filteredAndSorted = useMemo(() => {
    let result = [...baseList]

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.metadata?.originalQuote && c.metadata.originalQuote.toLowerCase().includes(q)) ||
        (Array.isArray(c.metadata?.stakeholders) && c.metadata.stakeholders.some(s => s.name && s.name.toLowerCase().includes(q)))
      )
    }

    // Source filter
    if (filterSource !== 'all') {
      result = result.filter(c => {
        if (filterSource === 'slack') return c.source === 'slack'
        if (filterSource === 'outlook') return c.source === 'outlook' || c.source === 'email'
        if (filterSource === 'recording') return c.source === 'recording' || c.source === 'meeting' || c.source === 'calendar'
        if (filterSource === 'manual') return !c.source || c.source === 'manual'
        return c.source === filterSource
      })
    }

    // Urgency filter
    if (filterUrgency !== 'all') {
      result = result.filter(c => c.metadata?.urgency === filterUrgency)
    }

    // Health filter
    if (filterHealth !== 'all') {
      result = result.filter(c => {
        const status = getCommitmentStatus(c)
        if (filterHealth === 'at_risk') return status.label === 'AT RISK' || status.label === 'OVERDUE'
        if (filterHealth === 'stalled') return status.label === 'STALLED'
        if (filterHealth === 'active') return status.label === 'ACTIVE'
        return true
      })
    }

    // Sort
    switch (sortBy) {
      case 'oldest':
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        break
      case 'score':
        result.sort((a, b) => getCommitmentScore(a) - getCommitmentScore(b))
        break
      case 'urgency': {
        const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
        result.sort((a, b) => {
          const aU = urgencyOrder[a.metadata?.urgency || 'low'] ?? 4
          const bU = urgencyOrder[b.metadata?.urgency || 'low'] ?? 4
          return aU - bU
        })
        break
      }
      default: // newest
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }

    // In active tabs, always float likely_complete items to the top
    if (activeTab === 'for_you' || activeTab === 'all_team') {
      result.sort((a, b) => {
        const aLikely = a.status === 'likely_complete' ? 0 : 1
        const bLikely = b.status === 'likely_complete' ? 0 : 1
        return aLikely - bLikely
      })
    }

    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitments, activeTab, searchQuery, filterSource, filterUrgency, filterHealth, sortBy])

  const hasActiveFilters = filterSource !== 'all' || filterUrgency !== 'all' || filterHealth !== 'all' || searchQuery.trim() !== ''
  const activeFilterCount = [filterSource !== 'all', filterUrgency !== 'all', filterHealth !== 'all'].filter(Boolean).length

  const selectAll = () => {
    if (selectedIds.size === filteredAndSorted.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAndSorted.map(c => c.id)))
    }
  }

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-5">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}

      {/* Quick Add Form */}
      {showQuickAdd && (
        <form onSubmit={handleQuickAdd} className="bg-white dark:bg-surface-dark-secondary border border-indigo-200 dark:border-indigo-800/50 rounded-xl p-4 flex items-center gap-3">
          <input
            type="text"
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            placeholder="What do you need to follow up on?"
            autoFocus
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <div className="flex items-center gap-1">
            {(['high', 'medium', 'low'] as const).map(u => (
              <button
                key={u}
                type="button"
                onClick={() => setQuickUrgency(u)}
                className={`px-2 py-1 text-[11px] font-medium rounded-full transition ${
                  quickUrgency === u
                    ? u === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : u === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                {u.charAt(0).toUpperCase() + u.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!quickTitle.trim() || quickSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            <Send className="w-3.5 h-3.5" />
            {quickSubmitting ? 'Adding...' : 'Add'}
          </button>
          <button type="button" onClick={() => setShowQuickAdd(false)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </form>
      )}

      {/* Header with stats */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commitment Tracing</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Every promise tracked from origin to resolution</p>
          </div>
          <button
            onClick={() => setShowQuickAdd(!showQuickAdd)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition"
          >
            <Plus className="w-4 h-4" />
            Add Task
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{forYouCommitments.length}</p>
            <p className="text-xs text-gray-500">for you</p>
          </div>
          <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600">{completedCommitments.length}</p>
            <p className="text-xs text-gray-500">completed</p>
          </div>
          {commitments.length > 0 && (
            <>
              <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
              <div className="text-right">
                <p className="text-2xl font-bold text-indigo-600">
                  {(() => {
                    const nonDismissed = commitments.filter(c => c.status !== 'dismissed').length
                    return nonDismissed > 0 ? Math.round(completedCommitments.length / nonDismissed * 100) : 0
                  })()}%
                </p>
                <p className="text-xs text-gray-500">follow-through</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search commitments, people, quotes..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-surface-dark-secondary dark:text-white"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition ${
              showFilters || activeFilterCount > 0
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 w-5 h-5 flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark-secondary dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score">Lowest score first</option>
            <option value="urgency">Highest urgency first</option>
          </select>
        </div>

        {/* Filter chips */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Source</span>
              {([
                { key: 'all' as FilterSource, label: 'All' },
                { key: 'slack' as FilterSource, label: 'Chat' },
                { key: 'outlook' as FilterSource, label: 'Email' },
                { key: 'recording' as FilterSource, label: 'Calendar' },
                { key: 'manual' as FilterSource, label: 'Manual' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilterSource(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                    filterSource === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Urgency</span>
              {(['all', 'critical', 'high', 'medium', 'low'] as FilterUrgency[]).map(u => (
                <button
                  key={u}
                  onClick={() => setFilterUrgency(u)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                    filterUrgency === u
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  {u === 'all' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Health</span>
              {(['all', 'at_risk', 'stalled', 'active'] as FilterHealth[]).map(h => (
                <button
                  key={h}
                  onClick={() => setFilterHealth(h)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                    filterHealth === h
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  {h === 'all' ? 'All' : h === 'at_risk' ? 'At Risk' : h.charAt(0).toUpperCase() + h.slice(1)}
                </button>
              ))}
            </div>
            {hasActiveFilters && (
              <>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                <button
                  onClick={() => { setFilterSource('all'); setFilterUrgency('all'); setFilterHealth('all'); setSearchQuery('') }}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex gap-6 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'for_you' as const, label: 'For You', count: forYouCommitments.length },
          { key: 'all_team' as const, label: 'All Team', count: openCommitments.length },
          { key: 'completed' as const, label: 'Completed', count: completedCommitments.length },
        ].map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => { setActiveTab(tab.key); setSelectedIds(new Set()) }}
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

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg">
          <input
            type="checkbox"
            checked={selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0}
            onChange={selectAll}
            className="w-4 h-4 rounded cursor-pointer"
          />
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {(activeTab === 'for_you' || activeTab === 'all_team') && (
              <>
                <button
                  onClick={bulkComplete}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark Complete
                </button>
                <button
                  onClick={bulkDismiss}
                  disabled={bulkActioning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Results count */}
      {hasActiveFilters && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing {filteredAndSorted.length} of {baseList.length} commitments
        </p>
      )}

      {/* Commitment Trace Cards */}
      {filteredAndSorted.length === 0 ? (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
          <div className="text-3xl mb-3" aria-hidden="true">
            {hasActiveFilters ? '\u{1F50D}' : activeTab === 'for_you' ? '\u2705' : activeTab === 'completed' ? '\u{1F4CB}' : '\u{1F4AC}'}
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {hasActiveFilters ? 'No commitments match your filters' : activeTab === 'for_you' ? 'Nothing needs your attention right now' : activeTab === 'all_team' ? 'No active team commitments' : 'No completed commitments yet'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            {hasActiveFilters
              ? 'Try adjusting your search or filter criteria.'
              : activeTab === 'for_you'
                ? 'Commitments where you are mentioned, assigned, or involved will appear here.'
                : activeTab === 'completed'
                  ? 'Mark commitments as complete to track your follow-through rate.'
                  : 'Tag @HeyWren in any Slack conversation to capture commitments directly.'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterSource('all'); setFilterUrgency('all'); setFilterHealth('all'); setSearchQuery('') }}
              className="mt-4 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Likely complete banner */}
          {(activeTab === 'for_you' || activeTab === 'all_team') && likelyCompleteCommitments.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Wren thinks {likelyCompleteCommitments.length === 1 ? 'this is' : `these ${likelyCompleteCommitments.length} are`} done — confirm?
              </p>
            </div>
          )}

          {/* Select all row */}
          {(activeTab === 'for_you' || activeTab === 'all_team') && filteredAndSorted.length > 0 && selectedIds.size === 0 && (
            <div className="flex items-center gap-2 px-2">
              <input
                type="checkbox"
                checked={false}
                onChange={selectAll}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <span className="text-xs text-gray-400">Select all</span>
            </div>
          )}
          {filteredAndSorted.map(c => {
            const score = getCommitmentScore(c)
            const status = getCommitmentStatus(c)
            const age = daysSince(c.created_at)
            const sourceBadge = getSourceBadge(c.source)
            const rawMeta = c.metadata
            const meta: CommitmentMetadata = (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) ? rawMeta as CommitmentMetadata : {}
            const urgency = getUrgencyConfig(meta.urgency)
            const commitmentType = getCommitmentTypeLabel(meta.commitmentType)
            const toneNote = getToneLabel(meta.tone)
            const scoreColor = score >= 70
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700'
              : score >= 50
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700'
            const isSelected = selectedIds.has(c.id)

            const isLikelyComplete = c.status === 'likely_complete'
            const completionEvidence = (meta as any).completionEvidence as string | undefined

            return (
              <div key={c.id} className={`border rounded-xl p-5 transition-colors ${
                isLikelyComplete
                  ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-300 dark:border-emerald-700'
                  : isSelected
                  ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/10'
                  : 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark'
              }`}>
                {/* Row 1: Checkbox + title + actions */}
                <div className="flex items-start gap-3 mb-2">
                  {(activeTab === 'for_you' || activeTab === 'all_team') && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      className="w-4 h-4 rounded cursor-pointer mt-1 flex-shrink-0"
                    />
                  )}
                  <Link href={`/commitments/${c.id}`} className="text-base font-bold text-gray-900 dark:text-white leading-snug flex-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">{c.title}</Link>
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
                    {isLikelyComplete ? (
                      <>
                        <button
                          onClick={() => updateStatus(c.id, 'completed')}
                          className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors"
                        >
                          Confirm complete
                        </button>
                        <button
                          onClick={() => updateStatus(c.id, 'open')}
                          className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 font-medium transition-colors"
                        >
                          Not done
                        </button>
                      </>
                    ) : c.status !== 'completed' ? (
                      <button
                        onClick={() => updateStatus(c.id, 'completed')}
                        className="text-xs px-3 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 font-medium transition-colors"
                      >
                        Complete
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Completion evidence for likely_complete items */}
                {isLikelyComplete && completionEvidence && (
                  <div className="flex items-center gap-2 mb-2.5 px-3 py-2 bg-emerald-100/50 dark:bg-emerald-900/20 rounded-lg">
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Evidence:</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-300 italic">&ldquo;{completionEvidence}&rdquo;</span>
                  </div>
                )}

                {/* Row 2: Badges */}
                <div className="flex items-center gap-2 flex-wrap mb-2.5">
                  <span className={`px-2 py-0.5 rounded border text-xs font-bold ${scoreColor}`}>
                    {score}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${status.bgColor} ${status.color}`}>
                    {status.label}
                  </span>
                  {urgency && (
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 ${urgency.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${urgency.dotColor}`} aria-hidden="true" />
                      {urgency.label}
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
                  <span className="text-xs text-gray-400">{age}d ago</span>
                </div>

                {/* Row 3: Description */}
                {c.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2.5 leading-relaxed">{c.description}</p>
                )}

                {/* Row 4: Original quote */}
                {meta.originalQuote && (
                  <div className="border-l-3 border-gray-300 dark:border-gray-600 pl-3 mb-2.5">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic leading-relaxed">
                      &ldquo;{meta.originalQuote}&rdquo;
                    </p>
                  </div>
                )}

                {/* Row 5: Stakeholders + origin */}
                <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-1.5">
                    {Array.isArray(meta.stakeholders) && meta.stakeholders.filter(s => s && s.name).map((s, i) => (
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
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                    <span>{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    {meta.channelName && <span className="text-gray-300">#{meta.channelName}</span>}
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
