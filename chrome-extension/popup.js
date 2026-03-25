// popup.js — HeyWren Chrome Extension Popup

document.addEventListener('DOMContentLoaded', async () => {
  const statusCard = document.getElementById('status-card')
  const statusDot = document.getElementById('status-dot')
  const statusText = document.getElementById('status-text')
  const statusDetail = document.getElementById('status-detail')
  const tokenInput = document.getElementById('token-input')
  const saveTokenBtn = document.getElementById('save-token')
  const tokenSection = document.getElementById('token-section')
  const connectedActions = document.getElementById('connected-actions')
  const disconnectBtn = document.getElementById('disconnect-btn')
  const apiUrlInput = document.getElementById('api-url-input')

  // Load saved config
  const config = await chrome.storage.local.get(['apiToken', 'apiUrl'])
  if (config.apiUrl) {
    apiUrlInput.value = config.apiUrl
  }

  // Check current status
  async function updateStatus() {
    const hasToken = !!config.apiToken

    if (!hasToken) {
      statusDot.className = 'status-dot yellow'
      statusText.textContent = 'Not connected'
      statusDetail.textContent = 'Add your API token to start capturing meetings.'
      tokenSection.style.display = 'block'
      connectedActions.style.display = 'none'
      return
    }

    // Check if actively recording
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const activeTab = tabs[0]

    if (activeTab) {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: activeTab.id }, resolve)
      })

      if (response?.isCapturing) {
        statusCard.className = 'status-card recording'
        statusDot.className = 'status-dot red'
        statusText.textContent = `Recording ${response.platform || 'meeting'}...`
        statusDetail.textContent = `${response.segmentCount} caption segments captured`
        tokenSection.style.display = 'none'
        connectedActions.style.display = 'block'
        return
      }
    }

    // Connected but not recording
    statusCard.className = 'status-card connected'
    statusDot.className = 'status-dot green'
    statusText.textContent = 'Connected'
    statusDetail.textContent = 'Join a meeting to start capturing captions.'
    tokenSection.style.display = 'none'
    connectedActions.style.display = 'block'
  }

  await updateStatus()

  // Save token
  saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim()
    if (!token) return

    // Validate token by making a test request
    const apiUrl = apiUrlInput.value.trim() || 'https://app.heywren.ai'

    saveTokenBtn.textContent = '...'
    saveTokenBtn.disabled = true

    try {
      const res = await fetch(`${apiUrl}/api/extension/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'ping' }), // Will return 400 (invalid action) if auth succeeds
      })

      if (res.status === 401) {
        statusDot.className = 'status-dot yellow'
        statusText.textContent = 'Invalid token'
        statusDetail.textContent = 'Please check your token and try again.'
        return
      }

      // Store token
      await chrome.storage.local.set({ apiToken: token, apiUrl: apiUrl })
      config.apiToken = token

      // Update UI
      tokenInput.value = ''
      await updateStatus()
    } catch (err) {
      statusDot.className = 'status-dot yellow'
      statusText.textContent = 'Connection failed'
      statusDetail.textContent = 'Could not reach the HeyWren server. Check the API URL.'
    } finally {
      saveTokenBtn.textContent = 'Save'
      saveTokenBtn.disabled = false
    }
  })

  // Disconnect
  disconnectBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['apiToken'])
    config.apiToken = null
    tokenSection.style.display = 'block'
    connectedActions.style.display = 'none'
    statusCard.className = 'status-card'
    statusDot.className = 'status-dot yellow'
    statusText.textContent = 'Disconnected'
    statusDetail.textContent = 'Add your API token to reconnect.'
  })

  // Save API URL on change
  apiUrlInput.addEventListener('change', async () => {
    const url = apiUrlInput.value.trim()
    if (url) {
      await chrome.storage.local.set({ apiUrl: url })
    }
  })
})
