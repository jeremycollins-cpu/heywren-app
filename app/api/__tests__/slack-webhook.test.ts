/**
 * @jest-environment node
 *
 * Tests for the Slack events webhook handler.
 *
 * Uses Node test environment for native Request/Response support.
 *
 * The route handler:
 *   1. Verifies Slack request signatures (HMAC-SHA256)
 *   2. Handles url_verification challenges
 *   3. Dispatches app_mention events to Inngest
 *   4. Dispatches message events (from humans, 15+ chars) to Inngest
 *   5. Returns 200 quickly for all valid requests
 */

import crypto from 'crypto'

// ─── Mock Inngest ───────────────────────────────────────────────────────────

const mockInngestSend = jest.fn().mockResolvedValue(undefined)

jest.mock('@/inngest/client', () => ({
  inngest: {
    send: (...args: any[]) => mockInngestSend(...args),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────

import { POST } from '@/app/api/integrations/slack/events/route'
import { NextRequest } from 'next/server'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SIGNING_SECRET = 'test_signing_secret_12345'

function createSlackSignature(timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`
  return (
    'v0=' +
    crypto.createHmac('sha256', SIGNING_SECRET).update(baseString).digest('hex')
  )
}

function makeSlackRequest(
  body: object,
  options: { timestamp?: string; signature?: string; invalidSignature?: boolean } = {}
): NextRequest {
  const rawBody = JSON.stringify(body)
  const timestamp =
    options.timestamp || Math.floor(Date.now() / 1000).toString()
  const signature =
    options.signature ||
    (options.invalidSignature
      ? 'v0=invalidsignature'
      : createSlackSignature(timestamp, rawBody))

  const request = new NextRequest('http://localhost/api/integrations/slack/events', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
  })

  return request
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Slack Events Webhook - POST', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Signature Verification', () => {
    it('rejects requests with invalid signatures', async () => {
      const request = makeSlackRequest(
        { type: 'event_callback', event: {} },
        { invalidSignature: true }
      )

      const response = await POST(request)

      expect(response.status).toBe(401)
      const json = await response.json()
      expect(json.error).toBe('Invalid signature')
    })

    it('rejects requests with timestamps older than 5 minutes', async () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString()
      const body = JSON.stringify({ type: 'event_callback', event: {} })
      const signature = createSlackSignature(oldTimestamp, body)

      const request = makeSlackRequest(
        { type: 'event_callback', event: {} },
        { timestamp: oldTimestamp, signature }
      )

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it('rejects requests when SLACK_SIGNING_SECRET is not set', async () => {
      delete process.env.SLACK_SIGNING_SECRET

      const request = makeSlackRequest({ type: 'url_verification', challenge: 'test' })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })
  })

  describe('URL Verification', () => {
    it('responds with the challenge for url_verification events', async () => {
      const challenge = 'test_challenge_string_abc123'
      const request = makeSlackRequest({
        type: 'url_verification',
        challenge,
      })

      const response = await POST(request)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json.challenge).toBe(challenge)
    })
  })

  describe('App Mention Events', () => {
    it('dispatches app_mention events to Inngest', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'app_mention',
          channel: 'C99999',
          user: 'U11111',
          text: '<@UBOTID> track this commitment please',
          ts: '1234567890.123456',
          thread_ts: '1234567890.000000',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).toHaveBeenCalledTimes(1)
      expect(mockInngestSend).toHaveBeenCalledWith({
        name: 'slack/mention.received',
        data: {
          team_id: 'T12345',
          channel_id: 'C99999',
          user_id: 'U11111',
          text: '<@UBOTID> track this commitment please',
          ts: '1234567890.123456',
          thread_ts: '1234567890.000000',
        },
      })
    })

    it('sends null thread_ts when not in a thread', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'app_mention',
          channel: 'C99999',
          user: 'U11111',
          text: '<@UBOTID> hello',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ thread_ts: null }),
        })
      )
    })
  })

  describe('Message Events', () => {
    it('dispatches human messages with 15+ characters to Inngest', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'message',
          channel: 'C99999',
          user: 'U11111',
          text: 'This is a longer message that should be processed',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).toHaveBeenCalledTimes(1)
      expect(mockInngestSend).toHaveBeenCalledWith({
        name: 'slack/message.received',
        data: expect.objectContaining({
          team_id: 'T12345',
          text: 'This is a longer message that should be processed',
        }),
      })
    })

    it('ignores messages shorter than 15 characters', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'message',
          channel: 'C99999',
          user: 'U11111',
          text: 'Short msg',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).not.toHaveBeenCalled()
    })

    it('ignores bot messages', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'message',
          channel: 'C99999',
          user: 'U11111',
          bot_id: 'B12345',
          text: 'This is an automated bot message that is long enough',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).not.toHaveBeenCalled()
    })

    it('ignores messages with subtypes (e.g., channel_join)', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'message',
          subtype: 'channel_join',
          channel: 'C99999',
          user: 'U11111',
          text: 'User has joined the channel and is now a member',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockInngestSend).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('continues returning 200 even when Inngest send fails', async () => {
      mockInngestSend.mockRejectedValueOnce(new Error('Inngest unavailable'))

      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'app_mention',
          channel: 'C99999',
          user: 'U11111',
          text: '<@UBOTID> track this',
          ts: '1234567890.123456',
        },
      })

      const response = await POST(request)
      // Should still return 200 because the handler catches Inngest errors
      expect(response.status).toBe(200)
    })

    it('returns 200 for unknown event types', async () => {
      const request = makeSlackRequest({
        type: 'event_callback',
        team_id: 'T12345',
        event: {
          type: 'reaction_added',
          channel: 'C99999',
          user: 'U11111',
        },
      })

      const response = await POST(request)
      expect(response.status).toBe(200)
    })
  })
})
