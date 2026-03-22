import { inngest } from '../client'
import { createClient } from '@/lib/supabase/server'

export const dailyDigest = inngest.createFunction(
  { id: 'daily-digest' },
  { cron: '0 8 * * *' }, // 8 AM daily
  async () => {
    const supabase = await createClient()

    // Get teams
    const { data: teams } = await supabase.from('teams').select('id, name')

    let digestesSent = 0

    for (const team of teams || []) {
      // Get team member stats
      const { data: commitments } = await supabase
        .from('commitments')
        .select('status')
        .eq('team_id', team.id)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      const stats = {
        total: commitments?.length || 0,
        pending: commitments?.filter((c) => c.status === 'pending').length || 0,
        completed: commitments?.filter((c) => c.status === 'completed').length || 0,
        overdue: commitments?.filter((c) => c.status === 'overdue').length || 0,
      }

      // In production, send digest via Slack or email
      console.log(`Daily digest for ${team.name}:`, stats)
      digestesSent++
    }

    return { success: true, digestesSent }
  }
)
