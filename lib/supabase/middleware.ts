import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

// Routes that don't require onboarding completion
const ONBOARDING_PATHS = ['/onboarding']
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
  // This ensures users always see the latest deployed version
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

  // Skip checks for public/API/static paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    // Still refresh the session for API routes
    await supabase.auth.getUser()
    return response
  }

  // Use getUser() instead of getSession() — Supabase recommends this
  // as getSession() reads unvalidated data from cookies
  const { data: { user } } = await supabase.auth.getUser()

  // No user → let pages handle their own auth redirects
  if (!user) {
    return response
  }

  // Check MFA enforcement
  // If user has enrolled TOTP factors, verify they've completed the MFA challenge
  // by checking the session's AAL (Authenticator Assurance Level)
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    // If user has enrolled MFA factors but current session is only aal1,
    // redirect to MFA challenge page
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel === 'aal1') {
      // Don't redirect if already on the MFA verify page or login
      if (!pathname.startsWith('/mfa-verify') && !AUTH_PATHS.some(p => pathname.startsWith(p))) {
        const mfaUrl = new URL('/mfa-verify', request.url)
        return NextResponse.redirect(mfaUrl)
      }
    }
  }

  // Skip if already on onboarding pages
  if (ONBOARDING_PATHS.some(p => pathname.startsWith(p))) {
    return response
  }

  // Check if user has completed onboarding
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('onboarding_completed, current_team_id')
      .eq('id', user.id)
      .single()

    // If the query errored, skip the onboarding check entirely
    if (profileError) {
      return response
    }

    // If onboarding is explicitly completed, let them through
    if (profile?.onboarding_completed) {
      return response
    }

    // Even if onboarding_completed is false, check if user has a team with
    // integrations — that means they've effectively onboarded and the flag
    // just wasn't set. Don't trap them in a loop.
    if (profile?.current_team_id) {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)

      if (integrations && integrations.length > 0) {
        // User has integrations — they've onboarded. Fix the flag silently.
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
        return response
      }
    }

    // No integrations and onboarding not completed → redirect to onboarding
    if (!profile || !profile.onboarding_completed) {
      const redirectUrl = new URL('/onboarding/profile', request.url)
      return NextResponse.redirect(redirectUrl)
    }
  } catch {
    // Any error → don't redirect, let the user through
    return response
  }

  return response
}
