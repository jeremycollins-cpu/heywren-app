export const dynamic = 'force-dynamic'
export const maxDuration = 300

// /api/cron/anthropic-admin-sync
//
// Vercel cron entry point. Wired in vercel.json with:
//   { "path": "/api/cron/anthropic-admin-sync", "schedule": "0 6 * * *" }
//
// Vercel attaches an Authorization: Bearer <CRON_SECRET> header to cron
// invocations when CRON_SECRET is set in the Vercel project env. We verify
// that before running so the endpoint can't be trivially triggered by the
// public internet.
//
// The endpoint forwards to POST /api/integrations/anthropic-admin/sync,
// which knows how to enumerate every org with a stored credential and
// upsert the last 7 days of rollups.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment' },
      { status: 500 }
    )
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Forward to the shared sync route using the same secret as a header.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const res = await fetch(`${appUrl}/api/integrations/anthropic-admin/sync`, {
    method: 'POST',
    headers: {
      'x-cron-secret': cronSecret,
      'content-type': 'application/json',
    },
  })
  const body = await res.json().catch(() => ({}))
  return NextResponse.json(body, { status: res.status })
}
