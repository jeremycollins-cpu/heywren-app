// lib/email/templates/morning-brief.ts
// Daily morning brief email — mirrors the Slack DM version for users without Slack.

import { baseLayout, ctaButton, secondaryButton, paragraph, sectionHeading, wrenGreeting, divider } from './base-layout'

export interface MorningBriefEmailData {
  userName: string
  greeting: string
  appUrl: string
  unsubscribeUrl: string
  // Sections — each is optional; only non-empty sections render
  calendarConflicts?: Array<{ description: string; severity: string }>
  threats?: Array<{ subject: string; fromEmail: string; threatLevel: string }>
  meetings?: Array<{ time: string; subject: string }>
  missedEmails?: Array<{ fromName: string; subject: string; urgency: string }>
  missedChats?: Array<{ fromName: string; preview: string; urgency: string }>
  overdueCommitments?: Array<{ title: string }>
  draftsCount?: number
  waitingRoomCount?: number
}

function alertBox(color: string, borderColor: string, textColor: string, content: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
  <tr>
    <td style="background-color:${color};border-left:4px solid ${borderColor};padding:12px 16px;border-radius:0 8px 8px 0;">
      <p style="margin:0;color:${textColor};font-size:13px;line-height:1.6;">${content}</p>
    </td>
  </tr>
</table>`
}

export function buildMorningBriefEmail(data: MorningBriefEmailData): { subject: string; html: string } | null {
  const sections: string[] = []
  const subjectParts: string[] = []

  // Calendar conflicts
  if (data.calendarConflicts && data.calendarConflicts.length > 0) {
    const critical = data.calendarConflicts.filter(c => c.severity === 'critical')
    const items = (critical.length > 0 ? critical : data.calendarConflicts)
      .map(c => alertBox('#fef2f2', '#ef4444', '#991b1b', c.description))
      .join('')
    sections.push(`${sectionHeading(`${data.calendarConflicts.length} Calendar Conflict${data.calendarConflicts.length !== 1 ? 's' : ''}`)}${items}`)
    subjectParts.push(`${data.calendarConflicts.length} conflict${data.calendarConflicts.length !== 1 ? 's' : ''}`)
  }

  // Security threats
  if (data.threats && data.threats.length > 0) {
    const items = data.threats
      .map(t => alertBox('#fef2f2', '#dc2626', '#991b1b', `<strong>${t.threatLevel.toUpperCase()}:</strong> "${t.subject}" from ${t.fromEmail}`))
      .join('')
    sections.push(`${sectionHeading(`${data.threats.length} Suspicious Email${data.threats.length !== 1 ? 's' : ''}`)}${items}${paragraph('<span style="color:#dc2626;font-weight:600;">Review in Security Alerts before interacting with these emails.</span>')}`)
    subjectParts.push(`${data.threats.length} security alert${data.threats.length !== 1 ? 's' : ''}`)
  }

  // Today's meetings
  if (data.meetings && data.meetings.length > 0) {
    const items = data.meetings
      .map(m => `<tr><td style="padding:4px 0;font-size:13px;color:#374151;"><strong>${m.time}</strong> — ${m.subject}</td></tr>`)
      .join('')
    sections.push(`${sectionHeading(`Today's Meetings (${data.meetings.length})`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">${items}</table>`)
  }

  // Missed emails
  if (data.missedEmails && data.missedEmails.length > 0) {
    const highPriority = data.missedEmails.filter(e => e.urgency === 'critical' || e.urgency === 'high')
    const displayEmails = highPriority.length > 0 ? highPriority : data.missedEmails.slice(0, 3)
    const items = displayEmails
      .map(e => alertBox('#fffbeb', '#f59e0b', '#92400e', `From <strong>${e.fromName}</strong>: "${e.subject}"`))
      .join('')
    sections.push(`${sectionHeading(`${data.missedEmails.length} Email${data.missedEmails.length !== 1 ? 's' : ''} Awaiting Your Reply`)}${items}`)
    subjectParts.push(`${data.missedEmails.length} missed email${data.missedEmails.length !== 1 ? 's' : ''}`)
  }

  // Missed chats
  if (data.missedChats && data.missedChats.length > 0) {
    const items = data.missedChats.slice(0, 3)
      .map(c => alertBox('#f5f3ff', '#7c3aed', '#5b21b6', `<strong>${c.fromName}:</strong> "${c.preview}"`))
      .join('')
    sections.push(`${sectionHeading(`${data.missedChats.length} Slack Message${data.missedChats.length !== 1 ? 's' : ''} Need a Reply`)}${items}`)
    subjectParts.push(`${data.missedChats.length} missed chat${data.missedChats.length !== 1 ? 's' : ''}`)
  }

  // Overdue commitments
  if (data.overdueCommitments && data.overdueCommitments.length > 0) {
    const items = data.overdueCommitments.slice(0, 3)
      .map(c => `<tr><td style="padding:3px 0 3px 12px;font-size:13px;color:#991b1b;">&#8226; ${c.title}</td></tr>`)
      .join('')
    const more = data.overdueCommitments.length > 3 ? `<tr><td style="padding:3px 0 3px 12px;font-size:13px;color:#6b7280;">...and ${data.overdueCommitments.length - 3} more</td></tr>` : ''
    sections.push(`${sectionHeading(`${data.overdueCommitments.length} Overdue Commitment${data.overdueCommitments.length !== 1 ? 's' : ''}`)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">${items}${more}</table>`)
    subjectParts.push(`${data.overdueCommitments.length} overdue`)
  }

  // Drafts ready
  if (data.draftsCount && data.draftsCount > 0) {
    sections.push(paragraph(`<strong>${data.draftsCount} draft${data.draftsCount !== 1 ? 's' : ''}</strong> ready to review and send. ${secondaryButton('Review Drafts', `${data.appUrl}/draft-queue`)}`))
  }

  // Waiting room
  if (data.waitingRoomCount && data.waitingRoomCount > 0) {
    sections.push(paragraph(`<strong>${data.waitingRoomCount} sent email${data.waitingRoomCount !== 1 ? 's' : ''}</strong> still waiting for a reply. ${secondaryButton('View Waiting Room', `${data.appUrl}/waiting-room`)}`))
  }

  // Skip if nothing to report
  if (sections.length === 0) return null

  const subject = subjectParts.length > 0
    ? `Your morning brief: ${subjectParts.join(', ')}`
    : `Your morning brief for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`

  const body = `
${wrenGreeting(data.userName, data.greeting)}
${sections.join(divider())}
${divider()}
${ctaButton('Open Dashboard', data.appUrl)}
`

  const html = baseLayout({
    preheader: subjectParts.join(' · ') || 'Your daily briefing from Wren',
    body,
    footerNote: 'Wren sends this every weekday morning. Manage in Settings.',
    unsubscribeUrl: data.unsubscribeUrl,
  })

  return { subject, html }
}
