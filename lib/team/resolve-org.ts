// lib/team/resolve-org.ts
// Org-scoped counterpart to lib/team/resolve-team.ts.
//
// Use this when a query should span everyone in the user's organization
// (System Health rollups, org-admin views, usage dashboards) — anywhere
// the user expects to see data for their whole company, not just their
// team.
//
// For team-scoped reads (the current user's commitments, their team's
// drafts) keep using resolveTeamId().

import { ensureTeamForUser } from './ensure-team'

type SupabaseClient = any

/**
 * Resolves the user's organization_id, self-healing if profiles.organization_id
 * is null. Returns the organization_id or null if truly unresolvable.
 *
 * Hot path hits profiles.organization_id; cold path runs the full ensureTeamForUser
 * cascade which also fixes team_members / profiles consistency as a side effect.
 */
export async function resolveOrganizationId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single()

  if (profile?.organization_id) return profile.organization_id

  try {
    const result = await ensureTeamForUser(userId)
    return result.organizationId
  } catch (err) {
    console.error('[resolveOrganizationId] Failed to resolve org for user:', userId, err)
    return null
  }
}

/**
 * Like resolveOrganizationId but also returns the user's current team, for
 * endpoints that need both (e.g. to pass team_id when writing to a table and
 * organization_id when reading back rollups).
 */
export async function resolveOrgAndTeam(
  supabase: SupabaseClient,
  userId: string
): Promise<{ organizationId: string | null; teamId: string | null }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, current_team_id')
    .eq('id', userId)
    .single()

  if (profile?.organization_id && profile?.current_team_id) {
    return { organizationId: profile.organization_id, teamId: profile.current_team_id }
  }

  try {
    const result = await ensureTeamForUser(userId)
    return { organizationId: result.organizationId, teamId: result.teamId }
  } catch (err) {
    console.error('[resolveOrgAndTeam] Failed to resolve org/team for user:', userId, err)
    return { organizationId: null, teamId: null }
  }
}

/**
 * Re-export of ensureTeamForUser for symmetry with resolveTeamId's module.
 * Keeps callers from importing from two locations when they're working on
 * org-scoped code paths.
 */
export { ensureTeamForUser as ensureOrganizationForUser } from './ensure-team'
