// app/(dashboard)/api/email-threats/route.ts
// GET: List email threat alerts for the current user
// PATCH: Update alert status (confirm, mark safe, report, dismiss)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

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

    const [activeRes, resolvedRes] = await Promise.all([
      admin.from('email_threat_alerts')
        .select('*')
        .eq('team_id', profile.current_team_id)
        .eq('user_id', userData.user.id)
        .eq('status', 'unreviewed')
        .order('created_at', { ascending: false })
        .limit(20),
      admin.from('email_threat_alerts')
        .select('*')
        .eq('team_id', profile.current_team_id)
        .eq('user_id', userData.user.id)
        .neq('status', 'unreviewed')
        .order('updated_at', { ascending: false })
        .limit(10),
    ])

    const active = activeRes.data || []
    const resolved = resolvedRes.data || []

    const stats = {
      unreviewed: active.length,
      critical: active.filter(a => a.threat_level === 'critical').length,
      confirmed: resolved.filter(a => a.status === 'confirmed_threat').length,
      falsePositives: resolved.filter(a => a.status === 'safe').length,
    }

    return NextResponse.json({ alerts: active, resolved, stats })
  } catch (err) {
    console.error('Email threats GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { alertId, action, feedback } = await request.json()
    if (!alertId || !['confirmed_threat', 'safe', 'reported', 'dismissed'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const admin = getAdminClient()
    const { error } = await admin
      .from('email_threat_alerts')
      .update({
        status: action,
        user_feedback: feedback || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', alertId)
      .eq('user_id', userData.user.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email threats PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
