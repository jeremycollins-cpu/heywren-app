export const dynamic = 'force-dynamic'

// app/api/recall/test/route.ts
// Diagnostic + recovery endpoint.
// POST with { meeting_url } — creates a new bot
// POST with { recover_bot_id } — fetches transcript from an existing bot and processes it
// DELETE THIS after debugging is complete.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'
import {
  getBotTranscript,
  recallTranscriptToSegments,
  recallTranscriptToText,
} from '@/lib/recall/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    // ── Recovery mode: fetch transcript from existing bot ──
    if (body.recover_bot_id) {
      return await recoverBot(body.recover_bot_id, body.meeting_title, user.id)
    }

    // ── Test mode: create a new bot ──
    const { meeting_url } = body
    const apiKey = process.env.RECALL_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'RECALL_API_KEY is not set' }, { status: 500 })
    }

    const recallBody = {
      meeting_url,
      bot_name: 'HeyWren Notetaker',
      recording_config: {
        transcript: {
          provider: { recallai_streaming: {} },
          diarization: { use_separate_streams_when_available: true },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`,
            events: ['transcript.data'],
          },
        ],
      },
    }

    const res = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recallBody),
    })

    const responseText = await res.text()
    let responseJson: any = null
    try { responseJson = JSON.parse(responseText) } catch {}

    if (!res.ok) {
      return NextResponse.json({
        error: 'Recall.ai API call failed',
        status: res.status,
        response: responseJson || responseText,
      }, { status: 502 })
    }

    return NextResponse.json({ success: true, bot: responseJson })
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected error',
      message: (error as Error).message,
    }, { status: 500 })
  }
}

async function recoverBot(botId: string, meetingTitle: string | undefined, userId: string) {
  const supabase = getAdminClient()

  try {
    // Get user's team
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Check if already recovered
    const { data: existing } = await supabase
      .from('meeting_transcripts')
      .select('id')
      .eq('external_meeting_id', botId)
      .limit(1)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'This bot was already processed', transcript_id: existing.id }, { status: 409 })
    }

    // Fetch transcript from Recall.ai
    const transcriptData = await getBotTranscript(botId)
    const entries = Array.isArray(transcriptData) ? transcriptData : (transcriptData as any).entries || []

    if (entries.length === 0) {
      return NextResponse.json({ error: 'No transcript entries found for this bot', bot_id: botId }, { status: 404 })
    }

    const segments = recallTranscriptToSegments(entries)
    const transcriptText = recallTranscriptToText(entries)

    // Also fetch bot details for metadata
    let botDetails: any = null
    try {
      const detailsRes = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/`, {
        headers: { Authorization: `Token ${process.env.RECALL_API_KEY}` },
      })
      if (detailsRes.ok) botDetails = await detailsRes.json()
    } catch {}

    const durationSeconds = botDetails?.recording?.duration || 0
    const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : null

    // Insert transcript
    const { data: transcript, error: insertError } = await supabase
      .from('meeting_transcripts')
      .insert({
        team_id: profile.current_team_id,
        user_id: userId,
        provider: 'recall_bot',
        external_meeting_id: botId,
        title: meetingTitle || botDetails?.bot_name || 'Recovered Meeting',
        start_time: botDetails?.join_at || new Date().toISOString(),
        duration_minutes: durationMinutes,
        attendees: [],
        transcript_text: transcriptText,
        transcript_segments: segments,
        transcript_status: 'pending',
        metadata: {
          recall_bot_id: botId,
          meeting_platform: botDetails?.meeting_url?.includes('teams') ? 'teams' : 'other',
          synced_via: 'manual_recovery',
        },
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ error: 'Failed to insert transcript', details: insertError.message }, { status: 500 })
    }

    // Dispatch for processing (summary + commitments + follow-ups)
    await inngest.send({
      name: 'meeting/transcript.ready',
      data: {
        transcript_id: transcript.id,
        team_id: profile.current_team_id,
        user_id: userId,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Transcript recovered and processing started. Check /meetings in 1-2 minutes.',
      transcript_id: transcript.id,
      segments_count: segments.length,
      text_length: transcriptText.length,
    })
  } catch (error) {
    return NextResponse.json({
      error: 'Recovery failed',
      message: (error as Error).message,
    }, { status: 500 })
  }
}
