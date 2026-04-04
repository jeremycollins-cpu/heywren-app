import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface SentimentRow {
  sentiment_score: number | null
  sentiment_label: string | null
  tone_themes: string[] | null
  user_id: string
}

interface OrgMember {
  user_id: string
  department_id: string | null
}

/**
 * Runs on the 1st of every month at 6 AM UTC.
 * Aggregates the previous month's sentiment data from missed_emails and
 * missed_chats into culture_snapshots (org-level) and
 * user_sentiment_scores (per-user) tables.
 */
export const aggregateMonthlySentiment = inngest.createFunction(
  { id: 'aggregate-monthly-sentiment' },
  { cron: '0 6 1 * *' }, // 1st of month, 6 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()

    // Calculate previous month range
    const now = new Date()
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const monthStartStr = prevMonthStart.toISOString().split('T')[0]

    // Get all organizations
    const orgs = await step.run('fetch-organizations', async () => {
      const { data } = await supabase.from('organizations').select('id')
      return data || []
    })

    let totalSnapshotsCreated = 0
    let totalUserScoresCreated = 0

    for (const org of orgs) {
      const orgId = org.id

      // Get org members with department info
      const members = await step.run(`fetch-members-${orgId}`, async () => {
        const { data } = await supabase
          .from('organization_members')
          .select('user_id, department_id')
          .eq('organization_id', orgId)
        return (data || []) as OrgMember[]
      })

      if (members.length === 0) continue
      const memberIds = members.map((m: OrgMember) => m.user_id)
      const memberDeptMap = new Map<string, string | null>()
      for (const m of members) {
        memberDeptMap.set(m.user_id, m.department_id)
      }

      // Fetch all sentiment-scored messages for this org in the previous month
      const messages = await step.run(`fetch-sentiment-${orgId}`, async () => {
        const [emailsResult, chatsResult] = await Promise.all([
          supabase
            .from('missed_emails')
            .select('sentiment_score, sentiment_label, tone_themes, user_id')
            .in('user_id', memberIds)
            .gte('received_at', prevMonthStart.toISOString())
            .lt('received_at', prevMonthEnd.toISOString())
            .not('sentiment_score', 'is', null),
          supabase
            .from('missed_chats')
            .select('sentiment_score, sentiment_label, tone_themes, user_id')
            .in('user_id', memberIds)
            .gte('sent_at', prevMonthStart.toISOString())
            .lt('sent_at', prevMonthEnd.toISOString())
            .not('sentiment_score', 'is', null),
        ])
        return [
          ...((emailsResult.data || []) as SentimentRow[]),
          ...((chatsResult.data || []) as SentimentRow[]),
        ]
      })

      if (messages.length === 0) continue

      // Compute org-level aggregates
      await step.run(`snapshot-${orgId}`, async () => {
        let sum = 0
        const distribution = { positive: 0, neutral: 0, negative: 0 }
        const themeCounts: Record<string, number> = {}
        const deptData: Record<string, { sum: number; count: number }> = {}

        for (const msg of messages) {
          if (msg.sentiment_score == null) continue
          sum += msg.sentiment_score

          if (msg.sentiment_label === 'positive') distribution.positive++
          else if (msg.sentiment_label === 'negative') distribution.negative++
          else distribution.neutral++

          if (msg.tone_themes) {
            for (const t of msg.tone_themes) {
              themeCounts[t] = (themeCounts[t] || 0) + 1
            }
          }

          const dept = memberDeptMap.get(msg.user_id) || 'unassigned'
          if (!deptData[dept]) deptData[dept] = { sum: 0, count: 0 }
          deptData[dept].sum += msg.sentiment_score
          deptData[dept].count++
        }

        const toneIndex = Math.round((sum / messages.length) * 100) / 100
        const departmentScores: Record<string, { tone: number; count: number }> = {}
        for (const [dept, data] of Object.entries(deptData)) {
          departmentScores[dept] = {
            tone: Math.round((data.sum / data.count) * 100) / 100,
            count: data.count,
          }
        }

        await supabase.from('culture_snapshots').upsert({
          organization_id: orgId,
          month_start: monthStartStr,
          tone_index: Math.max(-1, Math.min(1, toneIndex)),
          sample_count: messages.length,
          theme_counts: themeCounts,
          positive_count: distribution.positive,
          neutral_count: distribution.neutral,
          negative_count: distribution.negative,
          department_scores: departmentScores,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,month_start' })

        totalSnapshotsCreated++
      })

      // Compute per-user aggregates
      const userMessages: Record<string, SentimentRow[]> = {}
      for (const msg of messages) {
        if (!userMessages[msg.user_id]) userMessages[msg.user_id] = []
        userMessages[msg.user_id].push(msg)
      }

      const userScoreRows = Object.entries(userMessages).map(([userId, msgs]) => {
        let uSum = 0
        let positiveCount = 0
        const uThemes: Record<string, number> = {}

        for (const msg of msgs) {
          if (msg.sentiment_score != null) {
            uSum += msg.sentiment_score
            if (msg.sentiment_label === 'positive') positiveCount++
          }
          if (msg.tone_themes) {
            for (const t of msg.tone_themes) {
              uThemes[t] = (uThemes[t] || 0) + 1
            }
          }
        }

        const avg = Math.round((uSum / msgs.length) * 100) / 100
        const topThemes = Object.entries(uThemes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t)

        return {
          organization_id: orgId,
          user_id: userId,
          month_start: monthStartStr,
          avg_sentiment: Math.max(-1, Math.min(1, avg)),
          message_count: msgs.length,
          top_themes: topThemes,
          positive_ratio: Math.round((positiveCount / msgs.length) * 100) / 100,
          updated_at: new Date().toISOString(),
        }
      })

      if (userScoreRows.length > 0) {
        await step.run(`user-scores-${orgId}`, async () => {
          await supabase
            .from('user_sentiment_scores')
            .upsert(userScoreRows, { onConflict: 'organization_id,user_id,month_start' })
          totalUserScoresCreated += userScoreRows.length
        })
      }
    }

    return {
      month: monthStartStr,
      organizationsProcessed: orgs.length,
      snapshotsCreated: totalSnapshotsCreated,
      userScoresCreated: totalUserScoresCreated,
    }
  }
)
