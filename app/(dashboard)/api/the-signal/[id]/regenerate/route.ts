// app/(dashboard)/api/monthly-briefing/[id]/regenerate/route.ts
// POST — re-dispatch the generation pipeline for an existing briefing.
//        body: { userNotes?: string }
// Pinned and user-edited sections are preserved by the Inngest job.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const teamId = await resolveTeamId(supabase, user.id)
  if (!teamId) return NextResponse.json({ error: 'No team found' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { userNotes?: string }

  const admin = getAdminClient()
  const { data: briefing, error } = await admin
    .from('monthly_briefings')
    .select('id, period_start, status')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })

  if (['aggregating', 'extracting', 'synthesizing'].includes(briefing.status)) {
    return NextResponse.json({ error: 'Generation already in progress.' }, { status: 409 })
  }

  await admin
    .from('monthly_briefings')
    .update({ status: 'pending', status_detail: 'Queued for regeneration…', error_message: null })
    .eq('id', briefing.id)

  await inngest.send({
    name: 'briefing/monthly.generate',
    data: {
      briefingId: briefing.id,
      userId: user.id,
      teamId,
      periodStart: briefing.period_start,
      userNotes: body.userNotes ?? null,
    },
  })

  return NextResponse.json({ id: briefing.id, status: 'pending' })
}
