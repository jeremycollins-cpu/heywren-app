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

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    // Fetch all resolved emails in one query instead of per-user
    const { data: allResolved } = await supabase
      .from('missed_emails')
      .select('user_id, team_id, urgency, received_at, updated_at')
      .eq('status', 'replied')
      .gte('updated_at', thirtyDaysAgo)

    if (!allResolved || allResolved.length === 0) return { success: true, usersUpdated: 0 }

    // Group by user_id+team_id in memory
    const grouped = new Map<string, typeof allResolved>()
    for (const row of allResolved) {
      const key = `${row.user_id}:${row.team_id}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(row)
    }

    let updated = 0
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null

    const upsertBatch = []

    for (const [key, resolved] of grouped) {
      if (resolved.length < 3) continue // Need enough data

      const [user_id, team_id] = key.split(':')

      // Calculate average response hours by urgency
      const byUrgency: Record<string, number[]> = { critical: [], high: [], medium: [], low: [] }

      for (const item of resolved) {
        const received = new Date(item.received_at).getTime()
        const responded = new Date(item.updated_at).getTime()
        const hours = Math.max(0, (responded - received) / 3600000)

        if (hours > 0 && hours < 720) {
          if (byUrgency[item.urgency]) byUrgency[item.urgency].push(hours)
        }
      }

      // Detect peak response hours
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

      upsertBatch.push({
        user_id,
        team_id,
        avg_response_hours_critical: avg(byUrgency.critical),
        avg_response_hours_high: avg(byUrgency.high),
        avg_response_hours_medium: avg(byUrgency.medium),
        avg_response_hours_low: avg(byUrgency.low),
        peak_response_hours: peakHours,
        updated_at: new Date().toISOString(),
      })

      updated++
    }

    // Batch upsert all patterns at once
    if (upsertBatch.length > 0) {
      await supabase
        .from('user_response_patterns')
        .upsert(upsertBatch, { onConflict: 'user_id,team_id' })
    }

    return { success: true, usersUpdated: updated }
  }
)
