// app/api/inngest/route.ts
// Inngest event server — registers all background functions
// Make sure INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY are set in Vercel env vars

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { processSlackMention } from '@/inngest/functions/process-slack-mention'
import { processSlackMessage } from '@/inngest/functions/process-slack-message'
import { dailyDigest } from '@/inngest/functions/daily-digest'
import { sendNudges } from '@/inngest/functions/send-nudges'
import { syncOutlook, adminFullResync } from '@/inngest/functions/sync-outlook'
import { drainOutlookBacklog } from '@/inngest/functions/drain-outlook-backlog'
import { generateDrafts } from '@/inngest/functions/generate-drafts'
import { scanMissedEmails } from '@/inngest/functions/scan-missed-emails'
import { detectCommitmentCompletion } from '@/inngest/functions/detect-commitment-completion'
import { scanAwaitingReplies } from '@/inngest/functions/scan-awaiting-replies'
import { processMeetingTranscript } from '@/inngest/functions/process-meeting-transcript'
import {
  syncPlatformRecordings,
  handleZoomRecordingCompleted,
  handleGoogleMeetRecording,
  scheduledPlatformSync,
} from '@/inngest/functions/sync-platform-recordings'
import { calculateWeeklyScoresJob } from '@/inngest/functions/calculate-weekly-scores'
import { managerWeeklyDigest } from '@/inngest/functions/manager-weekly-digest'
import { detectStaleCommitments } from '@/inngest/functions/detect-stale-commitments'
import { learnResponsePatterns } from '@/inngest/functions/learn-response-patterns'
import { aggregateMonthlySentiment } from '@/inngest/functions/aggregate-monthly-sentiment'
import { generateManagerAlerts } from '@/inngest/functions/generate-manager-alerts'
import { emailWelcomeDrip } from '@/inngest/functions/email-welcome-drip'
import { emailWeeklyRecap } from '@/inngest/functions/email-weekly-recap'
import { emailNudgeFallback } from '@/inngest/functions/email-nudge-fallback'
import { emailAchievement } from '@/inngest/functions/email-achievement'
import { emailManagerBriefing } from '@/inngest/functions/email-manager-briefing'
import { emailReengagement } from '@/inngest/functions/email-reengagement'
import { scanEmailSubscriptions } from '@/inngest/functions/scan-email-subscriptions'
import { syncEmailFolders } from '@/inngest/functions/sync-email-folders'
import { applyEmailRule } from '@/inngest/functions/apply-email-rule'
import { generateMeetingFollowups } from '@/inngest/functions/generate-meeting-followups'
import { wrenMorningBrief } from '@/inngest/functions/wren-morning-brief'
import { scanCalendarConflicts } from '@/inngest/functions/scan-calendar-conflicts'
import { scanEmailThreats } from '@/inngest/functions/scan-email-threats'
import { processBccEmail } from '@/inngest/functions/process-bcc-email'
import { pollWrenMailbox } from '@/inngest/functions/poll-wren-mailbox'
import { scanStaleEmails } from '@/inngest/functions/scan-stale-emails'
import { scheduleRecallBots, dispatchManualRecallBot } from '@/inngest/functions/schedule-recall-bots'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processSlackMention,  // @HeyWren mentions — detects commitments and replies in Slack
    processSlackMessage,  // Passive monitoring — processes all channel messages silently
    dailyDigest,          // 8 AM daily — team activity summary
    sendNudges,           // 9 AM weekdays — commitment reminders
    syncOutlook,          // 6 AM PT daily — sync Outlook emails & calendar
    generateDrafts,       // 7 AM PT daily — AI follow-up draft generation
    scanMissedEmails,     // 6:30 AM PT daily — scan for emails needing a response
    detectCommitmentCompletion, // Auto-resolves commitments when follow-up messages indicate completion
    scanAwaitingReplies,  // 7 AM PT daily — "The Waiting Room" scan for sent items with no reply
    processMeetingTranscript, // Meeting transcript → commitment extraction + "Hey Wren" detection
    syncPlatformRecordings,      // On-demand sync: Zoom, Google Meet, Teams recording transcripts
    handleZoomRecordingCompleted, // Webhook: Zoom recording completed → download transcript
    handleGoogleMeetRecording,   // Webhook: Google Meet recording available → trigger sync
    scheduledPlatformSync,       // Cron: every 30 min — sync all connected platform recordings
    calculateWeeklyScoresJob,    // Monday 6 AM UTC — weekly scores, streaks, achievements, leaderboards
    managerWeeklyDigest,         // Monday 8 AM UTC — BI digest DM to managers via Slack
    adminFullResync,             // On-demand — admin triggers 90-day full resync for a user
    drainOutlookBacklog,         // Hourly + on-demand — processes all unprocessed email backlog
    detectStaleCommitments,      // 8 AM PT weekdays — notify users about 14+ day old open commitments
    learnResponsePatterns,       // Monday 7 AM PT — learn user response patterns for smarter escalation
    aggregateMonthlySentiment,   // 1st of month 6 AM UTC — aggregate sentiment into culture snapshots
    generateManagerAlerts,       // Monday 7 AM UTC — proactive alerts for managers (burnout, overload, sentiment shifts)
    // Email engagement
    emailWelcomeDrip,            // Hourly — welcome drip sequence (Day 0, 1, 3, 7)
    emailWeeklyRecap,            // Monday 8 AM UTC — personal weekly recap email
    emailNudgeFallback,          // 10 AM weekdays — email nudge for overdue items (Slack fallback)
    emailAchievement,            // Monday 9 AM UTC — achievement & streak celebration emails
    emailManagerBriefing,        // Monday 9 AM UTC — manager weekly briefing email
    emailReengagement,           // 11 AM daily — re-engagement email for 7+ day inactive users
    scanEmailSubscriptions,      // 7 AM PT daily — surface marketing emails with unsubscribe links
    syncEmailFolders,            // Every 6 hours — cache Outlook mail folders for organize feature
    applyEmailRule,              // On-demand — bulk-move existing emails when a new rule is created
    generateMeetingFollowups,    // On-demand — generate follow-up email drafts after meeting transcript processing
    wrenMorningBrief,            // 8:30 AM PT weekdays — personalized morning briefing via Slack DM
    scanCalendarConflicts,       // 7 AM PT weekdays — detect calendar conflicts against user boundaries
    scanEmailThreats,            // 7:30 AM PT daily — scan emails for phishing, scam, and impersonation
    processBccEmail,             // On-demand — process emails BCC'd to wren@heywren.ai
    pollWrenMailbox,             // Every 5 min — poll wren@heywren.ai IMAP mailbox for BCC'd emails
    scanStaleEmails,             // 11 AM + 3 PM PT weekdays — detect read-but-not-acted-on emails
    scheduleRecallBots,          // Every 15 min — auto-dispatch HeyWren Notetaker for 3+ attendee meetings
    dispatchManualRecallBot,     // On-demand — user manually sends notetaker to a meeting
  ],
})
