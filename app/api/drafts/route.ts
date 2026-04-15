export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const { data: drafts, error } = await admin
    .from('draft_queue')
    .select('*, commitment:commitments(id, title, description, source, status)')
    .eq('team_id', membership.team_id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch drafts:', error.message)
    return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 })
  }

  return NextResponse.json({ drafts: drafts || [] })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id: string; subject?: string; body?: string; status?: string }
  try {
    body = await request.json()
    if (!body.id) {
      return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Verify draft belongs to user's team
  const { data: membership } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const { data: existingDraft } = await admin
    .from('draft_queue')
    .select('id, team_id, user_id, subject, body, commitment_id')
    .eq('id', body.id)
    .single()

  if (!existingDraft || existingDraft.team_id !== membership.team_id) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  if (existingDraft.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Build update object
  const update: Record<string, string> = {}
  if (body.subject !== undefined) update.subject = body.subject
  if (body.body !== undefined) update.body = body.body
  if (body.status !== undefined) {
    if (!['pending', 'ready', 'edited', 'sent', 'dismissed'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    update.status = body.status
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: updated, error } = await admin
    .from('draft_queue')
    .update(update)
    .eq('id', body.id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update draft:', error.message)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }

  // Track edits as implicit feedback for AI draft quality improvement.
  // Heavy edits = AI got it wrong, no edits = AI got it right.
  if (body.status === 'sent' || body.status === 'dismissed' || body.subject !== undefined || body.body !== undefined) {
    try {
      const origSubject = existingDraft.subject || ''
      const origBody = existingDraft.body || ''
      const editedSubject = body.subject ?? origSubject
      const editedBody = body.body ?? origBody
      const origLen = origSubject.length + origBody.length
      // Simple edit distance: count character-level changes as a percentage
      const subjectChanged = origSubject !== editedSubject ? Math.abs(editedSubject.length - origSubject.length) + origSubject.length * 0.5 : 0
      const bodyChanged = origBody !== editedBody ? Math.abs(editedBody.length - origBody.length) + origBody.length * 0.5 : 0
      const editDistancePct = origLen > 0 ? Math.min(1, (subjectChanged + bodyChanged) / origLen) : 0

      const action = body.status === 'dismissed' ? 'deleted'
        : body.status === 'sent' && editDistancePct > 0.1 ? 'sent_edited'
        : body.status === 'sent' ? 'sent'
        : 'skipped'

      await admin.from('draft_feedback').insert({
        team_id: membership.team_id,
        user_id: user.id,
        original_subject: origSubject,
        original_body: origBody,
        edited_subject: editedSubject,
        edited_body: editedBody,
        edit_distance_pct: Math.round(editDistancePct * 100) / 100,
        commitment_id: existingDraft.commitment_id || null,
        action,
      })
    } catch (fbErr) {
      // Non-fatal — don't block the draft update
      console.error('Draft feedback tracking failed:', (fbErr as Error).message)
    }
  }

  return NextResponse.json({ draft: updated })
}
