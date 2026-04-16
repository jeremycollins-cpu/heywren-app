export const dynamic = 'force-dynamic'

// app/api/recall/webhook/route.ts
// Receives webhooks from Recall.ai:
//   1. Bot Status Change Webhooks (configured in dashboard) — bot lifecycle events
//   2. Real-time transcript endpoints (configured per-bot in createBot) — live transcript chunks
//
// When bot reaches "done" status, fetches the full transcript via API and dispatches processing.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'
import {
  getBot,
  getBotTranscript,
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
  // Verify webhook secret — reject unauthenticated callers
  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[recall-webhook] RECALL_WEBHOOK_SECRET is not set — rejecting webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('x-recall-signature') || req.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()

    console.log('[recall-webhook] Received:', JSON.stringify(body).slice(0, 500))

    const supabase = getAdminClient()

    // Recall.ai sends different payload formats:
    // 1. Bot Status Change: { event: "bot.status_change", data: { bot: { id }, data: { code } } }
    // 2. Real-time transcript: { event: "transcript.data", data: { bot_id, transcript: {...} } }
    // 3. Some events use flat structure: { bot_id, status, ... }

    const event = body.event

    if (event === 'bot.status_change') {
      const botId = body.data?.bot?.id
      const statusCode = body.data?.data?.code

      if (!botId || !statusCode) {
        console.log('[recall-webhook] Missing bot ID or status code in status_change event')
        return NextResponse.json({ ok: true })
      }

      console.log(`[recall-webhook] Status change: bot=${botId} status=${statusCode}`)

      // Update bot session status
      await updateBotStatus(supabase, botId, statusCode, body.data?.data?.sub_code)

      // When bot is done, fetch transcript via API and process it
      if (statusCode === 'done' || statusCode === 'analysis_done') {
        await fetchAndProcessTranscript(supabase, botId)
      }
    } else if (event === 'transcript.data' || event === 'transcript.partial_data') {
      // Real-time transcript chunks — log but don't process yet
      // Full transcript is fetched via API when bot.done fires
      console.log(`[recall-webhook] Real-time transcript event received`)
    } else {
      // Try to handle as a generic/flat payload (some webhook formats)
      const botId = body.bot_id || body.data?.bot?.id || body.data?.bot_id || body.data?.id
      const statusCode = body.status?.code || body.data?.status?.code || body.data?.data?.code

      if (botId && statusCode) {
        console.log(`[recall-webhook] Generic event: bot=${botId} status=${statusCode}`)
        await updateBotStatus(supabase, botId, statusCode)

        if (statusCode === 'done' || statusCode === 'analysis_done' || statusCode === 'call_ended') {
          await fetchAndProcessTranscript(supabase, botId)
        }
      } else {
        console.log(`[recall-webhook] Unhandled event format:`, JSON.stringify(body).slice(0, 300))
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[recall-webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function updateBotStatus(supabase: any, botId: string, statusCode: string, subCode?: string) {
  const statusMap: Record<string, string> = {
    joining_call: 'joining',
    in_waiting_room: 'joining',
    in_call_not_recording: 'in_meeting',
    recording_permission_allowed: 'in_meeting',
    recording_permission_denied: 'error',
    in_call_recording: 'recording',
    call_ended: 'done',
    done: 'done',
    analysis_done: 'done',
    fatal: 'error',
  }

  const recallStatus = statusMap[statusCode] || 'pending'

  const update: Record<string, unknown> = {
    recall_status: recallStatus,
  }

  if (recallStatus === 'error') {
    update.error_message = subCode || `Bot error: ${statusCode}`
  }

  await supabase
    .from('recall_bot_sessions')
    .update(update)
    .eq('recall_bot_id', botId)
}

async function fetchAndProcessTranscript(supabase: any, botId: string) {
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

  // Check if we already processed this bot (avoid duplicates from multiple done events)
  if (session.transcript_id) {
    console.log(`[recall-webhook] Bot ${botId} already processed, skipping`)
    return
  }

  try {
    // Fetch the full transcript from Recall.ai API
    console.log(`[recall-webhook] Fetching transcript for bot ${botId}`)
    const transcriptData = await getBotTranscript(botId)
    const entries = transcriptData.entries || transcriptData as any

    // Handle both array format and {entries: [...]} format
    const transcriptEntries = Array.isArray(entries) ? entries : []

    if (transcriptEntries.length === 0) {
      console.log(`[recall-webhook] No transcript entries for bot ${botId}`)
      await supabase
        .from('recall_bot_sessions')
        .update({ recall_status: 'done', error_message: 'No transcript available' })
        .eq('id', session.id)
      return
    }

    // Convert to our format
    const segments = recallTranscriptToSegments(transcriptEntries)
    const transcriptText = recallTranscriptToText(transcriptEntries)

    if (transcriptText.trim().length < 50) {
      await supabase
        .from('recall_bot_sessions')
        .update({ recall_status: 'done', error_message: 'Transcript too short' })
        .eq('id', session.id)
      return
    }

    // Also fetch bot details for duration
    let durationSeconds = 0
    try {
      const botDetails = await getBot(botId)
      durationSeconds = (botDetails as any).recording?.duration || 0
    } catch {
      // Non-critical — continue without duration
    }

    const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : null

    // Insert transcript into meeting_transcripts
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
        .update({ recall_status: 'error', error_message: `DB error: ${insertError.message}` })
        .eq('id', session.id)
      return
    }

    // Link transcript to bot session
    await supabase
      .from('recall_bot_sessions')
      .update({
        recall_status: 'done',
        transcript_id: transcript.id,
        recording_duration_seconds: durationSeconds,
        billed_minutes: calculateBilledMinutes(durationSeconds),
      })
      .eq('id', session.id)

    // Dispatch for commitment extraction + summary generation
    await inngest.send({
      name: 'meeting/transcript.ready',
      data: {
        transcript_id: transcript.id,
        team_id: session.team_id,
        user_id: session.user_id,
      },
    })

    console.log(`[recall-webhook] Bot ${botId} — transcript ${transcript.id} dispatched for processing`)
  } catch (error) {
    console.error(`[recall-webhook] Failed to fetch/process transcript for bot ${botId}:`, error)
    await supabase
      .from('recall_bot_sessions')
      .update({ recall_status: 'error', error_message: `Transcript fetch failed: ${(error as Error).message}` })
      .eq('id', session.id)
  }
}
