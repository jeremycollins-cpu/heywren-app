import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import crypto from 'crypto'

function verifySlackRequest(
  timestamp: string,
  signature: string,
  rawBody: string
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5
  if (parseInt(timestamp) < fiveMinutesAgo) {
    return false
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET is not set — cannot verify Slack events')
    return false
  }

  const baseString = 'v0:' + timestamp + ':' + rawBody
  const mySignature =
    'v0=' +
    crypto
      .createHmac('sha256', signingSecret)
      .update(baseString)
      .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(mySignature)
    )
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp') || ''
  const signature = request.headers.get('x-slack-signature') || ''

  // Verify the request is actually from Slack
  if (!verifySlackRequest(timestamp, signature, rawBody)) {
    console.error('Invalid Slack signature — check SLACK_SIGNING_SECRET env var')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body
  try {
    body = JSON.parse(rawBody)
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Handle Slack URL verification (required when setting up Event Subscriptions)
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge })
  }

  // Handle events
  if (body.type === 'event_callback') {
    const event = body.event

    // Process human messages only (skip bot messages, message_changed, etc.)
    if (event.type === 'message' && !event.bot_id && !event.subtype) {
      try {
        await inngest.send({
          name: 'slack/message.received',
          data: {
            team_id: body.team_id,
            channel_id: event.channel,
            user_id: event.user,
            text: event.text || '',
            ts: event.ts,
            thread_ts: event.thread_ts || null,
          },
        })
      } catch (err) {
        console.error('Failed to send event to Inngest:', err)
        // Still return 200 to Slack so it does not retry endlessly
      }
    }
  }

  // Always return 200 quickly — Slack expects a response within 3 seconds
  return NextResponse.json({ ok: true })
}
