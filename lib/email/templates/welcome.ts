// lib/email/templates/welcome.ts
// Welcome drip email sequence — Days 0, 1, 3, 7 after signup.

import { baseLayout, ctaButton, paragraph, insightBox, sectionHeading } from './base-layout'

export interface WelcomeEmailData {
  userName: string
  appUrl: string
  unsubscribeUrl: string
}

export interface WelcomeDay1Data extends WelcomeEmailData {
  hasIntegration: boolean
  commitmentsDetected: number
}

export interface WelcomeDay3Data extends WelcomeEmailData {
  teamMemberCount: number
}

export interface WelcomeDay7Data extends WelcomeEmailData {
  totalPoints: number
  commitmentsCompleted: number
  achievementEarned?: string | null
}

// --- Day 0: Welcome ---

export function buildWelcomeDay0(data: WelcomeEmailData): { subject: string; html: string } {
  const body = `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`Welcome to <strong>HeyWren</strong> — your AI-powered follow-through partner.`)}
${paragraph(`Wren works quietly in the background, monitoring your team's conversations to catch commitments before they fall through the cracks. No more "I forgot" or "that slipped through."`)}
${sectionHeading('Get started in 2 minutes')}
${paragraph(`Connect your first integration so Wren can start detecting commitments for you:`)}
${ctaButton('Connect Slack or Outlook', `${data.appUrl}/onboarding/integrations`)}
${insightBox('Once connected, Wren typically finds 5-10 commitments in your first hour — without you lifting a finger.')}
${paragraph(`Questions? Just reply to this email — we read every one.`)}
`

  return {
    subject: `Welcome to HeyWren — let's make sure nothing falls through`,
    html: baseLayout({
      preheader: 'Your AI-powered follow-through partner is ready',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 1: First Value ---

export function buildWelcomeDay1(data: WelcomeDay1Data): { subject: string; html: string } {
  const body = data.hasIntegration
    ? `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`Great news — Wren has been working since you connected and has already detected <strong>${data.commitmentsDetected} commitment${data.commitmentsDetected !== 1 ? 's' : ''}</strong> from your conversations.`)}
${paragraph(`These are promises, action items, and follow-ups that might have otherwise been forgotten.`)}
${ctaButton('See What Wren Found', `${data.appUrl}/commitments`)}
${insightBox('Tip: Mark items as complete as you finish them. This builds your Wren Score and keeps your team informed.')}
`
    : `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`Wren is ready to start working for you — but it needs a connection first.`)}
${paragraph(`Connect Slack or Outlook to let Wren automatically detect commitments from your conversations. Setup takes under 60 seconds.`)}
${ctaButton('Connect an Integration', `${data.appUrl}/onboarding/integrations`)}
${insightBox('Teams that connect in the first 24 hours see 3x more value from HeyWren in their first week.')}
`

  const subject = data.hasIntegration
    ? `Wren found ${data.commitmentsDetected} commitments — take a look`
    : `Quick setup: connect Slack to start catching commitments`

  return {
    subject,
    html: baseLayout({
      preheader: data.hasIntegration
        ? `${data.commitmentsDetected} commitments detected so far`
        : 'Connect your first integration to get started',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 3: Team Power ---

export function buildWelcomeDay3(data: WelcomeDay3Data): { subject: string; html: string } {
  const hasTeam = data.teamMemberCount > 1

  const body = hasTeam
    ? `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`Your team of <strong>${data.teamMemberCount}</strong> is already on HeyWren. Nice!`)}
${paragraph(`Here's what unlocks with a full team:`)}
<ul style="color:#4a4a68;font-size:15px;line-height:1.8;padding-left:20px;">
  <li><strong>Leaderboards</strong> — friendly competition drives follow-through</li>
  <li><strong>Collaboration insights</strong> — see who works with whom</li>
  <li><strong>Team dashboard</strong> — real-time view of your team's commitments</li>
  <li><strong>Manager alerts</strong> — proactive burnout and workload detection</li>
</ul>
${ctaButton('Explore Team Dashboard', `${data.appUrl}/team-dashboard`)}
`
    : `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`HeyWren gets even better with your team. When teammates join, you unlock:`)}
<ul style="color:#4a4a68;font-size:15px;line-height:1.8;padding-left:20px;">
  <li><strong>Leaderboards</strong> — friendly competition drives follow-through</li>
  <li><strong>Collaboration insights</strong> — see who works with whom</li>
  <li><strong>Team dashboard</strong> — real-time view of everyone's commitments</li>
  <li><strong>Manager alerts</strong> — proactive burnout and workload detection</li>
</ul>
${paragraph(`Invite your first teammate — it takes 10 seconds:`)}
${ctaButton('Invite Your Team', `${data.appUrl}/team-management`)}
`

  return {
    subject: hasTeam
      ? `Your team is on HeyWren — explore what you can do together`
      : `Invite your team to unlock HeyWren's best features`,
    html: baseLayout({
      preheader: hasTeam
        ? 'Leaderboards, collaboration insights, and more are ready'
        : 'Teams that use HeyWren together see 2x follow-through improvement',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 7: Week One Recap ---

export function buildWelcomeDay7(data: WelcomeDay7Data): { subject: string; html: string } {
  const body = `
${paragraph(`Hi ${data.userName},`)}
${paragraph(`You've been on HeyWren for a week! Here's how your first week went:`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin:16px 0;">
  <tr>
    <td style="padding:16px;text-align:center;width:50%;">
      <div style="font-size:28px;font-weight:700;color:#4f46e5;">${data.totalPoints}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px;">Points Earned</div>
    </td>
    <td style="padding:16px;text-align:center;width:50%;">
      <div style="font-size:28px;font-weight:700;color:#4f46e5;">${data.commitmentsCompleted}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px;">Commitments Completed</div>
    </td>
  </tr>
</table>
${data.achievementEarned ? insightBox(`Achievement unlocked: <strong>${data.achievementEarned}</strong>`) : ''}
${paragraph(`Keep it up! Every week you stay active builds your streak and earns you badges.`)}
${ctaButton('View Your Dashboard', `${data.appUrl}/dashboard`)}
`

  return {
    subject: `Your first week on HeyWren: ${data.totalPoints} points earned`,
    html: baseLayout({
      preheader: `${data.commitmentsCompleted} commitments completed in your first week`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
