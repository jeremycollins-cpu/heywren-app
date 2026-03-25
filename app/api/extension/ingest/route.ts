// app/api/extension/ingest/route.ts
// Receives live transcript data from the HeyWren Chrome extension.
// Authenticates via extension token (Bearer), then creates/appends to a transcript record.
// Supports two modes:
//   1. "start" — begins a new meeting session
//   2. "append" — adds new caption segments to an existing session
//   3. "end" — finalizes the transcript and triggers processing

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

// Validate extension token and return user/team context
async function validateToken(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const rawToken = authHeader.slice(7)
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

  const supabase = getAdminClient()
  const { data: tokenRecord } = await supabase
    .from('extension_tokens')
    .select('id, team_id, user_id, expires_at, revoked')
    .eq('token_hash', tokenHash)
    .single()

  if (!tokenRecord || tokenRecord.revoked) {
    return null
  }

  // Check expiration
  if (new Date(tokenRecord.expires_at) < new Date()) {
    return null
  }

  // Update last_used_at
  await supabase
    .from('extension_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRecord.id)

  return {
    userId: tokenRecord.user_id,
    teamId: tokenRecord.team_id,
  }
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate via extension token
    const auth = await validateToken(req.headers.get('authorization'))
    if (!auth) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const body = await req.json()
    const { action, meeting_url, platform, title, segments, transcript_id } = body

    const supabase = getAdminClient()

    // ── START: Begin a new meeting capture session ──
    if (action === 'start') {
      // Detect platform from URL
      let detectedPlatform = platform || 'unknown'
      if (meeting_url) {
        if (meeting_url.includes('meet.google.com')) detectedPlatform = 'google_meet'
        else if (meeting_url.includes('zoom.us')) detectedPlatform = 'zoom'
        else if (meeting_url.includes('teams.microsoft.com')) detectedPlatform = 'teams'
      }

      const { data: transcript, error: insertError } = await supabase
        .from('meeting_transcripts')
        .insert({
          team_id: auth.teamId,
          user_id: auth.userId,
          provider: 'chrome_extension',
          title: title || `Live capture — ${detectedPlatform}`,
          start_time: new Date().toISOString(),
          transcript_text: '',
          transcript_segments: [],
          transcript_status: 'processing', // Still capturing
          metadata: {
            capture_source: 'chrome_extension',
            detected_platform: detectedPlatform,
            meeting_url: meeting_url || null,
          },
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Failed to start extension capture:', insertError)
        return NextResponse.json({ error: 'Failed to start capture' }, { status: 500 })
      }

      return NextResponse.json({
        transcript_id: transcript.id,
        message: 'Capture started',
      })
    }

    // ── APPEND: Add new segments to an ongoing capture ──
    if (action === 'append') {
      if (!transcript_id || !segments?.length) {
        return NextResponse.json({ error: 'transcript_id and segments required' }, { status: 400 })
      }

      // Fetch current transcript
      const { data: existing } = await supabase
        .from('meeting_transcripts')
        .select('transcript_text, transcript_segments')
        .eq('id', transcript_id)
        .eq('team_id', auth.teamId)
        .single()

      if (!existing) {
        return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
      }

      // Append segments
      const existingSegments = existing.transcript_segments || []
      const newSegments = [...existingSegments, ...segments]
      const newText = existing.transcript_text +
        segments.map((s: any) => `${s.speaker || 'Unknown'}: ${s.text}`).join('\n') + '\n'

      await supabase
        .from('meeting_transcripts')
        .update({
          transcript_text: newText,
          transcript_segments: newSegments,
        })
        .eq('id', transcript_id)
        .eq('team_id', auth.teamId)

      return NextResponse.json({
        ok: true,
        total_segments: newSegments.length,
      })
    }

    // ── END: Finalize capture and trigger processing ──
    if (action === 'end') {
      if (!transcript_id) {
        return NextResponse.json({ error: 'transcript_id required' }, { status: 400 })
      }

      // Get final transcript
      const { data: transcript } = await supabase
        .from('meeting_transcripts')
        .select('transcript_text, start_time')
        .eq('id', transcript_id)
        .eq('team_id', auth.teamId)
        .single()

      if (!transcript) {
        return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
      }

      // Calculate duration
      const durationMinutes = transcript.start_time
        ? Math.round((Date.now() - new Date(transcript.start_time).getTime()) / 60000)
        : null

      // Mark as pending processing
      await supabase
        .from('meeting_transcripts')
        .update({
          transcript_status: 'pending',
          duration_minutes: durationMinutes,
        })
        .eq('id', transcript_id)
        .eq('team_id', auth.teamId)

      // Only process if we have enough transcript text
      if (transcript.transcript_text.trim().length >= 50) {
        await inngest.send({
          name: 'meeting/transcript.ready',
          data: {
            transcript_id,
            team_id: auth.teamId,
            user_id: auth.userId,
          },
        })
      } else {
        // Too short — mark as ready with 0 commitments
        await supabase
          .from('meeting_transcripts')
          .update({
            transcript_status: 'ready',
            processed: true,
            commitments_found: 0,
          })
          .eq('id', transcript_id)
      }

      return NextResponse.json({
        ok: true,
        transcript_id,
        duration_minutes: durationMinutes,
        message: 'Capture finalized. Processing commitments.',
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, append, end' }, { status: 400 })
  } catch (error) {
    console.error('Extension ingest error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
