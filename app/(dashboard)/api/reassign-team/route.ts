import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * PUT /api/reassign-team
 * Reassign a member to a different team (and optionally department).
 * org_admin: can move across departments.
 * dept_manager: can move within their department only.
 * Body:
 *   - userId: target member
 *   - teamId: new team
 *   - departmentId: new department (required if moving across departments, org_admin only)
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
    const body = await request.json()
    const { userId, teamId, departmentId } = body as {
      userId: string
      teamId: string
      departmentId?: string
    }

    if (!userId || !teamId) {
      return NextResponse.json({ error: 'Missing userId or teamId' }, { status: 400 })
    }

    // Verify caller's org membership
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const callerRole = callerMembership.role
    if (callerRole !== 'org_admin' && callerRole !== 'dept_manager') {
      return NextResponse.json({ error: 'Only org admins and department managers can reassign teams' }, { status: 403 })
    }

    // Verify target is in same org
    const { data: targetMembership } = await admin
      .from('organization_members')
      .select('id, organization_id, department_id, team_id')
      .eq('user_id', userId)
      .eq('organization_id', callerMembership.organization_id)
      .limit(1)
      .single()

    if (!targetMembership) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 404 })
    }

    // Verify the target team exists and belongs to the org
    const { data: targetTeam } = await admin
      .from('teams')
      .select('id, department_id')
      .eq('id', teamId)
      .single()

    if (!targetTeam) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Verify the team's department is in the same org
    const { data: teamDept } = await admin
      .from('departments')
      .select('id, organization_id')
      .eq('id', targetTeam.department_id)
      .single()

    if (!teamDept || teamDept.organization_id !== callerMembership.organization_id) {
      return NextResponse.json({ error: 'Team does not belong to your organization' }, { status: 403 })
    }

    // dept_manager: can only reassign within their own department
    if (callerRole === 'dept_manager') {
      if (targetTeam.department_id !== callerMembership.department_id) {
        return NextResponse.json({ error: 'Department managers can only reassign within their department' }, { status: 403 })
      }
    }

    // Build update
    const update: Record<string, string> = { team_id: teamId }

    // If moving to a team in a different department, update department too
    const newDeptId = departmentId || targetTeam.department_id
    if (newDeptId !== targetMembership.department_id) {
      if (callerRole !== 'org_admin') {
        return NextResponse.json({ error: 'Only org admins can move members across departments' }, { status: 403 })
      }
      update.department_id = newDeptId
    }

    const { error } = await admin
      .from('organization_members')
      .update(update)
      .eq('id', targetMembership.id)

    if (error) {
      console.error('Reassign team error:', error)
      return NextResponse.json({ error: 'Failed to reassign team' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Reassign team error:', err)
    return NextResponse.json({ error: 'Failed to reassign' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
