import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

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

    // Ensure the onboarding columns exist (migration 009)
    // This handles the case where the migration hasn't been applied yet
    try {
      await supabaseAdmin.rpc('exec_sql', {
        sql: `
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company TEXT;
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_size TEXT;
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step TEXT;
        `,
      })
    } catch {
      // rpc may not exist — try direct column adds via individual updates
      // If columns already exist, these are no-ops
    }

    // Update the profile using admin client to bypass RLS
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        job_title: jobTitle || null,
        company: companyName?.trim() || null,
        team_size: teamSize || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) {
      console.error('Profile update failed:', error)

      // If the error is about missing columns, try updating only the base columns
      if (error.message?.includes('column') || error.code === '42703') {
        console.warn('Falling back to base-column-only update (migration 009 may be missing)')
        const { error: fallbackError } = await supabaseAdmin
          .from('profiles')
          .update({
            full_name: fullName.trim(),
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
          warning: 'Only base profile fields were saved. Run migration 009 to enable full onboarding fields.',
        })
      }

      return NextResponse.json(
        { error: 'Failed to update profile: ' + error.message },
        { status: 500 }
      )
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
