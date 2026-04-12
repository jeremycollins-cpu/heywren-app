export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/invites/bulk
 * Bulk invite users from CSV data. Org admins only.
 * Body: { invites: Array<{ email: string; role?: string; department?: string }> }
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getAdminClient()

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || callerMembership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can bulk invite' }, { status: 403 })
    }

    const orgId = callerMembership.organization_id
    const { invites } = await request.json() as {
      invites: Array<{ email: string; role?: string; department?: string }>
    }

    if (!Array.isArray(invites) || invites.length === 0) {
      return NextResponse.json({ error: 'No invites provided' }, { status: 400 })
    }

    if (invites.length > 200) {
      return NextResponse.json({ error: 'Maximum 200 invites at once' }, { status: 400 })
    }

    const validRoles = ['org_admin', 'dept_manager', 'team_lead', 'member']
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Get existing members and pending invites
    const [{ data: existingMembers }, { data: existingInvites }, { data: departments }] = await Promise.all([
      admin.from('organization_members').select('user_id').eq('organization_id', orgId),
      admin.from('invitations').select('email').eq('organization_id', orgId).eq('status', 'pending'),
      admin.from('departments').select('id, name').eq('organization_id', orgId),
    ])

    // Get emails of existing members
    const memberUserIds = (existingMembers || []).map(m => m.user_id)
    let existingEmails = new Set<string>()
    if (memberUserIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('email')
        .in('id', memberUserIds)
      existingEmails = new Set((profiles || []).map(p => p.email?.toLowerCase()).filter(Boolean))
    }

    const pendingEmails = new Set((existingInvites || []).map(i => i.email.toLowerCase()))
    const deptMap = new Map((departments || []).map(d => [d.name.toLowerCase(), d.id]))

    const results: Array<{ email: string; status: 'sent' | 'skipped' | 'error'; reason?: string }> = []
    const toInsert: any[] = []

    for (const invite of invites) {
      const email = invite.email?.trim()?.toLowerCase()
      const role = invite.role?.trim()?.toLowerCase() || 'member'

      if (!email || !emailRegex.test(email)) {
        results.push({ email: email || '(empty)', status: 'error', reason: 'Invalid email' })
        continue
      }

      if (!validRoles.includes(role)) {
        results.push({ email, status: 'error', reason: `Invalid role: ${role}` })
        continue
      }

      if (existingEmails.has(email)) {
        results.push({ email, status: 'skipped', reason: 'Already a member' })
        continue
      }

      if (pendingEmails.has(email)) {
        results.push({ email, status: 'skipped', reason: 'Invite already pending' })
        continue
      }

      // Resolve department name to ID
      let departmentId: string | null = null
      if (invite.department) {
        departmentId = deptMap.get(invite.department.trim().toLowerCase()) || null
      }

      toInsert.push({
        organization_id: orgId,
        department_id: departmentId,
        invited_by: callerId,
        email,
        role,
        token: randomUUID(),
        status: 'pending',
        expires_at: expiresAt,
      })
      pendingEmails.add(email) // prevent duplicates within batch
      results.push({ email, status: 'sent' })
    }

    // Bulk insert invitations
    if (toInsert.length > 0) {
      const { error } = await admin.from('invitations').insert(toInsert)
      if (error) {
        console.error('Bulk invite insert error:', error)
        return NextResponse.json({ error: 'Failed to create invitations' }, { status: 500 })
      }

      // Send invite emails (fire-and-forget, don't block response)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'
      try {
        const { sendInviteEmail } = await import('@/lib/email/send-invite')
        const { data: inviterProfile } = await admin
          .from('profiles')
          .select('display_name')
          .eq('id', callerId)
          .single()
        const { data: org } = await admin
          .from('organizations')
          .select('name')
          .eq('id', orgId)
          .single()

        for (const inv of toInsert) {
          sendInviteEmail({
            email: inv.email,
            inviterName: inviterProfile?.display_name || 'Your team',
            organizationName: org?.name || 'your organization',
            role: inv.role,
            inviteToken: inv.token,
          }).catch(err => console.error(`Failed to send invite to ${inv.email}:`, err))
        }
      } catch (emailErr) {
        console.error('Bulk invite email sending failed (non-fatal):', emailErr)
      }
    }

    const sent = results.filter(r => r.status === 'sent').length
    const skipped = results.filter(r => r.status === 'skipped').length
    const errors = results.filter(r => r.status === 'error').length

    return NextResponse.json({ results, summary: { sent, skipped, errors, total: invites.length } })
  } catch (err) {
    console.error('Bulk invite error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
