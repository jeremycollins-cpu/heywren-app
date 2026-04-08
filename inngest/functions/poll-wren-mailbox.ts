// inngest/functions/poll-wren-mailbox.ts
// Polls the wren@heywren.ai IMAP mailbox for new emails every 5 minutes.
// When a user BCC's wren@heywren.ai, the email lands here. We read it,
// match the sender to a HeyWren user, and dispatch for commitment detection.
//
// Env vars required:
//   WREN_IMAP_HOST  — e.g. "mail.privateemail.com" (Namecheap)
//   WREN_IMAP_USER  — "wren@heywren.ai"
//   WREN_IMAP_PASS  — mailbox password

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const pollWrenMailbox = inngest.createFunction(
  {
    id: 'poll-wren-mailbox',
    name: 'Poll wren@heywren.ai Mailbox',
    retries: 1,
    concurrency: { limit: 1 }, // Only one poller at a time
  },
  { cron: '*/5 * * * *' }, // Every 5 minutes
  async ({ step }) => {
    const host = process.env.WREN_IMAP_HOST
    const user = process.env.WREN_IMAP_USER
    const pass = process.env.WREN_IMAP_PASS

    if (!host || !user || !pass) {
      console.warn('Wren mailbox polling skipped — WREN_IMAP_HOST/USER/PASS not configured')
      return { skipped: true, reason: 'not configured' }
    }

    // ── Step 1: Connect and fetch unread emails ──
    const emails = await step.run('fetch-unread-emails', async () => {
      const client = new ImapFlow({
        host,
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false,
      })

      const results: Array<{
        uid: number
        from: string
        fromName: string
        subject: string
        text: string
        date: string
      }> = []

      try {
        await client.connect()
        const lock = await client.getMailboxLock('INBOX')

        try {
          // Search for unseen messages
          const uids = await client.search({ seen: false })

          if (uids.length === 0) {
            return results
          }

          // Process up to 20 emails per poll to avoid timeouts
          const batch = uids.slice(0, 20)

          for (const uid of batch) {
            try {
              const download = await client.download(String(uid), undefined, { uid: true })
              const parsed: ParsedMail = await simpleParser(download.content)

              const fromAddr = parsed.from?.value?.[0]
              results.push({
                uid,
                from: fromAddr?.address?.toLowerCase() || '',
                fromName: fromAddr?.name || fromAddr?.address || 'Unknown',
                subject: parsed.subject || '(no subject)',
                text: (parsed.text || parsed.html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '').slice(0, 5000),
                date: (parsed.date || new Date()).toISOString(),
              })

              // Mark as read so we don't process again
              await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
            } catch (err) {
              console.error(`Failed to parse email uid=${uid}:`, err)
            }
          }
        } finally {
          lock.release()
        }

        await client.logout()
      } catch (err) {
        console.error('IMAP connection error:', err)
        try { await client.logout() } catch { /* ignore */ }
        throw err
      }

      return results
    })

    if (emails.length === 0) {
      return { processed: 0 }
    }

    // ── Step 2: Match senders to HeyWren users and dispatch ──
    const dispatched = await step.run('dispatch-emails', async () => {
      const supabase = getAdminClient()
      let count = 0

      for (const email of emails) {
        if (!email.from) continue

        // Look up sender in HeyWren profiles
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, current_team_id, full_name, display_name')
          .ilike('email', email.from)
          .single()

        if (!profile || !profile.current_team_id) {
          console.warn(`BCC email from unknown user: ${email.from} — "${email.subject}"`)
          continue
        }

        // Dispatch to the BCC processing function
        await inngest.send({
          name: 'email/bcc.received',
          data: {
            userId: profile.id,
            teamId: profile.current_team_id,
            senderEmail: email.from,
            senderName: profile.full_name || profile.display_name || email.fromName,
            subject: email.subject,
            bodyText: email.text,
            snippet: email.text.slice(0, 300),
            receivedAt: email.date,
          },
        })

        count++
      }

      return count
    })

    console.log(`Wren mailbox poll: ${emails.length} emails found, ${dispatched} dispatched`)

    return { processed: emails.length, dispatched }
  }
)
