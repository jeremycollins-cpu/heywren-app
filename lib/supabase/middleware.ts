import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

// Routes that don't require onboarding completion
const ONBOARDING_PATHS = ['/onboarding']
const AUTH_PATHS = ['/login', '/signup', '/callback']
const API_PATHS = ['/api/']
const PUBLIC_PATHS = [...AUTH_PATHS, ...API_PATHS]

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // This refreshes a user's session in case they have session data from a cookie
  const { data: { session } } = await supabase.auth.getSession()

  const pathname = request.nextUrl.pathname

  // Skip checks for public/API/static paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return response
  }

  // No session → let pages handle their own auth redirects
  if (!session) {
    return response
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
      .eq('id', session.user.id)
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
    // just wasn't set (server-side session bug). Don't trap them in a loop.
    if (profile?.current_team_id) {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('id')
        .eq('team_id', profile.current_team_id)
        .limit(1)

      if (integrations && integrations.length > 0) {
        // User has integrations — they've onboarded. Fix the flag silently.
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', session.user.id)
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
