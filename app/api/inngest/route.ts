import { inngest } from '@/inngest/client'
import { serve } from 'inngest/next'
import { processSlackMessage } from '@/inngest/functions/process-slack-message'
import { sendNudges } from '@/inngest/functions/send-nudges'
import { dailyDigest } from '@/inngest/functions/daily-digest'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processSlackMessage, sendNudges, dailyDigest],
})
