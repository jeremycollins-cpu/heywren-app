// lib/github/pr-metrics.ts
// Derives PR cycle time and stale-PR signals from the `github_events` table.
// No schema changes — we pair `pr_opened` events with their matching
// `pr_merged` / `pr_closed` outcome by (repo_name, metadata.pr_number).

export interface GithubEventRow {
  id: string
  event_type: string
  repo_name: string
  title: string | null
  url: string | null
  event_at: string
  metadata: Record<string, any> | null
  additions?: number | null
  deletions?: number | null
  changed_files?: number | null
}

export interface StalePr {
  key: string                // `${repo}#${pr_number}` — stable id for UI
  repo: string               // owner/repo
  pr_number: number | null
  title: string
  url: string | null
  opened_at: string
  days_open: number
  suggested_nudge: string    // draft Slack/DM-ready message
}

export interface CycleTimeSummary {
  median_hours: number | null
  mean_hours: number | null
  merged_count: number       // how many closed PRs contributed to the stat
  open_count: number         // how many PRs are currently open
  diagnosis: string          // one-sentence plain-English takeaway
}

export interface WeeklyVolumeBucket {
  week_start: string         // ISO date, Monday of the week (UTC)
  merged_prs: number         // count of merged PRs that week (with stats)
  additions: number
  deletions: number
  total_lines: number        // additions + deletions (gross volume)
}

export interface VolumeSummary {
  weeks: WeeklyVolumeBucket[]
  last_week_total: number
  prior_weeks_median: number // median total_lines across prior weeks (for trend language)
  prs_with_stats: number     // how many merged PRs contributed (for transparency)
  prs_without_stats: number  // merged PRs we couldn't get line counts for
}

export interface RefactorRatioSummary {
  refactor_prs: number       // merged PRs where deletions > additions
  total_prs: number          // merged PRs with line-count data
  ratio: number | null       // refactor_prs / total_prs, null if total == 0
  top_refactors: Array<{     // up to 3 biggest cleanup PRs to highlight
    repo: string
    pr_number: number | null
    title: string
    url: string | null
    net_lines_removed: number // deletions - additions, always positive here
  }>
}

export interface PrMetrics {
  cycleTime: CycleTimeSummary
  stalePrs: StalePr[]
  codeVolume: VolumeSummary
  refactorRatio: RefactorRatioSummary
}

const STALE_THRESHOLD_DAYS = 2
const HOURS_PER_DAY = 24
const MS_PER_HOUR = 1000 * 60 * 60

function prKey(repo: string, prNumber: number | string | null | undefined): string | null {
  if (prNumber === null || prNumber === undefined) return null
  return `${repo}#${prNumber}`
}

function hoursBetween(laterIso: string, earlierIso: string): number {
  return (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / MS_PER_HOUR
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < HOURS_PER_DAY) return `${hours.toFixed(1)}h`
  return `${(hours / HOURS_PER_DAY).toFixed(1)}d`
}

/**
 * Build a plain-English diagnosis so managers don't have to interpret numbers.
 * Mirrors the product strategy: one number, one diagnosis, one nudgeable action.
 */
function buildDiagnosis(
  medianHrs: number | null,
  mergedCount: number,
  openCount: number,
  staleCount: number
): string {
  if (mergedCount === 0 && openCount === 0) {
    return 'No PR activity in this window yet.'
  }
  if (mergedCount === 0) {
    return `${openCount} PR${openCount === 1 ? '' : 's'} open, none merged in this window. Cycle time will appear once something ships.`
  }

  const base =
    medianHrs !== null && medianHrs < HOURS_PER_DAY
      ? `PRs typically ship in ${formatHours(medianHrs)} — fast.`
      : medianHrs !== null && medianHrs < 3 * HOURS_PER_DAY
      ? `PRs typically ship in ${formatHours(medianHrs)}.`
      : medianHrs !== null
      ? `PRs typically take ${formatHours(medianHrs)} to ship — on the slow side.`
      : ''

  if (staleCount > 0) {
    return `${base} ${staleCount} PR${staleCount === 1 ? ' is' : 's are'} idle ${STALE_THRESHOLD_DAYS}+ days — most cycle time is spent waiting.`.trim()
  }
  return `${base} No stale PRs right now.`.trim()
}

