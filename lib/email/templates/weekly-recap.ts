// lib/email/templates/weekly-recap.ts
// Weekly personal recap email — sent every Monday morning.

import { baseLayout, ctaButton, statRow, paragraph, insightBox, sectionHeading } from './base-layout'

export interface WeeklyRecapData {
  userName: string
  weekLabel: string // e.g. "Mar 31 – Apr 6"
  totalPoints: number
  pointsDelta: number // +/- vs previous week
  rank: number | null
  rankDelta: number | null // positive = moved up
  streak: number
  commitmentsCompleted: number
  commitmentsCreated: number
  overdueCount: number
  onTimeRate: number // 0-100
  responseRate: number // 0-100
  achievementEarned?: { name: string; tier: string } | null
  insight?: string | null
  dashboardUrl: string
  overdueUrl: string
  unsubscribeUrl: string
}

export function buildWeeklyRecapEmail(data: WeeklyRecapData): { subject: string; html: string } {
  const subject = data.overdueCount > 0
    ? `Your week in review: ${data.totalPoints} pts earned, ${data.overdueCount} items need attention`
    : `Your week in review: ${data.totalPoints} pts earned — nice work!`

  const greeting = `Hi ${data.userName},`
  const intro = `Here's your HeyWren recap for the week of <strong>${data.weekLabel}</strong>.`

  // Points change indicator
  const pointsChange = data.pointsDelta > 0
    ? `↑ +${data.pointsDelta}`
    : data.pointsDelta < 0
    ? `↓ ${data.pointsDelta}`
    : ''

  // Rank change indicator
  const rankChange = data.rankDelta && data.rankDelta > 0
    ? `↑ +${data.rankDelta}`
    : data.rankDelta && data.rankDelta < 0
    ? `↓ ${Math.abs(data.rankDelta)}`
    : ''

  const stats = statRow([
    { label: 'Points Earned', value: String(data.totalPoints), change: pointsChange },
    { label: 'Completed', value: String(data.commitmentsCompleted) },
    { label: 'On-Time Rate', value: `${data.onTimeRate}%` },
    ...(data.rank ? [{ label: 'Rank', value: `#${data.rank}`, change: rankChange }] : []),
  ])

  // Streak callout
  const streakHtml = data.streak >= 2
    ? `<div style="text-align:center;margin:12px 0;"><span style="background-color:#fef3c7;color:#92400e;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;">${data.streak}-week streak</span></div>`
    : ''

  // Achievement section
  const achievementHtml = data.achievementEarned
    ? `${sectionHeading('Achievement Unlocked')}
<div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);padding:16px 20px;border-radius:8px;text-align:center;">
  <div style="font-size:16px;font-weight:700;color:#92400e;">${data.achievementEarned.name}</div>
  <div style="font-size:13px;color:#a16207;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">${data.achievementEarned.tier}</div>
</div>`
    : ''

  // Overdue alert
  const overdueHtml = data.overdueCount > 0
    ? `${sectionHeading('Needs Your Attention')}
<div style="background-color:#fef2f2;border-left:4px solid #dc2626;padding:14px 18px;border-radius:0 8px 8px 0;">
  <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
    You have <strong>${data.overdueCount} overdue ${data.overdueCount === 1 ? 'item' : 'items'}</strong> that could use your attention.
  </p>
</div>
${ctaButton('Review Overdue Items', data.overdueUrl)}`
    : ''

  // Insight
  const insightHtml = data.insight ? insightBox(data.insight) : ''

  const body = `
${paragraph(greeting)}
${paragraph(intro)}
${stats}
${streakHtml}
${achievementHtml}
${overdueHtml}
${insightHtml}
${ctaButton('View Your Dashboard', data.dashboardUrl)}
`

  const preheader = `${data.totalPoints} points earned this week${data.overdueCount > 0 ? ` — ${data.overdueCount} items overdue` : ''}`

  const html = baseLayout({
    preheader,
    body,
    footerNote: 'You receive this email weekly. Manage your preferences in HeyWren Settings.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
