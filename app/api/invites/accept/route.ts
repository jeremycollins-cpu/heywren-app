// app/api/invites/accept/route.ts
// Public API route for accepting an invitation via token

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ---------------------------------------------------------------------------
// GET — fetch invite details by token (public, no auth required)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const admin = getAdminClient()

    const { data: invitation, error } = await admin
      .from('invitations')
      .select(`
        id,
        email,
        role,
        status,
        organization_id,
        department_id,
        team_id,
        invited_by,
        expires_at,
        created_at
      `)
      .eq('token', token)
      .single()

    if (error || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Check if expired
    if (invitation.status === 'pending' && new Date(invitation.expires_at) < new Date()) {
      // Mark as expired
      await admin
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id)
      invitation.status = 'expired'
    }

    // Look up org name and inviter name for display
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', invitation.organization_id)
      .single()

    const { data: inviter } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', invitation.invited_by)
      .single()

    // Look up department/team names if present
    let departmentName: string | null = null
    let teamName: string | null = null

    if (invitation.department_id) {
      const { data: dept } = await admin
        .from('departments')
        .select('name')
        .eq('id', invitation.department_id)
        .single()
      departmentName = dept?.name || null
    }

    if (invitation.team_id) {
      const { data: team } = await admin
        .from('teams')
        .select('name')
        .eq('id', invitation.team_id)
        .single()
      teamName = team?.name || null
    }

    return NextResponse.json({
      invitation: {
        ...invitation,
        organization_name: org?.name || 'Unknown Organization',
        inviter_name: inviter?.full_name || inviter?.email || 'Someone',
        department_name: departmentName,
        team_name: teamName,
      },
    })
  } catch (err) {
    console.error('[invites/accept/GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST — accept the invitation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // User must be authenticated to accept
    const supabase = await createSessionClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to accept an invitation' }, { status: 401 })
    }

    const body = await request.json()
    const { token } = body as { token?: string }

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Fetch the invitation
    const { data: invitation, error: fetchError } = await admin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single()

    if (fetchError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Validate status
    if (invitation.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status}` },
        { status: 400 }
      )
    }

    // Check expiry
    if (new Date(invitation.expires_at) < new Date()) {
      await admin
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id)
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 })
    }

    // Check the user isn't already a member
    const { data: existingMembership } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', invitation.organization_id)
      .eq('user_id', user.id)
      .single()

    if (existingMembership) {
      // Already a member — mark invite as accepted and return
      await admin
        .from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)

      return NextResponse.json({
        success: true,
        alreadyMember: true,
        organization_id: invitation.organization_id,
      })
    }

    // Resolve department_id and team_id — organization_members requires both NOT NULL
    let inviteDeptId = invitation.department_id
    let inviteTeamId = invitation.team_id

    if (!inviteDeptId || !inviteTeamId) {
      // Fall back to the org's default department and team
      if (!inviteDeptId) {
        const { data: defaultDept } = await admin
          .from('departments')
          .select('id')
          .eq('organization_id', invitation.organization_id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()
        inviteDeptId = defaultDept?.id || null
      }

      if (!inviteTeamId && inviteDeptId) {
        const { data: defaultTeam } = await admin
          .from('teams')
          .select('id')
          .eq('organization_id', invitation.organization_id)
          .eq('department_id', inviteDeptId)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()
        inviteTeamId = defaultTeam?.id || null
      }

      if (!inviteDeptId || !inviteTeamId) {
        console.error('[invites/accept/POST] No default department/team found for org:', invitation.organization_id)
        return NextResponse.json({ error: 'Organization is not fully set up. Contact your admin.' }, { status: 500 })
      }
    }

    // Create organization_members record
    const { error: memberError } = await admin
      .from('organization_members')
      .insert({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
        department_id: inviteDeptId,
        team_id: inviteTeamId,
      })

    if (memberError) {
      console.error('[invites/accept/POST] Failed to create org membership:', memberError.message)
      return NextResponse.json({ error: 'Failed to join organization' }, { status: 500 })
    }

    // Also add to team_members for legacy compatibility
    if (inviteTeamId) {
      const { error: teamError } = await admin
        .from('team_members')
        .upsert({
          team_id: inviteTeamId,
          user_id: user.id,
          role: invitation.role === 'team_lead' ? 'team_lead' : 'member',
        }, { onConflict: 'team_id,user_id' })

      if (teamError) {
        console.error('[invites/accept/POST] Failed to add to team:', teamError.message)
        // Non-fatal — org membership was created
      }
    }

    // Update profile with organization/department info
    const profileUpdate: Record<string, string | null> = {
      organization_id: invitation.organization_id,
      department_id: inviteDeptId,
      current_team_id: inviteTeamId,
    }

    const { error: profileError } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', user.id)

    if (profileError) {
      console.error('[invites/accept/POST] Failed to update profile:', profileError.message)
      // Non-fatal
    }

    // Mark invitation as accepted
    const { error: updateError } = await admin
      .from('invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)

    if (updateError) {
      console.error('[invites/accept/POST] Failed to update invitation status:', updateError.message)
    }

    // Look up names for the response
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', invitation.organization_id)
      .single()

    let teamName: string | null = null
    if (inviteTeamId) {
      const { data: team } = await admin
        .from('teams')
        .select('name')
        .eq('id', inviteTeamId)
        .single()
      teamName = team?.name || null
    }

    return NextResponse.json({
      success: true,
      organization_id: invitation.organization_id,
      organization_name: org?.name || null,
      team_id: inviteTeamId,
      team_name: teamName,
      department_id: inviteDeptId,
      role: invitation.role,
    })
  } catch (err) {
    console.error('[invites/accept/POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
