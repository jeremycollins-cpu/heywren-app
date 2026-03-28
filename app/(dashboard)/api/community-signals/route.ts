import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { validateAndPromoteSignal } from '@/lib/ai/validate-community-signal'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET: List community signals with votes and filtering
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const type = searchParams.get('type')
  const sort = searchParams.get('sort') || 'votes'

  // Get user's team for scoping
  const admin = getAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  let query = admin
    .from('community_signals')
    .select('*')
    .eq('team_id', profile.current_team_id)

  if (status) {
    query = query.eq('validation_status', status)
  } else {
    // By default, show validated + promoted signals (not pending/rejected)
    query = query.in('validation_status', ['validated', 'promoted', 'pending'])
  }

  if (type) {
    query = query.eq('signal_type', type)
  }

  if (sort === 'votes') {
    query = query.order('vote_count', { ascending: false })
  } else if (sort === 'newest') {
    query = query.order('created_at', { ascending: false })
  }

  const { data: signals, error } = await query.limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get user's votes
  const { data: userVotes } = await admin
    .from('community_signal_votes')
    .select('signal_id')
    .eq('user_id', user.id)

  const votedIds = new Set((userVotes || []).map(v => v.signal_id))

  const enriched = (signals || []).map(({ author_name, user_id, team_id, ...s }) => ({
    ...s,
    user_has_voted: votedIds.has(s.id),
  }))

  // Also fetch promoted pattern count
  const { count: patternCount } = await admin
    .from('community_patterns')
    .select('id', { count: 'exact', head: true })
    .eq('active', true)

  return NextResponse.json({
    signals: enriched,
    patternCount: patternCount || 0,
  })
}

// POST: Submit a new community signal
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { signalType, title, description, exampleContent, expectedBehavior, sourcePlatform, attachments } = body

  if (!signalType || !title || !description || !expectedBehavior) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Get user profile for author name and team
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const { data: signal, error } = await admin
    .from('community_signals')
    .insert({
      team_id: profile.current_team_id,
      user_id: user.id,
      author_name: profile.display_name || user.email?.split('@')[0] || 'Anonymous',
      signal_type: signalType,
      title,
      description,
      example_content: exampleContent || null,
      expected_behavior: expectedBehavior,
      source_platform: sourcePlatform || null,
      attachments: attachments || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Kick off async AI validation (don't await — let it run in background)
  validateAndPromoteSignal(signal.id).catch(err => {
    console.error('Signal validation failed:', err)
  })

  return NextResponse.json({ signal })
}

// PATCH: Vote/unvote on a signal
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { signalId, action } = body

  if (!signalId || !['vote', 'unvote'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = getAdminClient()

  if (action === 'vote') {
    const { error } = await admin
      .from('community_signal_votes')
      .insert({ signal_id: signalId, user_id: user.id })

    if (error && error.code !== '23505') { // Ignore unique violation (already voted)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Increment vote count
    const { data: current } = await admin
      .from('community_signals')
      .select('vote_count')
      .eq('id', signalId)
      .single()

    if (current) {
      await admin
        .from('community_signals')
        .update({ vote_count: (current.vote_count || 0) + 1 })
        .eq('id', signalId)
    }
  } else {
    await admin
      .from('community_signal_votes')
      .delete()
      .eq('signal_id', signalId)
      .eq('user_id', user.id)

    // Decrement vote count (floor at 0)
    const { data: signal } = await admin
      .from('community_signals')
      .select('vote_count')
      .eq('id', signalId)
      .single()

    if (signal) {
      await admin
        .from('community_signals')
        .update({ vote_count: Math.max(0, (signal.vote_count || 0) - 1) })
        .eq('id', signalId)
    }
  }

  return NextResponse.json({ success: true })
}

export const dynamic = 'force-dynamic'
