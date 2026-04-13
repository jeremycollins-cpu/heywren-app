export const dynamic = 'force-dynamic'

// /api/integrations/anthropic-admin
//
// Manages the per-org Anthropic Admin API credential used to pull
// daily Claude Code usage rollups from
// https://api.anthropic.com/v1/organizations/usage_report/claude_code.
//
// Access: org admin only (profiles.role in admin/super_admin AND
// organization_members.role = 'org_admin'). The key is validated against
// Anthropic before storage; stored AES-256-GCM encrypted at rest.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { encryptAdminKey, fingerprintAdminKey } from '@/lib/crypto/admin-key'
import { validateAdminKey } from '@/lib/anthropic/admin-api'

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function resolveAdminContext(userId: string): Promise<
  | { ok: true; organizationId: string; service: ReturnType<typeof getServiceClient> }
  | { ok: false; status: number; error: string }
> {
  const service = getServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('role, organization_id')
    .eq('id', userId)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    return { ok: false, status: 403, error: 'Admin role required' }
  }
  if (!profile.organization_id) {
    return { ok: false, status: 400, error: 'No active organization' }
  }

  const { data: membership } = await service
    .from('organization_members')
    .select('role')
    .eq('organization_id', profile.organization_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership || membership.role !== 'org_admin') {
    return {
      ok: false,
      status: 403,
      error: 'Organization admin role required to manage this integration',
    }
  }

  return { ok: true, organizationId: profile.organization_id, service }
}

// ── POST: create or replace the admin key ───────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ctx = await resolveAdminContext(user.id)
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

    const body = await req.json().catch(() => ({}))
    const rawKey: unknown = body?.api_key
    if (typeof rawKey !== 'string' || !rawKey.startsWith('sk-ant-admin')) {
      return NextResponse.json(
        { error: 'Provide a valid Anthropic Admin API key (starts with sk-ant-admin)' },
        { status: 400 }
      )
    }

    // Validate against Anthropic before storing so we fail fast on bad keys.
    const validation = await validateAdminKey(rawKey)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Key validation failed' },
        { status: 400 }
      )
    }

    const { ciphertext, iv, tag } = encryptAdminKey(rawKey)
    const fingerprint = fingerprintAdminKey(rawKey)

    const { error: upsertError } = await ctx.service
      .from('anthropic_admin_credentials')
      .upsert(
        {
          organization_id: ctx.organizationId,
          encrypted_key: ciphertext,
          key_iv: iv,
          key_tag: tag,
          key_fingerprint: fingerprint,
          created_by: user.id,
          last_sync_at: null,
          last_sync_status: null,
          last_sync_error: null,
          last_sync_row_count: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' }
      )

    if (upsertError) {
      console.error('[anthropic-admin] upsert failed:', upsertError)
      return NextResponse.json({ error: 'Failed to save credential' }, { status: 500 })
    }

    return NextResponse.json({
      connected: true,
      fingerprint,
      message: 'Admin API key saved. A sync will run within 24 hours, or trigger one from the dashboard.',
    })
  } catch (err) {
    console.error('[anthropic-admin] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── GET: status (never returns the key) ─────────────────────────

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ctx = await resolveAdminContext(user.id)
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

    const { data: cred } = await ctx.service
      .from('anthropic_admin_credentials')
      .select('key_fingerprint, created_by, last_sync_at, last_sync_status, last_sync_error, last_sync_row_count, subscription_type, created_at')
      .eq('organization_id', ctx.organizationId)
      .maybeSingle()

    return NextResponse.json({
      connected: !!cred,
      fingerprint: cred?.key_fingerprint ?? null,
      last_sync_at: cred?.last_sync_at ?? null,
      last_sync_status: cred?.last_sync_status ?? null,
      last_sync_error: cred?.last_sync_error ?? null,
      last_sync_row_count: cred?.last_sync_row_count ?? null,
      subscription_type: cred?.subscription_type ?? null,
      connected_at: cred?.created_at ?? null,
    })
  } catch (err) {
    console.error('[anthropic-admin] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE: revoke ──────────────────────────────────────────────

export async function DELETE() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ctx = await resolveAdminContext(user.id)
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

    await ctx.service
      .from('anthropic_admin_credentials')
      .delete()
      .eq('organization_id', ctx.organizationId)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[anthropic-admin] DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
