// lib/recall/client.ts
// Recall.ai API client for the HeyWren Notetaker bot.
// Handles bot creation, status polling, transcript retrieval, and webhook verification.
// Docs: https://docs.recall.ai

const RECALL_API_BASE = 'https://us-west-2.recall.ai/api/v1'

interface RecallBotOptions {
  meetingUrl: string
  botName?: string
  joinAt?: string // ISO timestamp — bot joins at this time
}

interface RecallBot {
  id: string
  status: {
    code: string
    message?: string
  }
  meeting_url: string
  bot_name: string
  join_at?: string
  media?: {
    video_url?: string
  }
  transcript?: RecallTranscriptEntry[]
}

interface RecallTranscriptEntry {
  speaker: string
  words: Array<{
    text: string
    start_time: number
    end_time: number
  }>
}

interface RecallTranscript {
  entries: RecallTranscriptEntry[]
}

function getApiKey(): string {
  const key = process.env.RECALL_API_KEY
  if (!key) throw new Error('RECALL_API_KEY is not set')
  return key
}

async function recallFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${RECALL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Recall API error ${res.status}: ${body}`)
  }

  return res
}

/**
 * Create a bot and send it to a meeting.
 * The bot will appear as "HeyWren Notetaker" with the Wren avatar.
 */
export async function createBot(options: RecallBotOptions): Promise<RecallBot> {
  const body: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName || 'HeyWren Notetaker',
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: {},
        },
        diarization: {
          use_separate_streams_when_available: true,
        },
      },
      realtime_endpoints: [
        {
          type: 'webhook',
          url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`,
          events: ['transcript.data'],
        },
      ],
    },
  }

  // Schedule bot to join at a specific time (e.g., meeting start)
  if (options.joinAt) {
    body.join_at = options.joinAt
  }

  const res = await recallFetch('/bot/', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  return res.json()
}

/**
 * Get the current status of a bot.
 */
export async function getBot(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/bot/${botId}/`)
  return res.json()
}

/**
 * Retrieve the full transcript for a completed bot session.
 * Flow: GET bot → find transcript download_url in recordings → download transcript.
 */
export async function getBotTranscript(botId: string): Promise<RecallTranscript> {
  // Step 1: Get bot details to find the transcript download URL
  const bot = await getBot(botId)
  const recordings = (bot as any).recordings || []
  const transcriptShortcut = recordings[0]?.media_shortcuts?.transcript

  if (!transcriptShortcut?.data?.download_url) {
    throw new Error('No transcript download URL found for this bot')
  }

  // Step 2: Download the transcript from the provided URL
  // This is a pre-signed S3 URL — do NOT send Authorization header
  const downloadUrl = transcriptShortcut.data.download_url
  const res = await fetch(downloadUrl)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Transcript download failed ${res.status}: ${body}`)
  }

  return res.json()
}

/**
 * Remove a bot from a meeting (cancel or leave early).
 */
export async function removeBot(botId: string): Promise<void> {
  await recallFetch(`/bot/${botId}/leave_call/`, {
    method: 'POST',
  })
}

/**
 * Cancel a scheduled bot that hasn't joined yet.
 */
export async function cancelBot(botId: string): Promise<void> {
  await recallFetch(`/bot/${botId}/`, {
    method: 'DELETE',
  })
}

/**
 * Convert Recall.ai transcript format to our internal segment format.
 */
export function recallTranscriptToSegments(
  entries: RecallTranscriptEntry[]
): Array<{ speaker: string; text: string; start_s: number; end_s: number }> {
  return entries.map((entry) => {
    const text = entry.words.map((w) => w.text).join(' ')
    const startS = entry.words[0]?.start_time ?? 0
    const endS = entry.words[entry.words.length - 1]?.end_time ?? startS
    return {
      speaker: entry.speaker,
      text,
      start_s: startS,
      end_s: endS,
    }
  })
}

/**
 * Convert Recall.ai transcript to plain text (Speaker: text format).
 */
export function recallTranscriptToText(entries: RecallTranscriptEntry[]): string {
  return entries
    .map((entry) => {
      const text = entry.words.map((w) => w.text).join(' ')
      return `${entry.speaker}: ${text}`
    })
    .join('\n')
}

/**
 * Detect the meeting platform from a join URL.
 */
export function detectPlatform(meetingUrl: string): 'zoom' | 'google_meet' | 'teams' | 'webex' | 'other' {
  const url = meetingUrl.toLowerCase()
  if (url.includes('zoom.us') || url.includes('zoomgov.com')) return 'zoom'
  if (url.includes('meet.google.com')) return 'google_meet'
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams'
  if (url.includes('webex.com')) return 'webex'
  return 'other'
}

/**
 * Calculate billed minutes from recording duration.
 * Recall.ai bills per-second, prorated.
 */
export function calculateBilledMinutes(durationSeconds: number): number {
  return Math.ceil(durationSeconds / 60 * 100) / 100 // Round up to nearest 0.01 min
}

export type { RecallBot, RecallBotOptions, RecallTranscriptEntry, RecallTranscript }
