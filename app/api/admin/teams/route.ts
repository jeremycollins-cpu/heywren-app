export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getCallerOrgAdmin(admin: ReturnType<typeof getAdminClient>) {
  const supabase = await createSessionClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return null

  const { data: membership } = await admin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userData.user.id)
    .limit(1)
    .single()

  if (!membership || membership.role !== 'org_admin') return null
  return { userId: userData.user.id, orgId: membership.organization_id }
}

/**
 * GET /api/admin/teams
 * Returns all teams grouped by department. Org admins only.
 */
export async function GET() {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { data: teams } = await admin
      .from('teams')
      .select('id, name, slug, department_id, organization_id')
      .eq('organization_id', caller.orgId)
      .order('name')

    // Get member counts
    const { data: members } = await admin
      .from('organization_members')
      .select('team_id')
      .eq('organization_id', caller.orgId)

    const memberCounts: Record<string, number> = {}
    for (const m of members || []) {
      if (m.team_id) memberCounts[m.team_id] = (memberCounts[m.team_id] || 0) + 1
    }

    const enriched = (teams || []).map(t => ({ ...t, memberCount: memberCounts[t.id] || 0 }))
    return NextResponse.json({ teams: enriched })
  } catch (err) {
    console.error('Teams GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/teams
 * Create a team within a department. Org admins only.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { name, departmentId } = await request.json()
    if (!name?.trim() || !departmentId) {
      return NextResponse.json({ error: 'Team name and department are required' }, { status: 400 })
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36)

    const { data: team, error } = await admin
      .from('teams')
      .insert({
        name: name.trim(),
        slug,
        organization_id: caller.orgId,
        department_id: departmentId,
        owner_id: caller.userId,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ team: { ...team, memberCount: 0 } })
  } catch (err) {
    console.error('Teams POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/teams
 * Rename a team. Org admins only.
 */
export async function PATCH(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { id, name } = await request.json()
    if (!id || !name?.trim()) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

    const { error } = await admin
      .from('teams')
      .update({ name: name.trim() })
      .eq('id', id)
      .eq('organization_id', caller.orgId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Teams PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/teams
 * Delete an empty team. Org admins only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing team id' }, { status: 400 })

    const { count } = await admin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', id)

    if ((count || 0) > 0) {
      return NextResponse.json({ error: `Cannot delete — ${count} member${count !== 1 ? 's' : ''} still on this team` }, { status: 400 })
    }

    const { error } = await admin
      .from('teams')
      .delete()
      .eq('id', id)
      .eq('organization_id', caller.orgId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Teams DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
