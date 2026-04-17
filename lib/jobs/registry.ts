// lib/jobs/registry.ts
// Catalog of scheduled Inngest jobs that the super admin can trigger on demand
// from the admin dashboard. Each entry ties a human-readable label to the
// Inngest function's ID and the event name it responds to.
//
// To add a new job:
// 1. Add `{ event: 'admin/job.<functionId>' }` as an additional trigger on the
//    function in inngest/functions/<functionId>.ts (alongside the cron).
// 2. Append an entry here.
// 3. It will automatically appear in the admin Scheduled Jobs tab.

export interface ScheduledJobDefinition {
  /** Matches the Inngest function id. Also the job_name written to job_runs. */
  id: string
  /** Category for grouping in the UI. */
  category: 'email' | 'scan' | 'scoring' | 'sync'
  /** Human-readable label. */
  label: string
  /** One-line description shown under the label. */
  description: string
  /** Cron expression (informational — used in the UI to display the schedule). */
  cron: string
  /** Event name to fire via inngest.send() to invoke the job. */
  eventName: string
}

export const ADMIN_TRIGGERABLE_JOBS: ScheduledJobDefinition[] = [
  // ───────── Email ─────────
  {
    id: 'scan-missed-emails',
    category: 'scan',
    label: 'Missed Email Scan',
    description: 'Classifies recent inbound email; sends recipient_gap_alert when someone is mentioned but not CC\'d.',
    cron: '6:30 / 10:30 / 14:30 / 18:30 PT',
    eventName: 'admin/job.scan-missed-emails',
  },
  {
    id: 'wren-morning-brief',
    category: 'email',
    label: 'Morning Brief',
    description: 'Per-user briefing (meetings, missed emails, drafts, overdue items) via Slack and email.',
    cron: '8:30 AM PT weekdays',
    eventName: 'admin/job.wren-morning-brief',
  },
  {
    id: 'email-welcome-drip',
    category: 'email',
    label: 'Welcome Drip',
    description: 'Onboarding sequence (day 0 / 1 / 3 / 7) for new signups.',
    cron: 'every hour',
    eventName: 'admin/job.email-welcome-drip',
  },
  {
    id: 'email-weekly-recap',
    category: 'email',
    label: 'Weekly Recap',
    description: 'Personal score + highlights email to every active user.',
    cron: 'Monday 8:00 UTC',
    eventName: 'admin/job.email-weekly-recap',
  },
  {
    id: 'email-reengagement',
    category: 'email',
    label: 'Re-engagement Email',
    description: 'Nudges users inactive 7+ days (throttled per-user to every 14 days).',
    cron: 'daily 11:00 UTC',
    eventName: 'admin/job.email-reengagement',
  },
  {
    id: 'email-nudge-fallback',
    category: 'email',
    label: 'Email Nudge Fallback',
    description: 'Emails overdue commitments to users without Slack (or who ignored yesterday\'s Slack nudge).',
    cron: '10:00 UTC weekdays',
    eventName: 'admin/job.email-nudge-fallback',
  },
  {
    id: 'email-achievement',
    category: 'email',
    label: 'Achievement & Streak Emails',
    description: 'Celebrates newly-awarded achievements and streak milestones (4/8/12/24/52 weeks).',
    cron: 'Monday 9:00 UTC',
    eventName: 'admin/job.email-achievement',
  },
  {
    id: 'email-manager-briefing',
    category: 'email',
    label: 'Manager Briefing',
    description: 'Weekly summary email to org admins and dept managers.',
    cron: 'Monday 9:00 UTC',
    eventName: 'admin/job.email-manager-briefing',
  },
  // ───────── Scoring ─────────
  {
    id: 'calculate-weekly-scores',
    category: 'scoring',
    label: 'Calculate Weekly Scores',
    description: 'Computes per-user weekly points, streaks, and awards achievements. Upstream of recap + achievement emails.',
    cron: 'Monday 6:00 UTC',
    eventName: 'admin/job.calculate-weekly-scores',
  },
]

export function getJobById(id: string): ScheduledJobDefinition | undefined {
  return ADMIN_TRIGGERABLE_JOBS.find(j => j.id === id)
}
