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

/**
 * Resolve the organization for a Stripe event.
 * Checks metadata.organizationId first, then falls back to teamId → org lookup.
 */
async function resolveOrgFromStripe(
  supabase: ReturnType<typeof getAdminClient>,
  metadata: Record<string, string>,
  customerId?: string
): Promise<{ orgId: string; teamId: string | null } | null> {
  // Prefer organizationId in metadata (new flow)
  if (metadata?.organizationId) {
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('organization_id', metadata.organizationId)
      .limit(1)
      .single()
    return { orgId: metadata.organizationId, teamId: team?.id || metadata?.teamId || null }
  }

  // Fall back to teamId → org lookup (legacy flow)
  if (metadata?.teamId) {
    const { data: team } = await supabase
      .from('teams')
      .select('organization_id')
      .eq('id', metadata.teamId)
      .single()
    if (team?.organization_id) {
      return { orgId: team.organization_id, teamId: metadata.teamId }
    }
    // Team has no org — return teamId for legacy compat
    return { orgId: metadata.teamId, teamId: metadata.teamId }
  }

  // Fall back to customerId → org lookup
  if (customerId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .limit(1)
      .single()
    if (org) {
      const { data: team } = await supabase
        .from('teams')
        .select('id')
        .eq('organization_id', org.id)
        .limit(1)
        .single()
      return { orgId: org.id, teamId: team?.id || null }
    }

    // Legacy: check teams table
    const { data: team } = await supabase
      .from('teams')
      .select('id, organization_id')
      .eq('stripe_customer_id', customerId)
      .limit(1)
      .single()
    if (team) {
      return { orgId: team.organization_id || team.id, teamId: team.id }
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient()
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
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any
        const resolved = await resolveOrgFromStripe(supabase, subscription.metadata, subscription.customer)

        if (resolved) {
          const plan = subscription.metadata?.plan
            || subscription.items.data[0]?.price?.lookup_key
            || 'pro'
          const status = subscription.status
          const trialEnd = subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null

          const billingUpdate = {
            stripe_subscription_id: subscription.id,
            subscription_plan: plan,
            subscription_status: status,
            trial_ends_at: trialEnd,
          }

          // Update organization (source of truth)
          await supabase
            .from('organizations')
            .update(billingUpdate)
            .eq('id', resolved.orgId)

          // Keep team in sync (backward compat)
          if (resolved.teamId) {
            await supabase
              .from('teams')
              .update(billingUpdate)
              .eq('id', resolved.teamId)
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any
        const resolved = await resolveOrgFromStripe(supabase, subscription.metadata, subscription.customer)

        if (resolved) {
          const cancelUpdate = {
            stripe_subscription_id: null,
            subscription_plan: 'trial',
            subscription_status: 'cancelled',
          }

          await supabase.from('organizations').update(cancelUpdate).eq('id', resolved.orgId)
          if (resolved.teamId) {
            await supabase.from('teams').update(cancelUpdate).eq('id', resolved.teamId)
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const resolved = await resolveOrgFromStripe(supabase, {}, invoice.customer)

        if (resolved) {
          await supabase.from('organizations').update({ subscription_status: 'past_due' }).eq('id', resolved.orgId)
          if (resolved.teamId) {
            await supabase.from('teams').update({ subscription_status: 'past_due' }).eq('id', resolved.teamId)
          }
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any
        const resolved = await resolveOrgFromStripe(supabase, {}, invoice.customer)

        if (resolved) {
          await supabase.from('organizations').update({ subscription_status: 'active' }).eq('id', resolved.orgId)
          if (resolved.teamId) {
            await supabase.from('teams').update({ subscription_status: 'active' }).eq('id', resolved.teamId)
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
