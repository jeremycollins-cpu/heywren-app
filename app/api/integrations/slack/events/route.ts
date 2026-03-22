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
 
  const signingSecret = process.env.SLACK_SIGNING_SECRET || process.env.SLACK_CLIENT_SECRET
  if (!signingSecret) {
    console.error('No Slack signing secret configured')
    return false
  }
 
  const baseString = `v0:${timestamp}:${rawBody}`
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
    console.error('Invalid Slack signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
 
  const body = JSON.parse(rawBody)
 
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
