// app/api/auth/provision-account/route.ts
// Server-side account provisioning v2 — handles both NEW TEAM and JOIN TEAM flows
// Uses service role key (bypasses RLS) — no dependency on user session or sessionStorage
//
// Flow A (new team): Stripe session has no joiningTeamId → creates team, profile, membership
// Flow B (join team): Stripe session has joiningTeamId → adds user to existing team as member
//
// Idempotent — safe to call multiple times (handles page refresh, double-click, etc.)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

let stripe: any
async function getStripe() {
  if (!stripe) {
    const Stripe = (await import('stripe')).default
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
  }
  return stripe
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
    }

    // ─── 1. VERIFY STRIPE CHECKOUT SESSION ─────────────────────────────
    const stripeClient = await getStripe()
    let checkoutSession
    try {
      checkoutSession = await stripeClient.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer'],
      })
    } catch (err) {
      console.error('Stripe session retrieval failed:', err)
      return NextResponse.json({ error: 'Invalid checkout session' }, { status: 400 })
    }

    // Accept both 'complete' and 'paid' — trials show as 'complete' with 'no_payment_required'
    if (checkoutSession.status !== 'complete') {
      return NextResponse.json({ error: 'Checkout not completed' }, { status: 400 })
    }

    // ─── 2. EXTRACT METADATA ────────────────────────────────────────────
    const meta = checkoutSession.metadata || {}
    const userId = meta.userId
    const plan = meta.plan || 'basic'
    const joiningTeamId = meta.joiningTeamId || null
    const companyName = meta.companyName || 'My Team'

    const customerId = typeof checkoutSession.customer === 'string'
      ? checkoutSession.customer
      : checkoutSession.customer?.id
    const subscriptionId = typeof checkoutSession.subscription === 'string'
      ? checkoutSession.subscription
      : checkoutSession.subscription?.id

    if (!userId) {
      console.error('No userId in Stripe metadata:', meta)
      return NextResponse.json({ error: 'Missing user information' }, { status: 400 })
    }

    // ─── 3. GET USER FROM SUPABASE AUTH ─────────────────────────────────
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (authError || !authUser?.user) {
      console.error('User not found:', authError)
      return NextResponse.json({ error: 'User account not found' }, { status: 404 })
    }

    const user = authUser.user
    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'
    const userEmail = user.email || ''
    const domain = userEmail.includes('@') ? userEmail.split('@')[1].toLowerCase() : null

    // ─── 4. AUTO-CONFIRM EMAIL ──────────────────────────────────────────
    if (!user.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        email_confirm: true,
      })
    }

    // ─── 5. CHECK IF ALREADY PROVISIONED (idempotent) ───────────────────
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, current_team_id')
      .eq('id', userId)
      .single()

    if (existingProfile?.current_team_id) {
      return NextResponse.json({
        success: true,
        teamId: existingProfile.current_team_id,
        alreadyProvisioned: true,
        flow: 'existing',
      })
    }

    // ─── 6. DETERMINE FLOW: JOIN vs CREATE ──────────────────────────────
    let teamId: string
    let flow: 'joined' | 'created'

    if (joiningTeamId) {
      // ─── FLOW B: JOIN EXISTING TEAM ─────────────────────────────────
      // Verify the team actually exists
      const { data: existingTeam, error: teamLookupError } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .eq('id', joiningTeamId)
        .single()

      if (teamLookupError || !existingTeam) {
        console.error('Joining team not found:', joiningTeamId, teamLookupError)
        // Fall through to create a new team instead — don't fail the signup
        const result = await createNewTeam(userId, companyName, domain, customerId, subscriptionId, plan)
        teamId = result.teamId
        flow = 'created'
      } else {
        // Add as member of existing team
        const { error: memberError } = await supabaseAdmin
          .from('team_members')
          .upsert({
            team_id: existingTeam.id,
            user_id: userId,
            role: 'member',
          }, {
            onConflict: 'team_id,user_id',
          })

        if (memberError) {
          console.error('Failed to add team member:', memberError)
          // Try insert without upsert as fallback
          await supabaseAdmin
            .from('team_members')
            .insert({
              team_id: existingTeam.id,
              user_id: userId,
              role: 'member',
            })
        }

        teamId = existingTeam.id
        flow = 'joined'
      }
    } else {
      // ─── FLOW A: CREATE NEW TEAM ──────────────────────────────────
      const result = await createNewTeam(userId, companyName, domain, customerId, subscriptionId, plan)
      teamId = result.teamId
      flow = 'created'
    }

    // ─── 7. UPSERT PROFILE ─────────────────────────────────────────────
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: fullName,
        email: userEmail,
        role: flow === 'created' ? 'super_admin' : 'member',
        current_team_id: teamId,
      }, {
        onConflict: 'id',
      })

    if (profileError) {
      console.error('Profile upsert failed:', profileError)
      // Try update as fallback
      await supabaseAdmin
        .from('profiles')
        .update({
          full_name: fullName,
          email: userEmail,
          role: flow === 'created' ? 'super_admin' : 'member',
          current_team_id: teamId,
        })
        .eq('id', userId)
    }

    // ─── 8. UPDATE STRIPE METADATA WITH REAL TEAM ID ────────────────────
    if (subscriptionId) {
      try {
        await stripeClient.subscriptions.update(subscriptionId, {
          metadata: { userId, teamId, plan },
        })
      } catch (err) {
        console.error('Stripe subscription metadata update failed (non-critical):', err)
      }
    }

    if (customerId) {
      try {
        await stripeClient.customers.update(customerId, {
          metadata: { userId, teamId, plan },
        })
      } catch (err) {
        console.error('Stripe customer metadata update failed (non-critical):', err)
      }
    }

    // ─── 9. RETURN SUCCESS ──────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      teamId,
      flow,
      alreadyProvisioned: false,
    })

  } catch (error: any) {
    console.error('Provision account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to provision account' },
      { status: 500 }
    )
  }
}

// ─── HELPER: Create a new team ──────────────────────────────────────────────
async function createNewTeam(
  userId: string,
  companyName: string,
  domain: string | null,
  customerId: string | undefined,
  subscriptionId: string | undefined,
  plan: string
): Promise<{ teamId: string }> {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '-' + Date.now().toString(36)

  const { data: newTeam, error: teamError } = await supabaseAdmin
    .from('teams')
    .insert({
      name: companyName,
      slug,
      owner_id: userId,
      domain: domain || null,
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscriptionId || null,
      subscription_plan: plan,
      subscription_status: 'trialing',
    })
    .select('id')
    .single()

  if (teamError || !newTeam) {
    console.error('Team creation failed:', teamError)
    throw new Error('Failed to create team')
  }

  // Add creator as team owner
  const { error: memberError } = await supabaseAdmin
    .from('team_members')
    .insert({
      team_id: newTeam.id,
      user_id: userId,
      role: 'owner',
    })

  if (memberError) {
    console.error('Team member creation failed (non-critical):', memberError)
  }

  return { teamId: newTeam.id }
}
