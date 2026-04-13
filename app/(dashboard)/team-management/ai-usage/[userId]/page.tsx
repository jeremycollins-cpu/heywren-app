'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Cpu, Clock, Hash, MessageSquare, Wrench, AlertCircle,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import toast from 'react-hot-toast'

interface DrillDownData {
  user: {
    id: string
    full_name: string | null
    email: string | null
    avatar_url: string | null
    job_title: string | null
    department_name: string | null
  }
  summary: {
    totalSessions: number
    totalTokens: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCostCents: number
    totalDurationSeconds: number
    totalMessages: number
    totalToolCalls: number
    avgSessionMinutes: number
    days: number
  }
  dailyUsage: Array<{ date: string; sessions: number; tokens: number; costCents: number; durationMinutes: number }>
  byTool: Array<{ tool: string; sessions: number; tokens: number }>
  byModel: Array<{ model: string; sessions: number; tokens: number }>
  recentSessions: Array<{
    id: string
    session_id: string
    tool: string
    started_at: string
    ended_at: string | null
    duration_seconds: number | null
    input_tokens: number
    output_tokens: number
    model: string | null
    project_path: string | null
    messages_count: number
    tool_calls_count: number
  }>
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toString()
}

function Avatar({ src, name, size = 48 }: { src: string | null; name: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name || ''} width={size} height={size} className="rounded-full" />
  }
  const initials = (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div
      className="rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 flex items-center justify-center text-base font-semibold"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Cpu
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-1">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon size={16} className={color} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  )
}

function UsageSparkline({ data }: { data: Array<{ date: string; sessions: number }> }) {
  const max = Math.max(...data.map(d => d.sessions), 1)
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map(d => (
        <div
          key={d.date}
          className="flex-1 bg-indigo-200 dark:bg-indigo-900 rounded-t min-w-[3px]"
          style={{ height: `${Math.max((d.sessions / max) * 100, d.sessions > 0 ? 4 : 0)}%` }}
          title={`${d.date}: ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  )
}

export default function TeamUserAiUsagePage() {
  const params = useParams()
  const userId = params.userId as string
  const [data, setData] = useState<DrillDownData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [days, setDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setForbidden(false)
      try {
        const res = await fetch(`/api/ai-usage/team/user/${userId}?days=${days}`)
        if (res.status === 403) {
          if (!cancelled) setForbidden(true)
          return
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to load')
        }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err: any) {
        if (!cancelled) toast.error(err.message || 'Failed to load user AI usage')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [userId, days])

  if (forbidden) {
    return (
      <div className="px-4 sm:px-6 py-16 max-w-md mx-auto text-center">
        <AlertCircle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Not accessible</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          You don&apos;t have permission to view this user&apos;s AI usage. This page is for team
          admins viewing members of their own organization.
        </p>
        <Link href="/team-management/ai-usage" className="inline-block mt-4 text-sm text-indigo-600 underline">
          Back to Team AI Usage
        </Link>
      </div>
    )
  }

  if (loading && !data) return <LoadingSkeleton />
  if (!data) return null

  const u = data.user
  const displayName = u.full_name || u.email || 'Unknown'

  return (
    <UpgradeGate featureKey="ai_usage">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <Avatar src={u.avatar_url} name={u.full_name} size={56} />
            <div>
              <Link
                href="/team-management/ai-usage"
                className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1"
              >
                <ArrowLeft size={12} />
                Team AI Usage
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{displayName}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {u.job_title ? `${u.job_title} · ` : ''}{u.department_name || 'Unassigned'}
              </p>
            </div>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        {data.summary.totalSessions === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center">
            <Cpu className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <h3 className="font-semibold text-gray-900 dark:text-white">No sessions in this window</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {displayName} hasn&apos;t synced any Claude Code sessions in the last {days} days.
              Consider sharing the setup instructions at <code className="text-xs">/integrations</code>.
            </p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Cpu} label="Sessions" value={data.summary.totalSessions.toString()} color="text-indigo-500" />
              <StatCard icon={Hash} label="Tokens" value={formatCompact(data.summary.totalTokens)} color="text-violet-500" />
              <StatCard icon={MessageSquare} label="Messages" value={data.summary.totalMessages.toString()} color="text-emerald-500" />
              <StatCard
                icon={Clock}
                label="Avg. session"
                value={`${data.summary.avgSessionMinutes}m`}
                sub={`${data.summary.totalToolCalls} tool calls`}
                color="text-amber-500"
              />
            </div>

            {/* Daily usage */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">Daily sessions</h3>
              <UsageSparkline data={data.dailyUsage} />
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
                <span>{data.dailyUsage[0]?.date}</span>
                <span>{data.dailyUsage[data.dailyUsage.length - 1]?.date}</span>
              </div>
            </div>

            {/* Breakdowns */}
            {(data.byModel.length > 0 || data.byTool.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.byModel.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">By model</h3>
                    <div className="space-y-1.5">
                      {data.byModel.map(m => (
                        <div key={m.model} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300 truncate">{m.model}</span>
                          <span className="text-gray-500 dark:text-gray-400 tabular-nums">{m.sessions}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.byTool.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">By tool</h3>
                    <div className="space-y-1.5">
                      {data.byTool.map(t => (
                        <div key={t.tool} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300">{t.tool}</span>
                          <span className="text-gray-500 dark:text-gray-400 tabular-nums">{t.sessions}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Recent sessions */}
            {data.recentSessions.length > 0 && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Recent sessions</h3>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.recentSessions.slice(0, 20).map(s => (
                    <div key={s.id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="text-gray-900 dark:text-white truncate font-mono text-xs">
                          {s.project_path || '—'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(s.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {s.model && <> · {s.model}</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                        <span className="inline-flex items-center gap-1"><MessageSquare size={11} />{s.messages_count}</span>
                        <span className="inline-flex items-center gap-1"><Wrench size={11} />{s.tool_calls_count}</span>
                        {s.duration_seconds && <span>{Math.round(s.duration_seconds / 60)}m</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
