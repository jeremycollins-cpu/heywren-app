import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Handle Slack URL verification
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge })
  }

  // Handle events
  if (body.type === 'event_callback') {
    const event = body.event

    if (event.type === 'message' && !event.bot_id) {
      // Send to Inngest for processing
      await inngest.send({
        name: 'slack/message.received',
        data: {
          team_id: body.team_id,
          channel_id: event.channel,
          user_id: event.user,
          text: event.text,
          ts: event.ts,
          thread_ts: event.thread_ts,
        },
      })
    }
  }

  return NextResponse.json({ ok: true })
}
