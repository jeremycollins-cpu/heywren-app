import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/org-settings
 * Returns the MFA enforcement setting for the caller's organization.
 */
export async function GET() {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const { data: org, error } = await admin
      .from('organizations')
      .select('require_mfa')
      .eq('id', membership.organization_id)
      .single()

    if (error || !org) {
      return NextResponse.json({ error: 'Failed to fetch org settings' }, { status: 500 })
    }

    return NextResponse.json({ requireMfa: org.require_mfa })
  } catch (err) {
    console.error('Org settings GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/org-settings
 * Allows org_admin to update the MFA enforcement setting.
 * Body: { requireMfa: boolean }
 */
export async function PUT(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    if (membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can update organization settings' }, { status: 403 })
    }

    const body = await request.json()
    const { requireMfa } = body as { requireMfa?: boolean }

    if (typeof requireMfa !== 'boolean') {
      return NextResponse.json({ error: 'requireMfa must be a boolean' }, { status: 400 })
    }

    const { error } = await admin
      .from('organizations')
      .update({ require_mfa: requireMfa })
      .eq('id', membership.organization_id)

    if (error) {
      console.error('Failed to update org settings:', error)
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true, requireMfa })
  } catch (err) {
    console.error('Org settings PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
