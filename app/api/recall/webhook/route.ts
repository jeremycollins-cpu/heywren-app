export const dynamic = 'force-dynamic'

// app/api/recall/webhook/route.ts
// Receives webhooks from Recall.ai for bot status changes and transcript delivery.
// Events: bot.status_change, bot.transcription, bot.done
// Dispatches Inngest events for transcript processing.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'
import {
  recallTranscriptToSegments,
  recallTranscriptToText,
  calculateBilledMinutes,
} from '@/lib/recall/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event, data } = body

    if (!event || !data) {
      return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
    }

    const supabase = getAdminClient()

    switch (event) {
      case 'bot.status_change': {
        await handleStatusChange(supabase, data)
        break
      }

      case 'bot.transcription':
      case 'bot.done': {
        await handleBotDone(supabase, data)
        break
      }

      default: {
        console.log(`[recall-webhook] Unhandled event: ${event}`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[recall-webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function handleStatusChange(supabase: any, data: any) {
  const botId = data.bot_id || data.id
  if (!botId) return

  const statusMap: Record<string, string> = {
    joining_call: 'joining',
    in_waiting_room: 'joining',
    in_call_not_recording: 'in_meeting',
    in_call_recording: 'recording',
    call_ended: 'done',
    done: 'done',
    fatal: 'error',
    analysis_done: 'done',
  }

  const recallStatus = statusMap[data.status?.code] || data.status?.code

  const update: Record<string, unknown> = {
    recall_status: recallStatus,
  }

  if (recallStatus === 'error') {
    update.error_message = data.status?.message || 'Bot encountered an error'
  }

  if (data.recording?.duration) {
    update.recording_duration_seconds = data.recording.duration
    update.billed_minutes = calculateBilledMinutes(data.recording.duration)
  }

  await supabase
    .from('recall_bot_sessions')
    .update(update)
    .eq('recall_bot_id', botId)
}

async function handleBotDone(supabase: any, data: any) {
  const botId = data.bot_id || data.id
  if (!botId) return

  // Look up the bot session
  const { data: session } = await supabase
    .from('recall_bot_sessions')
    .select('*')
    .eq('recall_bot_id', botId)
    .single()

  if (!session) {
    console.error(`[recall-webhook] No session found for bot ${botId}`)
    return
  }

  // Extract transcript from the webhook payload
  const transcriptEntries = data.transcript || data.transcription?.entries || []
  if (transcriptEntries.length === 0) {
    console.log(`[recall-webhook] No transcript in done event for bot ${botId}`)

    await supabase
      .from('recall_bot_sessions')
      .update({ recall_status: 'done', error_message: 'No transcript received' })
      .eq('id', session.id)
    return
  }

  // Convert Recall.ai transcript to our format
  const segments = recallTranscriptToSegments(transcriptEntries)
  const transcriptText = recallTranscriptToText(transcriptEntries)

  if (transcriptText.trim().length < 50) {
    await supabase
      .from('recall_bot_sessions')
      .update({ recall_status: 'done', error_message: 'Transcript too short' })
      .eq('id', session.id)
    return
  }

  // Calculate duration
  const durationSeconds = data.recording?.duration || session.recording_duration_seconds || 0
  const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : null

  // Insert the transcript into meeting_transcripts
  const { data: transcript, error: insertError } = await supabase
    .from('meeting_transcripts')
    .insert({
      team_id: session.team_id,
      user_id: session.user_id,
      provider: 'recall_bot',
      external_meeting_id: botId,
      title: session.meeting_title || 'Meeting Recording',
      start_time: session.scheduled_start || session.created_at,
      duration_minutes: durationMinutes,
      attendees: [],
      transcript_text: transcriptText,
      transcript_segments: segments,
      transcript_status: 'pending',
      metadata: {
        recall_bot_id: botId,
        meeting_platform: session.meeting_platform,
        recording_url: data.media?.video_url || null,
        attendee_count: session.attendee_count,
        synced_via: 'recall_bot',
      },
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[recall-webhook] Failed to insert transcript:', insertError)
    await supabase
      .from('recall_bot_sessions')
      .update({ recall_status: 'error', error_message: 'Failed to store transcript' })
      .eq('id', session.id)
    return
  }

  // Link transcript to bot session and mark complete
  await supabase
    .from('recall_bot_sessions')
    .update({
      recall_status: 'done',
      transcript_id: transcript.id,
      recording_duration_seconds: durationSeconds,
      billed_minutes: calculateBilledMinutes(durationSeconds),
      recording_url: data.media?.video_url || null,
    })
    .eq('id', session.id)

  // Dispatch for commitment + summary processing
  await inngest.send({
    name: 'meeting/transcript.ready',
    data: {
      transcript_id: transcript.id,
      team_id: session.team_id,
      user_id: session.user_id,
    },
  })

  console.log(`[recall-webhook] Bot ${botId} done — transcript ${transcript.id} dispatched for processing`)
}
