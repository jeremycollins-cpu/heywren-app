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
 * POST /api/team-challenges
 * Creates a new team challenge. Only org_admin can create challenges.
 */
export async function POST(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    // Verify caller is org_admin
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization membership' }, { status: 404 })
    }

    if (membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can create challenges' }, { status: 403 })
    }

    const body = await request.json()
    const { title, description, scopeType, scopeId, targetMetric, targetValue, startsAt, endsAt } = body

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    if (!scopeType || !['organization', 'department', 'team'].includes(scopeType)) {
      return NextResponse.json({ error: 'Invalid scope type' }, { status: 400 })
    }

    const validMetrics = ['commitments_completed', 'points_earned', 'response_rate', 'on_time_rate', 'streak_members']
    if (!targetMetric || !validMetrics.includes(targetMetric)) {
      return NextResponse.json({ error: 'Invalid target metric' }, { status: 400 })
    }

    if (!targetValue || typeof targetValue !== 'number' || targetValue <= 0) {
      return NextResponse.json({ error: 'Target value must be a positive number' }, { status: 400 })
    }

    if (!startsAt || !endsAt) {
      return NextResponse.json({ error: 'Start and end dates are required' }, { status: 400 })
    }

    const startDate = new Date(startsAt)
    const endDate = new Date(endsAt)
    const now = new Date()

    // Allow start date to be today (compare dates only, not times)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startDateDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())

    if (startDateDay < todayStart) {
      return NextResponse.json({ error: 'Start date must be today or in the future' }, { status: 400 })
    }

    if (endDate <= startDate) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
    }

    // Determine scope_id: if scope is organization, use the org id
    const effectiveScopeId = scopeType === 'organization' ? membership.organization_id : scopeId

    if (!effectiveScopeId) {
      return NextResponse.json({ error: 'Scope ID is required for department/team scope' }, { status: 400 })
    }

    // Insert challenge
    const { data: challenge, error: insertError } = await admin
      .from('team_challenges')
      .insert({
        organization_id: membership.organization_id,
        scope_type: scopeType,
        scope_id: effectiveScopeId,
        title: title.trim(),
        description: description?.trim() || null,
        target_metric: targetMetric,
        target_value: targetValue,
        current_value: 0,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
        status: 'active',
        created_by: userId,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Failed to create challenge:', insertError)
      return NextResponse.json({ error: 'Failed to create challenge' }, { status: 500 })
    }

    return NextResponse.json(challenge, { status: 201 })
  } catch (err) {
    console.error('Create challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/team-challenges
 * Cancels a challenge. Only org_admin or the original creator can cancel.
 * Expects: { challengeId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const body = await request.json()
    const { challengeId } = body

    if (!challengeId) {
      return NextResponse.json({ error: 'Challenge ID is required' }, { status: 400 })
    }

    // Fetch the challenge
    const { data: challenge } = await admin
      .from('team_challenges')
      .select('id, organization_id, created_by, status')
      .eq('id', challengeId)
      .single()

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status === 'cancelled') {
      return NextResponse.json({ error: 'Challenge is already cancelled' }, { status: 400 })
    }

    // Verify caller is org_admin or creator
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', challenge.organization_id)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }

    const isAdmin = membership.role === 'org_admin'
    const isCreator = challenge.created_by === userId

    if (!isAdmin && !isCreator) {
      return NextResponse.json({ error: 'Only org admins or the challenge creator can cancel' }, { status: 403 })
    }

    // Set status to cancelled
    const { data: updated, error: updateError } = await admin
      .from('team_challenges')
      .update({ status: 'cancelled' })
      .eq('id', challengeId)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to cancel challenge:', updateError)
      return NextResponse.json({ error: 'Failed to cancel challenge' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Cancel challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
