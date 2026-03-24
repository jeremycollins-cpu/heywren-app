// app/api/stripe/create-checkout/route.ts
// Creates Stripe checkout session v2
// Key change: no longer requires a teamId (team is created AFTER payment in provisioning)
// Passes userId, plan, joiningTeamId, email, and companyName in Stripe metadata

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

interface CheckoutRequest {
  plan: 'basic' | 'pro' | 'team'
  joiningTeamId?: string | null
}

const PRICE_IDS: Record<string, string> = {
  basic: process.env.STRIPE_BASIC_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
}

export async function POST(request: NextRequest) {
  try {
    // Origin validation to prevent CSRF
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { plan, joiningTeamId } = (await request.json()) as CheckoutRequest

    if (!plan || !['basic', 'pro', 'team'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const priceId = PRICE_IDS[plan]
    if (!priceId) {
      return NextResponse.json({ error: 'Price ID not configured for this plan' }, { status: 500 })
    }

    // Get current user from session
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userId = userData.user.id
    const userEmail = userData.user.email || ''
    const fullName = userData.user.user_metadata?.full_name || ''
    const companyName = userData.user.user_metadata?.company_name || ''

    // Create a Stripe customer for this user (not team — team doesn't exist yet for new signups)
    const customer = await stripe.customers.create({
      email: userEmail,
      name: fullName,
      metadata: {
        userId,
        supabaseUserId: userId,
      },
    })

    // Build metadata — this is what provision-account reads after payment
    const metadata: Record<string, string> = {
      userId,
      plan,
      email: userEmail,
      fullName,
      companyName,
    }

    // If joining an existing team, include that info
    if (joiningTeamId) {
      metadata.joiningTeamId = joiningTeamId
    }

    // Create checkout session with 14-day trial
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      metadata,
      subscription_data: {
        trial_period_days: 14,
        metadata,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/callback?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/signup/plan`,
      allow_promotion_codes: true,
    })

    return NextResponse.json({ sessionId: session.id })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
