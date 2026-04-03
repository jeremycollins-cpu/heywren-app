import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabase = await createSessionClient()
  const adminDb = getAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await adminDb
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const { data: integration } = await adminDb
    .from('integrations')
    .select('config')
    .eq('team_id', profile.current_team_id)
    .eq('provider', 'slack')
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    digest_channel: integration?.config?.digest_channel || null,
    digest_channel_name: integration?.config?.digest_channel_name || null,
    digest_enabled: integration?.config?.digest_enabled !== false, // default true
  })
}

export async function PUT(req: Request) {
  const supabase = await createSessionClient()
  const adminDb = getAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await adminDb
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const body = await req.json()
  const { digest_channel, digest_channel_name, digest_enabled } = body

  // Get the existing integration
  const { data: integration } = await adminDb
    .from('integrations')
    .select('id, config')
    .eq('team_id', profile.current_team_id)
    .eq('provider', 'slack')
    .limit(1)
    .maybeSingle()

  if (!integration) {
    return NextResponse.json({ error: 'No Slack integration found' }, { status: 404 })
  }

  // Merge new digest settings into existing config
  const updatedConfig = {
    ...(integration.config || {}),
    digest_channel: digest_channel || null,
    digest_channel_name: digest_channel_name || null,
    digest_enabled: digest_enabled !== false,
  }

  const { error } = await adminDb
    .from('integrations')
    .update({ config: updatedConfig })
    .eq('id', integration.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
