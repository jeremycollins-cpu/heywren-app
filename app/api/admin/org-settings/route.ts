import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkSuperAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return false

  const adminDb = getAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  return profile?.role === 'super_admin'
}

// GET — list every org with its Slack-alerts kill-switch state
export async function GET() {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const adminDb = getAdminClient()
  const { data, error } = await adminDb
    .from('organizations')
    .select('id, name, disable_slack_alerts')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    organizations: (data || []).map(o => ({
      id: o.id,
      name: o.name,
      disableSlackAlerts: o.disable_slack_alerts === true,
    })),
  })
}

// PATCH — flip the kill switch for a single org
export async function PATCH(request: NextRequest) {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { organizationId, disableSlackAlerts } = body as {
    organizationId?: string
    disableSlackAlerts?: boolean
  }

  if (!organizationId || typeof organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
  }
  if (typeof disableSlackAlerts !== 'boolean') {
    return NextResponse.json({ error: 'disableSlackAlerts must be a boolean' }, { status: 400 })
  }

  const adminDb = getAdminClient()
  const { error } = await adminDb
    .from('organizations')
    .update({ disable_slack_alerts: disableSlackAlerts })
    .eq('id', organizationId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, organizationId, disableSlackAlerts })
}

export const dynamic = 'force-dynamic'
