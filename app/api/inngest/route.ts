// app/api/inngest/route.ts
// Inngest event server — registers all background functions
// Make sure INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY are set in Vercel env vars

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { processSlackMention } from '@/inngest/functions/process-slack-mention'
import { processSlackMessage } from '@/inngest/functions/process-slack-message'
import { dailyDigest } from '@/inngest/functions/daily-digest'
import { sendNudges } from '@/inngest/functions/send-nudges'
import { syncOutlook } from '@/inngest/functions/sync-outlook'
import { generateDrafts } from '@/inngest/functions/generate-drafts'
import { scanMissedEmails } from '@/inngest/functions/scan-missed-emails'
import { detectCommitmentCompletion } from '@/inngest/functions/detect-commitment-completion'
import { scanAwaitingReplies } from '@/inngest/functions/scan-awaiting-replies'
import { processMeetingTranscript } from '@/inngest/functions/process-meeting-transcript'

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
  ],
})
