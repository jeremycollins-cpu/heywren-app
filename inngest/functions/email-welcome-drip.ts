import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import {
  buildWelcomeDay0,
  buildWelcomeDay1,
  buildWelcomeDay3,
  buildWelcomeDay7,
} from '@/lib/email/templates/welcome'
import { startJobRun } from '@/lib/jobs/record-run'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Welcome drip email sequence.
 * Runs every hour and checks which users need their next drip email.
 * Day 0: Immediately after signup
 * Day 1: 24 hours after signup
 * Day 3: 72 hours after signup
 * Day 7: 168 hours after signup
 */
export const emailWelcomeDrip = inngest.createFunction(
  { id: 'email-welcome-drip' },
  { cron: '0 * * * *' }, // Every hour
  async ({ step }) => {
    const run = startJobRun('email-welcome-drip')
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'
    const now = new Date()

    // Initialize drip state for new users who don't have one yet
    await step.run('init-new-users', async () => {
      // Find users who signed up recently and don't have drip state
      const { data: newUsers } = await supabase
        .from('profiles')
        .select('id, email, full_name, created_at')
        .gte('created_at', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()) // Last 8 days

      if (!newUsers || newUsers.length === 0) return

      const userIds = newUsers.map(u => u.id)
      const { data: existingDrips } = await supabase
        .from('welcome_drip_state')
        .select('user_id')
        .in('user_id', userIds)

      const existingSet = new Set((existingDrips || []).map(d => d.user_id))
      const toCreate = newUsers.filter(u => !existingSet.has(u.id))

      if (toCreate.length > 0) {
        await supabase.from('welcome_drip_state').insert(
          toCreate.map(u => ({
            user_id: u.id,
            signup_at: u.created_at,
          }))
        )
      }
    })

    // Fetch all incomplete drip states
    const drips = await step.run('fetch-pending-drips', async () => {
      const { data } = await supabase
        .from('welcome_drip_state')
        .select('*')
        .eq('completed', false)
        .limit(200)

      return data || []
    })

    if (drips.length === 0) {
      run.meta({ reason: 'no pending drips' })
      await run.finish()
      return { success: true, emailsSent: 0, reason: 'no pending drips' }
    }

    run.meta({ pending_drips: drips.length })

    // Fetch profiles for all drip users
    const userIds = drips.map(d => d.user_id)
    const profilesData = await step.run('fetch-profiles', async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)

      return data || []
    })
    const profiles = new Map(profilesData.map(p => [p.id, p]))

    let emailsSent = 0

    for (const drip of drips) {
      const profile = profiles.get(drip.user_id)
      if (!profile?.email) {
        run.tally('skipped')
        continue
      }

      const signupAt = new Date(drip.signup_at)
      const hoursSinceSignup = (now.getTime() - signupAt.getTime()) / (1000 * 60 * 60)
      const userName = profile.full_name?.split(' ')[0] || 'there'
      const unsubscribeUrl = `${appUrl}/settings?tab=notifications`

      const baseData = { userName, appUrl, unsubscribeUrl }

      await step.run(`drip-${drip.user_id}`, async () => {
        // Day 0 — send immediately (within first hour)
        if (!drip.day0_sent_at && hoursSinceSignup < 24) {
          const { subject, html } = buildWelcomeDay0(baseData)
          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            from: 'HeyWren <hello@heywren.ai>',
            emailType: 'welcome_d0',
            userId: drip.user_id,
            idempotencyKey: `welcome_d0_${drip.user_id}`,
          })
          if (result.success) {
            await supabase.from('welcome_drip_state').update({ day0_sent_at: now.toISOString() }).eq('id', drip.id)
            emailsSent++
            run.tally('sent')
          } else {
            run.tally('failed')
          }
          return
        }

        // Day 1 — 24+ hours after signup
        if (!drip.day1_sent_at && drip.day0_sent_at && hoursSinceSignup >= 24 && hoursSinceSignup < 72) {
          // Check if user has connected an integration
          const { count: integrationCount } = await supabase
            .from('integrations')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', drip.user_id)

          const { count: commitmentCount } = await supabase
            .from('commitments')
            .select('*', { count: 'exact', head: true })
            .eq('creator_id', drip.user_id)

          const { subject, html } = buildWelcomeDay1({
            ...baseData,
            hasIntegration: (integrationCount || 0) > 0,
            commitmentsDetected: commitmentCount || 0,
          })

          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            from: 'HeyWren <hello@heywren.ai>',
            emailType: 'welcome_d1',
            userId: drip.user_id,
            idempotencyKey: `welcome_d1_${drip.user_id}`,
          })
          if (result.success) {
            await supabase.from('welcome_drip_state').update({ day1_sent_at: now.toISOString() }).eq('id', drip.id)
            emailsSent++
            run.tally('sent')
          } else {
            run.tally('failed')
          }
          return
        }

        // Day 3 — 72+ hours after signup
        if (!drip.day3_sent_at && drip.day1_sent_at && hoursSinceSignup >= 72 && hoursSinceSignup < 168) {
          // Check team size
          const { data: membership } = await supabase
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', drip.user_id)
            .limit(1)
            .maybeSingle()

          let teamMemberCount = 1
          if (membership?.organization_id) {
            const { count } = await supabase
              .from('organization_members')
              .select('*', { count: 'exact', head: true })
              .eq('organization_id', membership.organization_id)
            teamMemberCount = count || 1
          }

          const { subject, html } = buildWelcomeDay3({ ...baseData, teamMemberCount })
          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            from: 'HeyWren <hello@heywren.ai>',
            emailType: 'welcome_d3',
            userId: drip.user_id,
            idempotencyKey: `welcome_d3_${drip.user_id}`,
          })
          if (result.success) {
            await supabase.from('welcome_drip_state').update({ day3_sent_at: now.toISOString() }).eq('id', drip.id)
            emailsSent++
            run.tally('sent')
          } else {
            run.tally('failed')
          }
          return
        }

        // Day 7 — 168+ hours after signup
        if (!drip.day7_sent_at && drip.day3_sent_at && hoursSinceSignup >= 168) {
          const { data: weeklyScore } = await supabase
            .from('weekly_scores')
            .select('total_points, commitments_completed')
            .eq('user_id', drip.user_id)
            .order('week_start', { ascending: false })
            .limit(1)
            .maybeSingle()

          const { data: achievement } = await supabase
            .from('member_achievements')
            .select('achievement_id')
            .eq('user_id', drip.user_id)
            .limit(1)
            .maybeSingle()

          let achievementName: string | null = null
          if (achievement?.achievement_id) {
            const { data: ach } = await supabase
              .from('achievements')
              .select('name')
              .eq('id', achievement.achievement_id)
              .single()
            achievementName = ach?.name || null
          }

          const { subject, html } = buildWelcomeDay7({
            ...baseData,
            totalPoints: weeklyScore?.total_points || 0,
            commitmentsCompleted: weeklyScore?.commitments_completed || 0,
            achievementEarned: achievementName,
          })

          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            from: 'HeyWren <hello@heywren.ai>',
            emailType: 'welcome_d7',
            userId: drip.user_id,
            idempotencyKey: `welcome_d7_${drip.user_id}`,
          })
          if (result.success) {
            await supabase.from('welcome_drip_state').update({
              day7_sent_at: now.toISOString(),
              completed: true,
            }).eq('id', drip.id)
            emailsSent++
            run.tally('sent')
          } else {
            run.tally('failed')
          }
          return
        }

        // Mark as completed if past day 7 window (10+ days old)
        if (hoursSinceSignup > 240) {
          await supabase.from('welcome_drip_state').update({ completed: true }).eq('id', drip.id)
        }
      })
    }

    run.meta({ emailsSent })
    await run.finish()
    return { success: true, emailsSent }
  }
)
