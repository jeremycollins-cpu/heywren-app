import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
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

  if (!profile?.current_team_id) {
    return NextResponse.json({ lastSync: null })
  }

  const teamId = profile.current_team_id

  // Query the most recent activity timestamp across data sources
  const [slackResult, outlookResult, commitmentsResult] = await Promise.all([
    supabase
      .from('slack_messages')
      .select('created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('outlook_messages')
      .select('created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('commitments')
      .select('updated_at')
      .eq('team_id', teamId)
      .order('updated_at', { ascending: false })
      .limit(1),
  ])

  const timestamps = [
    slackResult.data?.[0]?.created_at,
    outlookResult.data?.[0]?.created_at,
    commitmentsResult.data?.[0]?.updated_at,
  ].filter(Boolean).map(t => new Date(t).getTime())

  const lastSync = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null

  return NextResponse.json({ lastSync })
}
