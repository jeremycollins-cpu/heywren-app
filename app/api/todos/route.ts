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

  const { data: todos, error } = await admin
    .from('todos')
    .select('*')
    .eq('user_id', user.id)
    .order('completed', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch todos' }, { status: 500 })
  }

  return NextResponse.json({ todos: todos || [] })
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
  const { title, source_type, source_id } = body

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const { data: todo, error } = await admin
    .from('todos')
    .insert({
      user_id: user.id,
      team_id: membership.team_id,
      title: title.trim(),
      source_type: source_type || 'manual',
      source_id: source_id || null,
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
  const { id, completed, title } = body

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

  const { data: todo, error } = await admin
    .from('todos')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
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
