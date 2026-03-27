import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabaseAdmin = getAdminClient()
  try {
    // Authenticate the user via session
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id

    // Get team_id from profile (using admin client to bypass RLS)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    let teamId = profile?.current_team_id || null

    // Fallback: check team_members directly
    if (!teamId) {
      const { data: membership } = await supabaseAdmin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (membership?.team_id) {
        teamId = membership.team_id
        // Fix the profile while we're at it
        await supabaseAdmin
          .from('profiles')
          .update({ current_team_id: teamId })
          .eq('id', userId)
      }
    }

    if (!teamId) {
      return NextResponse.json({ integrations: [], teamId: null })
    }

    // Get integrations for THIS user (not all team integrations)
    const { data: integrations, error } = await supabaseAdmin
      .from('integrations')
      .select('id, provider, config')
      .eq('team_id', teamId)
      .eq('user_id', userId)

    if (error) {
      console.error('Error fetching integrations:', error)
      return NextResponse.json({ integrations: [], teamId })
    }

    return NextResponse.json(
      { integrations: integrations || [], teamId },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    )
  } catch (err) {
    console.error('Integration status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic'
