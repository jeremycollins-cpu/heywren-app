import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

interface CheckoutRequest {
  plan: 'basic' | 'pro' | 'team'
  email?: string
  userId?: string
}

const PRICE_IDS = {
  basic: process.env.STRIPE_BASIC_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CheckoutRequest
    const { plan } = body

    if (!plan || !['basic', 'pro', 'team'].includes(plan)) {
      return NextResponse.json(
        { error: 'Invalid or missing plan' },
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

    // Try server-side auth first
    let userEmail: string | undefined
    let userId: string | undefined
    let teamId: string | undefined
    let customerId: string | undefined

    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()

    if (userData?.user) {
      // User is fully authenticated
      userEmail = userData.user.email || undefined
      userId = userData.user.id

      // Check for existing team/customer
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
    } else {
      // Not authenticated yet (signup flow before email confirmation)
      // Use client-provided email as fallback
      userEmail = body.email || undefined
      userId = body.userId || undefined
    }

    // Create Stripe customer if needed
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail || undefined,
        metadata: {
          userId: userId || 'pending',
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
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      discounts: [
        { coupon: process.env.STRIPE_EARLY_ACCESS_COUPON_ID || 'r6pxCjPz' },
      ],
      subscription_data: {
        metadata: {
          userId: userId || 'pending',
          teamId: teamId || 'pending',
          plan,
        },
      },
      metadata: {
        userId: userId || 'pending',
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
