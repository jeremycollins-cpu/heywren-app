'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCircle2, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

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

export function RemindersSection() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders')
      if (res.ok) {
        const data = await res.json()
        setReminders(data.reminders || [])
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReminders() }, [fetchReminders])

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
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to complete')
        fetchReminders() // revert
      }
    } catch {
      toast.error('Failed to complete')
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
    } catch { /* silent dismiss */ }
  }

  if (loading) return null
  if (reminders.length === 0) return null

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-amber-200 dark:border-amber-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Reminders</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{reminders.length}</span>
      </div>
      <div className="space-y-2">
        {reminders.map(r => (
          <div key={r.id} className="flex items-center gap-3 group">
            <button
              onClick={() => completeReminder(r.id)}
              className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 group-hover:border-green-500 group-hover:bg-green-50 dark:group-hover:bg-green-900/30 transition flex items-center justify-center"
              title="Complete"
            >
              <CheckCircle2 className="w-3 h-3 text-transparent group-hover:text-green-500 transition" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{r.title}</p>
              <span className="text-[10px] text-gray-400">{formatDate(r.created_at)}</span>
            </div>
            <button
              onClick={() => dismissReminder(r.id)}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
