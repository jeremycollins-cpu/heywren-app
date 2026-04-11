// lib/email/templates/weekly-recap.ts
// Weekly personal recap email — sent every Monday morning.

import { baseLayout, ctaButton, statRow, paragraph, insightBox, sectionHeading, wrenGreeting, divider } from './base-layout'

export interface WeeklyRecapData {
  userName: string
  weekLabel: string
  totalPoints: number
  pointsDelta: number
  rank: number | null
  rankDelta: number | null
  streak: number
  commitmentsCompleted: number
  commitmentsCreated: number
  overdueCount: number
  onTimeRate: number
  responseRate: number
  achievementEarned?: { name: string; tier: string } | null
  insight?: string | null
  reminders?: string[]
  dashboardUrl: string
  overdueUrl: string
  remindersUrl?: string
  unsubscribeUrl: string
}

export function buildWeeklyRecapEmail(data: WeeklyRecapData): { subject: string; html: string } {
  const subject = data.overdueCount > 0
    ? `Your week: ${data.totalPoints} pts earned, ${data.overdueCount} items need you`
    : `Your week: ${data.totalPoints} pts — you're on a roll`

  const pointsChange = data.pointsDelta > 0
    ? `↑ +${data.pointsDelta}`
    : data.pointsDelta < 0
    ? `↓ ${data.pointsDelta}`
    : ''

  const rankChange = data.rankDelta && data.rankDelta > 0
    ? `↑ +${data.rankDelta}`
    : data.rankDelta && data.rankDelta < 0
    ? `↓ ${Math.abs(data.rankDelta)}`
    : ''

  // Personalized intro message
  let introMessage = `Here's your follow-through report for <strong>${data.weekLabel}</strong>.`
  if (data.commitmentsCompleted >= 10) {
    introMessage = `You crushed it this week. Here's your follow-through report for <strong>${data.weekLabel}</strong>.`
  } else if (data.overdueCount === 0 && data.commitmentsCompleted > 0) {
    introMessage = `Clean slate — nothing overdue. Here's your report for <strong>${data.weekLabel}</strong>.`
  } else if (data.streak >= 4) {
    introMessage = `${data.streak} weeks strong. Here's your follow-through report for <strong>${data.weekLabel}</strong>.`
  }

  const stats = statRow([
    { label: 'Points', value: String(data.totalPoints), change: pointsChange },
    { label: 'Completed', value: String(data.commitmentsCompleted) },
    { label: 'On-Time', value: `${data.onTimeRate}%` },
    ...(data.rank ? [{ label: 'Rank', value: `#${data.rank}`, change: rankChange }] : []),
  ])

  // Streak badge
  const streakHtml = data.streak >= 2
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto;">
  <tr>
    <td style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);padding:8px 20px;border-radius:24px;text-align:center;border:1px solid #fcd34d;">
      <span style="font-size:13px;font-weight:700;color:#92400e;">${data.streak}-week streak</span>
    </td>
  </tr>
</table>`
    : ''

  // Achievement
  const achievementHtml = data.achievementEarned
    ? `${divider()}
${sectionHeading('Achievement Unlocked')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:linear-gradient(135deg,#fef9c3 0%,#fef3c7 100%);padding:20px;border-radius:12px;text-align:center;border:1px solid #fde68a;">
      <div style="font-size:28px;line-height:1;">&#127942;</div>
      <div style="font-size:17px;font-weight:700;color:#92400e;margin-top:8px;">${data.achievementEarned.name}</div>
      <div style="font-size:12px;color:#a16207;margin-top:4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${data.achievementEarned.tier}</div>
    </td>
  </tr>
</table>`
    : ''

  // Overdue alert
  const overdueHtml = data.overdueCount > 0
    ? `${divider()}
${sectionHeading('Needs Your Attention')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px 18px;border-radius:0 12px 12px 0;">
      <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;font-weight:500;">
        You have <strong>${data.overdueCount} overdue ${data.overdueCount === 1 ? 'item' : 'items'}</strong> — a quick review keeps things from piling up.
      </p>
    </td>
  </tr>
</table>
${ctaButton('Review Overdue Items', data.overdueUrl)}`
    : ''

  const insightHtml = data.insight ? insightBox(data.insight) : ''

  // Reminders section
  const remindersHtml = data.reminders && data.reminders.length > 0
    ? `${divider()}
${sectionHeading(`🔔 ${data.reminders.length} Active Reminder${data.reminders.length !== 1 ? 's' : ''}`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:16px 18px;border-radius:0 12px 12px 0;">
      ${data.reminders.slice(0, 5).map(r => `<p style="margin:0 0 6px;color:#92400e;font-size:13px;line-height:1.5;">• ${r}</p>`).join('')}
      ${data.reminders.length > 5 ? `<p style="margin:0;color:#92400e;font-size:12px;font-style:italic;">+ ${data.reminders.length - 5} more</p>` : ''}
    </td>
  </tr>
</table>
${data.remindersUrl ? ctaButton('View Reminders', data.remindersUrl) : ''}`
    : ''

  const body = `
${wrenGreeting(data.userName, introMessage)}
${stats}
${streakHtml}
${achievementHtml}
${overdueHtml}
${remindersHtml}
${insightHtml}
${divider()}
${ctaButton('Open Your Dashboard', data.dashboardUrl)}
`

  const preheader = `${data.totalPoints} pts this week${data.overdueCount > 0 ? ` · ${data.overdueCount} overdue` : data.streak >= 2 ? ` · ${data.streak}-week streak` : ''}`

  const html = baseLayout({
    preheader,
    body,
    footerNote: 'Wren sends this every Monday. Manage preferences in Settings.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
