'use client'

// Shared metric cards for the personal and team dev-activity views.
// Extracted so the team page doesn't duplicate ~350 lines of UI.

import { Clock, AlarmClock, Copy, ExternalLink, Info, BarChart3, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'

export interface CycleTimeSummary {
  median_hours: number | null
  mean_hours: number | null
  merged_count: number
  open_count: number
  diagnosis: string
}

export interface StalePr {
  key: string
  repo: string
  pr_number: number | null
  title: string
  url: string | null
  opened_at: string
  days_open: number
  suggested_nudge: string
  author_name?: string | null
}

export interface WeeklyVolumeBucket {
  week_start: string
  merged_prs: number
  additions: number
  deletions: number
  total_lines: number
}

export interface VolumeSummary {
  weeks: WeeklyVolumeBucket[]
  last_week_total: number
  prior_weeks_median: number
  prs_with_stats: number
  prs_without_stats: number
}

export interface RefactorRatioSummary {
  refactor_prs: number
  total_prs: number
  ratio: number | null
  top_refactors: Array<{
    repo: string
    pr_number: number | null
    title: string
    url: string | null
    net_lines_removed: number
  }>
}

// ── Shared helpers ──────────────────────────────────────────────

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${hours.toFixed(1)} hrs`
  return `${(hours / 24).toFixed(1)} days`
}

export function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

export function repoShortName(repo: string): string {
  const parts = repo.split('/')
  return parts.length > 1 ? parts[1] : repo
}

function formatWeekLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Cycle Time Card ─────────────────────────────────────────────

export function CycleTimeCard({ cycleTime, label = 'PR Cycle Time' }: { cycleTime: CycleTimeSummary; label?: string }) {
  const hasData = cycleTime.merged_count > 0 || cycleTime.open_count > 0
  if (!hasData) return null

  const headline = cycleTime.median_hours !== null ? formatHours(cycleTime.median_hours) : '—'

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Clock size={16} className="text-sky-500" />
            <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{headline}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">median, open → merged</span>
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

// ── Stale PR List ───────────────────────────────────────────────

export function StalePrList({
  prs,
  title = 'Stale PRs',
  showAuthor = false,
}: {
  prs: StalePr[]
  title?: string
  showAuthor?: boolean
}) {
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
            {title} ({prs.length})
          </h2>
        </div>
        <span className="text-xs text-amber-700 dark:text-amber-400">Open 2+ days, not merged or closed</span>
      </div>
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-800/30">
        {prs.map(pr => {
          const repoShort = repoShortName(pr.repo)
          return (
            <li key={pr.key} className="px-5 py-3 flex items-start gap-3 hover:bg-amber-100/40 dark:hover:bg-amber-900/10 transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 mb-0.5 flex-wrap">
                  <span className="font-mono">{repoShort}{pr.pr_number ? ` #${pr.pr_number}` : ''}</span>
                  <span className="text-amber-500">·</span>
                  <span>{Math.round(pr.days_open)} day{Math.round(pr.days_open) === 1 ? '' : 's'} open</span>
                  {showAuthor && pr.author_name && (
                    <>
                      <span className="text-amber-500">·</span>
                      <span>by {pr.author_name}</span>
                    </>
                  )}
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 truncate" title={pr.title}>{pr.title}</div>
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

// ── Code Volume Card ────────────────────────────────────────────

export function CodeVolumeCard({ volume }: { volume: VolumeSummary }) {
  const hasAny = volume.weeks.some(w => w.total_lines > 0)
  if (!hasAny) return null

  const maxTotal = Math.max(...volume.weeks.map(w => w.total_lines), 1)
  const lastWeek = volume.weeks[volume.weeks.length - 1]

  let trend = ''
  if (volume.prior_weeks_median > 0 && lastWeek) {
    const ratio = lastWeek.total_lines / volume.prior_weeks_median
    if (ratio >= 1.5) trend = `${Math.round((ratio - 1) * 100)}% above typical`
    else if (ratio <= 0.5 && lastWeek.total_lines > 0) trend = `${Math.round((1 - ratio) * 100)}% below typical`
    else trend = 'in line with typical'
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <BarChart3 size={16} className="text-teal-500" />
            <span className="text-xs font-medium uppercase tracking-wide">Code Volume Shipped</span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCompact(lastWeek?.total_lines ?? 0)} lines
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">last week, merged PRs</span>
          </div>
          {trend && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{trend} (vs {formatCompact(volume.prior_weeks_median)} median)</p>
          )}
        </div>
        <div
          className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[180px] text-right leading-snug"
          title="Volume reflects how much code moved, not its value. A great refactor may have low gross volume but high impact."
        >
          <Info size={11} className="inline mr-1 -mt-0.5" />
          Volume, not value — use for capacity sensing
        </div>
      </div>

      <div className="flex items-end gap-1 h-16">
        {volume.weeks.map(w => {
          const heightPct = (w.total_lines / maxTotal) * 100
          const addPct = w.total_lines > 0 ? (w.additions / w.total_lines) * heightPct : 0
          const delPct = w.total_lines > 0 ? (w.deletions / w.total_lines) * heightPct : 0
          return (
            <div key={w.week_start} className="group relative flex-1 min-w-0 flex flex-col justify-end h-full">
              {w.total_lines > 0 ? (
                <>
                  {delPct > 0 && <div className="w-full bg-rose-400 dark:bg-rose-500/80" style={{ height: `${delPct}%` }} />}
                  {addPct > 0 && <div className="w-full bg-emerald-400 dark:bg-emerald-500/80 rounded-t-sm" style={{ height: `${addPct}%` }} />}
                </>
              ) : (
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-t-sm" style={{ height: '2%' }} />
              )}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  <div className="font-medium">Week of {formatWeekLabel(w.week_start)}</div>
                  <div className="text-emerald-300">+{formatCompact(w.additions)} added</div>
                  <div className="text-rose-300">−{formatCompact(w.deletions)} removed</div>
                  <div className="text-gray-400 mt-0.5">{w.merged_prs} merged PR{w.merged_prs === 1 ? '' : 's'}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-emerald-400" /> Added</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-rose-400" /> Removed</div>
        </div>
        {volume.prs_without_stats > 0 && (
          <span title="Line stats unavailable for some PRs (private/archived/deleted).">
            {volume.prs_without_stats} PR{volume.prs_without_stats === 1 ? '' : 's'} missing stats
          </span>
        )}
      </div>
    </div>
  )
}

// ── Refactor Ratio Card ─────────────────────────────────────────

export function RefactorRatioCard({ refactor }: { refactor: RefactorRatioSummary }) {
  if (refactor.total_prs === 0) return null

  const pct = refactor.ratio !== null ? Math.round(refactor.ratio * 100) : 0

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
        <Sparkles size={16} className="text-fuchsia-500" />
        <span className="text-xs font-medium uppercase tracking-wide">Refactor Ratio</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900 dark:text-white">{pct}%</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">of merged PRs removed more than they added</span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
        {refactor.refactor_prs} of {refactor.total_prs} merged PRs were net-negative — cleanup work that raw LOC would hide.
      </p>

      {refactor.top_refactors.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Biggest cleanups</div>
          <ul className="space-y-1.5">
            {refactor.top_refactors.map(r => (
              <li key={`${r.repo}-${r.pr_number}`} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-gray-500 dark:text-gray-400">
                    {repoShortName(r.repo)}{r.pr_number ? ` #${r.pr_number}` : ''}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300 ml-2 truncate">{r.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    −{formatCompact(r.net_lines_removed)} net
                  </span>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-indigo-500">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
