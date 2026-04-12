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
 * GET /api/admin/departments
 * Returns all departments for the caller's org. Org admins only.
 */
export async function GET() {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 })
    }

    const { data: departments, error } = await admin
      .from('departments')
      .select('id, name, slug, head_user_id, created_at')
      .eq('organization_id', caller.orgId)
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get member counts per department
    const { data: members } = await admin
      .from('organization_members')
      .select('department_id')
      .eq('organization_id', caller.orgId)

    const memberCounts: Record<string, number> = {}
    for (const m of members || []) {
      if (m.department_id) {
        memberCounts[m.department_id] = (memberCounts[m.department_id] || 0) + 1
      }
    }

    const enriched = (departments || []).map(d => ({
      ...d,
      memberCount: memberCounts[d.id] || 0,
    }))

    return NextResponse.json({ departments: enriched })
  } catch (err) {
    console.error('Departments GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/departments
 * Create a new department. Org admins only.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 })
    }

    const { name } = await request.json()
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 })
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { data: dept, error } = await admin
      .from('departments')
      .insert({
        organization_id: caller.orgId,
        name: name.trim(),
        slug: slug || `dept-${Date.now().toString(36)}`,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A department with that name already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ department: { ...dept, memberCount: 0 } })
  } catch (err) {
    console.error('Departments POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/departments
 * Rename a department. Org admins only.
 */
export async function PATCH(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 })
    }

    const { id, name } = await request.json()
    if (!id || !name?.trim()) {
      return NextResponse.json({ error: 'id and name required' }, { status: 400 })
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { error } = await admin
      .from('departments')
      .update({ name: name.trim(), slug, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', caller.orgId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Departments PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/departments
 * Delete an empty department. Org admins only.
 */
export async function DELETE(request: NextRequest) {
  try {
    const admin = getAdminClient()
    const caller = await getCallerOrgAdmin(admin)
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 })
    }

    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Missing department id' }, { status: 400 })
    }

    // Check if department has members
    const { count } = await admin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id)

    if ((count || 0) > 0) {
      return NextResponse.json({ error: `Cannot delete — ${count} member${count !== 1 ? 's' : ''} still in this department. Move them first.` }, { status: 400 })
    }

    const { error } = await admin
      .from('departments')
      .delete()
      .eq('id', id)
      .eq('organization_id', caller.orgId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Departments DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
