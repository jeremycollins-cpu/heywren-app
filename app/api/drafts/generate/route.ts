export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateFollowUpDraft } from '@/lib/ai/generate-drafts'
import { logAiUsage } from '@/lib/ai/persist-usage'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Generate a follow-up draft for a single commitment (on-demand).
// User clicks "Draft follow-up" on a specific commitment card.
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (origin && allowedOrigin && origin !== allowedOrigin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { commitmentId } = body

  if (!commitmentId) {
    return NextResponse.json({ error: 'Missing commitmentId' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Get user's team
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

  // Check if draft already exists for this commitment
  const { data: existingDraft } = await admin
    .from('draft_queue')
    .select('id, subject, body, status')
    .eq('commitment_id', commitmentId)
    .eq('user_id', user.id)
    .in('status', ['ready', 'edited'])
    .maybeSingle()

  if (existingDraft) {
    return NextResponse.json({ draft: existingDraft, existing: true })
  }

  // Fetch the commitment
  const { data: commitment, error: commitError } = await admin
    .from('commitments')
    .select('id, title, description, source, created_at, assignee_id')
    .eq('id', commitmentId)
    .eq('team_id', teamId)
    .single()

  if (commitError || !commitment) {
    return NextResponse.json({ error: 'Commitment not found' }, { status: 404 })
  }

  // Look up assignee name
  let recipientName: string | undefined
  if (commitment.assignee_id) {
    const { data: assigneeProfile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', commitment.assignee_id)
      .single()
    recipientName = assigneeProfile?.display_name || undefined
  }

  // Generate the draft
  try {
    const draft = await generateFollowUpDraft({
      title: commitment.title,
      description: commitment.description || undefined,
      source: commitment.source || undefined,
      created_at: commitment.created_at,
      recipient_name: recipientName,
    })

    const { data: inserted, error: insertErr } = await admin
      .from('draft_queue')
      .insert({
        team_id: teamId,
        user_id: user.id,
        commitment_id: commitmentId,
        subject: draft.subject,
        body: draft.body,
        status: 'ready',
      })
      .select()
      .single()

    if (insertErr) {
      console.error('Failed to insert draft:', insertErr.message)
      return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
    }

    await logAiUsage(admin, { module: 'generate-drafts', trigger: 'on-demand', teamId, userId: user.id, itemsProcessed: 1 })

    return NextResponse.json({ draft: inserted, existing: false })
  } catch (err) {
    console.error('Draft generation failed:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to generate draft' }, { status: 500 })
  }
}
