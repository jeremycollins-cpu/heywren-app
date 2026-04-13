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
  user_id?: string | null
  github_username?: string | null
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
  ai_assisted?: boolean      // pulled from the opened event's metadata
  ai_tool?: string | null
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

export interface AiShareSummary {
  merged_prs: number              // total merged PRs in window
  ai_assisted_prs: number         // merged PRs with an AI signature OR session overlap
  share: number | null            // ai_assisted / merged, 0–1, null when merged=0
  by_tool: Record<string, number> // { claude: n, copilot: n, cursor: n, aider: n, other: n, session_only: n }
  avg_lines_ai: number | null     // mean (additions+deletions) for AI-assisted merged PRs
  avg_lines_human: number | null  // mean (additions+deletions) for non-AI merged PRs
  size_ratio: number | null       // avg_lines_ai / avg_lines_human (null when either is 0/unknown)
}

export interface PrMetrics {
  cycleTime: CycleTimeSummary
  stalePrs: StalePr[]
  codeVolume: VolumeSummary
  refactorRatio: RefactorRatioSummary
  aiShare: AiShareSummary
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
  opts: { volumeWeeks?: number; aiSessions?: AiSessionWindow[] } = {}
): PrMetrics {
  const volumeWeeks = opts.volumeWeeks ?? 8
  const aiSessions = opts.aiSessions ?? []
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
      ai_assisted: Boolean(openEvent.metadata?.ai_assisted),
      ai_tool: openEvent.metadata?.ai_tool ?? null,
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
  const aiShare = computeAiShare(mergedEvents, aiSessions)

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
    aiShare,
  }
}

// ── Contributor breakdown (team view) ────────────────────────────

export interface ContributorRow {
  user_id: string | null
  github_username: string | null
  full_name?: string | null          // filled in by the API layer from `profiles`
  avatar_url?: string | null
  commits: number
  prs_opened: number
  prs_merged: number
  prs_merged_with_stats: number      // how many of the merged PRs had additions/deletions populated
  reviews_given: number
  stale_prs: number                  // PRs authored by this user that are 2+ days open
  lines_added: number                // from merged PRs only (where stats available)
  lines_removed: number              // from merged PRs only (where stats available)
}

/**
 * Per-contributor breakdown for team-scope views. Intentionally framed as
 * "load distribution" not a leaderboard — the UI layer should present it as
 * capacity sensing, not a performance ranking.
 */
export function computeContributorBreakdown(events: GithubEventRow[]): ContributorRow[] {
  // Group events by user_id (fallback to github_username when user_id is null,
  // which can happen for very old rows before the column was populated).
  const byKey = new Map<string, ContributorRow>()

  // First pass: figure out which PRs are stale (opened, no merge/close, 2+ days).
  const openedByPrKey = new Map<string, GithubEventRow>()
  const mergedByPrKey = new Set<string>()
  const closedByPrKey = new Set<string>()
  for (const e of events) {
    const num = e.metadata?.pr_number
    if (!num) continue
    const key = `${e.repo_name}#${num}`
    if (e.event_type === 'pr_opened') openedByPrKey.set(key, e)
    else if (e.event_type === 'pr_merged') mergedByPrKey.add(key)
    else if (e.event_type === 'pr_closed') closedByPrKey.add(key)
  }
  const now = Date.now()
  const stalePrAuthors = new Map<string, number>() // contributor key → stale PR count
  for (const [key, openEvent] of openedByPrKey.entries()) {
    if (mergedByPrKey.has(key) || closedByPrKey.has(key)) continue
    const ageDays = (now - new Date(openEvent.event_at).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays < STALE_THRESHOLD_DAYS) continue
    const contribKey = openEvent.user_id || openEvent.github_username || 'unknown'
    stalePrAuthors.set(contribKey, (stalePrAuthors.get(contribKey) || 0) + 1)
  }

  // Second pass: tally the rest.
  for (const e of events) {
    const key = e.user_id || e.github_username || 'unknown'
    let row = byKey.get(key)
    if (!row) {
      row = {
        user_id: e.user_id ?? null,
        github_username: e.github_username ?? null,
        commits: 0,
        prs_opened: 0,
        prs_merged: 0,
        prs_merged_with_stats: 0,
        reviews_given: 0,
        stale_prs: 0,
        lines_added: 0,
        lines_removed: 0,
      }
      byKey.set(key, row)
    }
    if (e.event_type === 'commit') row.commits++
    else if (e.event_type === 'pr_opened') row.prs_opened++
    else if (e.event_type === 'pr_merged') {
      row.prs_merged++
      const hasStats = typeof e.additions === 'number' && typeof e.deletions === 'number'
      if (hasStats) {
        row.prs_merged_with_stats++
        row.lines_added += e.additions || 0
        row.lines_removed += e.deletions || 0
      }
    } else if (e.event_type === 'pr_reviewed') row.reviews_given++
  }

  // Attach stale PR counts.
  for (const [contribKey, count] of stalePrAuthors.entries()) {
    const row = byKey.get(contribKey)
    if (row) row.stale_prs = count
  }

  // Sort by total activity descending — useful default, not a ranking.
  return Array.from(byKey.values()).sort((a, b) => {
    const aTotal = a.commits + a.prs_merged + a.reviews_given
    const bTotal = b.commits + b.prs_merged + b.reviews_given
    return bTotal - aTotal
  })
}

