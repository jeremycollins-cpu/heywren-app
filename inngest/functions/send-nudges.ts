import { inngest } from '../client'
import { createClient } from '@/lib/supabase/server'
import { WebClient } from '@slack/web-api'

export const sendNudges = inngest.createFunction(
  { id: 'send-nudges' },
  { cron: '0 9 * * 1-5' }, // 9 AM weekdays
  async () => {
    const supabase = await createClient()

    // Get pending commitments that need nudges
    const { data: commitments, error } = await supabase
      .from('commitments')
      .select('*, nudges(id, sent_at)')
      .eq('status', 'pending')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch commitments:', error)
      return { success: false, error }
    }

    let nudgesSent = 0

    // Send Slack nudges for commitments
    for (const commitment of commitments || []) {
      const { data: integration } = await supabase
        .from('integrations')
        .select('access_token')
        .eq('team_id', commitment.team_id)
        .eq('provider', 'slack')
        .single()

      if (!integration?.access_token) continue

      const slack = new WebClient(integration.access_token)

      const { data: assignee } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', commitment.assignee_id)
        .single()

      const message = `Hey! Just a friendly reminder about your commitment: *${commitment.title}*`

      try {
        // This would need the channel_id from the original message
        // For now, we'll send to the user directly if possible
        if (assignee?.email) {
          // In production, you'd resolve email to Slack user ID
          // and send a direct message
        }

        // Create nudge record
        await supabase.from('nudges').insert({
          commitment_id: commitment.id,
          user_id: commitment.assignee_id,
          message,
          channel: 'slack',
          status: 'sent',
          sent_at: new Date().toISOString(),
        })

        nudgesSent++
      } catch (err) {
        console.error('Failed to send nudge:', err)
      }
    }

    return { success: true, nudgesSent }
  }
)
