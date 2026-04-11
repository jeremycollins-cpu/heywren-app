import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { createClient } from '@supabase/supabase-js'

// Use service role to bypass RLS — this is a server-only route
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getAdminClient()
  try {
    const { sessionId, userId, email, companyName } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session ID' }, { status: 400 })
    }

    // Verify the Stripe checkout session is real and paid
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
    if (!checkoutSession || checkoutSession.status !== 'complete') {
      return NextResponse.json({ error: 'Invalid or incomplete checkout session' }, { status: 400 })
    }

    // Get user ID from metadata or request body
    const resolvedUserId = checkoutSession.metadata?.userId !== 'pending'
      ? checkoutSession.metadata?.userId
      : userId
    const resolvedPlan = checkoutSession.metadata?.plan || 'basic'

    if (!resolvedUserId) {
      return NextResponse.json({ error: 'Could not determine user' }, { status: 400 })
    }

    // Check if user already has a team
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('current_team_id')
      .eq('id', resolvedUserId)
      .single()

    if (existingProfile?.current_team_id) {
      return NextResponse.json({
        success: true,
        teamId: existingProfile.current_team_id,
        alreadyExists: true,
      })
    }

    // Create team
    const teamName = companyName || 'My Team'
    const { data: newTeam, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert([{
        name: teamName,
        slug: `team-${Date.now()}`,
      }])
      .select()
      .single()

    if (teamError || !newTeam) {
      console.error('Team creation error:', teamError)
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
    }

    // Add user as owner
    const { error: memberError } = await supabaseAdmin
      .from('team_members')
      .insert([{
        team_id: newTeam.id,
        user_id: resolvedUserId,
        role: 'owner',
      }])

    if (memberError) {
      console.error('Member creation error:', memberError)
      return NextResponse.json({ error: 'Failed to add user to team' }, { status: 500 })
    }

    // Upsert profile — handles both existing and new profiles
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: resolvedUserId,
        email: email || '',
        full_name: companyName ? `${companyName} Admin` : 'User',
        display_name: companyName ? `${companyName} Admin` : 'User',
        role: 'super_admin',
        current_team_id: newTeam.id,
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('Profile upsert error:', profileError)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      teamId: newTeam.id,
    })
  } catch (error: any) {
    console.error('Setup account error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to set up account' },
      { status: 500 }
    )
  }
}
