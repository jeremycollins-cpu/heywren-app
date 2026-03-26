// app/(dashboard)/api/invites/route.ts
// API routes for managing invitations (list, create, revoke)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { sendInviteEmail } from '@/lib/email/send-invite'
import crypto from 'crypto'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAuthenticatedUser() {
  const supabase = await createSessionClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

async function getCallerMembership(adminClient: ReturnType<typeof getAdminClient>, userId: string) {
  const { data } = await adminClient
    .from('organization_members')
    .select('organization_id, department_id, team_id, role')
    .eq('user_id', userId)
    .single()
  return data
}

// ---------------------------------------------------------------------------
// GET  — list pending invites visible to the caller
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const membership = await getCallerMembership(admin, user.id)
    if (!membership) {
      return NextResponse.json({ error: 'No organization membership found' }, { status: 403 })
    }

    let query = admin
      .from('invitations')
      .select(`
        id,
        email,
        role,
        status,
        department_id,
        team_id,
        invited_by,
        expires_at,
        created_at,
        organization_id
      `)
      .eq('organization_id', membership.organization_id)
      .in('status', ['pending'])
      .order('created_at', { ascending: false })

    // dept_manager can only see invites for their department
    if (membership.role === 'dept_manager') {
      query = query.eq('department_id', membership.department_id)
    } else if (membership.role !== 'org_admin') {
      // team_lead and member cannot see invites
      return NextResponse.json({ invitations: [] })
    }

    const { data: invitations, error } = await query

    if (error) {
      console.error('[invites/GET] DB error:', error.message)
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
    }

    return NextResponse.json({ invitations })
  } catch (err) {
    console.error('[invites/GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST — create and send an invitation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { email, role, departmentId, teamId } = body as {
      email?: string
      role?: string
      departmentId?: string
      teamId?: string
    }

    // Validate required fields
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
    }

    const inviteRole = role || 'member'
    const validRoles = ['org_admin', 'dept_manager', 'team_lead', 'member']
    if (!validRoles.includes(inviteRole)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const admin = getAdminClient()
    const membership = await getCallerMembership(admin, user.id)
    if (!membership) {
      return NextResponse.json({ error: 'No organization membership found' }, { status: 403 })
    }

    // Permission checks
    if (membership.role === 'dept_manager') {
      // dept_manager can only invite to their own department with member/team_lead roles
      if (inviteRole === 'org_admin' || inviteRole === 'dept_manager') {
        return NextResponse.json(
          { error: 'Department managers cannot assign admin or manager roles' },
          { status: 403 }
        )
      }
      if (departmentId && departmentId !== membership.department_id) {
        return NextResponse.json(
          { error: 'You can only invite to your own department' },
          { status: 403 }
        )
      }
    } else if (membership.role !== 'org_admin') {
      return NextResponse.json(
        { error: 'You do not have permission to send invitations' },
        { status: 403 }
      )
    }

    // Check if the email is already a member of the org
    const { data: existingMember } = await admin
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .single()

    if (existingMember) {
      const { data: alreadyInOrg } = await admin
        .from('organization_members')
        .select('id')
        .eq('organization_id', membership.organization_id)
        .eq('user_id', existingMember.id)
        .single()

      if (alreadyInOrg) {
        return NextResponse.json(
          { error: 'This user is already a member of the organization' },
          { status: 409 }
        )
      }
    }

    // Check for existing pending invite
    const { data: existingInvite } = await admin
      .from('invitations')
      .select('id, status')
      .eq('organization_id', membership.organization_id)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .single()

    if (existingInvite) {
      return NextResponse.json(
        { error: 'A pending invitation already exists for this email' },
        { status: 409 }
      )
    }

    // Generate secure token and expiry
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    // Resolve department/team defaults for dept_manager
    const finalDepartmentId = departmentId || (membership.role === 'dept_manager' ? membership.department_id : null)
    const finalTeamId = teamId || null

    // If a previous invite was revoked/expired, delete it so the unique constraint is satisfied
    await admin
      .from('invitations')
      .delete()
      .eq('organization_id', membership.organization_id)
      .eq('email', email.toLowerCase())
      .in('status', ['revoked', 'expired'])

    // Create the invitation record
    const { data: invitation, error: insertError } = await admin
      .from('invitations')
      .insert({
        organization_id: membership.organization_id,
        department_id: finalDepartmentId,
        team_id: finalTeamId,
        invited_by: user.id,
        email: email.toLowerCase(),
        role: inviteRole,
        token,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[invites/POST] Insert error:', insertError.message)
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
    }

    // Look up inviter's name and org name for the email
    const { data: inviterProfile } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single()

    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', membership.organization_id)
      .single()

    const inviterName = inviterProfile?.full_name || inviterProfile?.email || 'Someone'
    const organizationName = org?.name || 'your organization'

    // Send the invite email
    const emailResult = await sendInviteEmail({
      email: email.toLowerCase(),
      inviterName,
      organizationName,
      role: inviteRole,
      inviteToken: token,
    })

    if (!emailResult.success) {
      console.error('[invites/POST] Email delivery failed:', emailResult.error)
      // Invitation is still created; the user can resend later
    }

    return NextResponse.json({
      invitation,
      emailSent: emailResult.success,
    })
  } catch (err) {
    console.error('[invites/POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE — revoke an invitation
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { inviteId } = body as { inviteId?: string }

    if (!inviteId) {
      return NextResponse.json({ error: 'inviteId is required' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Fetch the invitation
    const { data: invitation, error: fetchError } = await admin
      .from('invitations')
      .select('id, organization_id, invited_by, status')
      .eq('id', inviteId)
      .single()

    if (fetchError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 400 })
    }

    // Check permissions: org_admin in the same org OR original inviter
    const membership = await getCallerMembership(admin, user.id)
    const isOrgAdmin =
      membership &&
      membership.organization_id === invitation.organization_id &&
      membership.role === 'org_admin'
    const isOriginalInviter = invitation.invited_by === user.id

    if (!isOrgAdmin && !isOriginalInviter) {
      return NextResponse.json(
        { error: 'Only org admins or the original inviter can revoke invitations' },
        { status: 403 }
      )
    }

    // Revoke
    const { error: updateError } = await admin
      .from('invitations')
      .update({ status: 'revoked' })
      .eq('id', inviteId)

    if (updateError) {
      console.error('[invites/DELETE] Update error:', updateError.message)
      return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[invites/DELETE] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
