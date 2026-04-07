// lib/email/templates/welcome.ts
// Welcome drip email sequence — Days 0, 1, 3, 7 after signup.

import { baseLayout, ctaButton, paragraph, insightBox, sectionHeading, wrenGreeting, divider } from './base-layout'

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
${wrenGreeting(data.userName, "I'm Wren — your new follow-through partner.")}
${paragraph(`I work quietly in the background, listening to your team's Slack conversations and emails to catch the commitments that usually slip through the cracks.`)}
${paragraph(`No more "I forgot" or "that slipped through." I'll nudge you at the right time so you can stay on top of everything without the mental overhead.`)}
${divider()}
${sectionHeading('Get started in 60 seconds')}
${paragraph(`Connect Slack or Outlook so I can start detecting commitments for you:`)}
${ctaButton('Connect Your First Integration', `${data.appUrl}/onboarding/integrations`)}
${insightBox("I typically find 5-10 commitments in your first hour — things you've said you'd do that might have otherwise been forgotten.")}
${paragraph(`Just hit reply if you have questions — I'm here to help.`)}
`

  return {
    subject: `Welcome to HeyWren — I've got your back`,
    html: baseLayout({
      preheader: "Your AI follow-through partner is ready to go",
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 1: First Value ---

export function buildWelcomeDay1(data: WelcomeDay1Data): { subject: string; html: string } {
  const body = data.hasIntegration
    ? `
${wrenGreeting(data.userName, "I've been listening — and I found some things.")}
${paragraph(`Since you connected, I've detected <strong>${data.commitmentsDetected} commitment${data.commitmentsDetected !== 1 ? 's' : ''}</strong> from your conversations — promises, action items, and follow-ups that might have slipped through.`)}
${ctaButton("See What I Found", `${data.appUrl}/commitments`)}
${insightBox("Tip: Mark items complete as you finish them. It builds your Wren Score and keeps your team in the loop.")}
`
    : `
${wrenGreeting(data.userName, "I'm ready to start — just need a quick connection.")}
${paragraph(`Connect Slack or Outlook so I can start catching the commitments buried in your conversations. Takes under 60 seconds.`)}
${ctaButton('Connect an Integration', `${data.appUrl}/onboarding/integrations`)}
${insightBox("Teams that connect in the first 24 hours see 3x more value from HeyWren in week one.")}
`

  const subject = data.hasIntegration
    ? `I found ${data.commitmentsDetected} commitments — take a look`
    : `Quick setup: connect Slack to start catching commitments`

  return {
    subject,
    html: baseLayout({
      preheader: data.hasIntegration
        ? `${data.commitmentsDetected} commitments detected so far`
        : 'One quick step to get started',
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
${wrenGreeting(data.userName, `Your team of ${data.teamMemberCount} is already on HeyWren. Here's what you unlocked:`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:16px;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;border:1px solid #e9e5ff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#127942; <strong>Leaderboards</strong> — friendly competition drives follow-through</td></tr>
        <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#128200; <strong>Team dashboard</strong> — real-time view of everyone's commitments</td></tr>
        <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#129309; <strong>Collaboration insights</strong> — see who works with whom</td></tr>
        <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#128680; <strong>Manager alerts</strong> — early burnout and workload detection</td></tr>
      </table>
    </td>
  </tr>
</table>
${ctaButton('Explore Team Dashboard', `${data.appUrl}/team-dashboard`)}
`
    : `
${wrenGreeting(data.userName, 'HeyWren gets way better with your team.')}
${paragraph(`When teammates join, you unlock leaderboards, collaboration insights, a shared team dashboard, and proactive manager alerts for burnout and workload.`)}
${paragraph(`Invite your first teammate — takes 10 seconds:`)}
${ctaButton('Invite Your Team', `${data.appUrl}/team-management`)}
${insightBox("Teams using HeyWren together see 2x improvement in follow-through rates.")}
`

  return {
    subject: hasTeam
      ? `Your team is on HeyWren — explore what's unlocked`
      : `Invite your team to unlock HeyWren's best features`,
    html: baseLayout({
      preheader: hasTeam
        ? 'Leaderboards, collaboration insights, and more'
        : 'Better together — team features are waiting',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 7: Week One Recap ---

export function buildWelcomeDay7(data: WelcomeDay7Data): { subject: string; html: string } {
  const body = `
${wrenGreeting(data.userName, "You've been with me for a week — here's how it went.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;margin:16px 0;border:1px solid #e9e5ff;">
  <tr>
    <td style="padding:20px;text-align:center;width:50%;">
      <div style="font-size:32px;font-weight:800;color:#4f46e5;letter-spacing:-0.02em;">${data.totalPoints}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Points Earned</div>
    </td>
    <td style="padding:20px;text-align:center;width:50%;">
      <div style="font-size:32px;font-weight:800;color:#4f46e5;letter-spacing:-0.02em;">${data.commitmentsCompleted}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Completed</div>
    </td>
  </tr>
</table>
${data.achievementEarned ? insightBox(`Achievement unlocked: <strong>${data.achievementEarned}</strong>`) : ''}
${paragraph(`Every week you stay active builds your streak and earns you badges. Keep the momentum going.`)}
${ctaButton('View Your Dashboard', `${data.appUrl}/dashboard`)}
`

  return {
    subject: `Your first week: ${data.totalPoints} pts earned`,
    html: baseLayout({
      preheader: `${data.commitmentsCompleted} commitments completed in week one`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
