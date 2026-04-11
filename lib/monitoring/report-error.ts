// lib/monitoring/report-error.ts
// Lightweight error reporter that logs to the system_errors table.
// Import and call from any API route or inngest function.
//
// Usage:
//   import { reportError } from '@/lib/monitoring/report-error'
//   await reportError({
//     source: 'api/inbox-zero',
//     message: 'Graph API returned 401',
//     severity: 'error',
//     userId: user.id,
//     details: { statusCode: 401, response: data },
//     errorKey: 'graph_api_401',
//   })

import { createClient } from '@supabase/supabase-js'

let _client: ReturnType<typeof createClient> | null = null

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _client
}

export interface ReportErrorOptions {
  source: string
  message: string
  severity?: 'warning' | 'error' | 'critical'
  userId?: string | null
  teamId?: string | null
  details?: Record<string, unknown>
  errorKey?: string
}

/**
 * Log an error to the system_errors table.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export async function reportError(opts: ReportErrorOptions): Promise<void> {
  try {
    const supabase = getClient()
    await supabase.from('system_errors').insert({
      source: opts.source,
      message: opts.message,
      severity: opts.severity || 'error',
      user_id: opts.userId || null,
      team_id: opts.teamId || null,
      details: opts.details || null,
      error_key: opts.errorKey || null,
    } as any)
  } catch {
    // Never throw — monitoring should not break the app
    console.error('[reportError] Failed to log error:', opts.message)
  }
}
