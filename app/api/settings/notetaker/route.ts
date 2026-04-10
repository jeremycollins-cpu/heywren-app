export const dynamic = 'force-dynamic'

// app/api/settings/notetaker/route.ts
// GET/PUT notetaker settings for the current team.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getTeamId(userId: string, supabase: any): Promise<string | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', userId)
    .single()
  return profile?.current_team_id || null
}

export async function GET() {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()
    const teamId = await getTeamId(user.id, supabase)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const { data: settings } = await supabase
      .from('notetaker_settings')
      .select('*')
      .eq('team_id', teamId)
      .single()

    // Return defaults if no settings row yet
    return NextResponse.json({
      settings: settings || {
        auto_record_enabled: false,
        min_attendees: 3,
        bot_display_name: 'HeyWren Notetaker',
        notetaker_plan: 'free',
        free_meetings_limit: 2,
        meetings_recorded_this_month: 0,
      },
    })
  } catch (error) {
    console.error('Notetaker settings GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getAdminClient()
    const teamId = await getTeamId(user.id, supabase)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const body = await req.json()
    const {
      auto_record_enabled,
      min_attendees,
      bot_display_name,
    } = body

    // Validate min_attendees
    if (min_attendees !== undefined && (typeof min_attendees !== 'number' || min_attendees < 2)) {
      return NextResponse.json({ error: 'min_attendees must be at least 2' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (auto_record_enabled !== undefined) updates.auto_record_enabled = auto_record_enabled
    if (min_attendees !== undefined) updates.min_attendees = min_attendees
    if (bot_display_name !== undefined) updates.bot_display_name = bot_display_name

    // Upsert settings
    const { data: settings, error: upsertError } = await supabase
      .from('notetaker_settings')
      .upsert(
        {
          team_id: teamId,
          user_id: user.id,
          ...updates,
        },
        { onConflict: 'team_id' }
      )
      .select('*')
      .single()

    if (upsertError) {
      console.error('Notetaker settings upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    return NextResponse.json({ settings })
  } catch (error) {
    console.error('Notetaker settings PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
