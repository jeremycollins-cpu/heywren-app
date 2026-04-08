'use client'

import { useEffect, useState } from 'react'
import {
  Shield, Clock, AlertTriangle, CheckCircle2, XCircle, Calendar,
  Loader2, RefreshCw, Sparkles, BarChart3,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import { WrenSuggestionBanner } from '@/components/wren-suggestion-banner'

interface CalendarBoundary {
  max_meeting_hours_per_day: number
  max_meetings_per_day: number
  no_meetings_before: string
  no_meetings_after: string
  focus_days: number[]
  min_break_between_meetings: number
  conflict_alerts: boolean
  boundary_alerts: boolean
  weekly_calendar_summary: boolean
}

interface CalendarConflict {
  id: string
  conflict_type: string
  event_a_subject: string | null
  event_a_start: string
  event_a_end: string
  event_b_subject: string | null
  event_b_start: string | null
  event_b_end: string | null
  conflict_date: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  status: string
}

interface DayStat {
  date: string
  dayName: string
  meetingCount: number
  meetingHours: number
  conflicts: number
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const conflictTypeLabels: Record<string, string> = {
  overlap: 'Double-booked',
  exceeds_daily_hours: 'Too many hours',
  exceeds_daily_count: 'Too many meetings',
  outside_hours: 'Outside boundaries',
  focus_day: 'Focus day violated',
  no_break: 'No break between meetings',
}

const severityStyles = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-400', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
}

const defaultBoundaries: CalendarBoundary = {
  max_meeting_hours_per_day: 4,
  max_meetings_per_day: 6,
  no_meetings_before: '09:00',
  no_meetings_after: '17:00',
  focus_days: [],
  min_break_between_meetings: 0,
  conflict_alerts: true,
  boundary_alerts: true,
  weekly_calendar_summary: true,
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function CalendarProtectionPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [boundaries, setBoundaries] = useState<CalendarBoundary>(defaultBoundaries)
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([])
  const [dailyStats, setDailyStats] = useState<DayStat[]>([])
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const fetchData = async () => {
    try {
      const res = await fetch('/api/calendar-protection')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      if (data.boundaries) setBoundaries(data.boundaries)
      setConflicts(data.conflicts || [])
      setDailyStats(data.dailyStats || [])
    } catch {
      toast.error('Failed to load calendar data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const saveBoundaries = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/calendar-protection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boundaries),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Calendar boundaries saved')
    } catch {
      toast.error('Failed to save boundaries')
    } finally {
      setSaving(false)
    }
  }

  const resolveConflict = async (id: string, action: 'resolve' | 'dismiss') => {
    setActionLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch('/api/calendar-protection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflictId: id, action }),
      })
      if (!res.ok) throw new Error('Failed')
      setConflicts(prev => prev.filter(c => c.id !== id))
      toast.success(action === 'resolve' ? 'Marked as resolved' : 'Dismissed')
    } catch {
      toast.error('Failed to update conflict')
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  if (loading) return <LoadingSkeleton variant="list" />

  const criticalCount = conflicts.filter(c => c.severity === 'critical').length
  const warningCount = conflicts.filter(c => c.severity === 'warning').length
  const maxHoursDay = dailyStats.reduce((max, d) => Math.max(max, d.meetingHours), 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            Calendar Protection
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Set boundaries, detect conflicts, and protect your focus time.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{criticalCount}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Double-booked</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{warningCount}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Boundary Warnings</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{maxHoursDay}h</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Busiest Day</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {dailyStats.reduce((s, d) => s + d.meetingCount, 0)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Meetings This Week</div>
        </div>
      </div>

      {/* 7-day calendar heat strip */}
      <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Next 7 Days
        </h2>
        <div className="grid grid-cols-7 gap-2">
          {dailyStats.map(day => {
            const isOverLimit = boundaries.max_meeting_hours_per_day
              ? day.meetingHours > boundaries.max_meeting_hours_per_day
              : false
            const isFocusDay = boundaries.focus_days?.includes(new Date(day.date).getDay())

            return (
              <div
                key={day.date}
                className={`rounded-lg p-3 text-center border ${
                  day.conflicts > 0
                    ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                    : isOverLimit
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                      : isFocusDay && day.meetingCount > 0
                        ? 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-gray-100 dark:border-gray-800'
                }`}
              >
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{day.dayName}</div>
                <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{day.meetingCount}</div>
                <div className="text-[10px] text-gray-400">{day.meetingHours}h</div>
                {day.conflicts > 0 && (
                  <div className="text-[10px] text-red-600 dark:text-red-400 font-medium mt-0.5">
                    {day.conflicts} conflict{day.conflicts !== 1 ? 's' : ''}
                  </div>
                )}
                {isFocusDay && (
                  <div className="text-[10px] text-violet-600 dark:text-violet-400 font-medium mt-0.5">Focus</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Active conflicts */}
      {conflicts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Conflicts ({conflicts.length})
          </h2>
          {conflicts.map(conflict => {
            const style = severityStyles[conflict.severity]
            const isLoading = actionLoading[conflict.id]
            return (
              <div key={conflict.id} className={`${style.bg} border ${style.border} rounded-xl p-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${style.badge}`}>
                        {conflict.severity === 'critical' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                        {conflictTypeLabels[conflict.conflict_type] || conflict.conflict_type}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(conflict.conflict_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className={`text-sm font-medium mt-1.5 ${style.text}`}>{conflict.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatTime(conflict.event_a_start)} – {formatTime(conflict.event_a_end)}</span>
                      {conflict.event_b_subject && (
                        <span>vs {formatTime(conflict.event_b_start!)} – {formatTime(conflict.event_b_end!)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => resolveConflict(conflict.id, 'resolve')}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition disabled:opacity-40"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Resolved
                    </button>
                    <button
                      onClick={() => resolveConflict(conflict.id, 'dismiss')}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {conflicts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No conflicts detected</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your calendar looks clear for the next 7 days.</p>
        </div>
      )}

      {/* Boundary settings */}
      <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Calendar Boundaries
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Wren will alert you when meetings violate these boundaries.
        </p>

        <div className="grid grid-cols-2 gap-6">
          {/* Max hours */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max meeting hours/day</label>
            <input
              type="number"
              min={0}
              max={12}
              step={0.5}
              value={boundaries.max_meeting_hours_per_day}
              onChange={e => setBoundaries(b => ({ ...b, max_meeting_hours_per_day: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Max meetings */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max meetings/day</label>
            <input
              type="number"
              min={0}
              max={20}
              value={boundaries.max_meetings_per_day}
              onChange={e => setBoundaries(b => ({ ...b, max_meetings_per_day: parseInt(e.target.value) || 0 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* No meetings before */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">No meetings before</label>
            <input
              type="time"
              value={boundaries.no_meetings_before}
              onChange={e => setBoundaries(b => ({ ...b, no_meetings_before: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* No meetings after */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">No meetings after</label>
            <input
              type="time"
              value={boundaries.no_meetings_after}
              onChange={e => setBoundaries(b => ({ ...b, no_meetings_after: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Min break */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min break between meetings (min)</label>
            <input
              type="number"
              min={0}
              max={60}
              step={5}
              value={boundaries.min_break_between_meetings}
              onChange={e => setBoundaries(b => ({ ...b, min_break_between_meetings: parseInt(e.target.value) || 0 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Focus days */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Focus days (no meetings)</label>
            <div className="flex gap-1.5">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setBoundaries(b => ({
                      ...b,
                      focus_days: b.focus_days.includes(i)
                        ? b.focus_days.filter(d => d !== i)
                        : [...b.focus_days, i],
                    }))
                  }}
                  className={`w-9 h-9 text-xs font-semibold rounded-lg transition ${
                    boundaries.focus_days.includes(i)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {name.charAt(0)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={saveBoundaries}
          disabled={saving}
          className="mt-6 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
        >
          {saving ? 'Saving...' : 'Save Boundaries'}
        </button>
      </div>
    </div>
  )
}
