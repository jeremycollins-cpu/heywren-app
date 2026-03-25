import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    // Authenticate the user via session
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id

    // Parse the integration id from the request body
    const body = await request.json()
    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'Missing integration id' }, { status: 400 })
    }

    // Get team_id from profile (using admin client to bypass RLS)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    let teamId = profile?.current_team_id || null

    // Fallback: check team_members directly
    if (!teamId) {
      const { data: membership } = await supabaseAdmin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (membership?.team_id) {
        teamId = membership.team_id
      }
    }

    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    // Delete the integration scoped to both id and team_id
    const { error, count } = await supabaseAdmin
      .from('integrations')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('team_id', teamId)

    if (error) {
      console.error('Error deleting integration:', error)
      return NextResponse.json({ error: 'Failed to delete integration' }, { status: 500 })
    }

    if (count === 0) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Disconnect integration error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
