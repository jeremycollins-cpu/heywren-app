// lib/jobs/record-run.ts
// Small helper for scheduled Inngest functions to record per-run outcomes in job_runs.
// Makes silent data-gate failures visible (e.g. "scanned 12 users, 0 sent because
// enabled_categories filter dropped recipient_gap" — the bug fixed in migration 077).

import { createClient } from '@supabase/supabase-js'

export type RunOutcome =
  | 'sent'
  | 'skipped'      // intentional skip (nothing to report)
  | 'failed'       // exception or provider error
  | 'no_data'      // user had no qualifying data (e.g. no missed emails)
  | 'opted_out'    // user's preferences suppressed this send
  | 'deduped'      // idempotency key matched an earlier send
  | 'auth_failed'  // integration token refresh failed

export interface JobRunRecorder {
  /** Call once per user processed. */
  tally(outcome: RunOutcome, count?: number): void
  /** Attach arbitrary metadata (e.g. scan stats, cron timezone). */
  meta(data: Record<string, unknown>): void
  /** Mark the run as failed and store the error message. */
  fail(err: unknown): void
  /** Flush the row. Call in a finally block. */
  finish(): Promise<void>
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export function startJobRun(jobName: string): JobRunRecorder {
  const startedAt = Date.now()
  const outcomes: Record<string, number> = {}
  let metadata: Record<string, unknown> = {}
  let errorMessage: string | null = null

  return {
    tally(outcome, count = 1) {
      outcomes[outcome] = (outcomes[outcome] || 0) + count
    },
    meta(data) {
      metadata = { ...metadata, ...data }
    },
    fail(err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    },
    async finish() {
      const duration = Date.now() - startedAt
      const considered = Object.values(outcomes).reduce((a, b) => a + b, 0)
      const status = errorMessage
        ? 'failed'
        : (outcomes.failed || 0) > 0
          ? 'partial'
          : 'success'

      try {
        const supabase = getAdminClient()
        await supabase.from('job_runs').insert({
          job_name: jobName,
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: duration,
          status,
          users_considered: considered,
          outcomes,
          error: errorMessage,
          metadata,
        })
      } catch (err) {
        // Never throw from observability — just log and continue.
        console.error(`[job-runs] Failed to record ${jobName}:`, (err as Error).message)
      }
    },
  }
}
