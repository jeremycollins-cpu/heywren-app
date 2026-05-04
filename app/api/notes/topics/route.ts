// app/api/notes/topics/route.ts
// CRUD for note topics. Topics are hierarchical (parent_id self-FK) and
// shared across the user's team for visibility — only the creator can edit.

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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()
  if (!profile?.current_team_id) {
    return NextResponse.json({ topics: [] })
  }

  // Note count per topic — for the topic-tree UI.
  const { data: topics } = await admin
    .from('note_topics')
    .select('id, name, color, parent_id, user_id, created_at')
    .eq('team_id', profile.current_team_id)
    .order('name', { ascending: true })

  const { data: counts } = await admin
    .from('notes')
    .select('topic_id')
    .eq('user_id', user.id)
    .not('topic_id', 'is', null)

  const countMap = new Map<string, number>()
  for (const row of counts || []) {
    if (!row.topic_id) continue
    countMap.set(row.topic_id, (countMap.get(row.topic_id) || 0) + 1)
  }

  const enriched = (topics || []).map(t => ({
    ...t,
    note_count: countMap.get(t.id) || 0,
  }))

  return NextResponse.json({ topics: enriched })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()
  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const body = await request.json()
  const name = (body.name || '').trim()
  const parentId = body.parent_id || null
  const color = body.color || 'indigo'

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  // If parent supplied, validate it's in the same team to prevent cross-team mounting.
  if (parentId) {
    const { data: parent } = await admin
      .from('note_topics')
      .select('team_id')
      .eq('id', parentId)
      .single()
    if (!parent || parent.team_id !== profile.current_team_id) {
      return NextResponse.json({ error: 'Invalid parent topic' }, { status: 400 })
    }
  }

  const { data: topic, error } = await admin
    .from('note_topics')
    .insert({
      user_id: user.id,
      team_id: profile.current_team_id,
      parent_id: parentId,
      name,
      color,
    })
    .select()
    .single()

  if (error || !topic) {
    return NextResponse.json({ error: 'Failed to create topic' }, { status: 500 })
  }
  return NextResponse.json({ topic })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const body = await request.json()
  const { id, name, parent_id, color } = body
  if (!id) return NextResponse.json({ error: 'Topic id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if ('parent_id' in body) {
    if (parent_id === id) {
      return NextResponse.json({ error: 'Topic cannot be its own parent' }, { status: 400 })
    }
    updates.parent_id = parent_id || null
  }
  if (typeof color === 'string') updates.color = color

  const { data: topic, error } = await admin
    .from('note_topics')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !topic) {
    return NextResponse.json({ error: 'Failed to update topic' }, { status: 500 })
  }
  return NextResponse.json({ topic })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Topic id required' }, { status: 400 })

  // Notes in this topic become uncategorized (FK is ON DELETE SET NULL).
  const { error } = await admin
    .from('note_topics')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete topic' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
