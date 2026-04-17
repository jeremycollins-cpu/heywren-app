// app/api/commitments/create-asana-task/route.ts
// Cross-integration AI action: turn a HeyWren commitment into an Asana task.
//
// Flow:
//   1. Validate the user owns the commitment and has an Asana integration
//   2. If a task was already created from this commitment, return its URL
//   3. Use Claude to compose an actionable task name + notes + due date
//   4. POST to Asana to create the task
//   5. Persist back-reference: commitments.asana_gid + asana_tasks row

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { asanaFetch, type AsanaIntegrationRow } from '@/lib/asana/client'
import { composeAsanaTask } from '@/lib/ai/generate-asana-task'
import { logAiUsage } from '@/lib/ai/persist-usage'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface AsanaCreateTaskResponse {
  data: {
    gid: string
    name: string
    permalink_url: string
    notes?: string
    completed: boolean
    due_on?: string | null
    workspace?: { gid: string; name: string }
    projects?: Array<{ gid: string; name: string }>
    created_at?: string
    modified_at?: string
  }
}

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

  const body = await request.json().catch(() => ({}))
  const { commitmentId, projectGid: projectGidOverride, workspaceGid: workspaceGidOverride } = body
  if (!commitmentId) {
    return NextResponse.json({ error: 'Missing commitmentId' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Resolve team
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

  // Fetch the commitment
  const { data: commitment, error: commitErr } = await admin
    .from('commitments')
    .select('id, title, description, source, due_date, source_url, metadata, asana_gid, asana_url')
    .eq('id', commitmentId)
    .eq('team_id', teamId)
    .single()
  if (commitErr || !commitment) {
    return NextResponse.json({ error: 'Commitment not found' }, { status: 404 })
  }

  // Idempotent: if we already created an Asana task from this commitment,
  // just return it. Don't re-create on every click.
  if (commitment.asana_gid && commitment.asana_url) {
    return NextResponse.json({
      task: { gid: commitment.asana_gid, permalink_url: commitment.asana_url },
      existing: true,
    })
  }

  // Fetch the user's Asana integration
  const { data: integration } = await admin
    .from('integrations')
    .select('id, access_token, refresh_token, config')
    .eq('user_id', user.id)
    .eq('provider', 'asana')
    .single()
  if (!integration?.access_token) {
    return NextResponse.json(
      { error: 'Asana not connected. Connect Asana on the Integrations page first.' },
      { status: 400 }
    )
  }

  const integ: AsanaIntegrationRow = {
    id: integration.id,
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    config: integration.config,
  }

  const workspaceGid: string | undefined =
    workspaceGidOverride || integration.config?.default_workspace_gid
  if (!workspaceGid) {
    return NextResponse.json(
      { error: 'No Asana workspace available. Reconnect Asana to refresh workspace list.' },
      { status: 400 }
    )
  }

  // Compose the task with Claude
  const meta = (commitment.metadata as any) || {}
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const backRef = appUrl ? `${appUrl}/commitments/${commitment.id}` : commitment.source_url || ''

  let draft
  try {
    draft = await composeAsanaTask({
      title: commitment.title,
      description: commitment.description || undefined,
      source: commitment.source || undefined,
      due_date: commitment.due_date || undefined,
      original_quote: meta.originalQuote || undefined,
      urgency: meta.urgency || undefined,
      commitment_type: meta.commitmentType || undefined,
      stakeholders: meta.stakeholders || undefined,
      back_reference_url: backRef || undefined,
    })
  } catch (err) {
    console.error('[create-asana-task] AI compose failed:', err)
    return NextResponse.json({ error: 'Failed to draft Asana task' }, { status: 500 })
  }

  // Build the Asana create payload
  const taskBody: Record<string, any> = {
    name: draft.name,
    notes: draft.notes,
    workspace: workspaceGid,
    assignee: integration.config?.asana_user_gid || 'me',
  }
  if (draft.suggested_due_on) taskBody.due_on = draft.suggested_due_on
  if (projectGidOverride) taskBody.projects = [projectGidOverride]

  let created: AsanaCreateTaskResponse['data']
  try {
    const created_resp: AsanaCreateTaskResponse = await asanaFetch(admin, integ, '/tasks', {
      method: 'POST',
      body: JSON.stringify({ data: taskBody }),
    })
    created = created_resp.data
  } catch (err: any) {
    console.error('[create-asana-task] Asana create failed:', err)
    return NextResponse.json({ error: err.message || 'Asana API error' }, { status: 502 })
  }

  // Persist back-references in two places:
  //   1. commitments.asana_gid + asana_url so the UI can hide the button
  //      and link directly on subsequent loads
  //   2. asana_tasks row (with created_from_commitment_id) so the task
  //      appears in any Asana-task views and incremental sync upserts it
  await admin
    .from('commitments')
    .update({
      asana_gid: created.gid,
      asana_url: created.permalink_url,
      updated_at: new Date().toISOString(),
    })
    .eq('id', commitment.id)

  const project = created.projects?.[0] || (projectGidOverride ? { gid: projectGidOverride, name: '' } : null)
  await admin.from('asana_tasks').upsert(
    {
      user_id: user.id,
      team_id: teamId,
      asana_gid: created.gid,
      workspace_gid: created.workspace?.gid || workspaceGid,
      project_gid: project?.gid || null,
      project_name: project?.name || null,
      name: created.name,
      notes: created.notes || draft.notes,
      permalink_url: created.permalink_url,
      completed: !!created.completed,
      due_on: created.due_on || draft.suggested_due_on || null,
      assignee_gid: integration.config?.asana_user_gid || null,
      created_from_commitment_id: commitment.id,
      asana_created_at: created.created_at || null,
      asana_modified_at: created.modified_at || null,
      metadata: { source_commitment_id: commitment.id },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,asana_gid' }
  )

  await logAiUsage(admin, {
    module: 'compose-asana-task',
    trigger: 'on-demand',
    teamId,
    userId: user.id,
    itemsProcessed: 1,
  })

  return NextResponse.json({
    task: {
      gid: created.gid,
      name: created.name,
      permalink_url: created.permalink_url,
      due_on: created.due_on || null,
    },
    existing: false,
  })
}