/**
 * Build a short, copy-paste-ready nudge the user can drop into Slack.
 * Template-only (no AI) — matches the "drafted, not sent" philosophy and
 * avoids per-page AI cost. Users edit before sending.
 */
function buildNudgeDraft(title: string, url: string | null, daysOpen: number): string {
  const ageLabel =
    daysOpen >= 7
      ? `${Math.round(daysOpen)} days`
      : daysOpen >= 2
      ? `${Math.round(daysOpen)} days`
      : 'a couple days'
  const link = url ? `\n${url}` : ''
  return `Hey — this PR has been open ${ageLabel} and could use a fresh set of eyes: "${title}".${link}\nAny chance you can take a look today?`
}

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday that starts the week
 * containing `date`, in UTC. Monday-start keeps the "this week" bucket stable
 * across timezones and matches how most engineering teams think about sprints.
 */
function weekStartMondayUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

/**
 * Build weekly code-volume buckets from merged PR events.
 * Volume = additions + deletions (gross churn), not net. This is intentional:
 * a refactor that removes 500 lines is valuable work — net would hide it.
 * Framed as capacity sensing, not a performance metric.
 */
function computeCodeVolume(
  mergedEvents: GithubEventRow[],
  weeksBack: number
): VolumeSummary {
  // Seed buckets for the last N weeks so the sparkline has a stable length
  // even when a week has zero activity.
  const buckets = new Map<string, WeeklyVolumeBucket>()
  const now = new Date()
  const thisWeekStart = weekStartMondayUtc(now)

  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(`${thisWeekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i * 7)
    const key = weekStartMondayUtc(d)
    buckets.set(key, {
      week_start: key,
      merged_prs: 0,
      additions: 0,
      deletions: 0,
      total_lines: 0,
    })
  }

  let withStats = 0
  let withoutStats = 0

  for (const ev of mergedEvents) {
    const hasStats =
      typeof ev.additions === 'number' &&
      typeof ev.deletions === 'number'
    if (!hasStats) {
      withoutStats++
      continue
    }

    const weekKey = weekStartMondayUtc(new Date(ev.event_at))
    const bucket = buckets.get(weekKey)
    if (!bucket) continue // outside the requested window

    withStats++
    bucket.merged_prs++
    bucket.additions += ev.additions || 0
    bucket.deletions += ev.deletions || 0
    bucket.total_lines += (ev.additions || 0) + (ev.deletions || 0)
  }

  const weeks = Array.from(buckets.values()).sort((a, b) =>
    a.week_start.localeCompare(b.week_start)
  )

  const lastWeekTotal = weeks.length > 0 ? weeks[weeks.length - 1].total_lines : 0
  const priorTotals = weeks.slice(0, -1).map(w => w.total_lines)
  const priorMedian = median(priorTotals) ?? 0

  return {
    weeks,
    last_week_total: lastWeekTotal,
    prior_weeks_median: Math.round(priorMedian),
    prs_with_stats: withStats,
    prs_without_stats: withoutStats,
  }
}

/**
 * Refactor ratio: share of merged PRs where `deletions > additions`.
 * Explicitly celebrates cleanup work that raw LOC metrics penalize.
 */
function computeRefactorRatio(mergedEvents: GithubEventRow[]): RefactorRatioSummary {
  let refactorCount = 0
  let totalCount = 0
  const refactorCandidates: Array<{
    repo: string
    pr_number: number | null
    title: string
    url: string | null
    net_lines_removed: number
  }> = []

  for (const ev of mergedEvents) {
    if (typeof ev.additions !== 'number' || typeof ev.deletions !== 'number') continue
    totalCount++
    const net = ev.deletions - ev.additions
    if (net > 0) {
      refactorCount++
      refactorCandidates.push({
        repo: ev.repo_name,
        pr_number: ev.metadata?.pr_number ?? null,
        title: ev.title || `PR ${ev.metadata?.pr_number ?? ''}`.trim(),
        url: ev.url,
        net_lines_removed: net,
      })
    }
  }

  const topRefactors = refactorCandidates
    .sort((a, b) => b.net_lines_removed - a.net_lines_removed)
    .slice(0, 3)

  return {
    refactor_prs: refactorCount,
    total_prs: totalCount,
    ratio: totalCount > 0 ? Number((refactorCount / totalCount).toFixed(3)) : null,
    top_refactors: topRefactors,
  }
}

/**
 * Core metric computation. Pure function — takes events, returns metrics.
 * Events do NOT need to be sorted; we index them internally.
 */
export function computePrMetrics(
  events: GithubEventRow[],
  opts: { volumeWeeks?: number } = {}
): PrMetrics {
  const volumeWeeks = opts.volumeWeeks ?? 8
  // Index PR-related events by their stable key.
  // A single PR can have up to 3 lifecycle events: opened, merged, closed.
  const opened = new Map<string, GithubEventRow>()
  const merged = new Map<string, GithubEventRow>()
  const closed = new Map<string, GithubEventRow>()

  for (const e of events) {
    const num = e.metadata?.pr_number
    const key = prKey(e.repo_name, num)
    if (!key) continue
    if (e.event_type === 'pr_opened') opened.set(key, e)
    else if (e.event_type === 'pr_merged') merged.set(key, e)
    else if (e.event_type === 'pr_closed') closed.set(key, e)
  }

  // ── Cycle time: opened → merged ─────────────────────────────
  const cycleHours: number[] = []
  for (const [key, openEvent] of opened.entries()) {
    const mergedEvent = merged.get(key)
    if (!mergedEvent) continue
    const hrs = hoursBetween(mergedEvent.event_at, openEvent.event_at)
    if (hrs >= 0 && Number.isFinite(hrs)) cycleHours.push(hrs)
  }

  // ── Stale PRs: opened but neither merged nor closed, and aging ──
  const now = Date.now()
  const stalePrs: StalePr[] = []
  let openCount = 0

  for (const [key, openEvent] of opened.entries()) {
    if (merged.has(key) || closed.has(key)) continue
    openCount++

    const daysOpen = (now - new Date(openEvent.event_at).getTime()) / (MS_PER_HOUR * HOURS_PER_DAY)
    if (daysOpen < STALE_THRESHOLD_DAYS) continue

    const title = openEvent.title || `PR ${openEvent.metadata?.pr_number ?? ''}`.trim()

    stalePrs.push({
      key,
      repo: openEvent.repo_name,
      pr_number: openEvent.metadata?.pr_number ?? null,
      title,
      url: openEvent.url,
      opened_at: openEvent.event_at,
      days_open: Number(daysOpen.toFixed(1)),
      suggested_nudge: buildNudgeDraft(title, openEvent.url, daysOpen),
    })
  }

  // Oldest first — that's where attention should go.
  stalePrs.sort((a, b) => b.days_open - a.days_open)

  const medianHrs = median(cycleHours)
  const meanHrs = mean(cycleHours)

  // ── Code volume + refactor ratio (merged PRs only) ──
  const mergedEvents = Array.from(merged.values())
  const codeVolume = computeCodeVolume(mergedEvents, volumeWeeks)
  const refactorRatio = computeRefactorRatio(mergedEvents)

  return {
    cycleTime: {
      median_hours: medianHrs === null ? null : Number(medianHrs.toFixed(2)),
      mean_hours: meanHrs === null ? null : Number(meanHrs.toFixed(2)),
      merged_count: cycleHours.length,
      open_count: openCount,
      diagnosis: buildDiagnosis(medianHrs, cycleHours.length, openCount, stalePrs.length),
    },
    stalePrs,
    codeVolume,
    refactorRatio,
  }
}

export const _internal = { formatHours, median, mean, STALE_THRESHOLD_DAYS }
