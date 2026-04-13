'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GitCommit, GitPullRequest, Eye, ArrowLeft, Users, AlertTriangle } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import toast from 'react-hot-toast'
import {
  CycleTimeCard,
  StalePrList,
  CodeVolumeCard,
  RefactorRatioCard,
  formatCompact,
  type CycleTimeSummary,
  type StalePr,
  type VolumeSummary,
  type RefactorRatioSummary,
} from '@/components/dev-activity/metric-cards'

interface Summary {
  totalCommits: number
  totalPrsOpened: number
  totalPrsMerged: number
  totalPrsReviewed: number
  days: number
}

interface PrMetrics {
  cycleTime: CycleTimeSummary
  stalePrs: StalePr[]
  codeVolume: VolumeSummary
  refactorRatio: RefactorRatioSummary
}

interface Contributor {
  user_id: string | null
  github_username: string | null
  full_name?: string | null
  avatar_url?: string | null
  commits: number
  prs_opened: number
  prs_merged: number
  prs_merged_with_stats: number
  reviews_given: number
  stale_prs: number
  lines_added: number
  lines_removed: number
}

interface TeamDevActivityData {
  team: { id: string; name: string }
  summary: Summary
  prMetrics: PrMetrics
  contributors: Contributor[]
}

// ── Stat card ───────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof GitCommit
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-1">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon size={16} className={color} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
    </div>
  )
}

// ── Contributor row ─────────────────────────────────────────────
// Framed as load distribution, not a ranking. Sorted by total activity but
// we deliberately avoid numeric positions (#1, #2, …) to discourage the
// "team leaderboard" reading.

function contributorDisplay(c: Contributor): string {
  return c.full_name || c.github_username || 'Unknown'
}

function ContributorList({ contributors }: { contributors: Contributor[] }) {
  if (contributors.length === 0) return null

  // For a simple workload-balance visual, scale bars against the max-PR person.
  const maxMerged = Math.max(...contributors.map(c => c.prs_merged), 1)

  // Total line-stat coverage across the team — used for the transparency note.
  const totalMerged = contributors.reduce((s, c) => s + c.prs_merged, 0)
  const totalHydrated = contributors.reduce((s, c) => s + c.prs_merged_with_stats, 0)
  const coverageIncomplete = totalMerged > 0 && totalHydrated < totalMerged

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Contributors ({contributors.length})
          </h2>
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          Load distribution — spot imbalances, not rank performance
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-700">
              <th className="px-5 py-3 font-medium">Person</th>
              <th className="px-5 py-3 font-medium text-right">Commits</th>
              <th className="px-5 py-3 font-medium text-right">PRs merged</th>
              <th className="px-5 py-3 font-medium">Relative load</th>
              <th className="px-5 py-3 font-medium text-right">Reviews</th>
              <th className="px-5 py-3 font-medium text-right">Stale PRs</th>
              <th className="px-5 py-3 font-medium text-right">Net lines</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {contributors.map((c, i) => {
              const key = c.user_id || c.github_username || `row-${i}`
              const pct = (c.prs_merged / maxMerged) * 100
              const netLines = c.lines_added - c.lines_removed
              const hasAnyStats = c.prs_merged_with_stats > 0
              const partialStats = hasAnyStats && c.prs_merged_with_stats < c.prs_merged
              return (
                <tr key={key} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="w-6 h-6 rounded-full shrink-0" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-gray-900 dark:text-gray-100 truncate">{contributorDisplay(c)}</div>
                        {c.github_username && c.full_name && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">@{c.github_username}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{c.commits}</td>
                  <td className="px-5 py-3 text-right text-gray-900 dark:text-gray-100 font-medium tabular-nums">{c.prs_merged}</td>
                  <td className="px-5 py-3 w-[140px]">
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className="bg-indigo-400 dark:bg-indigo-500 h-1.5 rounded-full"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{c.reviews_given}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {c.stale_prs > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                        <AlertTriangle size={12} />
                        {c.stale_prs}
                      </span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${!hasAnyStats ? 'text-gray-400' : netLines < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'}`}>
                    {!hasAnyStats ? (
                      <span title="Line stats not yet available — the sync progressively backfills historical PRs each day.">—</span>
                    ) : (
                      <span
                        title={partialStats ? `Based on ${c.prs_merged_with_stats} of ${c.prs_merged} merged PRs — the rest are still being backfilled.` : undefined}
                      >
                        {netLines >= 0 ? '+' : ''}{formatCompact(netLines)}
                        {partialStats && <span className="text-[10px] text-gray-400 ml-0.5">*</span>}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400 flex items-center justify-between gap-3 flex-wrap">
        <span>
          Merged PRs and commits reflect volume, not value. Review-count imbalances and stale-PR concentration are the most actionable signals here.
        </span>
        {coverageIncomplete && (
          <span className="shrink-0" title="Line counts are hydrated from GitHub over several daily syncs for historical PRs.">
            Net lines: {totalHydrated}/{totalMerged} PRs hydrated
          </span>
        )}
      </div>
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No team dev activity yet</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
          Team members need to connect GitHub individually on their{' '}
          <Link href="/integrations" className="text-indigo-600 underline font-medium">Integrations page</Link>.
          Activity appears here once the first sync completes.
        </p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export default function TeamDevActivityPage() {
  const [data, setData] = useState<TeamDevActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [days, setDays] = useState(30)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/dev-activity/team?days=${days}`)
        if (res.status === 403) {
          setForbidden(true)
          return
        }
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to load team dev activity:', err)
        toast.error('Failed to load team developer activity')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [days])

  if (loading) return <LoadingSkeleton variant="dashboard" />

  if (forbidden) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-[900px] mx-auto">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Admins only</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            This view is available to team admins and super admins.
          </p>
          <Link href="/dev-activity" className="inline-block mt-4 text-sm text-indigo-600 underline">
            Go to your personal Dev Activity
          </Link>
        </div>
      </div>
    )
  }

  const hasActivity = data && (data.summary.totalCommits > 0 || data.summary.totalPrsOpened > 0)

  return (
    <UpgradeGate featureKey="dev_activity">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              href="/team-management"
              className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1"
            >
              <ArrowLeft size={12} />
              Team Management
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Team Dev Activity {data?.team?.name ? <span className="text-gray-400 font-normal">· {data.team.name}</span> : null}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Aggregated engineering output across your team. Load distribution, not performance ranking.
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

        {!hasActivity || !data ? (
          <EmptyState />
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={GitCommit} label="Commits" value={data.summary.totalCommits.toString()} color="text-emerald-500" />
              <StatCard icon={GitPullRequest} label="PRs opened" value={data.summary.totalPrsOpened.toString()} color="text-violet-500" />
              <StatCard icon={GitPullRequest} label="PRs merged" value={data.summary.totalPrsMerged.toString()} color="text-violet-500" />
              <StatCard icon={Eye} label="Reviews" value={data.summary.totalPrsReviewed.toString()} color="text-amber-500" />
            </div>

            {/* Team-wide metrics */}
            <CycleTimeCard cycleTime={data.prMetrics.cycleTime} label="Team PR Cycle Time" />
            <StalePrList prs={data.prMetrics.stalePrs} title="Team Stale PRs" showAuthor={false} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CodeVolumeCard volume={data.prMetrics.codeVolume} />
              <RefactorRatioCard refactor={data.prMetrics.refactorRatio} />
            </div>

            {/* Contributors */}
            <ContributorList contributors={data.contributors} />
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
