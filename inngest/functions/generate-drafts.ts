import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { generateFollowUpDraftsBatch } from '@/lib/ai/generate-drafts'

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
          .select('id, title, description, source, created_at, assignee:team_members(user_id, profiles(full_name))')
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

        // Prepare commitments for AI
        const commitmentsForAI = commitments.map((c: any) => ({
          id: c.id,
          title: c.title,
          description: c.description || undefined,
          source: c.source || undefined,
          created_at: c.created_at,
          recipient_name: c.assignee?.profiles?.full_name || undefined,
        }))

        let totalGenerated = 0

        // Process in batches of 10
        for (let i = 0; i < commitmentsForAI.length; i += 10) {
          const batch = commitmentsForAI.slice(i, i + 10)

          try {
            const drafts = await generateFollowUpDraftsBatch(batch)

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
            console.error('Draft generation batch error for team ' + teamId + ':', (err as Error).message)
          }
        }

        console.log(`Team ${teamId}: Generated ${totalGenerated} drafts from ${commitments.length} commitments`)
        results.push({ teamId, success: true, drafts_generated: totalGenerated })
      } catch (err) {
        console.error(`Team ${teamId} draft generation failed:`, (err as Error).message)
        results.push({ teamId, success: false, error: (err as Error).message })
      }
    }

    return { success: true, teamsProcessed: results.length, results }
  }
)
