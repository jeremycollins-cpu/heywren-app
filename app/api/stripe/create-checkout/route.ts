import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

interface CheckoutRequest {
  plan: 'basic' | 'pro' | 'team'
}

const PRICE_IDS = {
  basic: process.env.STRIPE_BASIC_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
}

export async function POST(request: NextRequest) {
  try {
    const { plan } = (await request.json()) as CheckoutRequest

    if (!plan) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (plan !== 'basic' && plan !== 'pro' && plan !== 'team') {
      return NextResponse.json(
        { error: 'Invalid plan' },
        { status: 400 }
      )
    }

    const priceId = PRICE_IDS[plan]
    if (!priceId) {
      return NextResponse.json(
        { error: 'Price ID not configured for this plan' },
        { status: 500 }
      )
    }

    // Get current user
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign up first.' },
        { status: 401 }
      )
    }

    const userEmail = userData.user.email
    const userId = userData.user.id

    // Check if user already has a team with a Stripe customer
    let customerId: string | undefined
    let teamId: string | undefined

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    if (profile?.current_team_id) {
      teamId = profile.current_team_id
      const { data: team } = await supabase
        .from('teams')
        .select('stripe_customer_id')
        .eq('id', teamId)
        .single()

      customerId = team?.stripe_customer_id || undefined
    }

    // Create Stripe customer if needed
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail || undefined,
        metadata: {
          userId,
          teamId: teamId || 'pending',
          plan,
        },
      })
      customerId = customer.id

      // Update team with customer ID if team exists
      if (teamId) {
        await supabase
          .from('teams')
          .update({ stripe_customer_id: customerId })
          .eq('id', teamId)
      }
    }

    // Create checkout session — auto-apply early access coupon
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      discounts: [
        {
          coupon: process.env.STRIPE_EARLY_ACCESS_COUPON_ID || 'r6pxCjPz',
        },
      ],
      subscription_data: {
        metadata: {
          userId,
          teamId: teamId || 'pending',
          plan,
        },
      },
      metadata: {
        userId,
        teamId: teamId || 'pending',
        plan,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/signup/plan`,
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
