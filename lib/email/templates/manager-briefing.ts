// lib/email/templates/manager-briefing.ts
// Weekly manager briefing email — team health, performance, and action items.

import { baseLayout, ctaButton, statRow, paragraph, sectionHeading, wrenGreeting, divider } from './base-layout'

export interface ManagerBriefingData {
  managerName: string
  orgName: string
  weekLabel: string
  memberCount: number
  totalPoints: number
  pointsDeltaPct: number
  totalCompleted: number
  totalOverdue: number
  avgResponseRate: number
  avgOnTimeRate: number
  activeStreaks: number
  topPerformers: { name: string; points: number }[]
  burnoutAlerts: number
  unresolvedAlerts: number
  newAchievements: number
  // Team health
  healthScore?: number | null
  healthDelta?: number | null
  // Workload
  overloadedMembers?: number
  lowestPulseEnergy?: number | null
  dashboardUrl: string
  peopleInsightsUrl: string
  unsubscribeUrl: string
}

export function buildManagerBriefingEmail(data: ManagerBriefingData): { subject: string; html: string } {
  const subject = data.burnoutAlerts > 0
    ? `${data.orgName} weekly: ${data.burnoutAlerts} alert${data.burnoutAlerts !== 1 ? 's' : ''} need attention`
    : `${data.orgName} weekly: ${data.totalCompleted} completed, ${data.avgOnTimeRate}% on time`

  const pointsChange = data.pointsDeltaPct > 0
    ? `↑ +${data.pointsDeltaPct}%`
    : data.pointsDeltaPct < 0
    ? `↓ ${data.pointsDeltaPct}%`
    : ''

  const stats = statRow([
    { label: 'Points', value: String(data.totalPoints), change: pointsChange },
    { label: 'Completed', value: String(data.totalCompleted) },
    { label: 'Overdue', value: String(data.totalOverdue) },
    { label: 'On-Time', value: `${data.avgOnTimeRate}%` },
  ])

  const secondaryStats = statRow([
    { label: 'Response Rate', value: `${data.avgResponseRate}%` },
    { label: 'Streaks', value: String(data.activeStreaks) },
    { label: 'Members', value: String(data.memberCount) },
    { label: 'Achievements', value: String(data.newAchievements) },
  ])

  // Alerts section
  const alertsHtml = data.burnoutAlerts > 0 || data.unresolvedAlerts > 0
    ? `${divider()}
${sectionHeading('Action Required')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:16px 18px;border-radius:0 12px 12px 0;">
      <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;font-weight:500;">
        ${data.burnoutAlerts > 0 ? `<strong>${data.burnoutAlerts} burnout risk alert${data.burnoutAlerts !== 1 ? 's' : ''}</strong> detected this week.` : ''}
        ${data.unresolvedAlerts > 0 ? ` <strong>${data.unresolvedAlerts} unresolved alert${data.unresolvedAlerts !== 1 ? 's' : ''}</strong> need your review.` : ''}
      </p>
    </td>
  </tr>
</table>
${ctaButton('Review Alerts', data.peopleInsightsUrl)}`
    : ''

  // Top performers
  const topPerformersHtml = data.topPerformers.length > 0
    ? `${divider()}
${sectionHeading('Top Performers')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;border:1px solid #e9e5ff;">
  ${data.topPerformers.map((p, i) => {
    const medal = i === 0 ? '&#129351;' : i === 1 ? '&#129352;' : '&#129353;'
    return `<tr>
    <td style="padding:12px 16px;${i < data.topPerformers.length - 1 ? 'border-bottom:1px solid #e9e5ff;' : ''}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:16px;width:30px;">${medal}</td>
          <td style="color:#1a1a2e;font-size:14px;font-weight:500;">${p.name}</td>
          <td style="text-align:right;color:#4f46e5;font-weight:700;font-size:14px;">${p.points} pts</td>
        </tr>
      </table>
    </td>
  </tr>`
  }).join('')}
</table>`
    : ''

  // Team health score hero (if available)
  const healthHtml = data.healthScore != null
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr>
    <td style="background:${data.healthScore >= 75 ? 'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%)' : data.healthScore >= 50 ? 'linear-gradient(135deg,#fefce8 0%,#fef3c7 100%)' : 'linear-gradient(135deg,#fef2f2 0%,#fecaca 100%)'};padding:16px 20px;border-radius:12px;border:1px solid ${data.healthScore >= 75 ? '#a7f3d0' : data.healthScore >= 50 ? '#fde68a' : '#fecaca'};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle;width:60px;">
            <div style="font-size:28px;font-weight:800;color:${data.healthScore >= 75 ? '#059669' : data.healthScore >= 50 ? '#d97706' : '#dc2626'};">${data.healthScore}</div>
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:14px;font-weight:600;color:#1a1a2e;">Team Health Score</div>
            <div style="font-size:12px;color:#6b7280;">${data.healthScore >= 75 ? 'Performing well' : data.healthScore >= 50 ? 'Some areas need attention' : 'Several signals need action'}${data.healthDelta != null && data.healthDelta !== 0 ? ` · <span style="color:${data.healthDelta > 0 ? '#059669' : '#dc2626'}">${data.healthDelta > 0 ? '↑+' : '↓'}${data.healthDelta} from last week</span>` : ''}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
    : ''

  // Workload warning
  const workloadHtml = (data.overloadedMembers && data.overloadedMembers > 0) || (data.lowestPulseEnergy != null && data.lowestPulseEnergy <= 2)
    ? `${sectionHeading('Signals to Watch')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:0 12px 12px 0;margin:12px 0;">
  <tr><td>
    ${data.overloadedMembers && data.overloadedMembers > 0 ? `<p style="margin:0 0 4px;color:#92400e;font-size:14px;line-height:1.6;"><strong>${data.overloadedMembers}</strong> team member${data.overloadedMembers !== 1 ? 's' : ''} overloaded (2x+ average workload)</p>` : ''}
    ${data.lowestPulseEnergy != null && data.lowestPulseEnergy <= 2 ? `<p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">Lowest pulse energy this week: <strong>${data.lowestPulseEnergy}/5</strong> — may need a check-in</p>` : ''}
  </td></tr>
</table>`
    : ''

  const body = `
${wrenGreeting(data.managerName, `Here's your team briefing for <strong>${data.orgName}</strong> — week of ${data.weekLabel}.`)}
${healthHtml}
${stats}
${secondaryStats}
${alertsHtml}
${workloadHtml}
${topPerformersHtml}
${divider()}
${ctaButton('Open Team Dashboard', data.dashboardUrl)}
`

  return {
    subject,
    html: baseLayout({
      preheader: `${data.totalCompleted} completed, ${data.totalOverdue} overdue, ${data.avgOnTimeRate}% on-time`,
      body,
      footerNote: 'Wren sends this to managers every Monday.',
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
