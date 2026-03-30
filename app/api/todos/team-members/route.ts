import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get user's team
  const { data: membership } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership) {
    return NextResponse.json({ members: [] })
  }

  // Get all team members
  const { data: teamMembers } = await admin
    .from('team_members')
    .select('user_id')
    .eq('team_id', membership.team_id)

  if (!teamMembers || teamMembers.length === 0) {
    return NextResponse.json({ members: [] })
  }

  const userIds = teamMembers.map(m => m.user_id).filter(id => id !== user.id)

  if (userIds.length === 0) {
    return NextResponse.json({ members: [] })
  }

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, email')
    .in('id', userIds)

  const members = (profiles || []).map(p => ({
    id: p.id,
    name: p.display_name || p.email?.split('@')[0] || 'Unknown',
    email: p.email || '',
  }))

  return NextResponse.json({ members })
}
