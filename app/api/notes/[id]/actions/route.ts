// app/api/notes/[id]/actions/route.ts
// Accept or dismiss AI-extracted todos / commitments from a note.
// Accepting a todo creates a row in `todos`; accepting a commitment creates
// a row in `commitments`. Either way we mark the candidate as accepted /
// dismissed in the note's `extracted_actions` JSONB so the UI hides it.

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

interface CandidateAction {
  title: string
  accepted: boolean
  dismissed: boolean
}

interface ExtractedActions {
  todos: CandidateAction[]
  commitments: CandidateAction[]
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const body = await request.json() as {
    kind: 'todo' | 'commitment'
    index: number
    action: 'accept' | 'dismiss'
  }

  if (!['todo', 'commitment'].includes(body.kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  }
  if (!['accept', 'dismiss'].includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data: note } = await admin
    .from('notes')
    .select('id, user_id, team_id, title, extracted_actions')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const extracted = (note.extracted_actions || { todos: [], commitments: [] }) as ExtractedActions
  const list = body.kind === 'todo' ? extracted.todos : extracted.commitments
  const candidate = list[body.index]
  if (!candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  if (body.action === 'accept' && body.kind === 'todo') {
    await admin.from('todos').insert({
      user_id: user.id,
      team_id: note.team_id,
      title: candidate.title,
      source_type: 'note',
      source_id: note.id,
    })
    candidate.accepted = true
  } else if (body.action === 'accept' && body.kind === 'commitment') {
    await admin.from('commitments').insert({
      team_id: note.team_id,
      creator_id: user.id,
      assignee_id: user.id,
      title: candidate.title,
      status: 'open',
      source: 'note' as any,
      metadata: {
        commitmentType: 'follow_up',
        createdVia: 'note_extraction',
        noteId: note.id,
        noteTitle: note.title,
      },
    })
    candidate.accepted = true
  } else {
    candidate.dismissed = true
  }

  await admin
    .from('notes')
    .update({ extracted_actions: extracted })
    .eq('id', note.id)

  return NextResponse.json({ extracted_actions: extracted })
}
