export const dynamic = 'force-dynamic'

// app/api/meetings/upload/route.ts
// Manual transcript upload endpoint.
// Users paste or upload meeting transcripts for commitment detection.
// Also supports structured transcript with segments (timestamped + speaker IDs).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      title,
      transcript_text,
      transcript_segments,
      provider = 'manual',
      start_time,
      duration_minutes,
      attendees,
      external_meeting_id,
    } = body

    // Validate required fields
    if (!transcript_text || typeof transcript_text !== 'string') {
      return NextResponse.json(
        { error: 'transcript_text is required and must be a string' },
        { status: 400 }
      )
    }

    if (transcript_text.trim().length < 50) {
      return NextResponse.json(
        { error: 'Transcript is too short (minimum 50 characters)' },
        { status: 400 }
      )
    }

    // Look up user's team
    const supabase = getAdminClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const teamId = profile.current_team_id

    // Insert transcript record
    const { data: transcript, error: insertError } = await supabase
      .from('meeting_transcripts')
      .insert({
        team_id: teamId,
        user_id: user.id,
        provider,
        external_meeting_id: external_meeting_id || null,
        title: title || 'Untitled Meeting',
        start_time: start_time || new Date().toISOString(),
        duration_minutes: duration_minutes || null,
        attendees: attendees || [],
        transcript_text: transcript_text.trim(),
        transcript_segments: transcript_segments || null,
        transcript_status: 'pending',
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Failed to insert transcript:', insertError)
      return NextResponse.json(
        { error: 'Failed to save transcript' },
        { status: 500 }
      )
    }

    // Dispatch Inngest event for background processing
    await inngest.send({
      name: 'meeting/transcript.ready',
      data: {
        transcript_id: transcript.id,
        team_id: teamId,
        user_id: user.id,
      },
    })

    return NextResponse.json({
      success: true,
      transcript_id: transcript.id,
      message: 'Transcript uploaded. Processing commitments in the background.',
    })
  } catch (error) {
    console.error('Transcript upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
