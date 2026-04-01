// inngest/functions/sync-platform-recordings.ts
// Syncs meeting recordings/transcripts from connected platforms (Zoom, Google Meet, Teams).
// Triggered on:
//   1. Initial connection (backfills recent recordings)
//   2. Scheduled cron (every 30 minutes for each connected team)
//   3. Webhook notification (recording just completed)

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Token refresh helpers ──

async function refreshZoomToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  const data = await res.json()
  if (data.error) return null
  return data
}

async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  const data = await res.json()
  if (data.error) return null
  return data
}

async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'openid profile email Mail.Read Calendars.Read OnlineMeetings.Read User.Read offline_access',
    }).toString(),
  })

  const data = await res.json()
  if (data.error) return null
  return data
}

// ── Get a fresh access token for a provider, refreshing if needed ──

async function getFreshToken(
  supabase: any,
  teamId: string,
  provider: string,
  userId?: string
): Promise<{ accessToken: string; integration: any } | null> {
  let query = supabase
    .from('integrations')
    .select('*')
    .eq('team_id', teamId)
    .eq('provider', provider)
  if (userId) query = query.eq('user_id', userId)
  const { data: integration } = await query.limit(1).maybeSingle()

  if (!integration) return null

  // Check if token is expired
  const expiresAt = integration.config?.token_expires_at
  const isExpired = expiresAt && new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000) // 5 min buffer

  if (!isExpired) {
    return { accessToken: integration.access_token, integration }
  }

  // Refresh the token
  if (!integration.refresh_token) return null

  let refreshed: any = null
  if (provider === 'zoom') {
    refreshed = await refreshZoomToken(integration.refresh_token)
  } else if (provider === 'google_meet') {
    refreshed = await refreshGoogleToken(integration.refresh_token)
  } else if (provider === 'teams' || provider === 'outlook') {
    refreshed = await refreshMicrosoftToken(integration.refresh_token)
  }

  if (!refreshed) return null

  // Update stored tokens
  await supabase
    .from('integrations')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || integration.refresh_token,
      config: {
        ...integration.config,
        token_expires_at: new Date(Date.now() + (refreshed.expires_in * 1000)).toISOString(),
      },
    })
    .eq('id', integration.id)

  return { accessToken: refreshed.access_token, integration }
}

// ── Zoom: Fetch recent cloud recordings and their transcripts ──

