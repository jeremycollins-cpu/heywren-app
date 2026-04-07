// lib/email/templates/nudge.ts
// Overdue commitment nudge email — sent as fallback when Slack nudge isn't acted on.

import { baseLayout, ctaButton, paragraph } from './base-layout'

export interface NudgeEmailData {
  userName: string
  overdueCount: number
  oldestOverdueDays: number
  dashboardUrl: string
  unsubscribeUrl: string
}

export function buildNudgeEmail(data: NudgeEmailData): { subject: string; html: string } {
  const itemLabel = data.overdueCount === 1 ? 'item' : 'items'

  const subject = data.overdueCount === 1
    ? `Friendly reminder: you have 1 overdue item in HeyWren`
    : `Friendly reminder: ${data.overdueCount} items need your attention`

  const urgencyNote = data.oldestOverdueDays >= 7
    ? `Your oldest item has been overdue for <strong>${data.oldestOverdueDays} days</strong>.`
    : `Some items are a few days past due.`

  const body = `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`You have <strong>${data.overdueCount} overdue ${itemLabel}</strong> in HeyWren that could use your attention.`)}
${paragraph(urgencyNote)}
${paragraph(`Taking a quick pass to update or complete these items helps your team stay in sync and keeps your Wren Score on track.`)}
${ctaButton('Review Your Items', data.dashboardUrl)}
${paragraph(`<span style="color:#9ca3af;font-size:13px;">No worries if something changed — you can mark items as cancelled or reassign them too.</span>`)}
`

  const html = baseLayout({
    preheader: `${data.overdueCount} overdue ${itemLabel} need your attention`,
    body,
    footerNote: 'This is a follow-up nudge. Manage email preferences in HeyWren Settings.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
