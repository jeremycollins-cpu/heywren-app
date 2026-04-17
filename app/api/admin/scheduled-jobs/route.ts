// app/api/admin/scheduled-jobs/route.ts
// Super-admin endpoint for listing scheduled Inngest jobs and triggering them
// on demand. Avoids requiring backend-tool (Inngest dashboard) access for
// operational tasks.
//
// GET  /api/admin/scheduled-jobs         → list all jobs with last-run info
// POST /api/admin/scheduled-jobs         → { action: 'run', jobId: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'
import { ADMIN_TRIGGERABLE_JOBS, getJobById } from '@/lib/jobs/registry'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkSuperAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return false

  const adminDb = getAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  return profile?.role === 'super_admin'
}

export async function GET() {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const adminDb = getAdminClient()

  // Fetch the most recent job_run per job_name.
  const jobNames = ADMIN_TRIGGERABLE_JOBS.map(j => j.id)
  const { data: recentRuns, error } = await adminDb
    .from('job_runs')
    .select('job_name, started_at, finished_at, duration_ms, status, users_considered, outcomes, error')
    .in('job_name', jobNames)
    .order('started_at', { ascending: false })
    .limit(500) // enough headroom for N jobs * recent runs

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Collapse to the most recent run per job_name.
  const latestByJob = new Map<string, typeof recentRuns[number]>()
  for (const run of recentRuns || []) {
    if (!latestByJob.has(run.job_name)) {
      latestByJob.set(run.job_name, run)
    }
  }

  const jobs = ADMIN_TRIGGERABLE_JOBS.map(def => {
    const lastRun = latestByJob.get(def.id)
    return {
      ...def,
      lastRun: lastRun
        ? {
            startedAt: lastRun.started_at,
            finishedAt: lastRun.finished_at,
            durationMs: lastRun.duration_ms,
            status: lastRun.status,
            usersConsidered: lastRun.users_considered,
            outcomes: lastRun.outcomes,
            error: lastRun.error,
          }
        : null,
    }
  })

  return NextResponse.json({ jobs })
}

export async function POST(request: NextRequest) {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { action, jobId } = body

  if (action !== 'run') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const job = getJobById(jobId)
  if (!job) {
    return NextResponse.json({ error: `Unknown jobId: ${jobId}` }, { status: 400 })
  }

  try {
    const result = await inngest.send({
      name: job.eventName,
      data: { triggeredBy: 'admin', triggeredAt: new Date().toISOString() },
    })

    return NextResponse.json({
      success: true,
      jobId: job.id,
      eventName: job.eventName,
      eventIds: result.ids,
      message: `Triggered ${job.label} — check back in a minute for job_runs update.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send Inngest event'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
