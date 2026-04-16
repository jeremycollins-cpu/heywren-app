import axios from 'axios'

const NANGO_BASE_URL = 'https://api.nango.dev'

const nangoClient = axios.create({
  baseURL: NANGO_BASE_URL,
  headers: {
    'Authorization': `Bearer ${process.env.NANGO_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
})

export async function getConnectionToken(
  connectionId: string,
  provider: string
): Promise<string | null> {
  try {
    const response = await nangoClient.get(
      `/v1/connection/${connectionId}`,
      {
        params: { provider },
      }
    )
    return response.data?.credentials?.access_token || null
  } catch (error) {
    console.error('Failed to get Nango token:', (error as Error).message)
    return null
  }
}

export async function refreshConnectionToken(
  connectionId: string,
  provider: string
): Promise<string | null> {
  try {
    const response = await nangoClient.post(
      `/v1/connection/${connectionId}/refresh`,
      { provider }
    )
    return response.data?.credentials?.access_token || null
  } catch (error) {
    console.error('Failed to refresh Nango token:', (error as Error).message)
    return null
  }
}

export async function deleteConnection(
  connectionId: string,
  provider: string
): Promise<boolean> {
  try {
    await nangoClient.delete(`/v1/connection/${connectionId}`, {
      params: { provider },
    })
    return true
  } catch (error) {
    console.error('Failed to delete Nango connection:', (error as Error).message)
    return false
  }
}

export function getNangoAuthUrl(
  provider: string,
  redirectUri: string,
  connectionId?: string
): string {
  const params = new URLSearchParams({
    client_id: process.env.NANGO_SECRET_KEY!,
    redirect_uri: redirectUri,
    provider,
    ...(connectionId && { connection_id: connectionId }),
  })

  return `${NANGO_BASE_URL}/oauth/authorize?${params.toString()}`
}

export async function handleNangoCallback(
  code: string,
  state: string
): Promise<any> {
  try {
    const response = await nangoClient.post('/v1/oauth/callback', {
      code,
      state,
    })
    return response.data
  } catch (error) {
    console.error('Failed to handle Nango callback:', (error as Error).message)
    throw error
  }
}
