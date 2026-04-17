// lib/asana/client.ts
// Asana REST API helpers — fetch wrapper that auto-refreshes the access token
// on 401 and persists the new token back to the integrations row.
//
// Asana access tokens expire after 1 hour; refresh tokens are long-lived.
// Docs: https://developers.asana.com/docs/oauth

import type { SupabaseClient } from '@supabase/supabase-js'

export const ASANA_API = 'https://app.asana.com/api/1.0'
const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token'

export interface AsanaIntegrationRow {
  id: string
  access_token: string
  refresh_token: string | null
  config: Record<string, any> | null
}

interface AsanaTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  data?: { id: string; gid: string; name: string; email: string }
}

/**
 * Refresh an Asana access token using the stored refresh_token.
 * Persists the new access_token back to the integrations row.
 * Returns the new access token, or null if the refresh failed.
 */
export async function refreshAsanaToken(
  admin: SupabaseClient,
  integrationId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = process.env.ASANA_CLIENT_ID
  const clientSecret = process.env.ASANA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[asana] Missing ASANA_CLIENT_ID / ASANA_CLIENT_SECRET')
    return null
  }

  try {
    const res = await fetch(ASANA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    })

    const tokenData = (await res.json()) as AsanaTokenResponse & { error?: string }
    if (!res.ok || !tokenData.access_token) {
      console.error('[asana] Token refresh failed:', tokenData.error || res.statusText)
      return null
    }

    const { data: current } = await admin
      .from('integrations')
      .select('config')
      .eq('id', integrationId)
      .single()

    await admin
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        // Asana usually does NOT return a new refresh_token; keep the old one.
        refresh_token: tokenData.refresh_token || refreshToken,
        config: {
          ...(current?.config || {}),
          token_expires_at: new Date(
            Date.now() + (tokenData.expires_in || 3600) * 1000
          ).toISOString(),
        },
      })
      .eq('id', integrationId)

    return tokenData.access_token
  } catch (err) {
    console.error('[asana] Token refresh error:', err)
    return null
  }
}

/**
 * Fetch an Asana API endpoint with the user's access token. Auto-refreshes
 * once on 401 and retries. `path` is the URL path after `/api/1.0`, e.g.
 * `/users/me`.
 */
export async function asanaFetch<T = any>(
  admin: SupabaseClient,
  integration: AsanaIntegrationRow,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${ASANA_API}${path}`

  const doFetch = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    })

  let res = await doFetch(integration.access_token)

  if (res.status === 401 && integration.refresh_token) {
    const newToken = await refreshAsanaToken(admin, integration.id, integration.refresh_token)
    if (!newToken) {
      throw new Error('Asana token refresh failed — please reconnect Asana')
    }
    integration.access_token = newToken
    res = await doFetch(newToken)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Asana API error (${res.status} ${path}): ${body.slice(0, 500)}`)
  }

  return (await res.json()) as T
}

/**
 * Exchange an OAuth authorization code for tokens. Used by the connect route.
 */
export async function exchangeAsanaCode(
  code: string,
  redirectUri: string
): Promise<AsanaTokenResponse | { error: string }> {
  const clientId = process.env.ASANA_CLIENT_ID
  const clientSecret = process.env.ASANA_CLIENT_SECRET
  if (!clientId || !clientSecret) return { error: 'Missing Asana credentials' }

  const res = await fetch(ASANA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  })

  const data = (await res.json()) as AsanaTokenResponse & { error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    return { error: data.error_description || data.error || `Token exchange failed (${res.status})` }
  }
  return data
}
