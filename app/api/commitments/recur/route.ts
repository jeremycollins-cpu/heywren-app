import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getNextDueDate(currentDue: string | null, recurrence: string): string {
  const base = currentDue ? new Date(currentDue) : new Date()
  switch (recurrence) {
    case 'daily':
      base.setDate(base.getDate() + 1)
      break
    case 'weekly':
      base.setDate(base.getDate() + 7)
      break
    case 'biweekly':
      base.setDate(base.getDate() + 14)
      break
    case 'monthly':
      base.setMonth(base.getMonth() + 1)
      break
  }
  return base.toISOString()
}

// POST: Create next recurring instance when a commitment is completed
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { commitmentId } = await request.json()

  if (!commitmentId) {
    return NextResponse.json({ error: 'commitmentId required' }, { status: 400 })
  }

  // Fetch the completed commitment
  const { data: commitment } = await admin
    .from('commitments')
    .select('*')
    .eq('id', commitmentId)
    .eq('creator_id', user.id)
    .single()

  if (!commitment || !commitment.recurrence) {
    return NextResponse.json({ error: 'Not a recurring commitment' }, { status: 400 })
  }

  // Create the next instance
  const nextDue = getNextDueDate(commitment.due_date, commitment.recurrence)

  const { data: newCommitment, error } = await admin
    .from('commitments')
    .insert({
      team_id: commitment.team_id,
      creator_id: commitment.creator_id,
      organization_id: commitment.organization_id || null,
      title: commitment.title,
      description: commitment.description,
      status: 'open',
      priority_score: commitment.priority_score,
      source: 'manual',
      category: commitment.category,
      recurrence: commitment.recurrence,
      recurrence_parent_id: commitment.recurrence_parent_id || commitment.id,
      due_date: nextDue,
    })
    .select('id, title, due_date')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create next instance' }, { status: 500 })
  }

  return NextResponse.json({ commitment: newCommitment })
}
