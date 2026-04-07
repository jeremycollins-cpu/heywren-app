// lib/email/templates/achievement.ts
// Achievement and milestone celebration emails.

import { baseLayout, ctaButton, paragraph, insightBox } from './base-layout'

export interface AchievementEmailData {
  userName: string
  achievementName: string
  achievementDescription: string
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  /** What the user did to earn it */
  reason: string
  /** Next achievement they're close to (optional) */
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

const TIER_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  bronze: { bg: '#fef3c7', text: '#92400e', accent: '#d97706' },
  silver: { bg: '#f1f5f9', text: '#475569', accent: '#64748b' },
  gold: { bg: '#fef9c3', text: '#854d0e', accent: '#ca8a04' },
  platinum: { bg: '#ede9fe', text: '#5b21b6', accent: '#7c3aed' },
}

export function buildAchievementEmail(data: AchievementEmailData): { subject: string; html: string } {
  const colors = TIER_COLORS[data.tier] || TIER_COLORS.bronze

  const nextHtml = data.nextAchievement
    ? `<div style="margin:20px 0;">
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Next up: <strong>${data.nextAchievement.name}</strong></p>
  <div style="background-color:#e5e7eb;border-radius:10px;height:10px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);height:10px;width:${Math.min(100, Math.round((data.nextAchievement.progress / data.nextAchievement.target) * 100))}%;border-radius:10px;"></div>
  </div>
  <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">${data.nextAchievement.progress} / ${data.nextAchievement.target}</p>
</div>`
    : ''

  const body = `
${paragraph(`Hi ${data.userName},`)}
<div style="text-align:center;margin:20px 0;">
  <div style="display:inline-block;background:${colors.bg};padding:24px 40px;border-radius:12px;border:2px solid ${colors.accent};">
    <div style="font-size:14px;color:${colors.text};text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">${data.tier} Achievement</div>
    <div style="font-size:22px;font-weight:700;color:${colors.text};margin-top:8px;">${data.achievementName}</div>
    <div style="font-size:14px;color:${colors.text};opacity:0.8;margin-top:4px;">${data.achievementDescription}</div>
  </div>
</div>
${paragraph(data.reason)}
${nextHtml}
${ctaButton('View Your Achievements', `${data.dashboardUrl}/wren-score`)}
`

  return {
    subject: `You earned a new badge: ${data.achievementName}`,
    html: baseLayout({
      preheader: `${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)} achievement unlocked — ${data.achievementName}`,
      body,
      footerNote: 'Keep up the great work!',
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}

export function buildStreakEmail(data: StreakEmailData): { subject: string; html: string } {
  const milestoneMessage = data.streakWeeks >= 52
    ? `A full year of consistent follow-through. That's truly exceptional.`
    : data.streakWeeks >= 24
    ? `Half a year of unbroken follow-through. You're in elite territory.`
    : data.streakWeeks >= 12
    ? `Three months straight. Your consistency is paying off.`
    : data.streakWeeks >= 8
    ? `Two months running. You're building a real habit here.`
    : `You're building momentum — keep it going!`

  const body = `
${paragraph(`Hi ${data.userName},`)}
<div style="text-align:center;margin:24px 0;">
  <div style="font-size:48px;font-weight:800;color:#4f46e5;">${data.streakWeeks}</div>
  <div style="font-size:16px;color:#6b7280;margin-top:4px;">week streak</div>
</div>
${insightBox(milestoneMessage)}
${ctaButton('View Your Score', `${data.dashboardUrl}/wren-score`)}
`

  return {
    subject: `${data.streakWeeks}-week streak — you're on fire!`,
    html: baseLayout({
      preheader: `${data.streakWeeks} consecutive weeks of activity`,
      body,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
  }
}
