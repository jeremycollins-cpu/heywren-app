// background.js — HeyWren Chrome Extension Service Worker
// Manages state, coordinates content scripts, and communicates with the HeyWren API.

const DEFAULT_API_URL = 'https://app.heywren.ai'

// ── State ──
let activeSessions = {} // tabId -> { transcriptId, segments, platform }

// ── API Helpers ──

async function getConfig() {
  const result = await chrome.storage.local.get(['apiToken', 'apiUrl'])
  return {
    token: result.apiToken || '',
    apiUrl: result.apiUrl || DEFAULT_API_URL,
  }
}

async function apiRequest(endpoint, body) {
  const config = await getConfig()
  if (!config.token) {
    throw new Error('Not authenticated. Please add your HeyWren token in the extension popup.')
  }

  const res = await fetch(`${config.apiUrl}/api/extension${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.error || `API error: ${res.status}`)
  }

  return res.json()
}

// ── Session Management ──

async function startCapture(tabId, platform, meetingUrl, title) {
  try {
    const data = await apiRequest('/ingest', {
      action: 'start',
      platform,
      meeting_url: meetingUrl,
      title,
    })

    activeSessions[tabId] = {
      transcriptId: data.transcript_id,
      platform,
      segments: [],
      segmentBuffer: [],
      lastFlush: Date.now(),
    }

    // Update badge
    chrome.action.setBadgeText({ text: 'REC', tabId })
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId })

    return { success: true, transcriptId: data.transcript_id }
  } catch (err) {
    console.error('Failed to start capture:', err)
    return { success: false, error: err.message }
  }
}

async function appendSegments(tabId) {
  const session = activeSessions[tabId]
  if (!session || session.segmentBuffer.length === 0) return

  const segments = [...session.segmentBuffer]
  session.segmentBuffer = []

  try {
    await apiRequest('/ingest', {
      action: 'append',
      transcript_id: session.transcriptId,
      segments,
    })
    session.segments.push(...segments)
  } catch (err) {
    console.error('Failed to append segments:', err)
    // Put segments back in buffer for retry
    session.segmentBuffer.unshift(...segments)
  }
}

async function endCapture(tabId) {
  const session = activeSessions[tabId]
  if (!session) return

  // Flush any remaining segments
  if (session.segmentBuffer.length > 0) {
    await appendSegments(tabId)
  }

  try {
    await apiRequest('/ingest', {
      action: 'end',
      transcript_id: session.transcriptId,
    })
  } catch (err) {
    console.error('Failed to end capture:', err)
  }

  delete activeSessions[tabId]
  chrome.action.setBadgeText({ text: '', tabId })
}

// ── Flush buffer periodically (every 15 seconds) ──

setInterval(async () => {
  for (const tabId of Object.keys(activeSessions)) {
    const session = activeSessions[tabId]
    if (session.segmentBuffer.length > 0 && Date.now() - session.lastFlush > 10000) {
      session.lastFlush = Date.now()
      await appendSegments(parseInt(tabId))
    }
  }
}, 15000)

// ── Message Handler (from content scripts and popup) ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id

  switch (message.type) {
    case 'START_CAPTURE': {
      const tid = tabId || message.tabId
      startCapture(tid, message.platform, message.meetingUrl, message.title)
        .then(sendResponse)
      return true // async response
    }

    case 'CAPTION_SEGMENT': {
      if (!tabId || !activeSessions[tabId]) return
      activeSessions[tabId].segmentBuffer.push({
        speaker: message.speaker || 'Unknown',
        text: message.text,
        start_s: message.timestamp,
      })

      // Flush if buffer is large
      if (activeSessions[tabId].segmentBuffer.length >= 10) {
        appendSegments(tabId)
      }
      break
    }

    case 'END_CAPTURE': {
      const tid = tabId || message.tabId
      endCapture(tid).then(() => sendResponse({ success: true }))
      return true
    }

    case 'GET_STATUS': {
      const tid = message.tabId || tabId
      const session = activeSessions[tid]
      sendResponse({
        isCapturing: !!session,
        transcriptId: session?.transcriptId,
        segmentCount: session?.segments.length || 0,
        platform: session?.platform,
      })
      return true
    }

    case 'CHECK_AUTH': {
      getConfig().then(config => {
        sendResponse({ authenticated: !!config.token })
      })
      return true
    }
  }
})

// ── Tab close/navigate: end capture ──

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeSessions[tabId]) {
    endCapture(tabId)
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && activeSessions[tabId]) {
    // Check if still on a meeting page
    const url = changeInfo.url
    const isMeeting = url.includes('meet.google.com') ||
      url.includes('zoom.us') ||
      url.includes('teams.microsoft.com') ||
      url.includes('teams.live.com')

    if (!isMeeting) {
      endCapture(tabId)
    }
  }
})
