// lib/email/templates/achievement.ts
// Achievement and milestone celebration emails.

import { baseLayout, ctaButton, paragraph, wrenGreeting, divider } from './base-layout'

export interface AchievementEmailData {
  userName: string
  achievementName: string
  achievementDescription: string
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  reason: string
  nextAchievement?: { name: string; progress: number; target: number } | null
  dashboardUrl: string
  unsubscribeUrl: string
}

export interface StreakEmailData {
  userName: string
  streakWeeks: number
  dashboardUrl: string
  unsubscribeUrl: string
}

const TIER_STYLES: Record<string, { bg: string; border: string; text: string; emoji: string }> = {
  bronze: { bg: 'linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)', border: '#fcd34d', text: '#92400e', emoji: '&#129353;' },
  silver: { bg: 'linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%)', border: '#cbd5e1', text: '#475569', emoji: '&#129352;' },
  gold: { bg: 'linear-gradient(135deg,#fef9c3 0%,#fde68a 100%)', border: '#fbbf24', text: '#854d0e', emoji: '&#127942;' },
  platinum: { bg: 'linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)', border: '#a78bfa', text: '#5b21b6', emoji: '&#128142;' },
}

export function buildAchievementEmail(data: AchievementEmailData): { subject: string; html: string } {
  const style = TIER_STYLES[data.tier] || TIER_STYLES.bronze

  const nextHtml = data.nextAchievement
    ? `${divider()}
<p style="margin:0 0 8px;color:#6b7280;font-size:13px;font-weight:600;">Next up: ${data.nextAchievement.name}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#e5e7eb;border-radius:10px;height:10px;padding:0;">
      <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);height:10px;width:${Math.min(100, Math.round((data.nextAchievement.progress / data.nextAchievement.target) * 100))}%;border-radius:10px;"></div>
    </td>
  </tr>
</table>
<p style="margin:6px 0 0;color:#9ca3af;font-size:12px;">${data.nextAchievement.progress} / ${data.nextAchievement.target}</p>`
    : ''

  const body = `
${wrenGreeting(data.userName, "You earned something special.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="background:${style.bg};padding:28px 44px;border-radius:16px;text-align:center;border:2px solid ${style.border};">
            <div style="font-size:36px;line-height:1;">${style.emoji}</div>
            <div style="font-size:20px;font-weight:700;color:${style.text};margin-top:12px;letter-spacing:-0.01em;">${data.achievementName}</div>
            <div style="font-size:13px;color:${style.text};opacity:0.8;margin-top:4px;">${data.achievementDescription}</div>
            <div style="margin-top:12px;display:inline-block;background:${style.text};color:white;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${data.tier}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
${paragraph(data.reason)}
${nextHtml}
${ctaButton('View Your Achievements', `${data.dashboardUrl}/wren-score`)}
`

  return {
    subject: `You earned ${data.achievementName}`,
    html: baseLayout({
      preheader: `${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)} badge unlocked — ${data.achievementName}`,
      body,
      footerNote: 'Keep up the great work!',
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

export function buildStreakEmail(data: StreakEmailData): { subject: string; html: string } {
  let milestoneMessage: string
  if (data.streakWeeks >= 52) {
    milestoneMessage = `A full year of consistent follow-through. That's truly exceptional — fewer than 1% of users reach this.`
  } else if (data.streakWeeks >= 24) {
    milestoneMessage = `Half a year of unbroken follow-through. You're in elite territory now.`
  } else if (data.streakWeeks >= 12) {
    milestoneMessage = `Three months straight. This isn't luck — it's a habit. And your team can tell.`
  } else if (data.streakWeeks >= 8) {
    milestoneMessage = `Two months running. You've built a real rhythm here.`
  } else {
    milestoneMessage = `Consistency compounds. Every week you show up builds trust with your team.`
  }

  const body = `
${wrenGreeting(data.userName, "Your streak keeps growing.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="text-align:center;background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);padding:28px;border-radius:16px;border:1px solid #e9e5ff;">
      <div style="font-size:56px;font-weight:800;color:#4f46e5;letter-spacing:-0.03em;line-height:1;">${data.streakWeeks}</div>
      <div style="font-size:14px;color:#6b7280;margin-top:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">week streak</div>
    </td>
  </tr>
</table>
${paragraph(milestoneMessage)}
${ctaButton('View Your Score', `${data.dashboardUrl}/wren-score`)}
`

  return {
    subject: `${data.streakWeeks}-week streak — you're unstoppable`,
    html: baseLayout({
      preheader: `${data.streakWeeks} consecutive weeks of follow-through`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
