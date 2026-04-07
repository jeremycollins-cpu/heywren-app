// lib/email/templates/reengagement.ts
// Re-engagement email for users inactive 7+ days.

import { baseLayout, ctaButton, paragraph, sectionHeading } from './base-layout'

export interface ReengagementEmailData {
  userName: string
  daysSinceLastActive: number
  /** What accumulated while they were away */
  commitmentsDetected: number
  overdueCount: number
  missedEmailCount: number
  dashboardUrl: string
  settingsUrl: string
  unsubscribeUrl: string
}

export function buildReengagementEmail(data: ReengagementEmailData): { subject: string; html: string } {
  const subject = data.overdueCount > 0
    ? `${data.overdueCount} items need you — here's what Wren caught while you were away`
    : `Wren's been working while you were away — here's what's new`

  const hasActivity = data.commitmentsDetected > 0 || data.overdueCount > 0 || data.missedEmailCount > 0

  const summaryItems: string[] = []
  if (data.commitmentsDetected > 0) summaryItems.push(`<strong>${data.commitmentsDetected}</strong> new commitments detected`)
  if (data.overdueCount > 0) summaryItems.push(`<strong>${data.overdueCount}</strong> items now overdue`)
  if (data.missedEmailCount > 0) summaryItems.push(`<strong>${data.missedEmailCount}</strong> emails awaiting your response`)

  const summaryHtml = summaryItems.length > 0
    ? `${sectionHeading("While you were away")}
<ul style="color:#4a4a68;font-size:15px;line-height:2;padding-left:20px;">
  ${summaryItems.map(item => `<li>${item}</li>`).join('')}
</ul>`
    : ''

  const body = `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`It's been ${data.daysSinceLastActive} days since you last checked in with HeyWren. ${hasActivity ? "Wren's been keeping watch — here's what's happened:" : "No worries — here's a quick catch-up."}`)}
${summaryHtml}
${paragraph(`A quick 2-minute review will get you back on track.`)}
${ctaButton('Catch Up Now', data.dashboardUrl)}
${paragraph(`<span style="color:#9ca3af;font-size:13px;">Getting too many emails? <a href="${data.settingsUrl}" style="color:#4f46e5;text-decoration:underline;">Adjust your preferences</a> or unsubscribe below.</span>`)}
`

  return {
    subject,
    html: baseLayout({
      preheader: hasActivity
        ? `${data.commitmentsDetected} commitments detected, ${data.overdueCount} overdue`
        : `Quick catch-up — takes 2 minutes`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
