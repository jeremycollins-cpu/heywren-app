// app/api/integrations/oauth-state/route.ts
// Generates an HMAC-signed OAuth state parameter for the authenticated user.
// Called by client-side integration pages before redirecting to OAuth providers.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signOAuthState } from '@/lib/crypto/oauth-state'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const redirect = body.redirect || 'dashboard'

  const state = signOAuthState({ userId: userData.user.id, redirect })

  return NextResponse.json({ state })
}