// ── AI-assisted share ───────────────────────────────────────────

export interface AiSessionWindow {
  started_at: string
  duration_seconds: number | null
}

/**
 * Returns true if the event fell inside any Claude Code session window.
 * This is the "session overlap" signal — catches AI-assisted work even
 * when the commit/PR has no explicit trailer (because HeyWren directly
 * observed a Claude Code session running at that time).
 */
function eventOverlapsAnySession(eventAtIso: string, sessions: AiSessionWindow[]): boolean {
  if (sessions.length === 0) return false
  const t = new Date(eventAtIso).getTime()
  for (const s of sessions) {
    const start = new Date(s.started_at).getTime()
    const end = start + (s.duration_seconds ?? 0) * 1000
    // Small grace window (5 minutes) — a commit just after session-end is
    // almost certainly finishing an AI-paired task.
    if (t >= start - 5 * 60_000 && t <= end + 5 * 60_000) return true
  }
  return false
}

/**
 * Compute the AI-assisted share of merged PRs in the window.
 * Combines two signals:
 *   1. Explicit signatures in commit/PR text (tool = claude/copilot/cursor/…)
 *   2. Temporal overlap with Claude Code sessions (tool = 'session_only'
 *      when no explicit signature was present)
 * Also returns an average-size correlation so the headline has context.
 */
export function computeAiShare(
  events: GithubEventRow[],
  aiSessions: AiSessionWindow[] = []
): AiShareSummary {
  const merged = events.filter(e => e.event_type === 'pr_merged')

  let aiAssisted = 0
  const byTool: Record<string, number> = {
    claude: 0, copilot: 0, cursor: 0, aider: 0, other: 0, session_only: 0,
  }

  const linesAi: number[] = []
  const linesHuman: number[] = []

  for (const ev of merged) {
    const hasSig = Boolean(ev.metadata?.ai_assisted)
    const tool = (ev.metadata?.ai_tool as string | null) || null
    const overlap = eventOverlapsAnySession(ev.event_at, aiSessions)
    const isAi = hasSig || overlap

    if (isAi) {
      aiAssisted++
      if (hasSig && tool && byTool[tool] !== undefined) byTool[tool]++
      else if (hasSig) byTool.other++
      else byTool.session_only++
    }

    if (typeof ev.additions === 'number' && typeof ev.deletions === 'number') {
      const size = (ev.additions || 0) + (ev.deletions || 0)
      if (isAi) linesAi.push(size)
      else linesHuman.push(size)
    }
  }

  const avgAi = linesAi.length > 0 ? Math.round(mean(linesAi) as number) : null
  const avgHuman = linesHuman.length > 0 ? Math.round(mean(linesHuman) as number) : null
  const sizeRatio = avgAi !== null && avgHuman !== null && avgHuman > 0
    ? Number((avgAi / avgHuman).toFixed(2))
    : null

  return {
    merged_prs: merged.length,
    ai_assisted_prs: aiAssisted,
    share: merged.length > 0 ? Number((aiAssisted / merged.length).toFixed(3)) : null,
    by_tool: byTool,
    avg_lines_ai: avgAi,
    avg_lines_human: avgHuman,
    size_ratio: sizeRatio,
  }
}

export const _internal = { formatHours, median, mean, STALE_THRESHOLD_DAYS }
