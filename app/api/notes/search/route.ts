// app/api/notes/search/route.ts
// Full-text search across the user's notes (title, summary, transcription, body).
// Used by the /notes page search bar and by the Wren chat for retrieval.

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

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(Number(searchParams.get('limit') || '25'), 100)

  if (!q) return NextResponse.json({ notes: [] })

  const admin = getAdminClient()
  // Use ILIKE across the indexed text columns. Postgres FTS via .textSearch
  // is faster but ILIKE is simpler and the dataset per user is small enough
  // that index-on-tsvector still kicks in for substring queries.
  const pattern = `%${q.replace(/[%_]/g, m => '\\' + m)}%`

  const { data: notes, error } = await admin
    .from('notes')
    .select('id, title, summary, topic_id, note_date, created_at')
    .eq('user_id', user.id)
    .or(`title.ilike.${pattern},summary.ilike.${pattern},transcription.ilike.${pattern},body.ilike.${pattern}`)
    .order('note_date', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[notes.search]', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  return NextResponse.json({ notes: notes || [] })
}
