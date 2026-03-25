// app/api/integrations/zoom/webhook/route.ts
// Handles Zoom webhook events — specifically recording.completed.
// When a cloud recording finishes, Zoom notifies us so we can pull the transcript.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'
import crypto from 'crypto'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let body: any

  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Zoom URL validation challenge ──
  // Zoom sends this when verifying the webhook endpoint
  if (body.event === 'endpoint.url_validation') {
    const hashForValidation = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '')
      .update(body.payload?.plainToken || '')
      .digest('hex')

    return NextResponse.json({
      plainToken: body.payload?.plainToken,
      encryptedToken: hashForValidation,
    })
  }

  // ── Verify webhook signature ──
  const signature = request.headers.get('x-zm-signature') || ''
  const timestamp = request.headers.get('x-zm-request-timestamp') || ''
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN

  if (secret) {
    const message = `v0:${timestamp}:${rawBody}`
    const expectedSig = 'v0=' + crypto.createHmac('sha256', secret).update(message).digest('hex')
    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // ── Handle recording.completed ──
  if (body.event === 'recording.completed') {
    const payload = body.payload?.object
    if (!payload) {
      return NextResponse.json({ ok: true })
    }

    const hostEmail = payload.host_email
    const meetingId = payload.id?.toString()
    const meetingTopic = payload.topic || 'Zoom Meeting'
    const startTime = payload.start_time
    const duration = payload.duration // minutes

    // Find the transcript file in recording files
    const transcriptFile = payload.recording_files?.find(
      (f: any) => f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript'
    )

    if (!transcriptFile) {
      console.log('No transcript file in recording.completed — skipping')
      return NextResponse.json({ ok: true })
    }

    // Look up which team this Zoom account belongs to
    const supabase = getAdminClient()
    const { data: integration } = await supabase
      .from('integrations')
      .select('team_id, access_token, config')
      .eq('provider', 'zoom')
      .filter('config->>email', 'eq', hostEmail)
      .limit(1)
      .single()

    if (!integration) {
      console.log(`No Zoom integration found for host ${hostEmail}`)
      return NextResponse.json({ ok: true })
    }

    // Dispatch Inngest event to download and process the transcript
    await inngest.send({
      name: 'zoom/recording.completed',
      data: {
        team_id: integration.team_id,
        meeting_id: meetingId,
        meeting_topic: meetingTopic,
        start_time: startTime,
        duration_minutes: duration,
        transcript_download_url: transcriptFile.download_url,
        recording_play_url: transcriptFile.play_url,
        participants: payload.participant_count,
        host_email: hostEmail,
      },
    })

    console.log(`Zoom recording.completed: meeting ${meetingId} for team ${integration.team_id}`)
  }

  return NextResponse.json({ ok: true })
}
