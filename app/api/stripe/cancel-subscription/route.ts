import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Origin validation
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { teamId, cancelImmediately } = await request.json()

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })
    }

    // Get user from session cookie to verify permissions
    const { createClient: createSessionClient } = await import('@/lib/supabase/server')
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is owner/admin of this team
    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userData.user.id)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Get team's Stripe subscription
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('id', teamId)
      .single()

    if (!team?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (cancelImmediately) {
      // Cancel immediately — subscription ends now
      await stripe.subscriptions.cancel(team.stripe_subscription_id)

      await supabaseAdmin
        .from('teams')
        .update({
          subscription_status: 'cancelled',
          subscription_plan: 'trial',
          stripe_subscription_id: null,
        })
        .eq('id', teamId)
    } else {
      // Cancel at period end — subscription stays active until billing period ends
      await stripe.subscriptions.update(team.stripe_subscription_id, {
        cancel_at_period_end: true,
      })

      await supabaseAdmin
        .from('teams')
        .update({
          subscription_status: 'cancelling',
        })
        .eq('id', teamId)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Cancel subscription error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cancel subscription' },
      { status: 500 }
    )
  }
}
