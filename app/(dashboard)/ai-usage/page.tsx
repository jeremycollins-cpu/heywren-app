'use client'

import { useEffect, useState, useMemo } from 'react'
import { Cpu, Clock, Hash, DollarSign, MessageSquare, Wrench, Calendar, ChevronDown, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import toast from 'react-hot-toast'

interface AiSession {
  id: string
  session_id: string
  tool: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost_cents: number
  model: string | null
  entrypoint: string | null
  project_path: string | null
  messages_count: number
  tool_calls_count: number
}

interface DailyUsage {
  date: string
  sessions: number
  tokens: number
  costCents: number
  durationMinutes: number
}

interface Summary {
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

interface ToolBreakdown {
  tool: string
  sessions: number
  tokens: number
}

interface ModelBreakdown {
  model: string
  sessions: number
  tokens: number
}

interface UsageData {
  summary: Summary
  dailyUsage: DailyUsage[]
  byTool: ToolBreakdown[]
  byModel: ModelBreakdown[]
  recentSessions: AiSession[]
}

// ── Helpers ─────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hours}h ${remainMins}m`
}

function formatCost(cents: number): string {
  if (cents === 0) return '$0.00'
  return `$${(cents / 100).toFixed(2)}`
}

function toolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    claude_code: 'Claude Code',
    cursor: 'Cursor',
    copilot: 'GitHub Copilot',
    windsurf: 'Windsurf',
  }
  return names[tool] || tool
}

function entrypointLabel(ep: string | null): string {
  if (!ep) return 'Unknown'
  const labels: Record<string, string> = {
    cli: 'CLI',
    web: 'Web',
    remote_mobile: 'Mobile',
    ide: 'IDE',
    vscode: 'VS Code',
    jetbrains: 'JetBrains',
  }
  return labels[ep] || ep
}

