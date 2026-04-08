'use client'

import { useEffect, useState } from 'react'
import {
  CalendarDays, CheckCircle2, XCircle, Forward, ArrowRight,
  Loader2, Trophy, TrendingUp, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface CarryOverItem {
  id: string
  title: string
  created_at: string
  source: string | null
  metadata: Record<string, any>
  days_old: number
}

interface WeekSummary {
  completed: number
  created: number
  carryOver: CarryOverItem[]
  topSource: string
  streakDays: number
}

type Decision = 'keep' | 'drop' | 'delegate'

export default function WeeklyReflectionPage() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<WeekSummary | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetchWeekData()
  }, [])

  const fetchWeekData = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

      const [completedRes, createdRes, carryOverRes] = await Promise.all([
        supabase.from('commitments')
          .select('id', { count: 'exact', head: true })
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .eq('status', 'completed')
          .gte('updated_at', weekAgo),
        supabase.from('commitments')
          .select('id, source', { count: 'exact' })
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .gte('created_at', weekAgo),
        supabase.from('commitments')
          .select('id, title, created_at, source, metadata')
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .in('status', ['open', 'overdue'])
          .order('created_at', { ascending: true })
          .limit(20),
      ])

      const carryOver: CarryOverItem[] = (carryOverRes.data || []).map(c => ({
        ...c,
        metadata: c.metadata || {},
        days_old: Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000),
      }))

      // Find most common source
      const sources = (createdRes.data || []).map(c => c.source).filter(Boolean)
      const sourceCounts: Record<string, number> = {}
      sources.forEach(s => { sourceCounts[s!] = (sourceCounts[s!] || 0) + 1 })
      const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'manual'

      setSummary({
        completed: completedRes.count || 0,
        created: createdRes.count || 0,
        carryOver,
        topSource,
        streakDays: 0, // Could be computed from activity data
      })
    } catch (err) {
      console.error('Failed to load week data:', err)
      toast.error('Failed to load weekly data')
    } finally {
      setLoading(false)
    }
  }

  const handleDecision = (itemId: string, decision: Decision) => {
    setDecisions(prev => ({ ...prev, [itemId]: decision }))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return

      for (const [itemId, decision] of Object.entries(decisions)) {
        if (decision === 'drop') {
          await supabase.from('commitments')
            .update({ status: 'dropped' })
            .eq('id', itemId)
        } else if (decision === 'keep') {
          // Mark as acknowledged — reset "staleness" by touching updated_at
          await supabase.from('commitments')
            .update({ status: 'open', updated_at: new Date().toISOString() })
            .eq('id', itemId)
        }
        // 'delegate' — for now just mark as open (delegation flow is on handoff page)
      }

      setSubmitted(true)
      toast.success(`Weekly reflection complete! ${Object.keys(decisions).length} items reviewed.`)
    } catch {
      toast.error('Failed to save decisions')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingSkeleton variant="list" />

  if (!summary) return null

  const decidedCount = Object.keys(decisions).length
  const totalCarryOver = summary.carryOver.length

  if (submitted) {
    const kept = Object.values(decisions).filter(d => d === 'keep').length
    const dropped = Object.values(decisions).filter(d => d === 'drop').length
    const delegated = Object.values(decisions).filter(d => d === 'delegate').length

    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-6">
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <Trophy className="w-10 h-10 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Week reviewed!</h1>
        <p className="text-gray-600 dark:text-gray-400">
          You completed {summary.completed} items this week and reviewed {decidedCount} carry-over items.
        </p>
        <div className="flex items-center justify-center gap-6 text-sm">
          {kept > 0 && <span className="text-green-600 font-medium">{kept} kept</span>}
          {dropped > 0 && <span className="text-red-500 font-medium">{dropped} dropped</span>}
          {delegated > 0 && <span className="text-violet-600 font-medium">{delegated} to delegate</span>}
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition"
        >
          Back to Dashboard
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          Weekly Reflection
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Review your week and decide what carries forward. Wren helps you start next week clean.
        </p>
      </div>

      {/* Week Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 text-center">
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">{summary.completed}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Completed</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 text-center">
          <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{summary.created}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">New This Week</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 text-center">
          <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{totalCarryOver}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Carrying Over</div>
        </div>
      </div>

      {/* Wren's take */}
      {totalCarryOver > 0 && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-indigo-800 dark:text-indigo-200">
            <span className="font-semibold">Wren:</span> You have {totalCarryOver} items carrying over into next week.
            {summary.carryOver.filter(c => c.days_old > 14).length > 0 && (
              <> {summary.carryOver.filter(c => c.days_old > 14).length} of them are older than 2 weeks — consider dropping or delegating those.</>
            )}
            {' '}For each item below, decide: keep it, drop it, or delegate it.
          </p>
        </div>
      )}

      {/* Carry-over items with decisions */}
      {summary.carryOver.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Items to Review ({decidedCount}/{totalCarryOver} decided)
            </h2>
            {decidedCount > 0 && decidedCount < totalCarryOver && (
              <span className="text-xs text-gray-400">{totalCarryOver - decidedCount} remaining</span>
            )}
          </div>

          {summary.carryOver.map(item => {
            const decision = decisions[item.id]
            const isStale = item.days_old > 14

            return (
              <div
                key={item.id}
                className={`bg-white dark:bg-surface-dark-secondary rounded-xl border p-4 transition ${
                  decision
                    ? 'border-gray-100 dark:border-gray-800 opacity-70'
                    : isStale
                      ? 'border-amber-200 dark:border-amber-800'
                      : 'border-gray-200 dark:border-border-dark'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                      <span>{item.days_old}d old</span>
                      {item.source && <span className="capitalize">{item.source}</span>}
                      {isStale && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Stale</span>
                      )}
                      {decision && (
                        <span className={`font-semibold ${
                          decision === 'keep' ? 'text-green-600' :
                          decision === 'drop' ? 'text-red-500' : 'text-violet-600'
                        }`}>
                          {decision === 'keep' ? 'Keeping' : decision === 'drop' ? 'Dropping' : 'Delegating'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleDecision(item.id, 'keep')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                        decision === 'keep'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Keep
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, 'drop')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                        decision === 'drop'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Drop
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, 'delegate')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                        decision === 'delegate'
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'
                      }`}
                    >
                      <Forward className="w-3.5 h-3.5" />
                      Delegate
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <TrendingUp className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Clean slate!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            No carry-over items. You completed everything this week.
          </p>
        </div>
      )}

      {/* Submit button */}
      {totalCarryOver > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-border-dark">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {decidedCount === 0
              ? 'Make decisions on your carry-over items above'
              : `${decidedCount} of ${totalCarryOver} items reviewed`
            }
          </p>
          <button
            onClick={handleSubmit}
            disabled={submitting || decidedCount === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Complete Reflection
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
