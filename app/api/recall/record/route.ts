export const dynamic = 'force-dynamic'

// app/api/recall/record/route.ts
// Manual bot dispatch — user clicks "Record this meeting" and provides a join link.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { meeting_url, meeting_title } = body

    if (!meeting_url || typeof meeting_url !== 'string') {
      return NextResponse.json({ error: 'meeting_url is required' }, { status: 400 })
    }

    // Validate it looks like a meeting URL
    const validDomains = ['zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'webex.com', 'zoomgov.com']
    const isValidUrl = validDomains.some((d) => meeting_url.toLowerCase().includes(d))
    if (!isValidUrl) {
      return NextResponse.json({ error: 'Please provide a valid Zoom, Google Meet, Teams, or Webex meeting link' }, { status: 400 })
    }

    const supabase = getAdminClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Dispatch the bot via Inngest
    await inngest.send({
      name: 'recall/bot.manual',
      data: {
        team_id: profile.current_team_id,
        user_id: user.id,
        meeting_url,
        meeting_title: meeting_title || 'Manual Recording',
      },
    })

    return NextResponse.json({
      success: true,
      message: 'HeyWren Notetaker is joining your meeting. It will appear as a participant shortly.',
    })
  } catch (error) {
    console.error('Manual record error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
