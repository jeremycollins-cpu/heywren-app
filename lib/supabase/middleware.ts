import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

const AUTH_PATHS = ['/login', '/signup', '/callback', '/mfa-verify']
const API_PATHS = ['/api/']
const PUBLIC_PATHS = [...AUTH_PATHS, ...API_PATHS]

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Prevent browsers and CDNs from caching dynamic pages
  const pathname = request.nextUrl.pathname
  const isStaticAsset = pathname.startsWith('/_next/') || pathname.startsWith('/favicon') || pathname.includes('.')
  if (!isStaticAsset) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    response.headers.set('Pragma', 'no-cache')
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: any }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — single network call, required for Supabase SSR token refresh
  const { data: { user } } = await supabase.auth.getUser()

  // Skip further checks for public/API paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return response
  }

  if (!user) {
    return response
  }

  // Track last activity — throttled to one DB write per 5 minutes via cookie
  const ACTIVITY_COOKIE = 'wren_last_ping'
  const ACTIVITY_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
  const lastPing = request.cookies.get(ACTIVITY_COOKIE)?.value
  const now = Date.now()
  if (!lastPing || now - Number(lastPing) > ACTIVITY_INTERVAL_MS) {
    // Fire-and-forget — don't block the response on this write
    supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', user.id).then()
    response.cookies.set(ACTIVITY_COOKIE, String(now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300, // 5 minutes in seconds
      path: '/',
    })
  }

  // MFA enforcement — reads from JWT cookie, no additional network call
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel === 'aal1') {
    if (!pathname.startsWith('/mfa-verify') && !AUTH_PATHS.some(p => pathname.startsWith(p))) {
      const mfaUrl = new URL('/mfa-verify', request.url)
      return NextResponse.redirect(mfaUrl)
    }
  }

  return response
}
