// app/(dashboard)/api/expenses/route.ts
// GET   — return the user's expense emails grouped by vendor
// POST  — trigger an on-demand scan of recent emails for receipts
// PATCH — update status (mark as reviewed / exported / dismissed)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTeamId } from '@/lib/team/resolve-team'
import { inngest } from '@/inngest/client'

interface ExpenseRow {
  id: string
  message_id: string
  outlook_message_id: string | null
  from_name: string | null
  from_email: string
  subject: string | null
  body_preview: string | null
  received_at: string
  web_link: string | null
  vendor: string
  vendor_domain: string
  amount: number | null
  currency: string | null
  receipt_date: string | null
  category: string
  confidence: number
  status: string
  has_attachments: boolean
  attachment_count: number
}

interface VendorGroup {
  vendor: string
  vendorDomain: string
  totalAmount: number
  currency: string | null
  count: number
  latestReceiptAt: string
  expenses: ExpenseRow[]
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Filter by user_id alone — expenses are personal, RLS already restricts
    // visibility to the row owner, and adding team_id here would silently hide
    // rows whose team_id was set from the integration row when that drifts
    // from profiles.current_team_id (legacy accounts, post team-switch state).
    const { data: expenses, error } = await supabase
      .from('expense_emails')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'dismissed')
      .order('received_at', { ascending: false })
      .limit(500)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Group by vendor_domain (canonical key) but display the most common
    // vendor name within the group. We don't normalize across domains because
    // "Stripe" and "Stripe Atlas" are legitimately distinct billing relationships.
    const groups = new Map<string, VendorGroup>()

    for (const row of (expenses || []) as ExpenseRow[]) {
      const key = row.vendor_domain || 'unknown'
      let group = groups.get(key)
      if (!group) {
        group = {
          vendor: row.vendor,
          vendorDomain: key,
          totalAmount: 0,
          currency: row.currency,
          count: 0,
          latestReceiptAt: row.received_at,
          expenses: [],
        }
        groups.set(key, group)
      }
      group.expenses.push(row)
      group.count++
      if (row.amount && (!group.currency || group.currency === row.currency)) {
        group.totalAmount += Number(row.amount)
      }
      if (new Date(row.received_at) > new Date(group.latestReceiptAt)) {
        group.latestReceiptAt = row.received_at
        // Use the vendor name from the most recent email — vendors sometimes
        // change their display name (e.g. "Twitter" → "X").
        group.vendor = row.vendor
      }
    }

    // Sort groups: most recent first
    const sortedGroups = Array.from(groups.values()).sort(
      (a, b) => new Date(b.latestReceiptAt).getTime() - new Date(a.latestReceiptAt).getTime()
    )

    // Last scan timestamp for the "Last scanned" footer
    const { data: lastRun } = await supabase
      .from('job_runs')
      .select('finished_at')
      .eq('job_name', 'scan-expenses')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      groups: sortedGroups,
      totalCount: expenses?.length || 0,
      lastRefreshedAt: lastRun?.finished_at || null,
    })
  } catch (err) {
    console.error('[api/expenses] GET error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    await inngest.send({
      name: 'app/scan-expenses.requested',
      data: { teamId, userId: user.id },
    })

    return NextResponse.json({ success: true, message: 'Expense scan triggered' })
  } catch (err) {
    console.error('[api/expenses] POST error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { id, status, ids } = body as { id?: string; status: string; ids?: string[] }

    const validStatuses = ['pending', 'reviewed', 'exported', 'dismissed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const targetIds = ids?.length ? ids : id ? [id] : []
    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'No id provided' }, { status: 400 })
    }

    const { error } = await supabase
      .from('expense_emails')
      .update({ status })
      .in('id', targetIds)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, updated: targetIds.length })
  } catch (err) {
    console.error('[api/expenses] PATCH error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
