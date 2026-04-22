// lib/email/templates/security-threat-alert.ts
// Out-of-band warning email for high/critical phishing threats detected by Wren.
// Sent separately from the in-app and Slack alerts so the user sees the warning
// even if they're away from the app — the entire point is "don't click anything".

import { baseLayout, ctaButton, escHtml, paragraph, wrenGreeting } from './base-layout'

export interface SecurityThreatAlertData {
  userName: string
  threatLevel: 'critical' | 'high' | 'medium' | 'low'
  threatType: string
  fromName: string
  fromEmail: string
  emailSubject: string
  explanation: string
  doNotActions: string[]
  recommendedActions: string[]
  reviewUrl: string
  unsubscribeUrl?: string
}

function humanizeThreatType(threatType: string): string {
  switch (threatType) {
    case 'phishing': return 'phishing attempt'
    case 'spoofing': return 'sender spoofing'
    case 'bec': return 'business email compromise'
    case 'malware_link': return 'malware link'
    case 'payment_fraud': return 'payment fraud'
    case 'impersonation': return 'impersonation'
    default: return 'suspicious email'
  }
}

function warningBanner(threatLevel: 'critical' | 'high' | 'medium' | 'low'): string {
  const label = threatLevel === 'critical' ? 'CRITICAL THREAT' : 'HIGH-RISK THREAT'
  const bgColor = threatLevel === 'critical' ? '#b91c1c' : '#dc2626'
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr>
    <td style="background:${bgColor};border-radius:10px;padding:18px 20px;text-align:center;">
      <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">
        &#9888;&#65039; ${label} DETECTED
      </p>
      <p style="margin:6px 0 0;color:#ffffff;font-size:15px;font-weight:600;">
        Do not click any links or open attachments in the flagged email.
      </p>
    </td>
  </tr>
</table>`
}

function suspectEmailCard(fromName: string, fromEmail: string, emailSubject: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:0 10px 10px 0;padding:14px 18px;">
      <p style="margin:0 0 4px;color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Flagged email</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.5;">
        <strong>From:</strong> ${escHtml(fromName || fromEmail)} &lt;${escHtml(fromEmail)}&gt;<br/>
        <strong>Subject:</strong> ${escHtml(emailSubject)}
      </p>
    </td>
  </tr>
</table>`
}

function actionList(heading: string, items: string[], color: 'red' | 'green'): string {
  if (!items || items.length === 0) return ''
  const headingColor = color === 'red' ? '#991b1b' : '#166534'
  const bulletColor = color === 'red' ? '#dc2626' : '#16a34a'
  const bullets = items
    .map(
      item => `<li style="margin:0 0 8px;color:#4a4a68;font-size:14px;line-height:1.6;">
        <span style="color:${bulletColor};font-weight:700;">&#9679;</span>
        <span style="margin-left:6px;">${escHtml(item)}</span>
      </li>`
    )
    .join('')
  return `<div style="margin:20px 0 8px;">
    <p style="margin:0 0 10px;color:${headingColor};font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escHtml(heading)}</p>
    <ul style="margin:0;padding:0;list-style:none;">${bullets}</ul>
  </div>`
}

export function buildSecurityThreatAlertEmail(
  data: SecurityThreatAlertData
): { subject: string; html: string } {
  const severityWord = data.threatLevel === 'critical' ? 'Critical' : 'High-risk'
  const typeLabel = humanizeThreatType(data.threatType)

  const subject = data.threatLevel === 'critical'
    ? `[Wren Security] Critical threat detected — don't click anything`
    : `[Wren Security] High-risk ${typeLabel} in your inbox`

  const defaultDoNot = [
    'Do not click any links in the flagged email',
    'Do not open any attachments',
    'Do not reply with personal or financial information',
    'Do not scan any QR codes included in the email',
  ]
  const defaultRecommended = [
    'Review the alert in HeyWren and confirm or dismiss',
    'If you know the sender, contact them through a channel you already trust (phone, in person) to verify',
    'Report the email as phishing in Outlook (right-click → Report)',
    'Delete the email after reporting',
  ]

  const doNotItems = data.doNotActions?.length ? data.doNotActions : defaultDoNot
  const recommendedItems = data.recommendedActions?.length ? data.recommendedActions : defaultRecommended

  const body = `
${warningBanner(data.threatLevel)}
${wrenGreeting(
  data.userName,
  `Wren flagged a ${severityWord.toLowerCase()} ${typeLabel} in your inbox. Please read this before you return to your email.`
)}
${suspectEmailCard(data.fromName, data.fromEmail, data.emailSubject)}
${paragraph(data.explanation || 'This email shows multiple signals consistent with a phishing attempt.')}
${actionList('Do not', doNotItems, 'red')}
${actionList('What to do instead', recommendedItems, 'green')}
${ctaButton('Review in HeyWren', data.reviewUrl)}
${paragraph(`<span style="color:#9ca3af;font-size:13px;">Wren only sends this email when we are highly confident a message is dangerous. If this is a false positive, mark it safe from the alert page and we'll learn from it.</span>`)}
`

  const html = baseLayout({
    preheader: `${severityWord} ${typeLabel} detected — do not click any links`,
    body,
    footerNote: 'Security alerts are sent when Wren detects a high-confidence threat in your inbox.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
