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

// Refresh Microsoft token if needed (reused pattern from scan-missed-emails)
async function refreshMicrosoftToken(
  admin: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
          client_secret: process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'openid profile email Mail.Read Mail.ReadWrite Calendars.ReadWrite User.Read offline_access',
        }).toString(),
      }
    )
    const tokenData = await res.json()
    if (tokenData.error) return null

    const { data: current } = await admin
      .from('integrations')
      .select('config')
      .eq('id', integrationId)
      .single()

    await admin
      .from('integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        config: {
          ...(current?.config || {}),
          token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        },
      })
      .eq('id', integrationId)

    return tokenData.access_token
  } catch {
    return null
  }
}

// Create a draft in the user's Outlook mailbox via Graph API.
// The draft appears in their Drafts folder — they can open Outlook, edit, and send.
async function createOutlookDraft(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  subject: string,
  body: string,
  recipientEmail?: string,
  recipientName?: string
): Promise<{ success: boolean; webLink?: string; error?: string }> {
  const { data: integration } = await admin
    .from('integrations')
    .select('id, access_token, refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .limit(1)
    .single()

  if (!integration) return { success: false, error: 'No Outlook integration' }

  let token = integration.access_token

  const graphBody: any = {
    subject,
    body: { contentType: 'Text', content: body },
    isDraft: true,
  }

  if (recipientEmail) {
    graphBody.toRecipients = [{
      emailAddress: {
        address: recipientEmail,
        name: recipientName || recipientEmail,
      },
    }]
  }

  let res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphBody),
  })

  // Token expired — refresh and retry
  if (res.status === 401) {
    const newToken = await refreshMicrosoftToken(admin, integration.id, integration.refresh_token || '')
    if (!newToken) return { success: false, error: 'Token refresh failed' }
    token = newToken

    res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphBody),
    })
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { success: false, error: err?.error?.message || `Graph API ${res.status}` }
  }

  const data = await res.json()
  return { success: true, webLink: data.webLink }
}

// Generate a follow-up draft for a single commitment (on-demand).
// For email commitments: creates draft directly in Outlook.
// For Slack commitments: saves to draft queue (copy to Slack DM).
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
    .select('id, subject, body, status, channel')
    .eq('commitment_id', commitmentId)
    .eq('user_id', user.id)
    .in('status', ['ready', 'edited'])
    .maybeSingle()

  if (existingDraft) {
    return NextResponse.json({ draft: existingDraft, existing: true })
  }

  // Fetch the commitment with metadata for recipient info
  const { data: commitment, error: commitError } = await admin
    .from('commitments')
    .select('id, title, description, source, created_at, assignee_id, metadata')
    .eq('id', commitmentId)
    .eq('team_id', teamId)
    .single()

  if (commitError || !commitment) {
    return NextResponse.json({ error: 'Commitment not found' }, { status: 404 })
  }

  // Determine channel from commitment source
  const isEmail = commitment.source === 'outlook' || commitment.source === 'email'
  const channel = isEmail ? 'email' : 'slack'

  // Look up assignee name and email
  let recipientName: string | undefined
  let recipientEmail: string | undefined
  if (commitment.assignee_id) {
    const { data: assigneeProfile } = await admin
      .from('profiles')
      .select('display_name, email')
      .eq('id', commitment.assignee_id)
      .single()
    recipientName = assigneeProfile?.display_name || undefined
    recipientEmail = assigneeProfile?.email || undefined
  }

  // Generate the draft text via AI
  try {
    const draft = await generateFollowUpDraft({
      title: commitment.title,
      description: commitment.description || undefined,
      source: commitment.source || undefined,
      created_at: commitment.created_at,
      recipient_name: recipientName,
    })

    // Save to draft queue
    const { data: inserted, error: insertErr } = await admin
      .from('draft_queue')
      .insert({
        team_id: teamId,
        user_id: user.id,
        commitment_id: commitmentId,
        subject: draft.subject,
        body: draft.body,
        channel,
        recipient_name: recipientName || null,
        recipient_email: recipientEmail || null,
        status: 'ready',
      })
      .select()
      .single()

    if (insertErr) {
      console.error('Failed to insert draft:', insertErr.message)
      return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
    }

    // For email commitments, also create the draft in Outlook
    let outlookResult: { success: boolean; webLink?: string; error?: string } | null = null
    if (isEmail) {
      outlookResult = await createOutlookDraft(
        admin, user.id, draft.subject, draft.body, recipientEmail, recipientName
      )
      if (!outlookResult.success) {
        console.error('Outlook draft creation failed:', outlookResult.error)
        // Non-fatal — user still has the draft in the queue
      }
    }

    await logAiUsage(admin, { module: 'generate-drafts', trigger: 'on-demand', teamId, userId: user.id, itemsProcessed: 1 })

    return NextResponse.json({
      draft: inserted,
      existing: false,
      channel,
      outlookDraft: outlookResult?.success ? { webLink: outlookResult.webLink } : null,
    })
  } catch (err) {
    console.error('Draft generation failed:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to generate draft' }, { status: 500 })
  }
}
