import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

/**
 * PUT /api/manage-member
 * Allows managers to update a member's org role, job title, and department.
 * org_admin can set any role; dept_manager/team_lead can only promote up to their own level.
 */
export async function PUT(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    // Verify caller is a manager in an org
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Only managers can manage members' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, orgRole, jobTitle, departmentId, systemRole } = body as {
      userId: string
      orgRole?: string
      jobTitle?: string
      departmentId?: string
      systemRole?: string
    }

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // Verify target user is in the same org
    const { data: targetMembership } = await admin
      .from('organization_members')
      .select('id, organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', callerMembership.organization_id)
      .limit(1)
      .single()

    if (!targetMembership) {
      return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
    }

    // Role hierarchy enforcement
    const roleHierarchy: Record<string, number> = {
      member: 0,
      team_lead: 1,
      dept_manager: 2,
      org_admin: 3,
    }

    const callerLevel = roleHierarchy[callerMembership.role] ?? 0
    const targetCurrentLevel = roleHierarchy[targetMembership.role] ?? 0

    // Can't edit someone at or above your level (unless you're org_admin)
    if (callerMembership.role !== 'org_admin' && targetCurrentLevel >= callerLevel) {
      return NextResponse.json({ error: 'Cannot manage users at or above your role level' }, { status: 403 })
    }

    const results: string[] = []

    // Update org role
    if (orgRole && orgRole !== targetMembership.role) {
      const newLevel = roleHierarchy[orgRole] ?? 0

      // Can't promote someone above your own level (unless org_admin)
      if (callerMembership.role !== 'org_admin' && newLevel >= callerLevel) {
        return NextResponse.json({ error: 'Cannot assign a role at or above your own level' }, { status: 403 })
      }

      const validRoles = ['member', 'team_lead', 'dept_manager', 'org_admin']
      if (!validRoles.includes(orgRole)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }

      const { error } = await admin
        .from('organization_members')
        .update({ role: orgRole })
        .eq('id', targetMembership.id)

      if (error) {
        return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
      }
      results.push(`Role updated to ${orgRole}`)
    }

    // Update job title in profiles
    if (jobTitle !== undefined) {
      const { error } = await admin
        .from('profiles')
        .update({ job_title: jobTitle.trim() || null })
        .eq('id', userId)

      if (error) {
        console.error('Failed to update job_title:', error)
      } else {
        results.push('Job title updated')
      }
    }

    // Update department
    if (departmentId !== undefined) {
      const { error } = await admin
        .from('organization_members')
        .update({ department_id: departmentId || null })
        .eq('id', targetMembership.id)

      if (error) {
        console.error('Failed to update department:', error)
      } else {
        results.push('Department updated')
      }
    }

    // Update system role (admin/super_admin) — org_admin only
    if (systemRole !== undefined && callerMembership.role === 'org_admin') {
      const validSystemRoles = ['user', 'admin']
      if (!validSystemRoles.includes(systemRole)) {
        return NextResponse.json({ error: 'Invalid system role' }, { status: 400 })
      }

      const { error } = await admin
        .from('profiles')
        .update({ role: systemRole })
        .eq('id', userId)

      if (error) {
        console.error('Failed to update system role:', error)
      } else {
        results.push(`System role updated to ${systemRole}`)
      }
    }

    return NextResponse.json({ success: true, changes: results })
  } catch (err) {
    console.error('Manage member error:', err)
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
