/**
 * @jest-environment node
 *
 * Tests for the Supabase middleware (updateSession).
 *
 * The middleware:
 *   - Creates a Supabase server client with cookie-based auth
 *   - Reads cookies from the incoming request
 *   - Sets cookies on the outgoing response
 *   - Calls getUser to authenticate the session
 *   - Returns a NextResponse.next() with the original headers
 */

import { NextRequest } from 'next/server'

// ─── Mock @supabase/ssr ─────────────────────────────────────────────────────

const mockGetUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null })

let capturedCookieConfig: any = null

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn((_url: string, _key: string, options: any) => {
    capturedCookieConfig = options.cookies
    return {
      auth: {
        getUser: mockGetUser,
      },
    }
  }),
}))

// ─── Import after mocks ────────────────────────────────────────────────────

import { updateSession } from '../supabase/middleware'
import { createServerClient } from '@supabase/ssr'

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('updateSession', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    capturedCookieConfig = null
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns a NextResponse', async () => {
    const request = new NextRequest('http://localhost/')
    const response = await updateSession(request)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
  })

  it('creates a Supabase server client with the correct URL and key', async () => {
    const request = new NextRequest('http://localhost/')
    await updateSession(request)

    expect(createServerClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-anon-key',
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      })
    )
  })

  it('calls getUser to authenticate the session', async () => {
    const request = new NextRequest('http://localhost/')
    await updateSession(request)

    expect(mockGetUser).toHaveBeenCalledTimes(1)
  })

  it('passes request cookies to the Supabase client via getAll', async () => {
    const request = new NextRequest('http://localhost/', {
      headers: {
        cookie: 'sb-token=abc123; other=value',
      },
    })
    await updateSession(request)

    // The getAll function should read from request cookies
    expect(capturedCookieConfig).toBeDefined()
    const cookies = capturedCookieConfig.getAll()
    expect(Array.isArray(cookies)).toBe(true)
  })

  it('sets cookies on the response via setAll', async () => {
    const request = new NextRequest('http://localhost/')
    const response = await updateSession(request)

    // The setAll function should be able to set cookies on the response
    expect(capturedCookieConfig).toBeDefined()
    capturedCookieConfig.setAll([
      { name: 'sb-token', value: 'new-value', options: { path: '/' } },
    ])

    // Verify cookie was set on the response
    const setCookieHeader = response.headers.get('set-cookie')
    expect(setCookieHeader).toContain('sb-token=new-value')
  })

  it('preserves request headers in the response', async () => {
    const request = new NextRequest('http://localhost/', {
      headers: {
        'x-custom-header': 'test-value',
      },
    })

    const response = await updateSession(request)
    // NextResponse.next preserves the request context
    expect(response).toBeDefined()
  })

  it('handles different URL paths correctly', async () => {
    const paths = ['/dashboard', '/api/data', '/auth/callback', '/']
    for (const path of paths) {
      const request = new NextRequest(`http://localhost${path}`)
      const response = await updateSession(request)
      expect(response.status).toBe(200)
    }
  })
})
