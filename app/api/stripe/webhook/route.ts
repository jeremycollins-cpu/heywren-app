import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { createClient } from '@supabase/supabase-js'

// Webhooks have no user session — must use service role
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getAdminClient()
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    const supabase = supabaseAdmin

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any
        const teamId = subscription.metadata?.teamId

        if (teamId) {
          // Resolve plan from metadata (set during checkout/change-plan),
          // then fall back to price lookup_key, then 'pro'
          const plan = subscription.metadata?.plan
            || subscription.items.data[0]?.price?.lookup_key
            || 'pro'
          const status = subscription.status

          await supabase
            .from('teams')
            .update({
              stripe_subscription_id: subscription.id,
              subscription_plan: plan,
              subscription_status: status,
              trial_ends_at:
                subscription.trial_end ?
                  new Date(subscription.trial_end * 1000).toISOString()
                  : null,
            })
            .eq('id', teamId)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any
        const teamId = subscription.metadata?.teamId

        if (teamId) {
          await supabase
            .from('teams')
            .update({
              stripe_subscription_id: null,
              subscription_plan: 'trial',
              subscription_status: 'cancelled',
            })
            .eq('id', teamId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const customerId = invoice.customer

        if (customerId) {
          // Update team subscription status to past_due
          await supabase
            .from('teams')
            .update({
              subscription_status: 'past_due',
            })
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any
        const customerId = invoice.customer

        if (customerId) {
          // Update team subscription status back to active
          const { data: team } = await supabase
            .from('teams')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (team) {
            await supabase
              .from('teams')
              .update({
                subscription_status: 'active',
              })
              .eq('id', team.id)
          }
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
