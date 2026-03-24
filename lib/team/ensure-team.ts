// lib/team/ensure-team.ts
// Single source of truth for resolving a user's team.
// Every route that needs a teamId should call ensureTeamForUser() instead of
// duplicating the lookup → domain match → create fallback chain.
//
// Resolution order:
//   1. team_members table (most authoritative)
//   2. profiles.current_team_id (may be stale but fast)
//   3. Domain match against teams.domain (for corporate emails)
//   4. Create new team (last resort — always sets domain + owner_id)
//
// After resolution, BOTH profiles.current_team_id AND team_members are
// guaranteed to be consistent.

import { createClient } from '@supabase/supabase-js'

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'tutanota.com',
  'zoho.com', 'yandex.com', 'mail.com', 'gmx.com',
  'fastmail.com', 'hey.com', 'pm.me',
])

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface EnsureTeamResult {
  teamId: string
  flow: 'existing_member' | 'existing_profile' | 'domain_match' | 'created'
  teamName?: string
}

/**
 * Ensures a user has a team. Resolves existing team or creates one.
 * Always guarantees: team_members row exists + profiles.current_team_id is set.
 *
 * @param userId - The user's auth UUID
 * @param options - Optional context for better team creation
 * @returns The resolved team ID and how it was resolved
 */
export async function ensureTeamForUser(
  userId: string,
  options?: {
    companyName?: string
    joiningTeamId?: string | null
  }
): Promise<EnsureTeamResult> {
  const supabase = getAdminClient()

  // ── Step 1: Check team_members (most authoritative) ──
  const { data: existingMembership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (existingMembership?.team_id) {
    // Ensure profiles.current_team_id is consistent
    await supabase
      .from('profiles')
      .update({ current_team_id: existingMembership.team_id })
      .eq('id', userId)
      .is('current_team_id', null)

    return { teamId: existingMembership.team_id, flow: 'existing_member' }
  }

  // ── Step 2: Check profiles.current_team_id ──
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id, email')
    .eq('id', userId)
    .single()

  if (profile?.current_team_id) {
    // Profile has a team but team_members is missing — fix the inconsistency
    await supabase
      .from('team_members')
      .upsert(
        { team_id: profile.current_team_id, user_id: userId, role: 'member' },
        { onConflict: 'team_id,user_id' }
      )

    return { teamId: profile.current_team_id, flow: 'existing_profile' }
  }

  // ── Step 3: If joining a specific team (from Stripe metadata / invite) ──
  if (options?.joiningTeamId) {
    const { data: targetTeam } = await supabase
      .from('teams')
      .select('id, name')
      .eq('id', options.joiningTeamId)
      .single()

    if (targetTeam) {
      await assignUserToTeam(supabase, userId, targetTeam.id, 'member')
      return { teamId: targetTeam.id, flow: 'domain_match', teamName: targetTeam.name }
    }
    // Team doesn't exist — fall through to domain match / create
  }

  // ── Step 4: Domain match ──
  const userEmail = profile?.email || ''
  // If no email in profile, try to get from auth
  let email = userEmail
  if (!email) {
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    email = authUser?.user?.email || ''
  }

  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : null

  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    const { data: domainTeam } = await supabase
      .from('teams')
      .select('id, name')
      .eq('domain', domain)
      .limit(1)
      .single()

    if (domainTeam) {
      await assignUserToTeam(supabase, userId, domainTeam.id, 'member')
      return { teamId: domainTeam.id, flow: 'domain_match', teamName: domainTeam.name }
    }
  }

  // ── Step 5: Create new team (last resort) ──
  const companyName = options?.companyName || domain?.split('.')[0] || 'My Team'
  const displayName = companyName.charAt(0).toUpperCase() + companyName.slice(1)
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '-' + Date.now().toString(36)

  const { data: newTeam, error: teamError } = await supabase
    .from('teams')
    .insert({
      name: displayName,
      slug,
      owner_id: userId,
      domain: domain || null,
    })
    .select('id, name')
    .single()

  if (teamError || !newTeam) {
    console.error('[ensureTeamForUser] Team creation failed:', teamError)
    throw new Error('Failed to create team for user ' + userId)
  }

  await assignUserToTeam(supabase, userId, newTeam.id, 'owner')
  return { teamId: newTeam.id, flow: 'created', teamName: newTeam.name }
}

/**
 * Assigns a user to a team, ensuring both team_members and profiles are consistent.
 */
async function assignUserToTeam(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  teamId: string,
  role: 'owner' | 'admin' | 'member'
) {
  // Upsert team_members
  const { error: memberError } = await supabase
    .from('team_members')
    .upsert(
      { team_id: teamId, user_id: userId, role },
      { onConflict: 'team_id,user_id' }
    )

  if (memberError) {
    console.error('[assignUserToTeam] team_members upsert failed:', memberError)
    // Try plain insert as fallback
    await supabase
      .from('team_members')
      .insert({ team_id: teamId, user_id: userId, role })
  }

  // Update profiles.current_team_id
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ current_team_id: teamId })
    .eq('id', userId)

  if (profileError) {
    console.error('[assignUserToTeam] profile update failed:', profileError)
  }
}

/**
 * Admin utility: Fix a specific user who is missing a team association.
 * Can optionally force-assign them to a specific team.
 */
export async function fixOrphanedUser(
  userEmail: string,
  forceTeamId?: string
): Promise<{ success: boolean; userId?: string; teamId?: string; flow?: string; error?: string }> {
  const supabase = getAdminClient()

  // Find user by email
  const { data: users } = await supabase.auth.admin.listUsers()
  const user = users?.users?.find(u => u.email?.toLowerCase() === userEmail.toLowerCase())

  if (!user) {
    return { success: false, error: `User not found: ${userEmail}` }
  }

  try {
    if (forceTeamId) {
      await assignUserToTeam(supabase, user.id, forceTeamId, 'member')
      return { success: true, userId: user.id, teamId: forceTeamId, flow: 'force_assigned' }
    }

    const result = await ensureTeamForUser(user.id)
    return { success: true, userId: user.id, teamId: result.teamId, flow: result.flow }
  } catch (err: any) {
    return { success: false, userId: user.id, error: err.message }
  }
}
