export const dynamic = 'force-dynamic'

// app/api/stripe/create-checkout/route.ts
// Creates Stripe checkout session v2
// Key change: no longer requires a teamId (team is created AFTER payment in provisioning)
// Passes userId, plan, joiningTeamId, email, and companyName in Stripe metadata

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

interface CheckoutRequest {
  plan: 'pro' | 'team'
  billingInterval?: 'monthly' | 'annual'
  joiningTeamId?: string | null
  promoCode?: string
}

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRO_PRICE_ID!,
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || undefined,
  },
  team: {
    monthly: process.env.STRIPE_TEAM_PRICE_ID!,
    annual: process.env.STRIPE_TEAM_ANNUAL_PRICE_ID || undefined,
  },
}

export async function POST(request: NextRequest) {
  try {
    // Origin validation to prevent CSRF
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { plan, billingInterval = 'monthly', joiningTeamId, promoCode } = (await request.json()) as CheckoutRequest

    if (!plan || !['pro', 'team'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    if (!['monthly', 'annual'].includes(billingInterval)) {
      return NextResponse.json({ error: 'Invalid billing interval' }, { status: 400 })
    }

    // Fall back to monthly if annual price isn't configured yet
    const priceId = PRICE_IDS[plan]?.[billingInterval] || PRICE_IDS[plan]?.monthly
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
      billingInterval,
      email: userEmail,
      fullName,
      companyName,
    }

    // If joining an existing team, include that info
    if (joiningTeamId) {
      metadata.joiningTeamId = joiningTeamId
    }

    // Resolve promo code if provided from the billing page
    let discounts: Array<{ promotion_code: string }> | undefined
    if (promoCode && typeof promoCode === 'string') {
      const promoCodes = await stripe.promotionCodes.list({
        code: promoCode.trim().toUpperCase(),
        active: true,
        limit: 1,
      })
      if (promoCodes.data.length > 0 && promoCodes.data[0].coupon.valid) {
        discounts = [{ promotion_code: promoCodes.data[0].id }]
      }
    }

    // Create checkout session with 14-day trial
    // Note: allow_promotion_codes and discounts are mutually exclusive in Stripe
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
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
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
