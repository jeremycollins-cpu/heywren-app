// app/api/integrations/google/webhook/route.ts
// Handles Google Meet webhook/push notifications.
// Google uses push notifications via Cloud Pub/Sub or webhooks
// to notify when new recordings are available.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  // Verify webhook bearer token — reject unauthenticated callers
  const webhookSecret = process.env.GOOGLE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('GOOGLE_WEBHOOK_SECRET is not set — rejecting webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Google Meet uses the Google Workspace Events API
  // Event types: google.workspace.meet.conference.v2.ended
  const eventType = body.eventType || body.type
  const meetingData = body.conferenceRecord || body.payload

  if (!meetingData) {
    return NextResponse.json({ ok: true })
  }

  // Extract conference ID and space info
  const conferenceId = meetingData.name?.split('/')?.pop() || meetingData.conferenceId
  const endTime = meetingData.endTime
  const spaceName = meetingData.space?.name || meetingData.spaceName

  if (!conferenceId) {
    return NextResponse.json({ ok: true })
  }

  // Look up which team this Google account belongs to
  const supabase = getAdminClient()

  // Find integration by checking recently active Google Meet integrations
  const { data: integrations } = await supabase
    .from('integrations')
    .select('team_id, access_token, refresh_token, config')
    .eq('provider', 'google_meet')

  if (!integrations || integrations.length === 0) {
    console.log('No Google Meet integrations found')
    return NextResponse.json({ ok: true })
  }

  // Dispatch sync event for each connected team
  // (The sync job will check if this recording belongs to their account)
  for (const integration of integrations) {
    await inngest.send({
      name: 'google-meet/recording.available',
      data: {
        team_id: integration.team_id,
        conference_id: conferenceId,
        space_name: spaceName,
        end_time: endTime,
      },
    })
  }

  console.log(`Google Meet recording available: conference ${conferenceId}`)
  return NextResponse.json({ ok: true })
}
