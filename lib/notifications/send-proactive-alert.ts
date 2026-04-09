// lib/notifications/send-proactive-alert.ts
// Shared utility for sending proactive multi-channel alerts (in-app + Slack DM + email).
// Used by scanners when they detect high-value, time-sensitive items that shouldn't wait
// for the user to check the dashboard.

import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'
import { sendEmail } from '@/lib/email/send'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface ProactiveAlertParams {
  teamId: string
  userId: string
  // Notification content
  notificationType: 'missed_email' | 'missed_chat' | 'security_alert' | 'stale_commitment' | 'anomaly'
  title: string
  body: string
  link: string
  // Slack message (Block Kit mrkdwn)
  slackText: string
  slackBlocks?: any[]
  // Email (optional — if not provided, only in-app + Slack)
  emailSubject?: string
  emailHtml?: string
  emailType?: string
  // Dedup key — prevents duplicate alerts for the same event on the same day
  idempotencyKey: string
}

export async function sendProactiveAlert(params: ProactiveAlertParams) {
  const supabase = getAdminClient()

  // 1. In-app notification (always)
  await supabase.from('notifications').insert({
    user_id: params.userId,
    team_id: params.teamId,
    type: params.notificationType,
    title: params.title,
    body: params.body,
    link: params.link,
  })

  // Resolve user's Slack and email info
  const [slackRes, profileRes] = await Promise.all([
    supabase
      .from('integrations')
      .select('access_token, config')
      .eq('team_id', params.teamId)
      .eq('user_id', params.userId)
      .eq('provider', 'slack')
      .single(),
    supabase
      .from('profiles')
      .select('email')
      .eq('id', params.userId)
      .single(),
  ])

  // 2. Slack DM (if connected)
  const slackUserId = slackRes.data?.config?.slack_user_id
  if (slackRes.data?.access_token && slackUserId) {
    try {
      const slack = new WebClient(slackRes.data.access_token)
      const { channel } = await slack.conversations.open({ users: slackUserId })
      if (channel?.id) {
        await slack.chat.postMessage({
          channel: channel.id,
          text: params.slackText,
          blocks: params.slackBlocks || [
            { type: 'section', text: { type: 'mrkdwn', text: params.slackText } },
            {
              type: 'actions',
              elements: [{
                type: 'button',
                text: { type: 'plain_text', text: 'View in HeyWren' },
                url: `${APP_URL}${params.link}`,
                action_id: 'view_alert',
              }],
            },
          ],
          unfurl_links: false,
        })
      }
    } catch {
      // Slack DM is best-effort
    }
  }

  // 3. Email (if provided and user has email)
  const userEmail = profileRes.data?.email
  if (params.emailSubject && params.emailHtml && userEmail) {
    try {
      await sendEmail({
        to: userEmail,
        subject: params.emailSubject,
        html: params.emailHtml,
        emailType: params.emailType || 'proactive_alert',
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
      })
    } catch {
      // Email is best-effort
    }
  }
}
