import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DEFAULTS = {
  achievement_notifications: true,
  streak_notifications: true,
  leaderboard_notifications: true,
  challenge_notifications: true,
  weekly_digest: true,
  celebration_posts: true,
  slack_notifications: true,
  email_digests: true,
  overdue_alerts: true,
  weekly_review: true,
}

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Resolve the user's organization
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.organization_id) {
    return NextResponse.json({ error: 'No organization found' }, { status: 400 })
  }

  const { data: prefs, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .eq('organization_id', membership.organization_id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!prefs) {
    return NextResponse.json({ preferences: DEFAULTS })
  }

  return NextResponse.json({
    preferences: {
      achievement_notifications: prefs.achievement_notifications,
      streak_notifications: prefs.streak_notifications,
      leaderboard_notifications: prefs.leaderboard_notifications,
      challenge_notifications: prefs.challenge_notifications,
      weekly_digest: prefs.weekly_digest,
      celebration_posts: prefs.celebration_posts,
      slack_notifications: prefs.slack_notifications ?? true,
      email_digests: prefs.email_digests ?? true,
      overdue_alerts: prefs.overdue_alerts ?? true,
      weekly_review: prefs.weekly_review ?? true,
    },
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.organization_id) {
    return NextResponse.json({ error: 'No organization found' }, { status: 400 })
  }

  const body = await req.json()

  const {
    achievement_notifications,
    streak_notifications,
    leaderboard_notifications,
    challenge_notifications,
    weekly_digest,
    celebration_posts,
    slack_notifications,
    email_digests,
    overdue_alerts,
    weekly_review,
  } = body

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        organization_id: membership.organization_id,
        user_id: user.id,
        achievement_notifications: achievement_notifications ?? true,
        streak_notifications: streak_notifications ?? true,
        leaderboard_notifications: leaderboard_notifications ?? true,
        challenge_notifications: challenge_notifications ?? true,
        weekly_digest: weekly_digest ?? true,
        celebration_posts: celebration_posts ?? true,
        slack_notifications: slack_notifications ?? true,
        email_digests: email_digests ?? true,
        overdue_alerts: overdue_alerts ?? true,
        weekly_review: weekly_review ?? true,
      },
      { onConflict: 'organization_id,user_id' }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