function projectName(path: string | null): string {
  if (!path) return 'Unknown'
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// ── Chart component (pure CSS bar chart) ────────────────────────

function UsageChart({ data, metric }: { data: DailyUsage[]; metric: 'sessions' | 'tokens' | 'durationMinutes' }) {
  const values = data.map(d => d[metric])
  const max = Math.max(...values, 1)

  return (
    <div className="flex items-end gap-[2px] h-32">
      {data.map((d, i) => {
        const height = max > 0 ? (values[i] / max) * 100 : 0
        const isToday = d.date === new Date().toISOString().split('T')[0]
        return (
          <div
            key={d.date}
            className="group relative flex-1 min-w-0"
          >
            <div
              className={`w-full rounded-t transition-all ${
                isToday
                  ? 'bg-indigo-500'
                  : 'bg-indigo-300 dark:bg-indigo-600 group-hover:bg-indigo-400 dark:group-hover:bg-indigo-500'
              }`}
              style={{ height: `${Math.max(height, 2)}%` }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
              <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                <div className="font-medium">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div>{d.sessions} sessions</div>
                <div>{formatTokens(d.tokens)} tokens</div>
                <div>{d.durationMinutes}m active</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Stat card ───────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, trend }: {
  icon: typeof Cpu
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-1">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {trend === 'up' && <ArrowUpRight size={14} className="text-green-500 ml-auto" />}
        {trend === 'down' && <ArrowDownRight size={14} className="text-red-500 ml-auto" />}
        {trend === 'flat' && <Minus size={14} className="text-gray-400 ml-auto" />}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mx-auto">
        <Cpu size={32} className="text-indigo-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No AI usage data yet</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
          Sync your Claude Code sessions to start tracking AI usage. Run the sync script from your terminal to get started.
        </p>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 max-w-lg mx-auto text-left">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Quick start</p>
        <code className="text-sm text-indigo-600 dark:text-indigo-400 block">
          npx heywren-sync
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Or use the Claude Code hook for automatic sync after each session.
        </p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export default function AiUsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [chartMetric, setChartMetric] = useState<'sessions' | 'tokens' | 'durationMinutes'>('sessions')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ai-usage?days=${days}`)
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to load AI usage data:', err)
        toast.error('Failed to load AI usage data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [days])

  if (loading) return <LoadingSkeleton variant="dashboard" />

  return (
    <UpgradeGate featureKey="ai_usage">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Usage</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Track how you use AI tools across your work sessions
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        </div>

        {!data || data.summary.totalSessions === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={Cpu}
                label="Sessions"
                value={data.summary.totalSessions.toString()}
                sub={`${data.summary.avgSessionMinutes}m avg duration`}
              />
              <StatCard
                icon={Hash}
                label="Total Tokens"
                value={formatTokens(data.summary.totalTokens)}
                sub={`${formatTokens(data.summary.totalInputTokens)} in / ${formatTokens(data.summary.totalOutputTokens)} out`}
              />
              <StatCard
                icon={Clock}
                label="Total Time"
                value={formatDuration(data.summary.totalDurationSeconds)}
                sub={`across ${data.summary.days} days`}
              />
              <StatCard
                icon={MessageSquare}
                label="Messages"
                value={data.summary.totalMessages.toString()}
                sub={`${data.summary.totalToolCalls} tool calls`}
              />
            </div>

            {/* Daily chart */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Daily Activity</h2>
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                  {(['sessions', 'tokens', 'durationMinutes'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`text-xs px-2.5 py-1 rounded-md transition ${
                        chartMetric === m
                          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm font-medium'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {m === 'sessions' ? 'Sessions' : m === 'tokens' ? 'Tokens' : 'Time'}
                    </button>
                  ))}
                </div>
              </div>
              <UsageChart data={data.dailyUsage} metric={chartMetric} />
              {/* X-axis labels */}
              <div className="flex justify-between mt-2 text-[10px] text-gray-400">
                <span>{data.dailyUsage.length > 0 ? new Date(data.dailyUsage[0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                <span>Today</span>
              </div>
            </div>

            {/* Breakdowns row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* By Tool */}
              {data.byTool.length > 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">By Tool</h2>
                  <div className="space-y-3">
                    {data.byTool.map(t => {
                      const pct = data.summary.totalTokens > 0 ? (t.tokens / data.summary.totalTokens) * 100 : 0
                      return (
                        <div key={t.tool}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-700 dark:text-gray-300">{toolDisplayName(t.tool)}</span>
                            <span className="text-gray-500 text-xs">{t.sessions} sessions &middot; {formatTokens(t.tokens)}</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-indigo-500 h-2 rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* By Model */}
              {data.byModel.length > 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">By Model</h2>
                  <div className="space-y-3">
                    {data.byModel.map(m => {
                      const pct = data.summary.totalTokens > 0 ? (m.tokens / data.summary.totalTokens) * 100 : 0
                      return (
                        <div key={m.model}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">{m.model}</span>
                            <span className="text-gray-500 text-xs">{m.sessions} sessions &middot; {formatTokens(m.tokens)}</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-violet-500 h-2 rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Recent sessions table */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Sessions</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Tool</th>
                      <th className="px-5 py-3 font-medium">Project</th>
                      <th className="px-5 py-3 font-medium">Duration</th>
                      <th className="px-5 py-3 font-medium">Tokens</th>
                      <th className="px-5 py-3 font-medium">Messages</th>
                      <th className="px-5 py-3 font-medium">Entrypoint</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.recentSessions.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                        <td className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                            <Cpu size={14} className="text-indigo-500" />
                            {toolDisplayName(s.tool)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs">
                          {projectName(s.project_path)}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {s.duration_seconds ? formatDuration(s.duration_seconds) : '-'}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatTokens(s.total_tokens)}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {s.messages_count}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
                            {entrypointLabel(s.entrypoint)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.recentSessions.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No sessions found for this period.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
