# HeyWren Email Engagement Strategy

## Why Email Matters

HeyWren currently delivers all engagement via **Slack only**. Email adds a critical
second channel that:

- **Reaches users outside Slack** (mobile, personal devices, commute time)
- **Creates a persistent record** users can reference and forward
- **Re-engages dormant users** who stopped checking Slack/dashboard
- **Drives habit formation** with consistent weekly touchpoints
- **Supports managers** who live in email more than Slack

## Email Types (Priority Order)

### 1. Weekly Personal Recap (Monday 8 AM, user timezone)
**Goal:** Habit-forming touchpoint that makes users feel accomplished and informed.

**Content:**
- Your Wren Score this week (points, rank change, streak)
- Commitments completed vs. created
- Overdue items needing attention (count + CTA)
- Top achievement earned (if any)
- One "insight" line (e.g., "Your on-time rate improved 12% this week")
- Quick action buttons: View Dashboard, Review Overdue

**Why it works:** Combines progress celebration with gentle accountability.
Users open it to see their score, then act on overdue items.

---

### 2. Overdue Commitment Nudge (Email fallback, 10 AM weekdays)
**Goal:** Ensure no commitment falls through the cracks, even if Slack is missed.

**Trigger:** Slack nudge sent but not acted on within 24 hours, OR user has
no Slack integration connected.

**Content:**
- Count of overdue items
- Days overdue for the oldest item
- One-click "Mark Complete" or "View All" CTA
- Friendly, non-judgmental tone

**Why it works:** Multichannel nudging dramatically increases follow-through
without increasing annoyance (different channel = fresh context).

---

### 3. Welcome Drip Sequence (Days 0, 1, 3, 7 after signup)
**Goal:** Activate new users through the critical first week.

**Day 0 — Welcome:**
- Warm welcome, reinforce value prop
- CTA: Connect your first integration (Slack/Outlook)

**Day 1 — First Value:**
- "Here's what Wren found" (if commitments detected) OR
- "Connect Slack to start" (if no integration yet)
- Show sample insight to demonstrate value

**Day 3 — Team Power:**
- Encourage inviting teammates
- Show team features preview (leaderboard, collaboration graph)
- CTA: Invite your team

**Day 7 — Week One Recap:**
- First weekly score summary
- Celebrate any achievements earned
- CTA: Explore your dashboard

**Why it works:** Guided activation reduces time-to-value. Each email has ONE
clear action, reducing decision fatigue.

---

### 4. Achievement & Milestone Celebration
**Goal:** Dopamine hit that reinforces positive behavior.

**Triggers:**
- New achievement badge earned
- Streak milestone reached (4, 8, 12, 24, 52 weeks)
- Leaderboard jump (moved up 3+ ranks)
- First commitment completed

**Content:**
- Visual badge/celebration
- What they did to earn it
- Next achievement they're close to (progress bar)
- Social proof: "Join X others who earned this"

**Why it works:** Variable reward timing creates engagement loops.
Showing "next milestone" drives continued behavior.

---

### 5. Manager Weekly Briefing (Monday 9 AM)
**Goal:** Keep managers engaged with team health data via email.

**Content:**
- Team scorecard (points, completion rate, response rate)
- Week-over-week trends (arrows up/down)
- Burnout risk alerts (if any team members flagged)
- Top performers spotlight
- Action items: unresolved manager alerts count
- CTA: Open People Insights, View Team Dashboard

**Why it works:** Managers are the buying decision-makers. Keeping them
engaged with actionable insights drives retention AND expansion.

---

### 6. Re-engagement Email (After 7 days inactive)
**Goal:** Win back users who've gone quiet.

**Trigger:** User hasn't logged in or completed any commitment in 7+ days.

**Content:**
- "We've been keeping an eye on things for you"
- Summary of what accumulated while away (X commitments detected,
  Y items now overdue, Z missed emails)
- Low-effort CTA: "Catch up in 2 minutes"
- Option to adjust notification frequency

**Why it works:** Shows the product kept working even without them,
creating FOMO. Low-effort CTA reduces return friction.

---

## Email Preferences & Opt-out

New columns on `notification_preferences`:
- `email_weekly_recap` (default: true)
- `email_nudges` (default: true)
- `email_achievements` (default: true)
- `email_manager_briefing` (default: true)
- `email_reengagement` (default: true)

All emails include one-click unsubscribe link (CAN-SPAM compliant).
Users can manage granular preferences in Settings.

---

## Delivery Infrastructure

- **Provider:** Resend (already integrated for invites)
- **Sender:** `notifications@heywren.com` (transactional), `hello@heywren.com` (welcome series)
- **Scheduling:** Inngest cron functions (consistent with existing architecture)
- **Tracking:** `email_sends` table logs every send for analytics & dedup
- **Templates:** Shared HTML layout in `lib/email/templates/` with per-email content

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Weekly recap open rate | > 40% |
| Nudge email → commitment resolved | > 15% |
| Welcome Day 0 → integration connected (Day 3) | > 60% |
| Achievement email open rate | > 50% |
| 7-day inactive → re-engaged within 48h | > 20% |
| Email unsubscribe rate | < 0.5% per send |

---

## Implementation Files

```
lib/email/templates/base-layout.ts      — Shared HTML wrapper
lib/email/templates/weekly-recap.ts     — Weekly personal recap
lib/email/templates/nudge.ts            — Overdue commitment nudge
lib/email/templates/welcome.ts          — Welcome drip series
lib/email/templates/achievement.ts      — Achievement celebration
lib/email/templates/manager-briefing.ts — Manager weekly briefing
lib/email/templates/reengagement.ts     — Re-engagement
lib/email/send.ts                       — Generic send helper (Resend)
inngest/functions/email-weekly-recap.ts
inngest/functions/email-nudge-fallback.ts
inngest/functions/email-welcome-drip.ts
inngest/functions/email-achievement.ts
inngest/functions/email-manager-briefing.ts
inngest/functions/email-reengagement.ts
supabase/migrations/044_email_engagement.sql
```
