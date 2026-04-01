import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Learn each user's typical response patterns from their resolved missed emails.
// Runs weekly after scores are calculated.
export const learnResponsePatterns = inngest.createFunction(
  { id: 'learn-response-patterns' },
  { cron: 'TZ=America/Los_Angeles 0 7 * * 1' }, // Monday 7 AM PT
  async () => {
    const supabase = getAdminClient()

    const { data: users } = await supabase
      .from('team_members')
      .select('user_id, team_id')

    if (!users) return { success: false }

    let updated = 0

    for (const { user_id, team_id } of users) {
      // Get resolved missed emails from the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

      const { data: resolved } = await supabase
        .from('missed_emails')
        .select('urgency, received_at, updated_at')
        .eq('user_id', user_id)
        .eq('team_id', team_id)
        .eq('status', 'replied')
        .gte('updated_at', thirtyDaysAgo)

      if (!resolved || resolved.length < 3) continue // Need enough data

      // Calculate average response hours by urgency
      const byUrgency: Record<string, number[]> = { critical: [], high: [], medium: [], low: [] }
      const responseHours: number[] = []

      for (const item of resolved) {
        const received = new Date(item.received_at).getTime()
        const responded = new Date(item.updated_at).getTime()
        const hours = Math.max(0, (responded - received) / 3600000)

        if (hours > 0 && hours < 720) { // Filter out unreasonable values (>30 days)
          if (byUrgency[item.urgency]) byUrgency[item.urgency].push(hours)
          responseHours.push(hours)
        }
      }

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null

      // Detect peak response hours (hours of day when user most frequently responds)
      const hourCounts = new Array(24).fill(0)
      for (const item of resolved) {
        const hour = new Date(item.updated_at).getHours()
        hourCounts[hour]++
      }
      const maxCount = Math.max(...hourCounts)
      const peakHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter(h => h.count >= maxCount * 0.5 && h.count > 0)
        .map(h => h.hour)
        .sort((a, b) => a - b)

      await supabase
        .from('user_response_patterns')
        .upsert({
          user_id,
          team_id,
          avg_response_hours_critical: avg(byUrgency.critical),
          avg_response_hours_high: avg(byUrgency.high),
          avg_response_hours_medium: avg(byUrgency.medium),
          avg_response_hours_low: avg(byUrgency.low),
          peak_response_hours: peakHours,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,team_id' })

      updated++
    }

    return { success: true, usersUpdated: updated }
  }
)
