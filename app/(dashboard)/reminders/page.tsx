'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import { Bell, CheckCircle2, X, Inbox, Plus, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCelebration } from '@/lib/contexts/celebration-context'

interface Reminder {
  id: string
  title: string
  note: string | null
  source_type: string
  source_id: string | null
  status: string
  created_at: string
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RemindersPage() {
  const { celebrate } = useCelebration()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active')

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch(`/api/reminders?status=${filter}`)
      if (res.ok) {
        const data = await res.json()
        setReminders(data.reminders || [])
      }
    } catch {
      toast.error('Failed to load reminders')
    }
    setLoading(false)
  }, [filter])

  useEffect(() => {
    setLoading(true)
    fetchReminders()
  }, [fetchReminders])

  const addReminder = async () => {
    if (!newTitle.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), sourceType: 'manual' }),
      })
      const data = await res.json()
      if (res.ok) {
        setReminders(prev => [data.reminder, ...prev])
        setNewTitle('')
        setShowAdd(false)
        toast.success('Reminder added')
      } else {
        toast.error(data.error || 'Failed to add')
      }
    } catch {
      toast.error('Failed to add reminder')
    }
    setAdding(false)
  }

  const completeReminder = async (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id))
    try {
      const res = await fetch('/api/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'completed' }),
      })
      if (res.ok) {
        toast.success('Done! Reminder and linked item completed')
        celebrate()
      } else {
        fetchReminders()
      }
    } catch {
      fetchReminders()
    }
  }

  const dismissReminder = async (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id))
    try {
      await fetch('/api/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed' }),
      })
    } catch { /* silent */ }
  }

  if (loading) return <LoadingSkeleton variant="list" />

  const activeCount = reminders.filter(r => r.status === 'active').length

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Reminders"
          description="Things you don't want to forget. Completing a reminder also completes the linked commitment."
        />
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* Quick add */}
      {showAdd && (
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addReminder()}
            placeholder="What do you need to remember?"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            autoFocus
          />
          <button
            onClick={addReminder}
            disabled={adding || !newTitle.trim()}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
          >
            {adding ? 'Adding...' : 'Save'}
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1 mb-4">
        {(['active', 'completed', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === f ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {reminders.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
            <Bell className="w-6 h-6 text-amber-400" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            {filter === 'active' ? 'No active reminders' : 'No reminders found'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Click the bell icon on any commitment or mention to add a reminder.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map(r => (
            <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border bg-white dark:bg-surface-dark-secondary group transition ${r.status === 'completed' ? 'border-green-200 dark:border-green-800/50 opacity-60' : 'border-gray-200 dark:border-gray-700'}`}>
              {r.status === 'active' ? (
                <button
                  onClick={() => completeReminder(r.id)}
                  className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 transition flex items-center justify-center"
                  title="Complete"
                >
                  <CheckCircle2 className="w-4 h-4 text-transparent group-hover:text-green-500 transition" />
                </button>
              ) : (
                <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                {r.source_type === 'commitment' && r.source_id ? (
                  <Link
                    href={`/commitments/${r.source_id}`}
                    className={`text-sm hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${r.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'}`}
                  >
                    {r.title}
                  </Link>
                ) : (
                  <p className={`text-sm ${r.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'}`}>{r.title}</p>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-400">{formatDate(r.created_at)}</span>
                  {r.source_type !== 'manual' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">from {r.source_type}</span>
                  )}
                  {r.source_type === 'commitment' && r.source_id && (
                    <Link
                      href={`/commitments/${r.source_id}`}
                      className="text-[10px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium flex items-center gap-0.5 transition-colors"
                    >
                      View commitment <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  )}
                  {r.source_type === 'mention' && (
                    <Link
                      href="/wren-mentions"
                      className="text-[10px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium flex items-center gap-0.5 transition-colors"
                    >
                      View mentions <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  )}
                </div>
              </div>
              {r.status === 'active' && (
                <button
                  onClick={() => dismissReminder(r.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
