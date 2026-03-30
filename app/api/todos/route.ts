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
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()

  // Fetch todos where user is creator OR assignee
  const { data: todos, error } = await admin
    .from('todos')
    .select('*')
    .or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`)
    .order('completed', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch todos' }, { status: 500 })
  }

  // Collect unique user IDs for profile lookup (creators + assignees)
  const userIds = new Set<string>()
  for (const t of todos || []) {
    if (t.user_id) userIds.add(t.user_id)
    if (t.assigned_to) userIds.add(t.assigned_to)
  }

  let profiles: Record<string, { display_name: string; email: string }> = {}
  if (userIds.size > 0) {
    const { data: profileData } = await admin
      .from('profiles')
      .select('id, display_name, email')
      .in('id', Array.from(userIds))

    if (profileData) {
      for (const p of profileData) {
        profiles[p.id] = { display_name: p.display_name || p.email?.split('@')[0] || '', email: p.email || '' }
      }
    }
  }

  return NextResponse.json({ todos: todos || [], profiles })
}

export async function POST(request: NextRequest) {
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

  const body = await request.json()
  const { title, source_type, source_id, parent_id, assigned_to } = body

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  // If assigning to someone, verify they're on the same team
  if (assigned_to) {
    const { data: assigneeMembership } = await admin
      .from('team_members')
      .select('team_id')
      .eq('user_id', assigned_to)
      .eq('team_id', membership.team_id)
      .limit(1)
      .single()

    if (!assigneeMembership) {
      return NextResponse.json({ error: 'Assignee is not on your team' }, { status: 400 })
    }
  }

  const { data: todo, error } = await admin
    .from('todos')
    .insert({
      user_id: user.id,
      team_id: membership.team_id,
      title: title.trim(),
      source_type: source_type || 'manual',
      source_id: source_id || null,
      parent_id: parent_id || null,
      assigned_to: assigned_to || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 })
  }

  return NextResponse.json({ todo })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const body = await request.json()
  const { id, completed, title, assigned_to } = body

  if (!id) {
    return NextResponse.json({ error: 'Todo ID is required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof completed === 'boolean') {
    updates.completed = completed
    updates.completed_at = completed ? new Date().toISOString() : null
  }
  if (typeof title === 'string' && title.trim().length > 0) {
    updates.title = title.trim()
  }
  if (assigned_to !== undefined) {
    updates.assigned_to = assigned_to || null
  }

  // Allow update if user is creator OR assignee
  const { data: todo, error } = await admin
    .from('todos')
    .update(updates)
    .eq('id', id)
    .or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 })
  }

  return NextResponse.json({ todo })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Todo ID is required' }, { status: 400 })
  }

  // Only the creator can delete
  const { error } = await admin
    .from('todos')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete todo' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
