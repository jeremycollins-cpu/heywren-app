// lib/team/resolve-team.ts
// Lightweight helper for API routes to resolve the user's team.
// If profiles.current_team_id is null, calls ensureTeamForUser() to self-heal.
// This prevents the "No team found" error that blocks features.

import { ensureTeamForUser } from './ensure-team'

type SupabaseClient = any

/**
 * Resolves the user's team_id, self-healing if profiles.current_team_id is null.
 * Returns the team_id or null if truly unresolvable.
 */
export async function resolveTeamId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  // Fast path: check profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', userId)
    .single()

  if (profile?.current_team_id) return profile.current_team_id

  // Self-heal: run the full resolution cascade
  try {
    const result = await ensureTeamForUser(userId)
    return result.teamId
  } catch (err) {
    console.error('[resolveTeamId] Failed to resolve team for user:', userId, err)
    return null
  }
}
