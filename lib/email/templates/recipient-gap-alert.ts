// lib/email/templates/recipient-gap-alert.ts
// Alert email when someone is mentioned in an email but not included as a recipient.

import { baseLayout, ctaButton, paragraph, wrenGreeting } from './base-layout'

export interface RecipientGapAlertData {
  userName: string
  senderName: string
  subject: string
  questionSummary: string
  missedEmailsUrl: string
  unsubscribeUrl: string
}

export function buildRecipientGapAlertEmail(data: RecipientGapAlertData): { subject: string; html: string } {
  const subject = `Heads up: someone may be missing from an email thread`

  const body = `
${wrenGreeting(data.userName, `Wren spotted a potential gap in an email from <strong>${data.senderName}</strong>.`)}
${paragraph(`<strong>Subject:</strong> ${data.subject}`)}
${paragraph(`<strong>What Wren found:</strong> ${data.questionSummary}`)}
${paragraph(`This means the question or request may go unanswered because the intended person never received the email. You might want to loop them in.`)}
${ctaButton('View in Missed Emails', data.missedEmailsUrl)}
`

  const html = baseLayout({
    preheader: `Someone was asked a question but wasn't included on the email`,
    body,
    footerNote: 'Wren sends alerts for important email issues that might slip through the cracks.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
