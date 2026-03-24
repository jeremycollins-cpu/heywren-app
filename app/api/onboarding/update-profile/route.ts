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

    // Ensure user has a team — join existing or create new so integrations step works
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()

    if (!currentProfile?.current_team_id) {
      // First check if user is already in team_members (e.g. added by provision-account)
      const { data: existingMembership } = await supabaseAdmin
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (existingMembership?.team_id) {
        // User already has a team membership — just fix the profile
        await supabaseAdmin
          .from('profiles')
          .update({ current_team_id: existingMembership.team_id })
          .eq('id', userId)
      } else {
        // Try domain matching to join an existing team (like provision-account does)
        const userEmail = currentProfile?.email || userData.user.email || ''
        const domain = userEmail.includes('@') ? userEmail.split('@')[1].toLowerCase() : null
        const FREE_DOMAINS = new Set([
          'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
          'outlook.com', 'live.com', 'aol.com', 'icloud.com',
          'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
        ])

        let teamId: string | null = null

        if (domain && !FREE_DOMAINS.has(domain)) {
          const { data: domainTeam } = await supabaseAdmin
            .from('teams')
            .select('id')
            .eq('domain', domain)
            .limit(1)
            .single()

          if (domainTeam) {
            // Join existing team
            teamId = domainTeam.id
            await supabaseAdmin
              .from('team_members')
              .upsert(
                { team_id: teamId, user_id: userId, role: 'member' },
                { onConflict: 'team_id,user_id' }
              )
          }
        }

        if (!teamId) {
          // No domain match — create a new team
          const slug = (companyName || 'team')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') + '-' + Date.now().toString(36)

          const { data: newTeam, error: teamError } = await supabaseAdmin
            .from('teams')
            .insert({ name: companyName?.trim() || 'My Team', slug })
            .select('id')
            .single()

          if (teamError) {
            console.error('Team creation error during onboarding:', teamError)
          }

          if (newTeam) {
            teamId = newTeam.id
            await supabaseAdmin
              .from('team_members')
              .insert({ team_id: teamId, user_id: userId, role: 'owner' })
          }
        }

        if (teamId) {
          await supabaseAdmin
            .from('profiles')
            .update({ current_team_id: teamId })
            .eq('id', userId)
        }
      }
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
