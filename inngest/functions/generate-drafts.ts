import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { generateFollowUpDraftsViaBatch } from '@/lib/ai/generate-drafts'
import { logAiUsage } from '@/lib/ai/persist-usage'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const generateDrafts = inngest.createFunction(
  { id: 'generate-drafts-daily' },
  { cron: 'TZ=America/Los_Angeles 0 7 * * *' },
  async () => {
    const supabase = getAdminClient()

    // Get all teams with active integrations
    const { data: integrations, error } = await supabase
      .from('integrations')
      .select('team_id')

    if (error || !integrations) {
      console.error('Failed to fetch integrations:', error)
      return { success: false, error: error?.message }
    }

    // Deduplicate team IDs
    const teamIds = [...new Set(integrations.map((i) => i.team_id))]
    console.log(`Draft generation: ${teamIds.length} team(s) to process`)

    const results = []

    for (const teamId of teamIds) {
      try {
        // Get existing draft commitment IDs for this team
        const { data: existingDrafts } = await supabase
          .from('draft_queue')
          .select('commitment_id')
          .eq('team_id', teamId)

        const existingCommitmentIds = (existingDrafts || []).map((d) => d.commitment_id)

        // Fetch open commitments without drafts
        let query = supabase
          .from('commitments')
          .select('id, title, description, source, created_at, assignee_id')
          .eq('team_id', teamId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(50)

        if (existingCommitmentIds.length > 0) {
          query = query.not('id', 'in', '(' + existingCommitmentIds.join(',') + ')')
        }

        const { data: commitments, error: commitError } = await query

        if (commitError) {
          console.error(`Team ${teamId}: Failed to fetch commitments:`, commitError.message)
          results.push({ teamId, success: false, error: commitError.message })
          continue
        }

        if (!commitments || commitments.length === 0) {
          results.push({ teamId, success: true, drafts_generated: 0 })
          continue
        }

        // Get a team member to attribute the generation to
        const { data: members } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', teamId)
          .limit(1)

        const generatedBy = members && members.length > 0 ? members[0].user_id : null

        // Look up assignee names separately (assignee_id FK points to auth.users, not profiles)
        const assigneeIds = [...new Set(commitments.map((c: any) => c.assignee_id).filter(Boolean))]
        const assigneeNames = new Map<string, string>()
        if (assigneeIds.length > 0) {
          const { data: assigneeProfiles } = await supabase
            .from('profiles')
            .select('id, display_name')
            .in('id', assigneeIds)
          for (const p of assigneeProfiles || []) {
            if (p.display_name) assigneeNames.set(p.id, p.display_name)
          }
        }

        // Prepare commitments for AI
        const commitmentsForAI = commitments.map((c: any) => ({
          id: c.id,
          title: c.title,
          description: c.description || undefined,
          source: c.source || undefined,
          created_at: c.created_at,
          recipient_name: c.assignee_id ? assigneeNames.get(c.assignee_id) : undefined,
        }))

        let totalGenerated = 0

        // Use Batch API (50% cheaper) — sends all commitments at once
        try {
          const drafts = await generateFollowUpDraftsViaBatch(commitmentsForAI)

          for (const [commitmentId, draft] of drafts) {
            const { error: insertErr } = await supabase.from('draft_queue').insert({
              team_id: teamId,
              commitment_id: commitmentId,
              subject: draft.subject,
              body: draft.body,
              status: 'pending',
              generated_by: generatedBy,
            })

            if (insertErr) {
              console.error('Failed to insert draft for commitment ' + commitmentId + ':', insertErr.message)
            } else {
              totalGenerated++
            }
          }
        } catch (err) {
          console.error('Draft generation error for team ' + teamId + ':', (err as Error).message)
        }

        console.log(`Team ${teamId}: Generated ${totalGenerated} drafts from ${commitments.length} commitments`)
        await logAiUsage(supabase, { module: 'generate-drafts', trigger: 'generate-drafts-daily', teamId, itemsProcessed: commitments.length })
        results.push({ teamId, success: true, drafts_generated: totalGenerated })
      } catch (err) {
        console.error(`Team ${teamId} draft generation failed:`, (err as Error).message)
        results.push({ teamId, success: false, error: (err as Error).message })
      }
    }

    return { success: true, teamsProcessed: results.length, results }
  }
)
