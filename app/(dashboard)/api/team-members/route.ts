import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    const admin = getAdminClient()

    if (!userId) {
      const { searchParams } = new URL(request.url)
      const qUserId = searchParams.get('userId')
      if (qUserId) {
        const { data: authUser } = await admin.auth.admin.getUserById(qUserId)
        if (authUser?.user) userId = authUser.user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ members: [] })
    }

    // Get team ID
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    let teamId = profile?.current_team_id
    if (!teamId) {
      const { data: membership } = await admin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()
      teamId = membership?.team_id
    }

    if (!teamId) {
      return NextResponse.json({ members: [], teamName: null })
    }

    // Get team name
    const { data: team } = await admin
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .single()

    // Get team members
    const { data: teamMembers } = await admin
      .from('team_members')
      .select('id, user_id, role')
      .eq('team_id', teamId)

    if (!teamMembers) {
      return NextResponse.json({ members: [], teamName: team?.name })
    }

    // Get profiles using admin client (bypasses RLS)
    const userIds = teamMembers.map(m => m.user_id)
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .in('id', userIds)

    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    const members = teamMembers.map(m => {
      const p = profileMap.get(m.user_id)
      return {
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: p?.email || '',
        full_name: p?.full_name || p?.email?.split('@')[0] || 'Unknown',
        avatar_url: p?.avatar_url || null,
      }
    })

    return NextResponse.json({ members, teamName: team?.name || null, teamId })
  } catch (err) {
    console.error('Team members error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