async function syncZoomRecordings(
  supabase: any,
  teamId: string,
  userId: string,
  accessToken: string,
  isInitialSync: boolean
) {
  // Fetch recordings from the last 30 days (or 7 for regular syncs)
  const daysBack = isInitialSync ? 30 : 7
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const to = new Date().toISOString().split('T')[0]

  const listRes = await fetch(
    `https://api.zoom.us/v2/users/me/recordings?from=${from}&to=${to}&page_size=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!listRes.ok) {
    throw new Error(`Zoom API error: ${listRes.status}`)
  }

  const listData = await listRes.json()
  const meetings = listData.meetings || []
  let synced = 0

  for (const meeting of meetings) {
    const meetingId = meeting.id?.toString()

    // Check if already synced
    const { data: existing } = await supabase
      .from('meeting_transcripts')
      .select('id')
      .eq('team_id', teamId)
      .eq('provider', 'zoom')
      .eq('external_meeting_id', meetingId)
      .limit(1)
      .single()

    if (existing) continue

    // Find transcript file
    const transcriptFile = meeting.recording_files?.find(
      (f: any) => f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript'
    )

    if (!transcriptFile?.download_url) continue

    // Download transcript
    const transcriptRes = await fetch(
      `${transcriptFile.download_url}?access_token=${accessToken}`
    )

    if (!transcriptRes.ok) continue

    const transcriptText = await transcriptRes.text()
    if (transcriptText.trim().length < 50) continue

    // Parse VTT-style transcript into segments
    const segments = parseZoomTranscript(transcriptText)

    // Insert transcript
    const { data: transcript } = await supabase
      .from('meeting_transcripts')
      .insert({
        team_id: teamId,
        user_id: userId,
        provider: 'zoom',
        external_meeting_id: meetingId,
        title: meeting.topic || 'Zoom Meeting',
        start_time: meeting.start_time,
        duration_minutes: meeting.duration,
        attendees: [],
        transcript_text: segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n'),
        transcript_segments: segments,
        transcript_status: 'pending',
        metadata: {
          zoom_meeting_uuid: meeting.uuid,
          participant_count: meeting.total_size,
          synced_via: 'platform_api',
        },
      })
      .select('id')
      .single()

    if (transcript) {
      synced++
      // Dispatch for commitment processing
      await inngest.send({
        name: 'meeting/transcript.ready',
        data: {
          transcript_id: transcript.id,
          team_id: teamId,
          user_id: userId,
        },
      })
    }
  }

  return synced
}

// Parse Zoom VTT transcript format
function parseZoomTranscript(vttText: string): Array<{ speaker?: string; text: string; start_s?: number; end_s?: number }> {
  const segments: Array<{ speaker?: string; text: string; start_s?: number; end_s?: number }> = []
  const lines = vttText.split('\n')

  let currentSpeaker = ''
  let currentText = ''
  let startTime: number | undefined
  let endTime: number | undefined

  for (const line of lines) {
    // Skip WEBVTT header and empty lines
    if (line.startsWith('WEBVTT') || line.trim() === '' || /^\d+$/.test(line.trim())) continue

    // Timestamp line: 00:00:01.000 --> 00:00:05.000
    const tsMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/)
    if (tsMatch) {
      // Save previous segment
      if (currentText) {
        segments.push({ speaker: currentSpeaker, text: currentText.trim(), start_s: startTime, end_s: endTime })
        currentText = ''
      }
      startTime = parseTimestamp(tsMatch[1])
      endTime = parseTimestamp(tsMatch[2])
      continue
    }

    // Speaker line: "Speaker Name: text"
    const speakerMatch = line.match(/^(.+?):\s*(.+)$/)
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].trim()
      currentText += speakerMatch[2] + ' '
    } else if (line.trim()) {
      currentText += line.trim() + ' '
    }
  }

  // Push last segment
  if (currentText) {
    segments.push({ speaker: currentSpeaker, text: currentText.trim(), start_s: startTime, end_s: endTime })
  }

  return segments
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':')
  const hours = parseInt(parts[0])
  const minutes = parseInt(parts[1])
  const seconds = parseFloat(parts[2])
  return hours * 3600 + minutes * 60 + seconds
}

// ── Google Meet: Fetch recordings via Google Drive ──

async function syncGoogleMeetRecordings(
  supabase: any,
  teamId: string,
  userId: string,
  accessToken: string,
  isInitialSync: boolean
) {
  // Google Meet recordings are stored in Google Drive in a "Meet Recordings" folder.
  // We search for transcript files (.sbv, .srt, or Google Docs transcripts)
  const daysBack = isInitialSync ? 30 : 7
  const afterDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  // Search for Meet transcript documents in Drive
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.document' and name contains 'Transcript' and modifiedTime > '${afterDate}'`
  )

  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,createdTime)&orderBy=modifiedTime desc&pageSize=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!driveRes.ok) {
    throw new Error(`Google Drive API error: ${driveRes.status}`)
  }

  const driveData = await driveRes.json()
  const files = driveData.files || []
  let synced = 0

  for (const file of files) {
    // Check if already synced
    const { data: existing } = await supabase
      .from('meeting_transcripts')
      .select('id')
      .eq('team_id', teamId)
      .eq('provider', 'google_meet')
      .eq('external_meeting_id', file.id)
      .limit(1)
      .single()

    if (existing) continue

    // Download transcript as plain text
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!exportRes.ok) continue

    const transcriptText = await exportRes.text()
    if (transcriptText.trim().length < 50) continue

    // Parse transcript into segments
    const segments = parseGoogleMeetTranscript(transcriptText)

    // Extract meeting title from filename
    // Google Meet names transcripts like: "Meeting Transcript - Daily Standup (2024-03-15)"
    const titleMatch = file.name?.match(/(?:Transcript\s*[-–—]\s*)(.+?)(?:\s*\(|$)/)
    const meetingTitle = titleMatch?.[1]?.trim() || file.name || 'Google Meet'

    const { data: transcript } = await supabase
      .from('meeting_transcripts')
      .insert({
        team_id: teamId,
        user_id: userId,
        provider: 'google_meet',
        external_meeting_id: file.id,
        title: meetingTitle,
        start_time: file.createdTime || file.modifiedTime,
        attendees: [],
        transcript_text: segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n'),
        transcript_segments: segments,
        transcript_status: 'pending',
        metadata: {
          google_drive_file_id: file.id,
          synced_via: 'platform_api',
        },
      })
      .select('id')
      .single()

    if (transcript) {
      synced++
      await inngest.send({
        name: 'meeting/transcript.ready',
        data: {
          transcript_id: transcript.id,
          team_id: teamId,
          user_id: userId,
        },
      })
    }
  }

  return synced
}

