import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET: Fetch Slack notification settings for the team
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdmin()

  // Verify admin role
  const { data: member } = await admin
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!member || !['admin', 'super_admin', 'owner'].includes(member.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Get Slack integration config
  const { data: integration } = await admin
    .from('integrations')
    .select('id, config, access_token')
    .eq('team_id', member.team_id)
    .eq('provider', 'slack')
    .limit(1)
    .single()

  if (!integration) {
    return NextResponse.json({ error: 'No Slack integration found' }, { status: 404 })
  }

  const config = (integration.config as Record<string, unknown>) || {}

  return NextResponse.json({
    daily_digest_enabled: config.daily_digest_enabled !== false, // default true
    nudges_enabled: config.nudges_enabled !== false, // default true
    digest_channel: config.digest_channel || null,
  })
}

// PATCH: Update Slack notification settings
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdmin()

  const { data: member } = await admin
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!member || !['admin', 'super_admin', 'owner'].includes(member.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('id, config')
    .eq('team_id', member.team_id)
    .eq('provider', 'slack')
    .limit(1)
    .single()

  if (!integration) {
    return NextResponse.json({ error: 'No Slack integration found' }, { status: 404 })
  }

  const body = await request.json()
  const config = (integration.config as Record<string, unknown>) || {}

  if (typeof body.daily_digest_enabled === 'boolean') {
    config.daily_digest_enabled = body.daily_digest_enabled
  }
  if (typeof body.nudges_enabled === 'boolean') {
    config.nudges_enabled = body.nudges_enabled
  }

  const { error } = await admin
    .from('integrations')
    .update({ config })
    .eq('id', integration.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE: Delete a specific Slack message by channel + timestamp
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdmin()

  const { data: member } = await admin
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!member || !['admin', 'super_admin', 'owner'].includes(member.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('access_token')
    .eq('team_id', member.team_id)
    .eq('provider', 'slack')
    .limit(1)
    .single()

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'No Slack token found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const channel = searchParams.get('channel')
  const ts = searchParams.get('ts')

  if (!channel || !ts) {
    return NextResponse.json({ error: 'channel and ts are required' }, { status: 400 })
  }

  const slack = new WebClient(integration.access_token)

  try {
    await slack.chat.delete({ channel, ts })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.data?.error || 'Failed to delete message' }, { status: 500 })
  }
}
