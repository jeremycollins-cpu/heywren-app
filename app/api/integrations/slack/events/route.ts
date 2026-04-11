// app/api/integrations/slack/events/route.ts
// Handles incoming Slack events — specifically @HeyWren mentions
// Verifies request signatures, then dispatches to Inngest for async processing

import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import crypto from 'crypto'

// ─── Slack Signature Verification ───────────────────────────────────────────

function verifySlackRequest(
  timestamp: string,
  signature: string,
  rawBody: string
): boolean {
  // Reject requests older than 5 minutes (replay attack prevention)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5
  if (parseInt(timestamp) < fiveMinutesAgo) {
    console.warn('Slack request too old — possible replay attack')
    return false
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET is not set — cannot verify Slack events')
    return false
  }

  const baseString = `v0:${timestamp}:${rawBody}`
  const mySignature =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(mySignature)
    )
  } catch {
    return false
  }
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp') || ''
  const signature = request.headers.get('x-slack-signature') || ''

  // Verify the request is actually from Slack
  if (!verifySlackRequest(timestamp, signature, rawBody)) {
    console.error('Invalid Slack signature — rejecting request')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── URL Verification (required when first setting up Event Subscriptions) ──
  if (body.type === 'url_verification') {
    console.log('Slack URL verification challenge received')
    return NextResponse.json({ challenge: body.challenge })
  }

  // ── Event Callback Processing ──
  if (body.type === 'event_callback') {
    const event = body.event

    // ── app_mention: Someone tagged @HeyWren ──
    if (event.type === 'app_mention') {
      console.log(
        `@HeyWren mentioned in channel ${event.channel} by user ${event.user}`
      )

      try {
        await inngest.send({
          name: 'slack/mention.received',
          data: {
            team_id: body.team_id, // Slack workspace ID
            channel_id: event.channel,
            user_id: event.user, // Who tagged @HeyWren
            text: event.text || '',
            ts: event.ts, // Message timestamp (Slack's unique message ID)
            thread_ts: event.thread_ts || null, // Thread parent if in a thread
          },
        })
      } catch (err) {
        console.error('Failed to send app_mention event to Inngest:', err)
      }
    }

    // ── message: DMs or regular channel messages ──
    // Only processes if the message is from a human (no bots, no subtypes)
    if (event.type === 'message' && !event.bot_id && !event.subtype) {
      // DMs to the bot → treat as explicit @HeyWren mention
      if (event.channel_type === 'im') {
        try {
          await inngest.send({
            name: 'slack/mention.received',
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
          console.error('Failed to send DM mention event to Inngest:', err)
        }
      } else if (event.text && event.text.trim().length >= 15) {
        // Regular channel message — passive monitoring
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
          console.error('Failed to send message event to Inngest:', err)
        }
      }
    }
  }

  // Always return 200 quickly — Slack expects a response within 3 seconds
  // Actual processing happens asynchronously via Inngest
  return NextResponse.json({ ok: true })
}
