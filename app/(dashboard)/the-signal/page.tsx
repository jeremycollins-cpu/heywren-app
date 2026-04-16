'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, Plus, Loader2, FileText, AlertTriangle, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface BriefingRow {
  id: string
  period_start: string
  period_end: string
  title: string | null
  subtitle: string | null
  status: string
  status_detail: string | null
  error_message: string | null
  generated_at: string | null
  created_at: string
  updated_at: string
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
function periodLabel(periodStart: string): string {
  const d = new Date(periodStart + 'T00:00:00Z')
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:      { label: 'Queued',      cls: 'bg-gray-100 text-gray-700' },
    aggregating:  { label: 'Aggregating', cls: 'bg-blue-50 text-blue-700' },
    extracting:   { label: 'Reading files', cls: 'bg-blue-50 text-blue-700' },
    synthesizing: { label: 'Synthesizing', cls: 'bg-violet-50 text-violet-700' },
    ready:        { label: 'Ready',       cls: 'bg-emerald-50 text-emerald-700' },
    failed:       { label: 'Failed',      cls: 'bg-red-50 text-red-700' },
  }
  const m = map[status] || { label: status, cls: 'bg-gray-100 text-gray-700' }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
}

export default function MonthlyBriefingListPage() {
  return (
    <UpgradeGate featureKey="the_signal">
      <ListPage />
    </UpgradeGate>
  )
}

function ListPage() {
  const router = useRouter()
  const [briefings, setBriefings] = useState<BriefingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const fetchBriefings = async () => {
    try {
      const res = await fetch('/api/the-signal')
      const json = await res.json()
      setBriefings(json.briefings || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBriefings()
  }, [])

  // Poll while any briefing is in progress
  useEffect(() => {
    const inFlight = briefings.some(b => ['pending', 'aggregating', 'extracting', 'synthesizing'].includes(b.status))
    if (!inFlight) return
    const interval = setInterval(fetchBriefings, 5_000)
    return () => clearInterval(interval)
  }, [briefings])

  const startNewBriefing = async (periodStart?: string) => {
    setCreating(true)
    try {
      const res = await fetch('/api/the-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not start briefing.')
        return
      }
      toast.success('Signal queued — opening it now.')
      router.push(`/the-signal/${json.id}`)
    } catch (err) {
      toast.error('Network error.')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <LoadingSkeleton />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-violet-600" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">The Signal</h1>
          </div>
          <p className="text-gray-500 dark:text-gray-400 max-w-2xl">
            Wren synthesizes your emails, chats, calendar, meetings, and any context you upload into an executive briefing — highlights, risks, priorities, and what to focus on next. Scales from a daily glance to board-ready output.
          </p>
        </div>
        <button
          onClick={() => startNewBriefing()}
          disabled={creating}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90 disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.25)',
          }}
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          New Signal
        </button>
      </div>

      {briefings.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
          <CalendarDays className="w-10 h-10 text-gray-400 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">No signals yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            Generate your first Signal. It pulls the last 30 days of activity — the more you've connected to Wren, the richer it gets.
          </p>
          <button
            onClick={() => startNewBriefing()}
            disabled={creating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate your first Signal
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {briefings.map(b => (
            <Link
              key={b.id}
              href={`/the-signal/${b.id}`}
              className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                      {b.title || `${periodLabel(b.period_start)} Briefing`}
                    </h3>
                    <StatusPill status={b.status} />
                  </div>
                  {b.subtitle && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{b.subtitle}</p>
                  )}
                  {b.status !== 'ready' && b.status_detail && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      {['aggregating', 'extracting', 'synthesizing'].includes(b.status) && (
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      )}
                      {b.status_detail}
                    </p>
                  )}
                  {b.status === 'failed' && b.error_message && (
                    <p className="text-xs text-red-600 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                      {b.error_message}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{periodLabel(b.period_start)}</p>
                  {b.generated_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Generated {new Date(b.generated_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
