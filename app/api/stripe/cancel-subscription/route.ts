import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

function getAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(request: NextRequest) {
  const admin = getAdmin()
  try {
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { cancelImmediately } = await request.json()

    // Auth
    const { createClient: createSessionClient } = await import('@/lib/supabase/server')
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify org admin
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single()

    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can cancel subscriptions' }, { status: 403 })
    }

    const orgId = membership.organization_id

    // Get organization's subscription
    const { data: org } = await admin
      .from('organizations')
      .select('stripe_subscription_id')
      .eq('id', orgId)
      .single()

    // Fall back to team subscription
    let subId = org?.stripe_subscription_id
    if (!subId) {
      const { data: team } = await admin
        .from('teams')
        .select('stripe_subscription_id')
        .eq('organization_id', orgId)
        .not('stripe_subscription_id', 'is', null)
        .limit(1)
        .single()
      subId = team?.stripe_subscription_id
    }

    if (!subId) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (cancelImmediately) {
      await stripe.subscriptions.cancel(subId)

      const cancelUpdate = {
        subscription_status: 'cancelled',
        subscription_plan: 'trial',
        stripe_subscription_id: null,
      }
      await admin.from('organizations').update(cancelUpdate).eq('id', orgId)
      await admin.from('teams').update(cancelUpdate).eq('organization_id', orgId)
    } else {
      await stripe.subscriptions.update(subId, { cancel_at_period_end: true })

      await admin.from('organizations').update({ subscription_status: 'cancelling' }).eq('id', orgId)
      await admin.from('teams').update({ subscription_status: 'cancelling' }).eq('organization_id', orgId)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Cancel subscription error:', error)
    return NextResponse.json({ error: error.message || 'Failed to cancel' }, { status: 500 })
  }
}
