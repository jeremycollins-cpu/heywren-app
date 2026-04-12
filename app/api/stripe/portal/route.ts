export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

function getAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdmin()

    // Find user's organization and verify admin role
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single()

    if (!membership || !['org_admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Only org admins can access billing' }, { status: 403 })
    }

    // Get organization's Stripe customer
    const { data: org } = await admin
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', membership.organization_id)
      .single()

    // Fall back to team-level customer if org doesn't have one
    let customerId = org?.stripe_customer_id
    if (!customerId) {
      const { data: team } = await admin
        .from('teams')
        .select('stripe_customer_id')
        .eq('organization_id', membership.organization_id)
        .not('stripe_customer_id', 'is', null)
        .limit(1)
        .single()
      customerId = team?.stripe_customer_id
    }

    if (!customerId) {
      return NextResponse.json({ error: 'No billing information found' }, { status: 404 })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe portal error:', error)
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
  }
}
