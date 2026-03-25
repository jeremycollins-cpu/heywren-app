import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildCommunicationProfile,
  generateCoachingInsights,
} from '@/lib/ai/generate-coaching'

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get user profile with job_title, team_size, company
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id, display_name, company, team_size, job_title')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const teamId = profile.current_team_id
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch commitments (last 30 days, all statuses) and missed emails in parallel
  const [commitmentsResult, missedEmailsResult] = await Promise.all([
    supabase
      .from('commitments')
      .select('id, title, description, status, source, metadata, created_at, updated_at, completed_at')
      .eq('team_id', teamId)
      .or(`creator_id.eq.${user.id},assignee_id.eq.${user.id}`)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('missed_emails')
      .select('id, from_name, from_email, subject, urgency, category, status, received_at')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (commitmentsResult.error) {
    return NextResponse.json({ error: commitmentsResult.error.message }, { status: 500 })
  }

  const commitments = commitmentsResult.data || []
  const missedEmails = missedEmailsResult.data || []

  // Build communication profile from raw data
  const communicationProfile = buildCommunicationProfile(commitments, missedEmails)

  // Generate AI coaching insights
  const insights = await generateCoachingInsights(
    communicationProfile,
    {
      jobTitle: profile.job_title || undefined,
      teamSize: profile.team_size || undefined,
      company: profile.company || undefined,
    },
    commitments,
    missedEmails
  )

  return NextResponse.json({
    insights,
    profile: communicationProfile,
    generatedAt: new Date().toISOString(),
  })
}
