export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

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
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  // Get or create preferences
  const { data: prefs, error } = await supabase
    .from('email_preferences')
    .select('*')
    .eq('user_id', user.id)
    .eq('team_id', profile.current_team_id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return defaults if no preferences exist yet
  if (!prefs) {
    return NextResponse.json({
      preferences: {
        vip_contacts: [],
        blocked_senders: [],
        min_urgency: 'low',
        scan_window_days: 7,
        enabled_categories: ['question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'],
        auto_dismiss_days: 0,
        include_in_digest: true,
        priority_folders: [],
        excluded_folders: [],
      },
    })
  }

  return NextResponse.json({ preferences: prefs })
}

export async function PUT(req: Request) {
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
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const body = await req.json()
  const {
    vip_contacts,
    blocked_senders,
    min_urgency,
    scan_window_days,
    enabled_categories,
    auto_dismiss_days,
    include_in_digest,
    priority_folders,
    excluded_folders,
  } = body

  const { error } = await getAdmin()
    .from('email_preferences')
    .upsert({
      team_id: profile.current_team_id,
      user_id: user.id,
      vip_contacts: vip_contacts || [],
      blocked_senders: blocked_senders || [],
      min_urgency: min_urgency || 'low',
      scan_window_days: scan_window_days || 7,
      enabled_categories: enabled_categories
        ? (enabled_categories.includes('recipient_gap') ? enabled_categories : [...enabled_categories, 'recipient_gap'])
        : ['question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'],
      auto_dismiss_days: auto_dismiss_days || 0,
      include_in_digest: include_in_digest ?? true,
      priority_folders: priority_folders || [],
      excluded_folders: excluded_folders || [],
    }, { onConflict: 'team_id,user_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
