// app/api/admin/fix-orphaned-user/route.ts
// Admin endpoint to fix users who are missing team associations.
// Protected by session-based admin check (team owner or admin role).
//
// Usage:
//   POST /api/admin/fix-orphaned-user
//   Body: { email: "user@example.com", forceTeamId?: "uuid" }

import { NextRequest, NextResponse } from 'next/server'
import { fixOrphanedUser } from '@/lib/team/ensure-team'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    // Auth: require authenticated admin user (session-based only)
    const { createClient: createSessionClient } = await import('@/lib/supabase/server')
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()

    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('role')
      .eq('user_id', userData.user.id)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { email, forceTeamId } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Missing email parameter' }, { status: 400 })
    }

    const result = await fixOrphanedUser(email, forceTeamId)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({
      ...result,
      message: `User ${email} is now associated with team ${result.teamId} (${result.flow})`,
    })
  } catch (error: any) {
    console.error('Fix orphaned user error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fix user' },
      { status: 500 }
    )
  }
}
