import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'

// Use service role to bypass RLS — this is a server-only route
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getAdminClient()
  try {
    const { sessionId, email, companyName } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session ID' }, { status: 400 })
    }

    // Verify the Stripe checkout session is real and paid
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
    if (!checkoutSession || checkoutSession.status !== 'complete') {
      return NextResponse.json({ error: 'Invalid or incomplete checkout session' }, { status: 400 })
    }

    // Only trust userId from Stripe metadata — never from the request body
    const resolvedUserId = checkoutSession.metadata?.userId
    const resolvedPlan = checkoutSession.metadata?.plan || 'basic'

    if (!resolvedUserId || resolvedUserId === 'pending') {
      return NextResponse.json({ error: 'Checkout session missing user information. Please retry signup.' }, { status: 400 })
    }

    // Check if user already has a team
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id')
      .eq('id', resolvedUserId)
      .single()

    if (existingProfile?.current_team_id) {
      return NextResponse.json({
        success: true,
        teamId: existingProfile.current_team_id,
        alreadyExists: true,
      })
    }

    // Create full org hierarchy (org → dept → team) using shared utility
    let teamResult
    try {
      teamResult = await ensureTeamForUser(resolvedUserId, {
        companyName: companyName || 'My Team',
      })
    } catch (err: any) {
      console.error('Team creation error:', err)
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
    }

    const newTeamId = teamResult.teamId

    // Update org with Stripe billing info
    if (teamResult.organizationId) {
      const orgBilling: Record<string, any> = {}
      const sub = typeof checkoutSession.subscription === 'object' ? checkoutSession.subscription : null
      if (checkoutSession.customer) {
        const custId = typeof checkoutSession.customer === 'string' ? checkoutSession.customer : checkoutSession.customer?.id
        if (custId) orgBilling.stripe_customer_id = custId
      }
      if (checkoutSession.subscription) {
        const subId = typeof checkoutSession.subscription === 'string' ? checkoutSession.subscription : (checkoutSession.subscription as any)?.id
        if (subId) orgBilling.stripe_subscription_id = subId
      }
      orgBilling.subscription_plan = resolvedPlan
      orgBilling.subscription_status = 'trialing'
      if (sub?.trial_end) {
        orgBilling.trial_ends_at = new Date((sub as any).trial_end * 1000).toISOString()
      }
      await supabaseAdmin.from('organizations').update(orgBilling).eq('id', teamResult.organizationId)
      // Keep team in sync
      await supabaseAdmin.from('teams').update(orgBilling).eq('id', newTeamId)
    }

    // Upsert profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: resolvedUserId,
        email: email || '',
        display_name: companyName ? `${companyName} Admin` : 'User',
        role: 'super_admin',
        current_team_id: newTeamId,
        organization_id: teamResult.organizationId,
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('Profile upsert error:', profileError)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      teamId: newTeamId,
    })
  } catch (error: any) {
    console.error('Setup account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to set up account' },
      { status: 500 }
    )
  }
}
