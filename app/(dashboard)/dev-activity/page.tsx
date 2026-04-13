'use client'

import { useEffect, useState } from 'react'
import { GitCommit, GitPullRequest, Eye, Cpu, Clock, TrendingUp, ExternalLink, Info, ArrowUpRight, Copy, AlarmClock } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import toast from 'react-hot-toast'

interface DailyActivity {
  date: string
  commits: number
  prs_opened: number
  prs_merged: number
  reviews: number
  ai_sessions: number
  ai_minutes: number
}

interface RepoBreakdown {
  repo: string
  commits: number
  prs: number
  reviews: number
  total: number
}

interface GitHubEvent {
  id: string
  event_type: string
  repo_name: string
  title: string | null
  url: string | null
  github_username: string
  event_at: string
}

interface Summary {
  totalCommits: number
  totalPrsOpened: number
  totalPrsMerged: number
  totalPrsReviewed: number
  totalAiSessions: number
  totalAiMinutes: number
  days: number
}

interface CycleTimeSummary {
  median_hours: number | null
  mean_hours: number | null
  merged_count: number
  open_count: number
  diagnosis: string
}

interface StalePr {
  key: string
  repo: string
  pr_number: number | null
  title: string
  url: string | null
  opened_at: string
  days_open: number
  suggested_nudge: string
}

interface PrMetrics {
  cycleTime: CycleTimeSummary
  stalePrs: StalePr[]
}

interface DevActivityData {
  summary: Summary
  dailyActivity: DailyActivity[]
  byRepo: RepoBreakdown[]
  recentEvents: GitHubEvent[]
  prMetrics?: PrMetrics
}

// ── Helpers ─────────────────────────────────────────────────────

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    commit: 'Commit',
    pr_opened: 'PR Opened',
    pr_merged: 'PR Merged',
    pr_closed: 'PR Closed',
    pr_reviewed: 'Review',
  }
  return labels[type] || type
}

function eventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    commit: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    pr_opened: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    pr_merged: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    pr_closed: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    pr_reviewed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  }
  return colors[type] || 'bg-gray-100 text-gray-600'
}

function repoShortName(repo: string): string {
  const parts = repo.split('/')
  return parts.length > 1 ? parts[1] : repo
}

// ── Stat card ───────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof GitCommit
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

// ── Activity chart (stacked bars: commits + PRs + reviews + AI) ──

