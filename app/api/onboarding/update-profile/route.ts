import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTeamForUser } from '@/lib/team/ensure-team'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Authenticate the user via session
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id
    const { fullName, jobTitle, companyName, teamSize } = await request.json()

    if (!fullName?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
    }

    // Detect which name column exists: production may use 'display_name' or 'full_name'
    const nameColumn = await detectNameColumn()

    // Try full update with all onboarding columns
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        [nameColumn]: fullName.trim(),
        job_title: jobTitle || null,
        company: companyName?.trim() || null,
        team_size: teamSize || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) {
      console.error('Profile update failed:', error)

      // If error is about missing columns (job_title etc.), fall back to name-only
      if (error.message?.includes('column') || error.code === '42703') {
        console.warn('Falling back to name-only update (migration 009 columns may be missing)')
        const { error: fallbackError } = await supabaseAdmin
          .from('profiles')
          .update({
            [nameColumn]: fullName.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (fallbackError) {
          return NextResponse.json(
            { error: 'Failed to update profile: ' + fallbackError.message },
            { status: 500 }
          )
        }

        return NextResponse.json({
          success: true,
          warning: 'Only name was saved. Run migration 009 to enable full onboarding fields.',
        })
      }

      return NextResponse.json(
        { error: 'Failed to update profile: ' + error.message },
        { status: 500 }
      )
    }

    // Ensure user has a team — uses shared utility that handles all fallback paths
    // and guarantees both team_members and profiles.current_team_id are consistent
    try {
      await ensureTeamForUser(userId, { companyName: companyName?.trim() })
    } catch (teamErr) {
      console.error('Failed to ensure team during onboarding:', teamErr)
      // Non-fatal — user can still complete onboarding, team will be resolved later
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Update profile error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Detect whether the profiles table uses 'full_name' or 'display_name'.
 * Tries full_name first (matches migration 001), falls back to display_name.
 */
async function detectNameColumn(): Promise<string> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .limit(1)

  if (error && error.message?.includes('full_name')) {
    return 'display_name'
  }
  return 'full_name'
}
