// content-scripts/teams-web.js
// Captures live captions from Microsoft Teams web client.
// Teams renders live captions in a panel when enabled by the user.

;(function () {
  'use strict'

  let isCapturing = false
  let observer = null
  let lastCaptionText = ''
  let captionTimeout = null

  // ── Find Teams caption container ──
  function findCaptionsContainer() {
    const selectors = [
      '[data-tid="closed-captions-renderer"]',    // Teams CC renderer
      '.ts-live-captions-container',               // Live captions container
      '[class*="captions-container"]',             // Alternative
      '[data-tid="live-captions-subtitle"]',       // Subtitle region
      '.ui-chat__messagelist',                      // Fallback: chat-style CC
    ]

    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el) return el
    }

    return null
  }

  function parseCaptionElement(el) {
    let speaker = 'Unknown'
    let text = ''

    // Teams format: speaker name in a header element, text below
    const speakerEl = el.querySelector('[data-tid*="speaker"]') ||
      el.querySelector('[class*="speaker-name"]') ||
      el.querySelector('.ts-caption-speaker')

    if (speakerEl) {
      speaker = speakerEl.textContent?.trim() || 'Unknown'
    }

    const textEl = el.querySelector('[data-tid*="caption-text"]') ||
      el.querySelector('[class*="caption-text"]') ||
      el.querySelector('.ts-caption-text')

    text = textEl?.textContent?.trim() || el.textContent?.trim() || ''

    if (speaker !== 'Unknown' && text.startsWith(speaker)) {
      text = text.slice(speaker.length).replace(/^[:\s]+/, '').trim()
    }

    return { speaker, text }
  }

  function startObserving() {
    if (observer) return

    const container = findCaptionsContainer()
    if (!container) {
      setTimeout(startObserving, 2000)
      return
    }

    observer = new MutationObserver((mutations) => {
      if (!isCapturing) return

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            clearTimeout(captionTimeout)
            captionTimeout = setTimeout(() => {
              const { speaker, text } = parseCaptionElement(node)
              if (text && text !== lastCaptionText && text.length > 3) {
                lastCaptionText = text
                chrome.runtime.sendMessage({
                  type: 'CAPTION_SEGMENT',
                  speaker,
                  text,
                  timestamp: Math.floor(Date.now() / 1000),
                })
              }
            }, 300)
          }
        }

        if (mutation.type === 'characterData') {
          clearTimeout(captionTimeout)
          captionTimeout = setTimeout(() => {
            const el = mutation.target.parentElement
            if (el) {
              const { speaker, text } = parseCaptionElement(el)
              if (text && text !== lastCaptionText && text.length > 3) {
                lastCaptionText = text
                chrome.runtime.sendMessage({
                  type: 'CAPTION_SEGMENT',
                  speaker,
                  text,
                  timestamp: Math.floor(Date.now() / 1000),
                })
              }
            }
          }, 300)
        }
      }
    })

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    console.log('[HeyWren] Caption observer started on Teams')
  }

  // ── Overlay ──
  function injectOverlay() {
    if (document.getElementById('heywren-overlay')) return

    const overlay = document.createElement('div')
    overlay.id = 'heywren-overlay'
    overlay.className = 'heywren-overlay'
    overlay.innerHTML = `
      <div class="heywren-pill" id="heywren-pill">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2C6.48 2 2 6 2 11c0 2.5 1.5 5 3 6.5V22l4-2c1 .3 2 .5 3 .5 5.52 0 10-4 10-9s-4.48-9-10-9z"/>
        </svg>
        <span id="heywren-label">Start Wren</span>
      </div>
    `
    document.body.appendChild(overlay)

    document.getElementById('heywren-pill').addEventListener('click', toggleCapture)
  }

  async function toggleCapture() {
    const pill = document.getElementById('heywren-pill')
    const label = document.getElementById('heywren-label')

    if (isCapturing) {
      isCapturing = false
      chrome.runtime.sendMessage({ type: 'END_CAPTURE' })
      pill.classList.remove('heywren-recording')
      label.textContent = 'Start Wren'
      if (observer) { observer.disconnect(); observer = null }
    } else {
      const meetingTitle = document.title.replace(/\| Microsoft Teams/gi, '').trim() || 'Teams Meeting'
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'START_CAPTURE',
          platform: 'teams',
          meetingUrl: window.location.href,
          title: meetingTitle,
        }, resolve)
      })

      if (response?.success) {
        isCapturing = true
        pill.classList.add('heywren-recording')
        label.textContent = 'Recording...'
        startObserving()
      } else {
        label.textContent = response?.error || 'Error'
        setTimeout(() => { label.textContent = 'Start Wren' }, 3000)
      }
    }
  }

  function init() {
    const checkReady = setInterval(() => {
      const hasMeetingUI = document.querySelector('[data-tid="calling-screen"]') ||
        document.querySelector('video') ||
        document.querySelector('#teams-client')

      if (hasMeetingUI) {
        clearInterval(checkReady)
        injectOverlay()
      }
    }, 2000)

    setTimeout(() => clearInterval(checkReady), 30000)
  }

  if (document.readyState === 'complete') init()
  else window.addEventListener('load', init)
})()
