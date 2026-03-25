// content-scripts/google-meet.js
// Captures live captions from Google Meet by observing the captions container DOM.
// Google Meet renders captions in a specific container when turned on.

;(function () {
  'use strict'

  let isCapturing = false
  let observer = null
  let lastCaptionText = ''
  let captionTimeout = null

  // ── Find the captions container ──
  // Google Meet renders captions in elements with specific data attributes
  function findCaptionsContainer() {
    // Primary: the closed captions container
    const selectors = [
      '[jscontroller] div[class*="iOzk7"]', // Caption overlay region
      'div[jsname="tgaKEf"]',               // Known captions container
      'div[class*="a4cQT"]',                // Alternative caption class
      '.a4cQT',                              // Fallback
    ]

    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el) return el
    }

    // Fallback: find by structure — look for caption-like elements
    const allDivs = document.querySelectorAll('div[jsname]')
    for (const div of allDivs) {
      if (div.getAttribute('aria-live') === 'polite' && div.textContent?.trim()) {
        return div
      }
    }

    return null
  }

  // ── Extract speaker and text from caption element ──
  function parseCaptionElement(el) {
    // Google Meet captions typically have: speaker name image/text, then caption text
    const images = el.querySelectorAll('img')
    let speaker = 'Unknown'

    // Try to find speaker name from image alt or adjacent text
    if (images.length > 0) {
      speaker = images[0].alt || 'Unknown'
    }

    // Look for speaker name in a specific child span
    const nameSpans = el.querySelectorAll('span')
    for (const span of nameSpans) {
      const text = span.textContent?.trim()
      if (text && text.length < 50 && !text.includes(' ') === false) {
        // This might be a speaker name if it's short and doesn't look like caption text
        const style = window.getComputedStyle(span)
        if (style.fontWeight === '500' || style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 500) {
          speaker = text
          break
        }
      }
    }

    // Get the full text content, excluding the speaker name
    let text = el.textContent?.trim() || ''
    if (speaker !== 'Unknown' && text.startsWith(speaker)) {
      text = text.slice(speaker.length).trim()
    }

    return { speaker, text }
  }

  // ── Start observing captions ──
  function startObserving() {
    if (observer) return

    const container = findCaptionsContainer()

    // If no container yet, retry
    if (!container) {
      setTimeout(startObserving, 2000)
      return
    }

    observer = new MutationObserver((mutations) => {
      if (!isCapturing) return

      for (const mutation of mutations) {
        // Process added nodes (new caption lines)
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            processCaptionUpdate(container)
          }
        }

        // Also process character data changes (text updates)
        if (mutation.type === 'characterData') {
          processCaptionUpdate(container)
        }
      }
    })

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    console.log('[HeyWren] Caption observer started on Google Meet')
  }

  function processCaptionUpdate(container) {
    // Debounce: captions update character by character
    clearTimeout(captionTimeout)
    captionTimeout = setTimeout(() => {
      const captionEls = container.querySelectorAll('div[class]')
      if (captionEls.length === 0) return

      // Get the last caption element (most recent)
      const lastEl = captionEls[captionEls.length - 1]
      const { speaker, text } = parseCaptionElement(lastEl)

      if (text && text !== lastCaptionText && text.length > 3) {
        lastCaptionText = text

        chrome.runtime.sendMessage({
          type: 'CAPTION_SEGMENT',
          speaker,
          text,
          timestamp: Math.floor(Date.now() / 1000),
        })
      }
    }, 500) // Wait 500ms for caption to finish updating
  }

  // ── Inject HeyWren overlay button ──
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

    const pill = document.getElementById('heywren-pill')
    pill.addEventListener('click', toggleCapture)
  }

  async function toggleCapture() {
    const pill = document.getElementById('heywren-pill')
    const label = document.getElementById('heywren-label')

    if (isCapturing) {
      // Stop
      isCapturing = false
      chrome.runtime.sendMessage({ type: 'END_CAPTURE' })
      pill.classList.remove('heywren-recording')
      label.textContent = 'Start Wren'
      if (observer) {
        observer.disconnect()
        observer = null
      }
    } else {
      // Start
      const meetingTitle = document.title.replace(' - Google Meet', '').trim()
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'START_CAPTURE',
          platform: 'google_meet',
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

  // ── Initialize ──
  // Wait for the page to fully load, then inject overlay
  function init() {
    // Google Meet loads dynamically, wait for the meeting UI
    const checkReady = setInterval(() => {
      // Check if we're in an active meeting (has video elements or meeting controls)
      const hasControls = document.querySelector('[data-call-ended]') ||
        document.querySelector('[jscontroller]') ||
        document.querySelector('video')

      if (hasControls) {
        clearInterval(checkReady)
        injectOverlay()
      }
    }, 2000)

    // Stop checking after 30 seconds
    setTimeout(() => clearInterval(checkReady), 30000)
  }

  if (document.readyState === 'complete') {
    init()
  } else {
    window.addEventListener('load', init)
  }
})()
