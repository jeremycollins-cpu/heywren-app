// Thin wrapper around the Anthropic Admin API's Claude Code usage report.
// Docs: https://docs.anthropic.com/en/api/claude-code-analytics-api
//
// The endpoint returns daily per-user rows with session counts, token
// breakdowns by model, estimated cost in USD cents, and productivity
// signals (LOC, commits, PRs, tool acceptance).

const BASE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/claude_code'

export interface ClaudeCodeUsageRow {
  date: string
  actor: {
    type: 'user_actor' | string
    email_address?: string
    user_uuid?: string
  }
  customer_type?: 'api' | 'subscription'
  subscription_type?: 'team' | 'enterprise' | string
  num_sessions?: number
  lines_of_code?: {
    added?: number
    removed?: number
  }
  commits?: number
  pull_requests?: number
  terminal_type?: string
  tool_actions?: {
    accepted?: number
    rejected?: number
  }
  core_metrics?: {
    estimated_cost?: { amount?: number; currency?: string }
    num_sessions?: number
    models?: Array<{
      model: string
      tokens?: {
        input?: number
        output?: number
        cache_creation?: number
        cache_read?: number
      }
    }>
  }
}

export interface UsageReportResponse {
  data: ClaudeCodeUsageRow[]
  has_more?: boolean
  next_page?: string | null
}

export class AnthropicAdminApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Anthropic Admin API error ${status}: ${body.slice(0, 300)}`)
  }
}

async function fetchOneDay(params: {
  apiKey: string
  day: string // 'YYYY-MM-DD'
}): Promise<ClaudeCodeUsageRow[]> {
  const rows: ClaudeCodeUsageRow[] = []
  let pageToken: string | null | undefined = undefined
  let pagesFetched = 0
  const MAX_PAGES = 50 // safety cap per day

  while (true) {
    const url = new URL(BASE_URL)
    url.searchParams.set('starting_at', params.day)
    if (pageToken) url.searchParams.set('page', pageToken)

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new AnthropicAdminApiError(res.status, body)
    }

    const json = (await res.json()) as UsageReportResponse
    rows.push(...(json.data || []))
    pagesFetched += 1

    if (!json.has_more || !json.next_page) break
    if (pagesFetched >= MAX_PAGES) break
    pageToken = json.next_page
  }

  return rows
}

/**
 * Fetch daily per-user usage for a date range. The Anthropic endpoint
 * returns one day per request (specified by `starting_at`), so we loop
 * over each day from startingAt (inclusive) to endingAt (exclusive)
 * and paginate within each day.
 */
export async function fetchClaudeCodeUsage(params: {
  apiKey: string
  startingAt: string // 'YYYY-MM-DD' inclusive
  endingAt: string // 'YYYY-MM-DD' exclusive
}): Promise<ClaudeCodeUsageRow[]> {
  const rows: ClaudeCodeUsageRow[] = []
  const start = new Date(`${params.startingAt}T00:00:00Z`)
  const end = new Date(`${params.endingAt}T00:00:00Z`)
  const MAX_DAYS = 90 // safety cap on range width

  let daysFetched = 0
  for (let d = new Date(start); d < end && daysFetched < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    rows.push(...(await fetchOneDay({ apiKey: params.apiKey, day })))
    daysFetched += 1
  }

  return rows
}

/**
 * Light-touch validation: hit the endpoint for yesterday and return
 * whether the key is usable. Yesterday (UTC) is used because data
 * freshness can lag by up to an hour, so today may legitimately be
 * empty. 401/403 → invalid; 200 (even empty) → good.
 */
export async function validateAdminKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
  try {
    await fetchOneDay({ apiKey, day: yesterday })
    return { valid: true }
  } catch (err) {
    if (err instanceof AnthropicAdminApiError) {
      if (err.status === 401 || err.status === 403) {
        return { valid: false, error: 'Invalid or unauthorized admin API key' }
      }
      if (err.status === 404) {
        return {
          valid: false,
          error: 'Claude Code Analytics endpoint not available — requires Team or Enterprise plan',
        }
      }
      const snippet = err.body ? `: ${err.body.slice(0, 200)}` : ''
      return { valid: false, error: `Anthropic API returned ${err.status}${snippet}` }
    }
    return { valid: false, error: (err as Error).message }
  }
}