function ActivityChart({ data }: { data: DailyActivity[] }) {
  const maxTotal = Math.max(
    ...data.map(d => d.commits + d.prs_opened + d.prs_merged + d.reviews),
    1
  )

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-[2px] h-36">
        {data.map((d) => {
          const total = d.commits + d.prs_opened + d.prs_merged + d.reviews
          const heightPct = (total / maxTotal) * 100
          const isToday = d.date === new Date().toISOString().split('T')[0]

          // Proportional segments
          const commitPct = total > 0 ? (d.commits / total) * heightPct : 0
          const prPct = total > 0 ? ((d.prs_opened + d.prs_merged) / total) * heightPct : 0
          const reviewPct = total > 0 ? (d.reviews / total) * heightPct : 0

          return (
            <div key={d.date} className="group relative flex-1 min-w-0 flex flex-col justify-end h-full">
              {total > 0 ? (
                <>
                  {reviewPct > 0 && (
                    <div className="w-full bg-amber-400 dark:bg-amber-500 rounded-t-sm" style={{ height: `${reviewPct}%` }} />
                  )}
                  {prPct > 0 && (
                    <div className={`w-full bg-violet-400 dark:bg-violet-500 ${reviewPct === 0 ? 'rounded-t-sm' : ''}`} style={{ height: `${prPct}%` }} />
                  )}
                  {commitPct > 0 && (
                    <div className={`w-full ${isToday ? 'bg-emerald-500' : 'bg-emerald-400 dark:bg-emerald-500'} ${prPct === 0 && reviewPct === 0 ? 'rounded-t-sm' : ''}`} style={{ height: `${commitPct}%` }} />
                  )}
                </>
              ) : (
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-t-sm" style={{ height: '2%' }} />
              )}
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  <div className="font-medium">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div>{d.commits} commits</div>
                  <div>{d.prs_opened + d.prs_merged} PRs</div>
                  <div>{d.reviews} reviews</div>
                  {d.ai_sessions > 0 && <div className="text-indigo-300">{d.ai_sessions} AI sessions ({d.ai_minutes}m)</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Commits</div>
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-violet-400" /> PRs</div>
        <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Reviews</div>
      </div>
      {/* X-axis */}
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{data.length > 0 ? new Date(data[0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

// ── AI Correlation insight ──────────────────────────────────────

function AiCorrelation({ data, summary }: { data: DailyActivity[]; summary: Summary }) {
  // Calculate correlation: days with AI usage vs days without
  const daysWithAi = data.filter(d => d.ai_sessions > 0)
  const daysWithoutAi = data.filter(d => d.ai_sessions === 0)

  const avgCommitsWithAi = daysWithAi.length > 0
    ? (daysWithAi.reduce((sum, d) => sum + d.commits, 0) / daysWithAi.length).toFixed(1)
    : '0'
  const avgCommitsWithoutAi = daysWithoutAi.length > 0
    ? (daysWithoutAi.reduce((sum, d) => sum + d.commits, 0) / daysWithoutAi.length).toFixed(1)
    : '0'

  const avgPrsWithAi = daysWithAi.length > 0
    ? (daysWithAi.reduce((sum, d) => sum + d.prs_opened + d.prs_merged, 0) / daysWithAi.length).toFixed(1)
    : '0'
  const avgPrsWithoutAi = daysWithoutAi.length > 0
    ? (daysWithoutAi.reduce((sum, d) => sum + d.prs_opened + d.prs_merged, 0) / daysWithoutAi.length).toFixed(1)
    : '0'

  if (summary.totalAiSessions === 0) return null

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Cpu size={16} className="text-indigo-600 dark:text-indigo-400" />
        <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">AI Impact on Output</h2>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-1">Avg commits/day</p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-indigo-900 dark:text-indigo-100">{avgCommitsWithAi}</span>
            <span className="text-xs text-indigo-500">with AI</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-500">{avgCommitsWithoutAi}</span>
            <span className="text-xs text-gray-400">without AI</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-1">Avg PRs/day</p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-indigo-900 dark:text-indigo-100">{avgPrsWithAi}</span>
            <span className="text-xs text-indigo-500">with AI</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-500">{avgPrsWithoutAi}</span>
            <span className="text-xs text-gray-400">without AI</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-3">
        Based on {daysWithAi.length} days with AI usage vs {daysWithoutAi.length} days without over the last {summary.days} days.
      </p>
    </div>
  )
}

// ── Cycle time card ─────────────────────────────────────────────

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${hours.toFixed(1)} hrs`
  return `${(hours / 24).toFixed(1)} days`
}

function CycleTimeCard({ cycleTime }: { cycleTime: CycleTimeSummary }) {
  const hasData = cycleTime.merged_count > 0 || cycleTime.open_count > 0
  if (!hasData) return null

  const headline =
    cycleTime.median_hours !== null
      ? formatHours(cycleTime.median_hours)
      : '—'

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Clock size={16} className="text-sky-500" />
            <span className="text-xs font-medium uppercase tracking-wide">PR Cycle Time</span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{headline}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              median, open → merged
            </span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">{cycleTime.diagnosis}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Based on <span className="font-semibold text-gray-700 dark:text-gray-300">{cycleTime.merged_count}</span> merged
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{cycleTime.open_count}</span> open now
          </div>
          {cycleTime.mean_hours !== null && cycleTime.merged_count > 1 && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              mean {formatHours(cycleTime.mean_hours)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stale PR list (with copy-nudge action) ──────────────────────

function StalePrList({ prs }: { prs: StalePr[] }) {
  if (prs.length === 0) return null

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Nudge copied — paste it into Slack')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-200 dark:border-amber-800/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlarmClock size={16} className="text-amber-600 dark:text-amber-400" />
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Stale PRs ({prs.length})
          </h2>
        </div>
        <span className="text-xs text-amber-700 dark:text-amber-400">
          Open 2+ days, not merged or closed
        </span>
      </div>
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-800/30">
        {prs.map(pr => {
          const repoShort = repoShortName(pr.repo)
          return (
            <li key={pr.key} className="px-5 py-3 flex items-start gap-3 hover:bg-amber-100/40 dark:hover:bg-amber-900/10 transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 mb-0.5">
                  <span className="font-mono">{repoShort}{pr.pr_number ? ` #${pr.pr_number}` : ''}</span>
                  <span className="text-amber-500">·</span>
                  <span>{Math.round(pr.days_open)} day{Math.round(pr.days_open) === 1 ? '' : 's'} open</span>
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 truncate" title={pr.title}>
                  {pr.title}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleCopy(pr.suggested_nudge)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-gray-700 transition"
                  title={pr.suggested_nudge}
                >
                  <Copy size={12} />
                  Copy nudge
                </button>
                {pr.url && (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition"
                    title="Open PR on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
        <GitPullRequest size={32} className="text-gray-400" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No developer activity yet</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
          Connect GitHub on the <a href="/integrations" className="text-indigo-600 underline font-medium">Integrations page</a> to
          start tracking commits, pull requests, and code reviews.
        </p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export default function DevActivityPage() {
  const [data, setData] = useState<DevActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/dev-activity?days=${days}`)
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to load dev activity:', err)
        toast.error('Failed to load developer activity')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [days])

  if (loading) return <LoadingSkeleton variant="dashboard" />

  return (
    <UpgradeGate featureKey="dev_activity">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dev Activity</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              GitHub activity and engineering output across your repositories
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

        {!data || (data.summary.totalCommits === 0 && data.summary.totalPrsOpened === 0) ? (
          <EmptyState />
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={GitCommit}
                label="Commits"
                value={data.summary.totalCommits.toString()}
                color="text-emerald-500"
              />
              <StatCard
                icon={GitPullRequest}
                label="PRs Opened"
                value={data.summary.totalPrsOpened.toString()}
                sub={`${data.summary.totalPrsMerged} merged`}
                color="text-violet-500"
              />
              <StatCard
                icon={Eye}
                label="Reviews"
                value={data.summary.totalPrsReviewed.toString()}
                color="text-amber-500"
              />
              <StatCard
                icon={Cpu}
                label="AI Sessions"
                value={data.summary.totalAiSessions.toString()}
                sub={data.summary.totalAiMinutes > 0 ? `${data.summary.totalAiMinutes}m total` : 'Connect Claude Code'}
                color="text-indigo-500"
              />
            </div>

            {/* PR cycle time + stale PR nudges */}
            {data.prMetrics && <CycleTimeCard cycleTime={data.prMetrics.cycleTime} />}
            {data.prMetrics && <StalePrList prs={data.prMetrics.stalePrs} />}

            {/* Activity chart */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Daily Activity</h2>
              <ActivityChart data={data.dailyActivity} />
            </div>

            {/* AI Correlation + Repo breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Impact */}
              <AiCorrelation data={data.dailyActivity} summary={data.summary} />

              {/* By Repo */}
              {data.byRepo.length > 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Top Repositories</h2>
                  <div className="space-y-3">
                    {data.byRepo.slice(0, 6).map(r => {
                      const maxTotal = Math.max(...data.byRepo.map(x => x.total), 1)
                      const pct = (r.total / maxTotal) * 100
                      return (
                        <div key={r.repo}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-700 dark:text-gray-300 font-mono text-xs truncate max-w-[200px]">{repoShortName(r.repo)}</span>
                            <span className="text-gray-500 text-xs">{r.commits}c &middot; {r.prs}pr &middot; {r.reviews}r</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-gray-800 dark:bg-gray-300 h-2 rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 3)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Recent events table */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Repository</th>
                      <th className="px-5 py-3 font-medium">Description</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.recentEvents.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                        <td className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">
                          {new Date(e.event_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${eventTypeColor(e.event_type)}`}>
                            {eventTypeLabel(e.event_type)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs">
                          {repoShortName(e.repo_name)}
                        </td>
                        <td className="px-5 py-3 text-gray-700 dark:text-gray-300 text-xs max-w-[300px] truncate">
                          {e.title || '-'}
                        </td>
                        <td className="px-5 py-3">
                          {e.url && (
                            <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-indigo-500 transition">
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.recentEvents.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No activity found for this period.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
