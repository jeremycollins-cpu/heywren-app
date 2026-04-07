// lib/email/templates/manager-briefing.ts
// Weekly manager briefing email — team health, performance, and action items.

import { baseLayout, ctaButton, statRow, paragraph, sectionHeading, insightBox } from './base-layout'

export interface ManagerBriefingData {
  managerName: string
  orgName: string
  weekLabel: string
  memberCount: number
  // Performance stats
  totalPoints: number
  pointsDeltaPct: number
  totalCompleted: number
  totalOverdue: number
  avgResponseRate: number
  avgOnTimeRate: number
  activeStreaks: number
  // Top performers
  topPerformers: { name: string; points: number }[]
  // Alerts
  burnoutAlerts: number
  unresolvedAlerts: number
  // New achievements
  newAchievements: number
  // URLs
  dashboardUrl: string
  peopleInsightsUrl: string
  unsubscribeUrl: string
}

export function buildManagerBriefingEmail(data: ManagerBriefingData): { subject: string; html: string } {
  const subject = data.burnoutAlerts > 0
    ? `Weekly briefing: ${data.orgName} — ${data.burnoutAlerts} alert${data.burnoutAlerts !== 1 ? 's' : ''} need attention`
    : `Weekly briefing: ${data.orgName} — ${data.totalCompleted} completed, ${data.avgOnTimeRate}% on time`

  const pointsChange = data.pointsDeltaPct > 0
    ? `↑ +${data.pointsDeltaPct}%`
    : data.pointsDeltaPct < 0
    ? `↓ ${data.pointsDeltaPct}%`
    : ''

  const stats = statRow([
    { label: 'Points Earned', value: String(data.totalPoints), change: pointsChange },
    { label: 'Completed', value: String(data.totalCompleted) },
    { label: 'Overdue', value: String(data.totalOverdue) },
    { label: 'On-Time Rate', value: `${data.avgOnTimeRate}%` },
  ])

  const secondaryStats = statRow([
    { label: 'Response Rate', value: `${data.avgResponseRate}%` },
    { label: 'Active Streaks', value: String(data.activeStreaks) },
    { label: 'Team Members', value: String(data.memberCount) },
    { label: 'Achievements', value: String(data.newAchievements) },
  ])

  // Alerts section
  const alertsHtml = data.burnoutAlerts > 0 || data.unresolvedAlerts > 0
    ? `${sectionHeading('Action Required')}
<div style="background-color:#fef2f2;border-left:4px solid #dc2626;padding:14px 18px;border-radius:0 8px 8px 0;margin:12px 0;">
  <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
    ${data.burnoutAlerts > 0 ? `<strong>${data.burnoutAlerts} burnout risk alert${data.burnoutAlerts !== 1 ? 's</strong>' : '</strong>'} detected this week.` : ''}
    ${data.unresolvedAlerts > 0 ? ` <strong>${data.unresolvedAlerts} unresolved alert${data.unresolvedAlerts !== 1 ? 's' : ''}</strong> need your review.` : ''}
  </p>
</div>
${ctaButton('Review Alerts', data.peopleInsightsUrl)}`
    : ''

  // Top performers
  const topPerformersHtml = data.topPerformers.length > 0
    ? `${sectionHeading('Top Performers')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
  ${data.topPerformers.map((p, i) => {
    const medal = i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'
    return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">
      <span style="color:#6b7280;font-size:13px;font-weight:600;">${medal}</span>
      <span style="margin-left:12px;color:#1a1a2e;font-size:14px;">${p.name}</span>
    </td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">
      <span style="color:#4f46e5;font-weight:600;font-size:14px;">${p.points} pts</span>
    </td>
  </tr>`
  }).join('')}
</table>`
    : ''

  const body = `
${paragraph(`Hi ${data.managerName},`)}
${paragraph(`Here's your weekly briefing for <strong>${data.orgName}</strong> — week of ${data.weekLabel}.`)}
${stats}
${secondaryStats}
${alertsHtml}
${topPerformersHtml}
${ctaButton('Open Team Dashboard', data.dashboardUrl)}
`

  return {
    subject,
    html: baseLayout({
      preheader: `${data.totalCompleted} completed, ${data.totalOverdue} overdue, ${data.avgOnTimeRate}% on-time rate`,
      body,
      footerNote: 'Sent to managers every Monday. Manage preferences in HeyWren Settings.',
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
