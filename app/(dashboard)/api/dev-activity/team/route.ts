import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  computePrMetrics,
  computeContributorBreakdown,
  type GithubEventRow,
  type ContributorRow,
} from '@/lib/github/pr-metrics'

/**
 * GET /api/dev-activity/team
 *
 * Admin-gated team-scope dev activity. Returns the same PR metrics as the
 * personal endpoint but aggregated across all members of the caller's
 * current team, plus a per-contributor breakdown (framed as load
 * distribution, not a ranking).
 *
 * Query params:
 *   - days: number of days to look back (default 30)
 *
 * Access control:
 *   Only users with profiles.role in ('admin', 'super_admin'). We use the
 *   service-role client for the cross-user query since the RLS on
 *   github_events gates on team_members.role, which may not be in sync
 *   with profiles.role for all orgs.
 */
function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Admin gate + team resolution in one trip.
    const adminDb = getServiceClient()
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role, current_team_id')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
    }
    if (!profile.current_team_id) {
      return NextResponse.json({ error: 'No active team' }, { status: 400 })
    }
    const teamId = profile.current_team_id as string

    const { searchParams } = new URL(request.url)
    const days = Math.max(1, Math.min(parseInt(searchParams.get('days') || '30', 10) || 30, 180))

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceIso = since.toISOString()

    // Fetch team-scoped events via service role (bypasses RLS mismatch).
    // Cap at 5k events — generous for a 30-day window of a mid-sized team.
    const { data: events, error } = await adminDb
      .from('github_events')
      .select('id,event_type,repo_name,title,url,event_at,metadata,additions,deletions,changed_files,user_id,github_username')
      .eq('team_id', teamId)
      .gte('event_at', sinceIso)
      .order('event_at', { ascending: false })
      .limit(5000)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allEvents = (events || []) as unknown as GithubEventRow[]

    // ── Team-wide PR metrics (identical computation to personal endpoint) ──
    const prMetrics = computePrMetrics(allEvents)

    // ── Summary counts ──
    const summary = {
      totalCommits: allEvents.filter(e => e.event_type === 'commit').length,
      totalPrsOpened: allEvents.filter(e => e.event_type === 'pr_opened').length,
      totalPrsMerged: allEvents.filter(e => e.event_type === 'pr_merged').length,
      totalPrsReviewed: allEvents.filter(e => e.event_type === 'pr_reviewed').length,
      days,
    }

    // ── Contributor breakdown ──
    const contributors: ContributorRow[] = computeContributorBreakdown(allEvents)

    // Hydrate display names from profiles for every user_id we have.
    const userIds = contributors.map(c => c.user_id).filter((x): x is string => !!x)
    let nameMap = new Map<string, { full_name: string | null; avatar_url: string | null }>()
    if (userIds.length > 0) {
      const { data: profs } = await adminDb
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds)
      for (const p of profs || []) {
        nameMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url })
      }
    }
    const contributorsWithNames = contributors.map(c => ({
      ...c,
      full_name: c.user_id ? nameMap.get(c.user_id)?.full_name ?? null : null,
      avatar_url: c.user_id ? nameMap.get(c.user_id)?.avatar_url ?? null : null,
    }))

    // ── Team name for the page header ──
    const { data: team } = await adminDb
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .single()

    return NextResponse.json({
      team: { id: teamId, name: team?.name ?? 'Team' },
      summary,
      prMetrics,
      contributors: contributorsWithNames,
    })
  } catch (err: any) {
    console.error('[dev-activity/team] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
