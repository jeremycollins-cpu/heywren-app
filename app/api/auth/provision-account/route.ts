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
import { ensureTeamForUser } from '@/lib/team/ensure-team'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

let stripe: any
async function getStripe() {
  if (!stripe) {
    const Stripe = (await import('stripe')).default
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
  }
  return stripe
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getAdminClient()
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
    const plan = meta.plan || 'pro'
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

    // ─── 5. CHECK IF ALREADY PROVISIONED ─────────────────────────────────
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, current_team_id')
      .eq('id', userId)
      .single()

    if (existingProfile?.current_team_id) {
      // User already has a team — but they may be upgrading from trial.
      // Update the team's Stripe IDs so billing works going forward.
      if (customerId || subscriptionId) {
        const updateFields: Record<string, any> = {}
        if (customerId) updateFields.stripe_customer_id = customerId
        if (subscriptionId) updateFields.stripe_subscription_id = subscriptionId
        if (plan) updateFields.subscription_plan = plan
        updateFields.subscription_status = 'trialing'

        // Calculate trial_ends_at from subscription if available
        const sub = typeof checkoutSession.subscription === 'object'
          ? checkoutSession.subscription
          : null
        if (sub?.trial_end) {
          updateFields.trial_ends_at = new Date(sub.trial_end * 1000).toISOString()
        }

        await supabaseAdmin
          .from('teams')
          .update(updateFields)
          .eq('id', existingProfile.current_team_id)

        // Also update Stripe metadata with real team ID
        if (subscriptionId) {
          try {
            await stripeClient.subscriptions.update(subscriptionId, {
              metadata: { userId, teamId: existingProfile.current_team_id, plan },
            })
          } catch {}
        }
        if (customerId) {
          try {
            await stripeClient.customers.update(customerId, {
              metadata: { userId, teamId: existingProfile.current_team_id, plan },
            })
          } catch {}
        }
      }

      return NextResponse.json({
        success: true,
        teamId: existingProfile.current_team_id,
        alreadyProvisioned: true,
        flow: 'existing',
      })
    }

    // ─── 6. RESOLVE TEAM (shared utility handles domain match + create) ──
    // ensureTeamForUser handles: team_members lookup → profiles → domain match → create
    // It also guarantees both team_members and profiles.current_team_id are consistent
    const teamResult = await ensureTeamForUser(userId, {
      companyName,
      joiningTeamId: joiningTeamId || null,
    })

    const teamId = teamResult.teamId
    const flow: 'joined' | 'created' = teamResult.flow === 'created' ? 'created' : 'joined'

    // ─── 6b. SET STRIPE BILLING FIELDS ON TEAM ─────────────────────────
    // The shared utility doesn't know about Stripe, so we update billing fields here
    if (customerId || subscriptionId) {
      const stripeFields: Record<string, any> = {}
      if (customerId) stripeFields.stripe_customer_id = customerId
      if (subscriptionId) stripeFields.stripe_subscription_id = subscriptionId
      stripeFields.subscription_plan = plan
      stripeFields.subscription_status = 'trialing'

      const sub = typeof checkoutSession.subscription === 'object'
        ? checkoutSession.subscription
        : null
      if (sub?.trial_end) {
        stripeFields.trial_ends_at = new Date(sub.trial_end * 1000).toISOString()
      }

      await supabaseAdmin
        .from('teams')
        .update(stripeFields)
        .eq('id', teamId)
    }

    // ─── 7. UPSERT PROFILE ─────────────────────────────────────────────
    const profileRole = flow === 'created' ? 'admin' : 'user'

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: fullName,
        display_name: fullName,
        email: userEmail,
        role: profileRole,
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
          display_name: fullName,
          email: userEmail,
          role: profileRole,
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

// Production uses display_name (confirmed by schema audit)
async function detectNameColumn(): Promise<string> {
  return 'display_name'
}
