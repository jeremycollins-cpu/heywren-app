// lib/email/templates/reengagement.ts
// Re-engagement email for users inactive 7+ days.

import { baseLayout, ctaButton, paragraph, sectionHeading, wrenGreeting } from './base-layout'

export interface ReengagementEmailData {
  userName: string
  daysSinceLastActive: number
  commitmentsDetected: number
  overdueCount: number
  missedEmailCount: number
  dashboardUrl: string
  settingsUrl: string
  unsubscribeUrl: string
}

export function buildReengagementEmail(data: ReengagementEmailData): { subject: string; html: string } {
  const subject = data.overdueCount > 0
    ? `${data.overdueCount} items need you — here's what happened while you were away`
    : `I've been keeping watch — here's what's new`

  const hasActivity = data.commitmentsDetected > 0 || data.overdueCount > 0 || data.missedEmailCount > 0

  const summaryItems: string[] = []
  if (data.commitmentsDetected > 0) summaryItems.push(`<strong>${data.commitmentsDetected}</strong> new commitments detected from your conversations`)
  if (data.overdueCount > 0) summaryItems.push(`<strong>${data.overdueCount}</strong> items now overdue and waiting for you`)
  if (data.missedEmailCount > 0) summaryItems.push(`<strong>${data.missedEmailCount}</strong> emails that may need a response`)

  const summaryHtml = summaryItems.length > 0
    ? `${sectionHeading("While you were away")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;margin:12px 0;border:1px solid #e9e5ff;">
  <tr>
    <td style="padding:18px 20px;">
      ${summaryItems.map(item => `<p style="margin:6px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#8226; ${item}</p>`).join('')}
    </td>
  </tr>
</table>`
    : ''

  const body = `
${wrenGreeting(data.userName, `It's been ${data.daysSinceLastActive} days since you last checked in. ${hasActivity ? "I kept working in the background — here's what accumulated:" : "No worries — let's get you caught up."}`)}
${summaryHtml}
${paragraph(`A quick 2-minute review will get you back on track.`)}
${ctaButton('Catch Up Now', data.dashboardUrl)}
${paragraph(`<span style="color:#9ca3af;font-size:13px;">Getting too many emails? <a href="${data.settingsUrl}" style="color:#7c3aed;text-decoration:underline;">Adjust your preferences</a></span>`)}
`

  return {
    subject,
    html: baseLayout({
      preheader: hasActivity
        ? `${data.commitmentsDetected} commitments detected, ${data.overdueCount} overdue`
        : 'Quick catch-up — takes 2 minutes',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
