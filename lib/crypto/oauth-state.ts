// lib/crypto/oauth-state.ts
// HMAC-signed OAuth state parameters to prevent CSRF attacks on OAuth callbacks.
//
// Usage:
//   const state = signOAuthState({ userId, redirect })  // before redirect to provider
//   const data = verifyOAuthState(state)                 // in callback route

import crypto from 'crypto'

interface OAuthStatePayload {
  userId: string
  redirect?: string
}

function getSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) is not set')
  }
  return secret
}

/**
 * Create an HMAC-signed, base64url-encoded state parameter.
 * Format: base64url(JSON payload) + '.' + hex(HMAC-SHA256)
 */
export function signOAuthState(payload: OAuthStatePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const hmac = crypto.createHmac('sha256', getSecret()).update(data).digest('hex')
  return `${data}.${hmac}`
}

/**
 * Verify and decode a signed OAuth state parameter.
 * Returns the payload if valid, null if tampered or malformed.
 */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const dotIndex = state.lastIndexOf('.')
  if (dotIndex === -1) return null

  const data = state.slice(0, dotIndex)
  const providedHmac = state.slice(dotIndex + 1)

  const expectedHmac = crypto.createHmac('sha256', getSecret()).update(data).digest('hex')

  // Constant-time comparison to prevent timing attacks
  if (providedHmac.length !== expectedHmac.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) return null

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString())
  } catch {
    return null
  }
}
