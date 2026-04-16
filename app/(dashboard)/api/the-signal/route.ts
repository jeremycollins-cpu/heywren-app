// app/(dashboard)/api/monthly-briefing/route.ts
// GET  — list briefings for the current user
// POST — create a new briefing for a given period and dispatch generation
//        body: { periodStart?: 'YYYY-MM-DD', userNotes?: string, force?: boolean }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'
import { inngest } from '@/inngest/client'
import { monthlyPeriodFor } from '@/lib/monthly-briefing/aggregate-data'

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('monthly_briefings')
    .select('id, period_start, period_end, title, subtitle, status, status_detail, error_message, generated_at, total_cost_cents, created_at, updated_at')
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
    .limit(24)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ briefings: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const teamId = await resolveTeamId(supabase, user.id)
  if (!teamId) return NextResponse.json({ error: 'No team found' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    periodStart?: string
    userNotes?: string | null
    force?: boolean
  }

  // Default to the current month
  const periodDate = body.periodStart ? new Date(body.periodStart + 'T00:00:00Z') : new Date()
  const period = monthlyPeriodFor(periodDate)
  const periodStartDate = period.start.slice(0, 10) // YYYY-MM-DD
  const periodEndDate = period.end.slice(0, 10)

  const admin = getAdminClient()

  // Upsert the briefing row (one per user+month)
  const { data: existing } = await admin
    .from('monthly_briefings')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('period_start', periodStartDate)
    .maybeSingle()

  let briefingId: string
  if (existing && !body.force) {
    briefingId = existing.id
    // If it's already running, return as-is.
    if (['aggregating', 'extracting', 'synthesizing'].includes(existing.status)) {
      return NextResponse.json({ id: briefingId, status: existing.status, message: 'Generation already in progress.' })
    }
    await admin
      .from('monthly_briefings')
      .update({ status: 'pending', status_detail: 'Queued for generation…', error_message: null })
      .eq('id', briefingId)
  } else if (existing && body.force) {
    briefingId = existing.id
    await admin
      .from('monthly_briefings')
      .update({ status: 'pending', status_detail: 'Queued for regeneration…', error_message: null })
      .eq('id', briefingId)
  } else {
    const { data: created, error } = await admin
      .from('monthly_briefings')
      .insert({
        user_id: user.id,
        team_id: teamId,
        period_start: periodStartDate,
        period_end: periodEndDate,
        status: 'pending',
        status_detail: 'Queued for generation…',
      })
      .select('id')
      .single()
    if (error || !created) return NextResponse.json({ error: error?.message || 'failed to create briefing' }, { status: 500 })
    briefingId = created.id
  }

  // Dispatch the background generation job
  await inngest.send({
    name: 'briefing/monthly.generate',
    data: {
      briefingId,
      userId: user.id,
      teamId,
      periodStart: periodStartDate,
      userNotes: body.userNotes ?? null,
    },
  })

  return NextResponse.json({ id: briefingId, status: 'pending', period: { start: periodStartDate, end: periodEndDate, label: period.label } })
}
