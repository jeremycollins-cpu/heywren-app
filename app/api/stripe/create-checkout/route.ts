import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

interface CheckoutRequest {
  plan: 'basic' | 'pro' | 'team'
  teamId: string
}

const PRICE_IDS = {
  basic: process.env.STRIPE_BASIC_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
}

export async function POST(request: NextRequest) {
  try {
    const { plan, teamId } = (await request.json()) as CheckoutRequest

    if (!plan || !teamId) {
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
        { error: 'Price ID not configured' },
        { status: 500 }
      )
    }

    // Get current user
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get team to check if it already has a customer
    const { data: team } = await supabase
      .from('teams')
      .select('stripe_customer_id')
      .eq('id', teamId)
      .single()

    let customerId = team?.stripe_customer_id

    // Create or get Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: {
          teamId,
          userId: userData.user.id,
        },
      })
      customerId = customer.id

      // Update team with customer ID
      await supabase
        .from('teams')
        .update({ stripe_customer_id: customerId })
        .eq('id', teamId)
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
          teamId,
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/signup/plan`,
    })

    return NextResponse.json({ sessionId: session.id })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
