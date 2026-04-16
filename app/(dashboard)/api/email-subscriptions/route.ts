// app/(dashboard)/api/email-subscriptions/route.ts
// GET: List active email subscriptions for the current user
// POST: Execute one-click unsubscribe (RFC 8058) or mark as kept
// PATCH: Update subscription status

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const { data: subscriptions, error } = await admin
      .from('email_subscriptions')
      .select('*')
      .eq('team_id', profile.current_team_id)
      .eq('user_id', userData.user.id)
      .in('status', ['active', 'unsubscribed', 'kept', 'failed'])
      .order('email_count', { ascending: false })
      .order('received_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch subscriptions:', error)
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }

    // Split into active and handled
    const active = (subscriptions || []).filter(s => s.status === 'active')
    const handled = (subscriptions || []).filter(s => s.status !== 'active')

    // Stats
    const totalActive = active.length
    const unreadCount = active.filter(s => !s.is_read).length
    const oneClickCount = active.filter(s => s.has_one_click || s.unsubscribe_url).length

    return NextResponse.json({
      subscriptions: active,
      handled,
      stats: { totalActive, unreadCount, oneClickCount },
    })
  } catch (err) {
    console.error('Email subscriptions GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { subscriptionId, action } = body

    // On-demand scan trigger (no subscriptionId needed)
    if (action === 'scan') {
      await inngest.send({
        name: 'subscriptions/scan',
        data: { userId: userData.user.id },
      })
      return NextResponse.json({ success: true, scheduled: true })
    }

    if (!subscriptionId || !['unsubscribe', 'keep'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Verify ownership
    const { data: sub } = await admin
      .from('email_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('user_id', userData.user.id)
      .single()

    if (!sub) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (action === 'keep') {
      await admin
        .from('email_subscriptions')
        .update({ status: 'kept', updated_at: new Date().toISOString() })
        .eq('id', subscriptionId)

      return NextResponse.json({ success: true, status: 'kept' })
    }

    // ── Execute unsubscribe ──────────────────────────────────────────
    let unsubscribeSuccess = false
    let unsubscribeError: string | null = null

    // Strategy 1: RFC 8058 one-click (POST to URL with List-Unsubscribe=One-Click)
    if (sub.has_one_click && sub.unsubscribe_url) {
      try {
        const res = await fetch(sub.unsubscribe_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        })
        // 2xx or 3xx = success (some redirect to a confirmation page)
        unsubscribeSuccess = res.status < 400
        if (!unsubscribeSuccess) {
          unsubscribeError = `HTTP ${res.status}`
        }
      } catch (err) {
        unsubscribeError = (err as Error).message
      }
    }

    // Strategy 2: GET the unsubscribe URL (many services support this)
    if (!unsubscribeSuccess && sub.unsubscribe_url) {
      try {
        const res = await fetch(sub.unsubscribe_url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        })
        unsubscribeSuccess = res.status < 400
        if (!unsubscribeSuccess) {
          unsubscribeError = `HTTP ${res.status} on GET`
        }
      } catch (err) {
        unsubscribeError = (err as Error).message
      }
    }

    // Update status
    const newStatus = unsubscribeSuccess ? 'unsubscribed' : 'failed'
    await admin
      .from('email_subscriptions')
      .update({
        status: newStatus,
        unsubscribed_at: unsubscribeSuccess ? new Date().toISOString() : null,
        unsubscribe_error: unsubscribeError,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)

    return NextResponse.json({
      success: unsubscribeSuccess,
      status: newStatus,
      error: unsubscribeError,
    })
  } catch (err) {
    console.error('Email subscriptions POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
