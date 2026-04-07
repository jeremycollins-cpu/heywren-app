// lib/email/send.ts
// Generic email send helper using the Resend SDK.
// Handles dedup via idempotency keys and logs every send to the email_sends table.

import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

interface SendEmailParams {
  to: string
  subject: string
  html: string
  from?: string
  /** Email type for tracking/dedup (e.g. 'weekly_recap', 'nudge') */
  emailType?: string
  /** User ID for tracking */
  userId?: string
  /** Idempotency key to prevent duplicate sends */
  idempotencyKey?: string
}

interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

let resendClient: Resend | null = null

function getResend(): Resend | null {
  if (resendClient) return resendClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[send-email] RESEND_API_KEY is not configured')
    return null
  }
  resendClient = new Resend(apiKey)
  return resendClient
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, html, from, emailType, userId, idempotencyKey } = params

  const resend = getResend()
  if (!resend) {
    return { success: false, error: 'Email service not configured' }
  }

  const supabase = getAdminClient()

  // Dedup check: if an idempotency key is provided, skip if already sent
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('email_sends')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .eq('status', 'sent')
      .limit(1)
      .maybeSingle()

    if (existing) {
      return { success: true, messageId: existing.id, error: 'Already sent (dedup)' }
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: from || 'HeyWren <notifications@heywren.com>',
      to,
      subject,
      html,
    })

    if (error) {
      console.error('[send-email] Resend error:', error)

      // Log failed send
      if (emailType && userId) {
        await supabase.from('email_sends').insert({
          user_id: userId,
          email_type: emailType,
          recipient: to,
          subject,
          status: 'failed',
          error: error.message,
          idempotency_key: idempotencyKey || null,
        }).catch(() => {})
      }

      return { success: false, error: error.message }
    }

    // Log successful send
    if (emailType && userId) {
      await supabase.from('email_sends').insert({
        user_id: userId,
        email_type: emailType,
        recipient: to,
        subject,
        status: 'sent',
        resend_id: data?.id || null,
        idempotency_key: idempotencyKey || null,
      }).catch(err => {
        console.error('[send-email] Failed to log send:', err)
      })
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send-email] Failed to send email:', message)
    return { success: false, error: message }
  }
}
