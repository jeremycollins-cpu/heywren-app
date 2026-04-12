export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function getStripe() {
  const Stripe = (await import('stripe')).default
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any })
}

async function verifySuperAdmin(admin: ReturnType<typeof getAdmin>): Promise<string | null> {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return null
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).single()
    if (!profile || !['admin', 'super_admin'].includes(profile.role)) return null
    return userData.user.id
  } catch { return null }
}

/**
 * GET /api/admin/subscriptions
 * Returns all organizations with billing + Stripe revenue data.
 */
export async function GET() {
  try {
    const admin = getAdmin()
    const callerId = await verifySuperAdmin(admin)
    if (!callerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Get all organizations
    const { data: orgs } = await admin
      .from('organizations')
      .select('id, name, domain, billing_type, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, trial_ends_at, max_users, created_at')
      .order('created_at', { ascending: false })

    // Member counts
    const { data: members } = await admin.from('organization_members').select('organization_id')
    const memberCounts: Record<string, number> = {}
    for (const m of members || []) {
      if (m.organization_id) memberCounts[m.organization_id] = (memberCounts[m.organization_id] || 0) + 1
    }

    // Pull Stripe data for revenue metrics
    let stripeInvoices: any[] = []
    let stripeSubscriptions: any[] = []
    let mrr = 0
    let totalRevenue = 0

    try {
      const stripe = await getStripe()

      // Get active subscriptions for MRR
      const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 })
      stripeSubscriptions = subs.data

      // Calculate MRR from active subscriptions
      for (const sub of subs.data) {
        const item = sub.items.data[0]
        if (item?.price?.unit_amount && item?.quantity) {
          const monthlyAmount = item.price.recurring?.interval === 'year'
            ? (item.price.unit_amount * item.quantity) / 12
            : (item.price.unit_amount * item.quantity)
          mrr += monthlyAmount
        }
      }

      // Get recent invoices
      const invoices = await stripe.invoices.list({
        limit: 20,
        status: 'paid',
      })
      stripeInvoices = invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        customer: inv.customer,
        customerEmail: inv.customer_email,
        amount: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        pdfUrl: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
      }))

      // Total revenue from paid invoices
      totalRevenue = invoices.data.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0)

      // Also get failed/open invoices
      const openInvoices = await stripe.invoices.list({ limit: 10, status: 'open' })
      for (const inv of openInvoices.data) {
        stripeInvoices.push({
          id: inv.id,
          number: inv.number,
          customer: inv.customer,
          customerEmail: inv.customer_email,
          amount: inv.amount_due,
          currency: inv.currency,
          status: 'open',
          created: inv.created,
          pdfUrl: inv.invoice_pdf,
          hostedUrl: inv.hosted_invoice_url,
        })
      }

      // Sort by date descending
      stripeInvoices.sort((a, b) => b.created - a.created)
    } catch (stripeErr) {
      console.error('Stripe data fetch failed (non-fatal):', stripeErr)
    }

    // Map Stripe customers to orgs
    const customerToOrg = new Map<string, string>()
    for (const org of orgs || []) {
      if (org.stripe_customer_id) customerToOrg.set(org.stripe_customer_id, org.name)
    }

    // Enrich invoices with org names
    const enrichedInvoices = stripeInvoices.map(inv => ({
      ...inv,
      organizationName: customerToOrg.get(inv.customer as string) || inv.customerEmail || 'Unknown',
    }))

    // Enrich orgs
    const enriched = (orgs || []).map(org => {
      const sub = stripeSubscriptions.find(s =>
        s.id === org.stripe_subscription_id ||
        (typeof s.customer === 'string' ? s.customer : s.customer?.id) === org.stripe_customer_id
      )
      let monthlyRevenue = 0
      if (sub?.items?.data?.[0]) {
        const item = sub.items.data[0]
        if (item.price?.unit_amount && item.quantity) {
          monthlyRevenue = item.price.recurring?.interval === 'year'
            ? (item.price.unit_amount * item.quantity) / 12
            : (item.price.unit_amount * item.quantity)
        }
      }

      return {
        ...org,
        memberCount: memberCounts[org.id] || 0,
        trialExpired: org.trial_ends_at ? new Date(org.trial_ends_at) < new Date() : false,
        monthlyRevenue,
        seatCount: sub?.items?.data?.[0]?.quantity || 0,
        currentPeriodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      }
    })

    return NextResponse.json({
      organizations: enriched,
      revenue: {
        mrr: mrr / 100, // Convert cents to dollars
        arr: (mrr * 12) / 100,
        totalRevenue: totalRevenue / 100,
        activeSubscriptions: stripeSubscriptions.length,
      },
      invoices: enrichedInvoices,
    })
  } catch (err) {
    console.error('Admin subscriptions GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/subscriptions
 * Update an organization's billing settings.
 */
export async function PATCH(request: NextRequest) {
  try {
    const admin = getAdmin()
    const callerId = await verifySuperAdmin(admin)
    if (!callerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: profile } = await admin.from('profiles').select('role').eq('id', callerId).single()
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { organizationId, billingType, plan, status, maxUsers } = body

    if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 })

    const updates: Record<string, any> = {}
    if (billingType) updates.billing_type = billingType
    if (plan) updates.subscription_plan = plan
    if (status) updates.subscription_status = status
    if (maxUsers) updates.max_users = maxUsers

    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

    const { error } = await admin.from('organizations').update(updates).eq('id', organizationId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Keep teams in sync
    const teamUpdates: Record<string, any> = {}
    if (plan) teamUpdates.subscription_plan = plan
    if (status) teamUpdates.subscription_status = status
    if (maxUsers) teamUpdates.max_users = maxUsers
    if (Object.keys(teamUpdates).length > 0) {
      await admin.from('teams').update(teamUpdates).eq('organization_id', organizationId)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin subscriptions PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
