// app/api/meetings/list/route.ts
// List meeting transcripts for the current user's team.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Get user's team
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ transcripts: [] })
    }

    // Fetch transcripts — scoped to this user's meetings
    const { data: transcripts, error } = await supabase
      .from('meeting_transcripts')
      .select('id, title, provider, start_time, transcript_status, commitments_found, hey_wren_triggers, created_at')
      .eq('team_id', profile.current_team_id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Failed to list transcripts:', error)
      return NextResponse.json({ transcripts: [] })
    }

    return NextResponse.json({ transcripts: transcripts || [] })
  } catch (error) {
    console.error('Transcript list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
