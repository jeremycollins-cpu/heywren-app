export const dynamic = 'force-dynamic'

// app/api/meetings/[id]/route.ts
// Fetches a single meeting transcript with summary, commitments, and follow-up drafts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user
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
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Fetch transcript (RLS-like check via team_id + user_id)
    const { data: transcript, error: fetchError } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('id', id)
      .eq('team_id', profile.current_team_id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !transcript) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
    }

    // Fetch commitments linked to this transcript
    const { data: commitments } = await supabase
      .from('commitments')
      .select('id, title, description, status, priority_score, due_date, metadata, created_at')
      .eq('team_id', profile.current_team_id)
      .eq('source', 'recording')
      .eq('source_message_id', id)
      .order('created_at', { ascending: true })

    // Fetch follow-up drafts for these commitments
    const commitmentIds = (commitments || []).map((c: any) => c.id)
    let drafts: any[] = []
    if (commitmentIds.length > 0) {
      const { data: draftData } = await supabase
        .from('draft_queue')
        .select('id, commitment_id, subject, body, recipient_name, status, created_at')
        .in('commitment_id', commitmentIds)
        .order('created_at', { ascending: true })
      drafts = draftData || []
    }

    // Fetch bot session info if this was a Recall.ai recording
    let botSession = null
    if (transcript.provider === 'recall_bot' && transcript.external_meeting_id) {
      const { data: session } = await supabase
        .from('recall_bot_sessions')
        .select('id, recall_status, meeting_platform, attendee_count, recording_duration_seconds, trigger_type')
        .eq('recall_bot_id', transcript.external_meeting_id)
        .single()
      botSession = session
    }

    return NextResponse.json({
      transcript,
      commitments: commitments || [],
      drafts,
      botSession,
    })
  } catch (error) {
    console.error('Meeting detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
