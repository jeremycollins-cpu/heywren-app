import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateFollowUpDraftsBatch } from '@/lib/ai/generate-drafts'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  // Origin validation to prevent CSRF
  const origin = request.headers.get('origin')
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (origin && allowedOrigin && origin !== allowedOrigin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Authenticate user
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's team
  const admin = getAdminClient()

  const { data: membership } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const teamId = membership.team_id

  // Fetch open commitments that don't already have a draft
  const { data: existingDrafts } = await admin
    .from('draft_queue')
    .select('commitment_id')
    .eq('team_id', teamId)

  const existingCommitmentIds = (existingDrafts || []).map((d) => d.commitment_id)

  let query = admin
    .from('commitments')
    .select('id, title, description, source, created_at, assignee:team_members(user_id, profiles(display_name))')
    .eq('team_id', teamId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(50)

  if (existingCommitmentIds.length > 0) {
    const escaped = existingCommitmentIds.map((id: string) => `"${id.replace(/"/g, '')}"`).join(',')
    query = query.not('id', 'in', `(${escaped})`)
  }

  const { data: commitments, error: commitError } = await query

  if (commitError) {
    console.error('Failed to fetch commitments:', commitError.message)
    return NextResponse.json({ error: 'Failed to fetch commitments' }, { status: 500 })
  }

  if (!commitments || commitments.length === 0) {
    return NextResponse.json({ drafts_generated: 0, message: 'No new commitments to draft follow-ups for' })
  }

  // Prepare commitments for AI
  const commitmentsForAI = commitments.map((c: any) => ({
    id: c.id,
    title: c.title,
    description: c.description || undefined,
    source: c.source || undefined,
    created_at: c.created_at,
    recipient_name: c.assignee?.profiles?.display_name || undefined,
  }))

  // Generate drafts in batches of 10
  let totalGenerated = 0

  for (let i = 0; i < commitmentsForAI.length; i += 10) {
    const batch = commitmentsForAI.slice(i, i + 10)

    try {
      const drafts = await generateFollowUpDraftsBatch(batch)

      for (const [commitmentId, draft] of drafts) {
        const { error: insertErr } = await admin.from('draft_queue').insert({
          team_id: teamId,
          commitment_id: commitmentId,
          subject: draft.subject,
          body: draft.body,
          status: 'pending',
          generated_by: user.id,
        })

        if (insertErr) {
          console.error('Failed to insert draft for commitment ' + commitmentId + ':', insertErr.message)
        } else {
          totalGenerated++
        }
      }
    } catch (err) {
      console.error('Draft generation batch error:', (err as Error).message)
    }
  }

  return NextResponse.json({ drafts_generated: totalGenerated })
}
