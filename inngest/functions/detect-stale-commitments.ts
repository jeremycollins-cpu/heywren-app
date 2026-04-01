import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

const STALE_THRESHOLD_DAYS = 14

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const detectStaleCommitments = inngest.createFunction(
  { id: 'detect-stale-commitments' },
  { cron: 'TZ=America/Los_Angeles 0 8 * * 1-5' }, // 8 AM PT, weekdays
  async () => {
    const supabase = getAdminClient()

    // Find open commitments that are 14+ days old and haven't been notified in 7 days
    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_DAYS * 86400000).toISOString()
    const renotifyCutoff = new Date(Date.now() - 7 * 86400000).toISOString()

    const { data: staleCommitments, error } = await supabase
      .from('commitments')
      .select('id, team_id, creator_id, title, created_at, stale_notified_at')
      .in('status', ['open', 'in_progress'])
      .lt('created_at', staleCutoff)
      .or(`stale_notified_at.is.null,stale_notified_at.lt.${renotifyCutoff}`)
      .limit(200)

    if (error || !staleCommitments) {
      console.error('Failed to fetch stale commitments:', error?.message)
      return { success: false, error: error?.message }
    }

    if (staleCommitments.length === 0) {
      return { success: true, notified: 0 }
    }

    // Group by user
    const byUser = new Map<string, typeof staleCommitments>()
    for (const c of staleCommitments) {
      if (!c.creator_id) continue
      const existing = byUser.get(c.creator_id) || []
      existing.push(c)
      byUser.set(c.creator_id, existing)
    }

    let totalNotified = 0

    for (const [userId, commitments] of byUser) {
      const teamId = commitments[0].team_id
      const count = commitments.length
      const titles = commitments.slice(0, 3).map(c => c.title).join(', ')
      const suffix = count > 3 ? ` and ${count - 3} more` : ''

      // Create a single notification per user summarizing stale items
      await supabase.from('notifications').insert({
        user_id: userId,
        team_id: teamId,
        type: 'stale_commitment',
        title: `${count} commitment${count > 1 ? 's' : ''} may be stale`,
        body: `${titles}${suffix} — still open after ${STALE_THRESHOLD_DAYS}+ days. Complete, drop, or update them.`,
        link: '/commitments',
      })

      // Mark as notified
      const ids = commitments.map(c => c.id)
      await supabase
        .from('commitments')
        .update({ stale_notified_at: new Date().toISOString() })
        .in('id', ids)

      totalNotified += count
    }

    console.log(`Stale commitment scan: ${totalNotified} stale items across ${byUser.size} users`)
    return { success: true, notified: totalNotified, users: byUser.size }
  }
)
