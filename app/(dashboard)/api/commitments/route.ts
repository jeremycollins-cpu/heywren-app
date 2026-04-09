// app/(dashboard)/api/commitments/route.ts
// API for creating manual commitments

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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

    const body = await request.json()
    const { title, description, dueDate, urgency } = body
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(admin, userId)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const { data: commitment, error } = await admin
      .from('commitments')
      .insert({
        team_id: teamId,
        creator_id: userId,
        assignee_id: userId,
        title: title.trim(),
        description: description?.trim() || null,
        status: 'open',
        source: 'manual',
        priority_score: urgency === 'high' ? 90 : urgency === 'medium' ? 60 : 30,
        due_date: dueDate || null,
        metadata: {
          urgency: urgency || 'medium',
          commitmentType: 'deliverable',
          tone: 'professional',
          stakeholders: [],
        },
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ commitment })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
