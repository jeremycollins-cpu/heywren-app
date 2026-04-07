// lib/email/templates/nudge.ts
// Overdue commitment nudge email — sent as fallback when Slack nudge isn't acted on.

import { baseLayout, ctaButton, paragraph, wrenGreeting } from './base-layout'

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
    ? `Quick nudge: 1 item needs your attention`
    : `Quick nudge: ${data.overdueCount} items need your attention`

  // Vary the tone based on how overdue things are
  let nudgeMessage: string
  if (data.oldestOverdueDays >= 14) {
    nudgeMessage = `Some of these have been waiting a while — your oldest is <strong>${data.oldestOverdueDays} days</strong> overdue. A quick pass will clear the backlog.`
  } else if (data.oldestOverdueDays >= 7) {
    nudgeMessage = `Your oldest item has been overdue for <strong>${data.oldestOverdueDays} days</strong>. A couple of minutes to review will make a big difference.`
  } else {
    nudgeMessage = `A few items are a couple days past due. A quick review keeps things from piling up.`
  }

  const body = `
${wrenGreeting(data.userName, `You have <strong>${data.overdueCount} overdue ${itemLabel}</strong> that could use your attention.`)}
${paragraph(nudgeMessage)}
${ctaButton('Review Your Items', data.dashboardUrl)}
${paragraph(`<span style="color:#9ca3af;font-size:13px;">If something changed, you can mark items as done, cancel them, or reassign — no judgment.</span>`)}
`

  const html = baseLayout({
    preheader: `${data.overdueCount} ${itemLabel} overdue — quick review needed`,
    body,
    footerNote: 'Wren sends nudges on weekdays for overdue items.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
