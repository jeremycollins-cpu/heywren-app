export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'

function getAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
  if (!teamId) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const body = await req.json()
  const { commitment_id, feedback, reason } = body

  if (!feedback || (feedback !== 'accurate' && feedback !== 'inaccurate')) {
    return NextResponse.json({ error: 'Feedback must be "accurate" or "inaccurate"' }, { status: 400 })
  }

  const admin = getAdmin()

  // Fetch commitment context for pattern extraction later
  let source: string | null = null
  let commitmentType: string | null = null
  let direction: string | null = null
  let originalQuote: string | null = null

  if (commitment_id) {
    const { data: commitment } = await admin
      .from('commitments')
      .select('source, category, metadata')
      .eq('id', commitment_id)
      .single()

    if (commitment) {
      source = commitment.source
      commitmentType = commitment.category || commitment.metadata?.commitmentType || null
      direction = commitment.metadata?.direction || null
      originalQuote = commitment.metadata?.originalQuote || null
    }
  }

  const { error } = await admin
    .from('commitment_feedback')
    .insert({
      team_id: teamId,
      user_id: user.id,
      commitment_id: commitment_id || null,
      feedback,
      reason: reason || null,
      source,
      commitment_type: commitmentType,
      direction,
      original_quote: originalQuote,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// Get feedback stats
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
  if (!teamId) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const { data: feedback } = await supabase
    .from('commitment_feedback')
    .select('feedback')
    .eq('team_id', teamId)

  const accurate = (feedback || []).filter(f => f.feedback === 'accurate').length
  const inaccurate = (feedback || []).filter(f => f.feedback === 'inaccurate').length

  return NextResponse.json({
    stats: { accurate, inaccurate, total: accurate + inaccurate },
  })
}
