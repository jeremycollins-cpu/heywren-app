'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2, XCircle, ChevronDown, ChevronRight,
  MessageSquare, Mail, Mic, Pencil, Check, X, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface ReviewItem {
  id: string
  title: string
  description: string | null
  source: string
  source_ref: string | null
  source_url: string | null
  category: string | null
  metadata: Record<string, any> | null
  created_at: string
}

interface ReviewGroup {
  key: string
  label: string
  source: string
  sourceRef: string | null
  items: ReviewItem[]
  created_at: string
}

const sourceIcon: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  recording: Mic,
  outlook: Mail,
  email: Mail,
}

const sourceColor: Record<string, string> = {
  slack: 'text-purple-600 bg-purple-50',
  recording: 'text-teal-600 bg-teal-50',
  outlook: 'text-blue-600 bg-blue-50',
  email: 'text-blue-600 bg-blue-50',
}

export function CommitmentReviewSection({ onReviewComplete }: { onReviewComplete?: () => void }) {
  const [groups, setGroups] = useState<ReviewGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [acting, setActing] = useState<Set<string>>(new Set())

  const fetchReview = useCallback(async () => {
    try {
      const res = await fetch('/api/commitments/review')
      if (res.ok) {
        const data = await res.json()
        setGroups(data.groups || [])
        setTotal(data.total || 0)
        // Auto-expand first group
        if (data.groups?.length > 0) {
          setExpanded(new Set([data.groups[0].key]))
        }
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReview() }, [fetchReview])

  const reviewAction = async (action: 'accept' | 'reject', ids: string[], title?: string) => {
    setActing(prev => new Set([...prev, ...ids]))
    try {
      const res = await fetch('/api/commitments/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, title }),
      })
      if (res.ok) {
        // Remove reviewed items from state
        setGroups(prev => {
          const updated = prev.map(g => ({
            ...g,
            items: g.items.filter(item => !ids.includes(item.id)),
          })).filter(g => g.items.length > 0)
          return updated
        })
        setTotal(prev => prev - ids.length)
        const msg = action === 'accept'
          ? `${ids.length} commitment${ids.length > 1 ? 's' : ''} confirmed`
          : `${ids.length} dismissed`
        toast.success(msg)
        if (onReviewComplete) onReviewComplete()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed')
      }
    } catch {
      toast.error('Failed to review')
    }
    setActing(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.delete(id))
      return next
    })
  }

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) return null
  if (total === 0) return null

  return (
    <section className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Review Suggested Commitments
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
              {total}
            </span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Auto-detected from your conversations. Confirm what matters, dismiss the rest.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {groups.map(group => {
          const isExpanded = expanded.has(group.key)
          const Icon = sourceIcon[group.source] || MessageSquare
          const color = sourceColor[group.source] || 'text-gray-600 bg-gray-50'
          const allIds = group.items.map(i => i.id)

          return (
            <div key={group.key} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              {/* Group header */}
              <button
                onClick={() => toggleExpand(group.key)}
                className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
              >
                <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate block">
                    {group.label}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {group.items.length} item{group.items.length !== 1 ? 's' : ''} to review
                  </span>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {/* Expanded items */}
              {isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-800">
                  {/* Bulk actions */}
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                    <button
                      onClick={() => reviewAction('accept', allIds)}
                      disabled={acting.size > 0}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30 transition disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Accept all
                    </button>
                    <button
                      onClick={() => reviewAction('reject', allIds)}
                      disabled={acting.size > 0}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                    >
                      <XCircle className="w-3 h-3" />
                      Dismiss all
                    </button>
                  </div>

                  {/* Individual items */}
                  {group.items.map(item => {
                    const isEditing = editingId === item.id
                    const isActing = acting.has(item.id)
                    const meta = (item.metadata || {}) as Record<string, any>
                    const quote = meta.originalQuote as string | undefined

                    return (
                      <div key={item.id} className={`flex items-start gap-3 px-3 sm:px-4 py-3 border-b last:border-0 border-gray-50 dark:border-gray-800 ${isActing ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    reviewAction('accept', [item.id], editTitle.trim())
                                    setEditingId(null)
                                  }
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                autoFocus
                              />
                              <button
                                onClick={() => { reviewAction('accept', [item.id], editTitle.trim()); setEditingId(null) }}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</p>
                              {quote && (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1 italic">
                                  &ldquo;{quote}&rdquo;
                                </p>
                              )}
                            </>
                          )}
                        </div>
                        {!isEditing && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => reviewAction('accept', [item.id])}
                              disabled={isActing}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-md transition"
                              title="Accept"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setEditingId(item.id); setEditTitle(item.title) }}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition"
                              title="Edit title & accept"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => reviewAction('reject', [item.id])}
                              disabled={isActing}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition"
                              title="Dismiss"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
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
    </section>
  )
}
