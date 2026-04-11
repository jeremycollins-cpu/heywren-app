import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id
    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ mentions: [], total: 0 })
    }

    const channel = request.nextUrl.searchParams.get('channel') // 'slack' | 'email' | 'meeting' | null (all)
    const page = parseInt(request.nextUrl.searchParams.get('page') || '1', 10)
    const limit = 30
    const offset = (page - 1) * limit

    let query = admin
      .from('wren_mentions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('team_id', profile.current_team_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (channel && ['slack', 'email', 'meeting'].includes(channel)) {
      query = query.eq('channel', channel)
    }

    const { data: mentions, error, count } = await query

    if (error) {
      console.error('Failed to fetch wren mentions:', error)
      return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 })
    }

    // Enrich with linked commitment titles (match by source_url = commitment.source_url)
    const mentionUrls = (mentions || []).map((m: any) => m.source_url).filter(Boolean)
    const commitmentMap = new Map<string, string[]>()

    if (mentionUrls.length > 0) {
      const { data: commitments } = await admin
        .from('commitments')
        .select('title, source_url')
        .eq('team_id', profile.current_team_id)
        .in('source_url', mentionUrls)

      for (const c of commitments || []) {
        if (!c.source_url) continue
        const existing = commitmentMap.get(c.source_url) || []
        existing.push(c.title)
        commitmentMap.set(c.source_url, existing)
      }
    }

    const enrichedMentions = (mentions || []).map((m: any) => ({
      ...m,
      commitment_titles: m.source_url ? (commitmentMap.get(m.source_url) || []) : [],
    }))

    return NextResponse.json({
      mentions: enrichedMentions,
      total: count || 0,
      page,
      hasMore: (count || 0) > offset + limit,
    })
  } catch (err: any) {
    console.error('Wren mentions error:', err?.message || err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