function parseGoogleMeetTranscript(text: string): Array<{ speaker?: string; text: string; start_s?: number }> {
  const segments: Array<{ speaker?: string; text: string; start_s?: number }> = []
  const lines = text.split('\n').filter(l => l.trim())

  for (const line of lines) {
    // Google Meet transcript format: "Speaker Name (HH:MM): text"
    // or "Speaker Name: text"
    const match = line.match(/^(.+?)\s*(?:\((\d{1,2}:\d{2}(?::\d{2})?)\))?\s*:\s*(.+)$/)
    if (match) {
      const speaker = match[1].trim()
      const timestamp = match[2]
      const text = match[3].trim()
      let startS: number | undefined
      if (timestamp) {
        const parts = timestamp.split(':').map(Number)
        startS = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
      }
      segments.push({ speaker, text, start_s: startS })
    } else if (line.trim()) {
      segments.push({ text: line.trim() })
    }
  }

  return segments
}

// ── Microsoft Teams: Fetch meeting transcripts via Graph API ──

async function syncTeamsRecordings(
  supabase: any,
  teamId: string,
  userId: string,
  accessToken: string,
  isInitialSync: boolean
) {
  // Microsoft Graph: List online meetings with transcripts
  // GET /me/onlineMeetings — then get transcripts for each
  const daysBack = isInitialSync ? 30 : 7
  const startDateTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  // List recent calendar events that are online meetings
  // Note: calendarView does not support $orderby combined with $filter — omit $orderby
  const endDateTime = new Date().toISOString()
  const eventsRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$filter=isOnlineMeeting eq true&$select=id,subject,start,end,onlineMeeting&$top=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!eventsRes.ok) {
    const body = await eventsRes.text().catch(() => '')
    throw new Error(`Microsoft Graph API error: ${eventsRes.status} ${body}`)
  }

  const eventsData = await eventsRes.json()
  const events = eventsData.value || []
  let synced = 0

  for (const event of events) {
    const joinUrl = event.onlineMeeting?.joinUrl
    if (!joinUrl) continue

    const meetingId = event.id

    // Check if already synced
    const { data: existing } = await supabase
      .from('meeting_transcripts')
      .select('id')
      .eq('team_id', teamId)
      .eq('provider', 'teams')
      .eq('external_meeting_id', meetingId)
      .limit(1)
      .single()

    if (existing) continue

    // Try to get transcript for this meeting
    // First, find the online meeting ID
    try {
      const meetingRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter=joinWebUrl eq '${encodeURIComponent(joinUrl)}'`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      if (!meetingRes.ok) continue
      const meetingData = await meetingRes.json()
      const onlineMeeting = meetingData.value?.[0]
      if (!onlineMeeting) continue

      // Get transcripts for this meeting
      const transcriptsRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/onlineMeetings/${onlineMeeting.id}/transcripts`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      if (!transcriptsRes.ok) continue
      const transcriptsData = await transcriptsRes.json()
      const transcriptRecord = transcriptsData.value?.[0]
      if (!transcriptRecord) continue

      // Download transcript content
      const contentRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/onlineMeetings/${onlineMeeting.id}/transcripts/${transcriptRecord.id}/content?$format=text/vtt`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      if (!contentRes.ok) continue
      const vttContent = await contentRes.text()
      if (vttContent.trim().length < 50) continue

      // Parse VTT
      const segments = parseZoomTranscript(vttContent) // VTT format is similar

      const startTime = event.start?.dateTime
      const endTime = event.end?.dateTime
      const durationMinutes = startTime && endTime
        ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
        : null

      const { data: transcript } = await supabase
        .from('meeting_transcripts')
        .insert({
          team_id: teamId,
          user_id: userId,
          provider: 'teams',
          external_meeting_id: meetingId,
          title: event.subject || 'Teams Meeting',
          start_time: startTime,
          duration_minutes: durationMinutes,
          attendees: [],
          transcript_text: segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n'),
          transcript_segments: segments,
          transcript_status: 'pending',
          metadata: {
            teams_meeting_id: onlineMeeting.id,
            join_url: joinUrl,
            synced_via: 'platform_api',
          },
        })
        .select('id')
        .single()

      if (transcript) {
        synced++
        await inngest.send({
          name: 'meeting/transcript.ready',
          data: {
            transcript_id: transcript.id,
            team_id: teamId,
            user_id: userId,
          },
        })
      }
    } catch (err) {
      console.error(`Error syncing Teams meeting ${meetingId}:`, err)
    }
  }

  return synced
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main sync function — dispatched on connect, webhook, or cron
// ═══════════════════════════════════════════════════════════════════════════════

export const syncPlatformRecordings = inngest.createFunction(
  {
    id: 'sync-platform-recordings',
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: 'platform/sync.recordings' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const { team_id: teamId, provider, user_id: userId, is_initial_sync } = event.data as {
      team_id: string
      provider: string
      user_id: string
      is_initial_sync?: boolean
    }

    // Mark sync as in-progress
    await step.run('mark-syncing', async () => {
      await supabase
        .from('platform_sync_cursors')
        .upsert(
          { team_id: teamId, provider, sync_status: 'syncing' },
          { onConflict: 'team_id,provider' }
        )
    })

    // Get fresh access token
    const tokenResult = await step.run('get-token', async () => {
      // For Teams transcripts, we use the outlook integration
      const lookupProvider = provider === 'teams' ? 'outlook' : provider
      return getFreshToken(supabase, teamId, lookupProvider, userId)
    })

    if (!tokenResult) {
      await step.run('mark-error-no-token', async () => {
        await supabase
          .from('platform_sync_cursors')
          .update({ sync_status: 'error', sync_error: 'Token expired or integration disconnected' })
          .eq('team_id', teamId)
          .eq('provider', provider)
      })
      return { success: false, error: 'No valid token' }
    }

    // Sync recordings based on provider
    const synced = await step.run('sync-recordings', async () => {
      switch (provider) {
        case 'zoom':
          return syncZoomRecordings(supabase, teamId, userId, tokenResult.accessToken, !!is_initial_sync)
        case 'google_meet':
          return syncGoogleMeetRecordings(supabase, teamId, userId, tokenResult.accessToken, !!is_initial_sync)
        case 'teams':
          return syncTeamsRecordings(supabase, teamId, userId, tokenResult.accessToken, !!is_initial_sync)
        default:
          throw new Error(`Unknown provider: ${provider}`)
      }
    })

    // Update sync cursor
    await step.run('update-cursor', async () => {
      await supabase
        .from('platform_sync_cursors')
        .update({
          sync_status: 'idle',
          sync_error: null,
          last_synced_at: new Date().toISOString(),
          recordings_synced: synced,
        })
        .eq('team_id', teamId)
        .eq('provider', provider)
    })

    console.log(`Platform sync complete: ${provider} for team ${teamId} — ${synced} recordings synced`)

    return { success: true, provider, synced }
  }
)

// ── Zoom webhook recording handler ──

export const handleZoomRecordingCompleted = inngest.createFunction(
  {
    id: 'handle-zoom-recording-completed',
    retries: 3,
  },
  { event: 'zoom/recording.completed' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const data = event.data as {
      team_id: string
      meeting_id: string
      meeting_topic: string
      start_time: string
      duration_minutes: number
      transcript_download_url: string
      host_email: string
    }

    // Get token for this team
    const tokenResult = await step.run('get-zoom-token', async () => {
      return getFreshToken(supabase, data.team_id, 'zoom')
    })

    if (!tokenResult) {
      return { success: false, error: 'No valid Zoom token' }
    }

    // Download transcript
    const transcriptText = await step.run('download-transcript', async () => {
      const res = await fetch(
        `${data.transcript_download_url}?access_token=${tokenResult.accessToken}`
      )
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      return res.text()
    })

    if (transcriptText.trim().length < 50) {
      return { success: false, error: 'Transcript too short' }
    }

    const segments = parseZoomTranscript(transcriptText)

    // Find user_id for this team (use first team member)
    const { data: member } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', data.team_id)
      .limit(1)
      .single()

    const userId = member?.user_id

    // Insert transcript
    const transcript = await step.run('insert-transcript', async () => {
      const { data: t } = await supabase
        .from('meeting_transcripts')
        .insert({
          team_id: data.team_id,
          user_id: userId,
          provider: 'zoom',
          external_meeting_id: data.meeting_id,
          title: data.meeting_topic,
          start_time: data.start_time,
          duration_minutes: data.duration_minutes,
          attendees: [],
          transcript_text: segments.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n'),
          transcript_segments: segments,
          transcript_status: 'pending',
          metadata: { synced_via: 'webhook', host_email: data.host_email },
        })
        .select('id')
        .single()
      return t
    })

    if (transcript && userId) {
      await step.run('dispatch-processing', async () => {
        await inngest.send({
          name: 'meeting/transcript.ready',
          data: {
            transcript_id: transcript.id,
            team_id: data.team_id,
            user_id: userId,
          },
        })
      })
    }

    return { success: true, transcriptId: transcript?.id }
  }
)

// ── Google Meet recording available handler ──

export const handleGoogleMeetRecording = inngest.createFunction(
  {
    id: 'handle-google-meet-recording',
    retries: 3,
  },
  { event: 'google-meet/recording.available' },
  async ({ event, step }) => {
    const data = event.data as {
      team_id: string
      conference_id: string
    }

    // Get user for this team
    const supabase = getAdminClient()
    const { data: member } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', data.team_id)
      .limit(1)
      .single()

    if (!member) return { success: false, error: 'No team member found' }

    // Trigger a targeted sync
    await step.run('dispatch-sync', async () => {
      await inngest.send({
        name: 'platform/sync.recordings',
        data: {
          team_id: data.team_id,
          provider: 'google_meet',
          user_id: member.user_id,
          is_initial_sync: false,
        },
      })
    })

    return { success: true }
  }
)

// ── Scheduled sync cron (every 30 minutes) ──

export const scheduledPlatformSync = inngest.createFunction(
  {
    id: 'scheduled-platform-sync',
    concurrency: { limit: 5 },
  },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const supabase = getAdminClient()

    // Find all active platform integrations (per-user)
    const integrations = await step.run('list-integrations', async () => {
      const { data } = await supabase
        .from('integrations')
        .select('team_id, user_id, provider')
        .in('provider', ['zoom', 'google_meet'])

      // Also find users with Outlook that may have Teams meetings
      const { data: outlookIntegrations } = await supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      const all = [...(data || [])]
      for (const oi of (outlookIntegrations || [])) {
        all.push({ team_id: oi.team_id, user_id: oi.user_id, provider: 'teams' })
      }

      return all
    })

    if (!integrations?.length) {
      return { success: true, message: 'No platform integrations to sync' }
    }

    // Dispatch sync for each integration
    let dispatched = 0
    await step.run('dispatch-syncs', async () => {
      for (const integration of integrations) {
        if (integration.user_id) {
          await inngest.send({
            name: 'platform/sync.recordings',
            data: {
              team_id: integration.team_id,
              provider: integration.provider,
              user_id: integration.user_id,
              is_initial_sync: false,
            },
          })
          dispatched++
        }
      }
    })

    return { success: true, dispatched }
  }
)
