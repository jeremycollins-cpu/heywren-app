// app/api/test-email/route.ts
// Temporary test endpoint — send a sample email to verify Resend is connected.
// DELETE THIS FILE before shipping to production.

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { buildWeeklyRecapEmail } from '@/lib/email/templates/weekly-recap'
import { buildWelcomeDay0 } from '@/lib/email/templates/welcome'
import { buildNudgeEmail } from '@/lib/email/templates/nudge'
import { buildAchievementEmail } from '@/lib/email/templates/achievement'

const TEMPLATES: Record<string, () => { subject: string; html: string }> = {
  welcome: () => buildWelcomeDay0({
    userName: 'Jeremy',
    appUrl: 'https://app.heywren.com',
    unsubscribeUrl: 'https://app.heywren.com/settings?tab=notifications',
  }),
  recap: () => buildWeeklyRecapEmail({
    userName: 'Jeremy',
    weekLabel: 'Mar 31 – Apr 6',
    totalPoints: 247,
    pointsDelta: 42,
    rank: 3,
    rankDelta: 2,
    streak: 8,
    commitmentsCompleted: 12,
    commitmentsCreated: 15,
    overdueCount: 2,
    onTimeRate: 88,
    responseRate: 94,
    achievementEarned: { name: 'Follow-Through Pro', tier: 'silver' },
    insight: 'Your points jumped 20% compared to last week. Great momentum!',
    dashboardUrl: 'https://app.heywren.com/dashboard',
    overdueUrl: 'https://app.heywren.com/commitments?status=overdue',
    unsubscribeUrl: 'https://app.heywren.com/settings?tab=notifications',
  }),
  nudge: () => buildNudgeEmail({
    userName: 'Jeremy',
    overdueCount: 3,
    oldestOverdueDays: 5,
    dashboardUrl: 'https://app.heywren.com/commitments?status=overdue',
    unsubscribeUrl: 'https://app.heywren.com/settings?tab=notifications',
  }),
  achievement: () => buildAchievementEmail({
    userName: 'Jeremy',
    achievementName: 'Follow-Through Pro',
    achievementDescription: 'Complete 50 commitments on time',
    tier: 'silver',
    reason: 'You earned this by reaching 50 on-time completions. Impressive consistency!',
    nextAchievement: { name: 'Follow-Through Master', progress: 50, target: 100 },
    dashboardUrl: 'https://app.heywren.com',
    unsubscribeUrl: 'https://app.heywren.com/settings?tab=notifications',
  }),
}

export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get('to')
  const template = req.nextUrl.searchParams.get('template') || 'recap'

  if (!to) {
    return NextResponse.json({
      error: 'Missing ?to=your@email.com parameter',
      availableTemplates: Object.keys(TEMPLATES),
      example: '/api/test-email?to=you@example.com&template=recap',
    }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 })
  }

  const buildTemplate = TEMPLATES[template]
  if (!buildTemplate) {
    return NextResponse.json({
      error: `Unknown template "${template}"`,
      availableTemplates: Object.keys(TEMPLATES),
    }, { status: 400 })
  }

  const { subject, html } = buildTemplate()

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: 'HeyWren <notifications@heywren.com>',
      to,
      subject: `[TEST] ${subject}`,
      html,
    })

    if (error) {
      return NextResponse.json({ success: false, error }, { status: 500 })
    }

    return NextResponse.json({ success: true, messageId: data?.id, template, to })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}
