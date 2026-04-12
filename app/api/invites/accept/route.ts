export const dynamic = 'force-dynamic'

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

    // Auto-confirm email for invited users (they were explicitly invited)
    if (!user.email_confirmed_at) {
      try {
        await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
      } catch { /* non-fatal */ }
    }

    // Resolve team_id: if invite doesn't specify one, find the org's default team
    let resolvedTeamId = invitation.team_id || null
    let resolvedDeptId = invitation.department_id || null
    if (!resolvedTeamId) {
      // Find the first team in this org
      const { data: orgTeam } = await admin
        .from('teams')
        .select('id, department_id')
        .eq('organization_id', invitation.organization_id)
        .limit(1)
        .single()
      if (orgTeam) {
        resolvedTeamId = orgTeam.id
        if (!resolvedDeptId) resolvedDeptId = orgTeam.department_id
      }
    }

    // Ensure profile exists (upsert — new invite users may not have a profiles row)
    const { error: profileUpsertError } = await admin
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        organization_id: invitation.organization_id,
        department_id: resolvedDeptId,
        current_team_id: resolvedTeamId,
      }, { onConflict: 'id' })

    if (profileUpsertError) {
      console.error('[invites/accept/POST] Profile upsert failed:', profileUpsertError.message)
    }

    // Create organization_members record
    const { error: memberError } = await admin
      .from('organization_members')
      .insert({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
        department_id: resolvedDeptId,
        team_id: resolvedTeamId,
      })

    if (memberError) {
      console.error('[invites/accept/POST] Failed to create org membership:', memberError.message)
      return NextResponse.json({ error: 'Failed to join organization' }, { status: 500 })
    }

    // Add to team_members (legacy table, keep in sync)
    if (resolvedTeamId) {
      const { error: teamError } = await admin
        .from('team_members')
        .upsert({
          team_id: resolvedTeamId,
          user_id: user.id,
          role: invitation.role === 'team_lead' ? 'team_lead' : 'member',
        }, { onConflict: 'team_id,user_id' })

      if (teamError) {
        console.error('[invites/accept/POST] Failed to add to team:', teamError.message)
        // Non-fatal — org membership was created
      }
    }

    // Profile already upserted above with org/dept/team info

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
    if (invitation.team_id) {
      const { data: team } = await admin
        .from('teams')
        .select('name')
        .eq('id', invitation.team_id)
        .single()
      teamName = team?.name || null
    }

    // Increment Stripe seat count (org subscription is source of truth)
    try {
      const { data: orgBilling } = await admin
        .from('organizations')
        .select('billing_type, stripe_subscription_id')
        .eq('id', invitation.organization_id)
        .single()

      if (orgBilling?.billing_type !== 'enterprise') {
        const subId = orgBilling?.stripe_subscription_id
        if (subId) {
          try {
            const Stripe = (await import('stripe')).default
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
            const subscription = await stripe.subscriptions.retrieve(subId)
            if (subscription.items.data[0]) {
              await stripe.subscriptions.update(subId, {
                items: [{
                  id: subscription.items.data[0].id,
                  quantity: (subscription.items.data[0].quantity || 1) + 1,
                }],
                proration_behavior: 'create_prorations',
              })
            }
          } catch (stripeErr) {
            console.error('[invites/accept] Stripe seat increment failed (non-fatal):', stripeErr)
          }
        }
      }
    } catch {
      // Non-fatal — billing update can be reconciled later
    }

    return NextResponse.json({
      success: true,
      organization_id: invitation.organization_id,
      organization_name: org?.name || null,
      team_id: invitation.team_id || null,
      team_name: teamName,
      department_id: invitation.department_id || null,
      role: invitation.role,
    })
  } catch (err) {
    console.error('[invites/accept/POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
