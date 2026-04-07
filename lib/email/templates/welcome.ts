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
${wrenGreeting(data.userName, "Welcome to HeyWren. I'm Wren — your AI follow-through partner.")}
${paragraph(`Think about the last week. How many times did someone say <em>"I'll send that over,"</em> <em>"Let me follow up,"</em> or <em>"I'll have that done by Friday"</em> — and it never happened? That's the problem I solve.`)}
${paragraph(`I listen to your Slack conversations and emails in the background, automatically detecting the commitments your team makes every day. Then I nudge you at the right moment — before things go overdue, not after.`)}

${divider()}

${sectionHeading("Here's what changes with Wren")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:20px;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;border:1px solid #e9e5ff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:10px 0;color:#4a4a68;font-size:14px;line-height:1.6;">
            <strong style="color:#4f46e5;">Commitments get caught</strong><br/>
            <span style="color:#6b7280;">I scan your messages and emails to find promises, action items, and follow-ups — no manual tracking needed.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">
            <strong style="color:#4f46e5;">Smart nudges, not spam</strong><br/>
            <span style="color:#6b7280;">I'll remind you in Slack or email at 9 AM on weekdays — only for things that are overdue or at risk. No noise.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">
            <strong style="color:#4f46e5;">Missed emails surfaced</strong><br/>
            <span style="color:#6b7280;">I flag emails that need a response so nothing gets buried in your inbox.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">
            <strong style="color:#4f46e5;">Your Wren Score grows</strong><br/>
            <span style="color:#6b7280;">Earn points, build streaks, and unlock badges as you follow through. See how you stack up on the team leaderboard.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">
            <strong style="color:#4f46e5;">Weekly recaps every Monday</strong><br/>
            <span style="color:#6b7280;">Start your week with a clear picture — what you completed, what's overdue, and where you stand.</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

${divider()}

${sectionHeading("One step to get started")}
${paragraph(`Connect Slack or Outlook so I can start detecting commitments from your conversations. It takes 60 seconds and I'll scan the last 30 days of your messages automatically.`)}
${ctaButton('Connect Your First Integration', `${data.appUrl}/onboarding/integrations`)}
${insightBox("Most users see their first commitments within an hour of connecting. I typically find 5-10 things you said you'd do that might have otherwise been forgotten.")}

${divider()}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
  <tr>
    <td style="padding:16px 20px;background-color:#fafbfc;border-radius:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;font-weight:600;">What to expect this week:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;line-height:1.6;">
          <strong style="color:#4a4a68;">Today</strong> — Connect Slack or Outlook, I'll start scanning
        </td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;line-height:1.6;">
          <strong style="color:#4a4a68;">Tomorrow</strong> — I'll email you what I found
        </td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;line-height:1.6;">
          <strong style="color:#4a4a68;">Day 3</strong> — Tips on getting your team onboard
        </td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;line-height:1.6;">
          <strong style="color:#4a4a68;">Day 7</strong> — Your first weekly recap with Wren Score
        </td></tr>
      </table>
    </td>
  </tr>
</table>

${paragraph(`<span style="color:#6b7280;font-size:13px;">Questions? Just reply to this email — it goes straight to our team.</span>`)}
`

  return {
    subject: `Welcome to HeyWren — nothing falls through the cracks`,
    html: baseLayout({
      preheader: "Your AI follow-through partner is ready. Here's what changes now.",
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 1: First Value ---

export function buildWelcomeDay1(data: WelcomeDay1Data): { subject: string; html: string } {
  const body = data.hasIntegration
    ? `
${wrenGreeting(data.userName, "I've been scanning your conversations — and I found some things.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="text-align:center;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);padding:24px;border-radius:12px;border:1px solid #e9e5ff;">
      <div style="font-size:40px;font-weight:800;color:#4f46e5;letter-spacing:-0.03em;line-height:1;">${data.commitmentsDetected}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:6px;font-weight:500;">commitment${data.commitmentsDetected !== 1 ? 's' : ''} detected from your conversations</div>
    </td>
  </tr>
</table>
${paragraph(`These are promises, action items, and follow-ups that were buried in your messages. Now they're tracked — and I'll nudge you before any of them go overdue.`)}
${ctaButton("Review What I Found", `${data.appUrl}/commitments`)}
${divider()}
${sectionHeading("Quick tips for your first day")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.7;">&#10003; <strong>Mark items complete</strong> as you finish them — it builds your Wren Score</td></tr>
  <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.7;">&#10003; <strong>Dismiss anything stale</strong> — cancel items that are no longer relevant</td></tr>
  <tr><td style="padding:6px 0;color:#4a4a68;font-size:14px;line-height:1.7;">&#10003; <strong>Check "Missed Emails"</strong> — I flagged emails that may need a response</td></tr>
</table>
`
    : `
${wrenGreeting(data.userName, "I'm ready to start working for you — just need one quick step.")}
${paragraph(`Connect Slack or Outlook so I can start catching the commitments buried in your conversations. Once connected, I'll scan the last 30 days of messages and surface everything that needs your attention.`)}
${ctaButton('Connect an Integration', `${data.appUrl}/onboarding/integrations`)}
${insightBox("Most users who connect on Day 1 find commitments within the first hour. The longer you wait, the more things slip through.")}
${paragraph(`<strong>What I'll do once connected:</strong>`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:4px 0;color:#4a4a68;font-size:14px;line-height:1.7;">1. Scan your last 30 days of messages</td></tr>
  <tr><td style="padding:4px 0;color:#4a4a68;font-size:14px;line-height:1.7;">2. Detect commitments you've made</td></tr>
  <tr><td style="padding:4px 0;color:#4a4a68;font-size:14px;line-height:1.7;">3. Flag missed emails needing a response</td></tr>
  <tr><td style="padding:4px 0;color:#4a4a68;font-size:14px;line-height:1.7;">4. Start sending smart nudges before things go overdue</td></tr>
</table>
`

  const subject = data.hasIntegration
    ? `I found ${data.commitmentsDetected} commitments in your conversations`
    : `Quick setup: connect Slack so I can start working for you`

  return {
    subject,
    html: baseLayout({
      preheader: data.hasIntegration
        ? `${data.commitmentsDetected} commitments detected — review them now`
        : 'One step away from automatic follow-through',
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
${wrenGreeting(data.userName, `Your team of ${data.teamMemberCount} is on HeyWren. Here's what that unlocks:`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:20px;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;border:1px solid #e9e5ff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;color:#4a4a68;font-size:14px;line-height:1.6;">&#127942; <strong>Leaderboards</strong> — friendly competition that drives real follow-through</td></tr>
        <tr><td style="padding:8px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">&#128200; <strong>Team dashboard</strong> — real-time view of everyone's commitments and progress</td></tr>
        <tr><td style="padding:8px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">&#129309; <strong>Collaboration insights</strong> — see who works with whom and where handoffs break down</td></tr>
        <tr><td style="padding:8px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;">&#128680; <strong>Manager alerts</strong> — proactive burnout detection and workload balancing</td></tr>
      </table>
    </td>
  </tr>
</table>
${ctaButton('Explore Your Team Dashboard', `${data.appUrl}/team-dashboard`)}
`
    : `
${wrenGreeting(data.userName, 'HeyWren gets way more powerful with your team.')}
${paragraph(`Right now, I'm tracking your commitments. But when your teammates join, the whole picture comes together — you can see who owes what to whom, celebrate wins together, and catch problems before they snowball.`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:20px;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;border:1px solid #e9e5ff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;color:#4a4a68;font-size:14px;line-height:1.6;"><strong style="color:#4f46e5;">For you:</strong> See your follow-through rate per person and build trust with everyone you work with</td></tr>
        <tr><td style="padding:8px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;"><strong style="color:#4f46e5;">For your team:</strong> Leaderboards, shared dashboards, and weekly recaps that keep everyone aligned</td></tr>
        <tr><td style="padding:8px 0;border-top:1px solid #e9e5ff;color:#4a4a68;font-size:14px;line-height:1.6;"><strong style="color:#4f46e5;">For managers:</strong> Proactive alerts for burnout, workload imbalance, and engagement drops</td></tr>
      </table>
    </td>
  </tr>
</table>
${paragraph(`Invite your first teammate — takes 10 seconds:`)}
${ctaButton('Invite Your Team', `${data.appUrl}/team-management`)}
${insightBox("Teams using HeyWren together see 2x improvement in follow-through rates.")}
`

  return {
    subject: hasTeam
      ? `Your team is on HeyWren — see what's unlocked`
      : `Invite your team to unlock the full picture`,
    html: baseLayout({
      preheader: hasTeam
        ? 'Leaderboards, collaboration insights, and manager alerts are ready'
        : 'Better together — team features are one invite away',
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

// --- Day 7: Week One Recap ---

export function buildWelcomeDay7(data: WelcomeDay7Data): { subject: string; html: string } {
  // Personalized intro based on their week
  let introMessage: string
  if (data.commitmentsCompleted >= 5) {
    introMessage = "Your first week was strong. Here's what you accomplished:"
  } else if (data.totalPoints > 0) {
    introMessage = "You've been with me for a week. Here's how your first week went:"
  } else {
    introMessage = "You've been on HeyWren for a week — here's where you stand:"
  }

  const body = `
${wrenGreeting(data.userName, introMessage)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;margin:16px 0;border:1px solid #e9e5ff;">
  <tr>
    <td style="padding:24px;text-align:center;width:50%;">
      <div style="font-size:36px;font-weight:800;color:#4f46e5;letter-spacing:-0.03em;">${data.totalPoints}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Points Earned</div>
    </td>
    <td style="padding:24px;text-align:center;width:50%;">
      <div style="font-size:36px;font-weight:800;color:#4f46e5;letter-spacing:-0.03em;">${data.commitmentsCompleted}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Completed</div>
    </td>
  </tr>
</table>
${data.achievementEarned ? insightBox(`Achievement unlocked: <strong>${data.achievementEarned}</strong>`) : ''}
${divider()}
${sectionHeading("What's next")}
${paragraph(`Starting this Monday, you'll get a <strong>weekly recap</strong> every week — your score, achievements, overdue items, and how you compare to your team. It's the best way to start your week with clarity.`)}
${paragraph(`Every week you stay active builds your streak. Keep the momentum going.`)}
${ctaButton('View Your Dashboard', `${data.appUrl}/dashboard`)}
`

  return {
    subject: data.commitmentsCompleted > 0
      ? `Week one: ${data.commitmentsCompleted} commitments completed, ${data.totalPoints} pts`
      : `Your first week on HeyWren — ${data.totalPoints} pts earned`,
    html: baseLayout({
      preheader: `${data.commitmentsCompleted} completed in your first week — weekly recaps start Monday`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
