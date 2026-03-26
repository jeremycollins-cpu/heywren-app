// lib/team/ensure-team.ts
// Single source of truth for resolving a user's organization, department, and team.
// Every route that needs org/team context should call ensureTeamForUser() instead of
// duplicating the lookup → domain match → create fallback chain.
//
// Resolution order:
//   1. organization_members table (most authoritative — new hierarchy)
//   2. team_members table (legacy fallback)
//   3. profiles.current_team_id (may be stale but fast)
//   4. Domain match against organizations.domain (for corporate emails)
//   5. Create new org + department + team (last resort)
//
// After resolution, organization_members, team_members, AND profiles are
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

export type OrgRole = 'org_admin' | 'dept_manager' | 'team_lead' | 'member'

export interface EnsureTeamResult {
  organizationId: string
  departmentId: string
  teamId: string
  role: OrgRole
  flow: 'existing_org_member' | 'existing_team_member' | 'existing_profile' | 'domain_match' | 'created'
  organizationName?: string
  teamName?: string
}

/**
 * Ensures a user has a full org hierarchy (org → dept → team).
 * Resolves existing membership or creates the full chain.
 *
 * @param userId - The user's auth UUID
 * @param options - Optional context for better org/team creation
 * @returns The resolved org hierarchy and how it was resolved
 */
export async function ensureTeamForUser(
  userId: string,
  options?: {
    companyName?: string
    joiningTeamId?: string | null
    departmentName?: string
    teamName?: string
  }
): Promise<EnsureTeamResult> {
  const supabase = getAdminClient()

  // ── Step 1: Check organization_members (new hierarchy, most authoritative) ──
  const { data: orgMembership } = await supabase
    .from('organization_members')
    .select('organization_id, department_id, team_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (orgMembership) {
    // Ensure profiles + team_members are consistent
    await syncProfileAndTeamMember(supabase, userId, orgMembership)

    return {
      organizationId: orgMembership.organization_id,
      departmentId: orgMembership.department_id,
      teamId: orgMembership.team_id,
      role: orgMembership.role as OrgRole,
      flow: 'existing_org_member',
    }
  }

  // ── Step 2: Check team_members (legacy fallback) ──
  const { data: existingMembership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (existingMembership?.team_id) {
    // Legacy member — migrate them into the org hierarchy
    const result = await migrateTeamMemberToOrgHierarchy(
      supabase, userId, existingMembership.team_id, existingMembership.role
    )
    if (result) return result
  }

  // ── Step 3: Check profiles.current_team_id ──
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id, email')
    .eq('id', userId)
    .single()

  if (profile?.current_team_id) {
    const result = await migrateTeamMemberToOrgHierarchy(
      supabase, userId, profile.current_team_id, 'member'
    )
    if (result) return { ...result, flow: 'existing_profile' }
  }

  // ── Step 4: If joining a specific team (from invite link / Stripe metadata) ──
  if (options?.joiningTeamId) {
    const { data: targetTeam } = await supabase
      .from('teams')
      .select('id, name, organization_id, department_id')
      .eq('id', options.joiningTeamId)
      .single()

    if (targetTeam?.organization_id && targetTeam?.department_id) {
      await assignUserToOrgHierarchy(supabase, userId, {
        organizationId: targetTeam.organization_id,
        departmentId: targetTeam.department_id,
        teamId: targetTeam.id,
        role: 'member',
      })
      return {
        organizationId: targetTeam.organization_id,
        departmentId: targetTeam.department_id,
        teamId: targetTeam.id,
        role: 'member',
        flow: 'domain_match',
        teamName: targetTeam.name,
      }
    }
  }

  // ── Step 5: Domain match against organizations ──
  const userEmail = profile?.email || ''
  let email = userEmail
  if (!email) {
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    email = authUser?.user?.email || ''
  }

  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : null

  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    // Try org-level domain match first
    const { data: domainOrg } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('domain', domain)
      .limit(1)
      .single()

    if (domainOrg) {
      // Find a default department + team to place the user in
      const { data: defaultDept } = await supabase
        .from('departments')
        .select('id')
        .eq('organization_id', domainOrg.id)
        .limit(1)
        .single()

      if (defaultDept) {
        const { data: defaultTeam } = await supabase
          .from('teams')
          .select('id, name')
          .eq('department_id', defaultDept.id)
          .limit(1)
          .single()

        if (defaultTeam) {
          await assignUserToOrgHierarchy(supabase, userId, {
            organizationId: domainOrg.id,
            departmentId: defaultDept.id,
            teamId: defaultTeam.id,
            role: 'member',
          })
          return {
            organizationId: domainOrg.id,
            departmentId: defaultDept.id,
            teamId: defaultTeam.id,
            role: 'member',
            flow: 'domain_match',
            organizationName: domainOrg.name,
            teamName: defaultTeam.name,
          }
        }
      }
    }

    // Legacy fallback: check teams.domain
    const { data: domainTeam } = await supabase
      .from('teams')
      .select('id, name')
      .eq('domain', domain)
      .limit(1)
      .single()

    if (domainTeam) {
      const result = await migrateTeamMemberToOrgHierarchy(
        supabase, userId, domainTeam.id, 'member'
      )
      if (result) return { ...result, flow: 'domain_match', teamName: domainTeam.name }
    }
  }

  // ── Step 6: Create new org + department + team (last resort) ──
  const companyName = options?.companyName || domain?.split('.')[0] || 'My Team'
  const displayName = companyName.charAt(0).toUpperCase() + companyName.slice(1)
  const slugBase = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const slugSuffix = Date.now().toString(36)

  // Create organization
  const { data: newOrg, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: displayName,
      slug: slugBase + '-' + slugSuffix,
      domain: domain || null,
      owner_id: userId,
    })
    .select('id, name')
    .single()

  if (orgError || !newOrg) {
    console.error('[ensureTeamForUser] Organization creation failed:', orgError)
    throw new Error('Failed to create organization for user ' + userId)
  }

  // Create default department
  const deptName = options?.departmentName || 'General'
  const { data: newDept, error: deptError } = await supabase
    .from('departments')
    .insert({
      organization_id: newOrg.id,
      name: deptName,
      slug: deptName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      head_user_id: userId,
    })
    .select('id')
    .single()

  if (deptError || !newDept) {
    console.error('[ensureTeamForUser] Department creation failed:', deptError)
    throw new Error('Failed to create department for user ' + userId)
  }

  // Create default team
  const teamDisplayName = options?.teamName || displayName
  const { data: newTeam, error: teamError } = await supabase
    .from('teams')
    .insert({
      name: teamDisplayName,
      slug: slugBase + '-team-' + slugSuffix,
      organization_id: newOrg.id,
      department_id: newDept.id,
      owner_id: userId,
      domain: domain || null,
    })
    .select('id, name')
    .single()

  if (teamError || !newTeam) {
    console.error('[ensureTeamForUser] Team creation failed:', teamError)
    throw new Error('Failed to create team for user ' + userId)
  }

  // Assign user as org_admin (they created the org)
  await assignUserToOrgHierarchy(supabase, userId, {
    organizationId: newOrg.id,
    departmentId: newDept.id,
    teamId: newTeam.id,
    role: 'org_admin',
  })

  return {
    organizationId: newOrg.id,
    departmentId: newDept.id,
    teamId: newTeam.id,
    role: 'org_admin',
    flow: 'created',
    organizationName: newOrg.name,
    teamName: newTeam.name,
  }
}

/**
 * Migrates a legacy team_members user into the org hierarchy.
 * If the team already has org/dept, places the user there.
 * If not, creates the org/dept structure around the existing team.
 */
async function migrateTeamMemberToOrgHierarchy(
  supabase: any,
  userId: string,
  teamId: string,
  legacyRole: string
): Promise<EnsureTeamResult | null> {
  // Check if team already has org hierarchy
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, organization_id, department_id, domain, owner_id')
    .eq('id', teamId)
    .single()

  if (!team) return null

  let orgId = team.organization_id
  let deptId = team.department_id

  // If team doesn't have org/dept yet, create them
  if (!orgId) {
    const { data: newOrg } = await supabase
      .from('organizations')
      .insert({
        name: team.name,
        slug: team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36),
        domain: team.domain || null,
        owner_id: team.owner_id || userId,
      })
      .select('id')
      .single()

    if (!newOrg) return null
    orgId = newOrg.id

    // Update team with org_id
    await supabase
      .from('teams')
      .update({ organization_id: orgId })
      .eq('id', teamId)
  }

  if (!deptId) {
    const { data: newDept } = await supabase
      .from('departments')
      .insert({
        organization_id: orgId,
        name: 'General',
        slug: 'general',
      })
      .select('id')
      .single()

    if (!newDept) return null
    deptId = newDept.id

    // Update team with dept_id
    await supabase
      .from('teams')
      .update({ department_id: deptId })
      .eq('id', teamId)
  }

  // Map legacy role to org role
  const roleMap: Record<string, OrgRole> = {
    owner: 'org_admin',
    admin: 'org_admin',
    member: 'member',
  }
  const orgRole = roleMap[legacyRole] || 'member'

  await assignUserToOrgHierarchy(supabase, userId, {
    organizationId: orgId,
    departmentId: deptId,
    teamId,
    role: orgRole,
  })

  return {
    organizationId: orgId,
    departmentId: deptId,
    teamId,
    role: orgRole,
    flow: 'existing_team_member',
    teamName: team.name,
  }
}

/**
 * Assigns a user to the full org hierarchy, keeping all tables consistent.
 */
async function assignUserToOrgHierarchy(
  supabase: any,
  userId: string,
  membership: {
    organizationId: string
    departmentId: string
    teamId: string
    role: OrgRole
  }
) {
  // Upsert organization_members (canonical)
  const { error: orgMemberError } = await supabase
    .from('organization_members')
    .upsert(
      {
        organization_id: membership.organizationId,
        department_id: membership.departmentId,
        team_id: membership.teamId,
        user_id: userId,
        role: membership.role,
      },
      { onConflict: 'organization_id,user_id' }
    )

  if (orgMemberError) {
    console.error('[assignUserToOrgHierarchy] org_members upsert failed:', orgMemberError)
  }

  // Keep legacy team_members in sync
  const legacyRole = membership.role === 'org_admin' ? 'owner'
    : membership.role === 'dept_manager' ? 'admin'
    : 'member'

  const { error: memberError } = await supabase
    .from('team_members')
    .upsert(
      { team_id: membership.teamId, user_id: userId, role: legacyRole },
      { onConflict: 'team_id,user_id' }
    )

  if (memberError) {
    console.error('[assignUserToOrgHierarchy] team_members upsert failed:', memberError)
    await supabase
      .from('team_members')
      .insert({ team_id: membership.teamId, user_id: userId, role: legacyRole })
  }

  // Update profile
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      current_team_id: membership.teamId,
      organization_id: membership.organizationId,
      department_id: membership.departmentId,
    })
    .eq('id', userId)

  if (profileError) {
    console.error('[assignUserToOrgHierarchy] profile update failed:', profileError)
  }
}

/**
 * Admin utility: Fix a specific user who is missing a team/org association.
 */
export async function fixOrphanedUser(
  userEmail: string,
  forceTeamId?: string
): Promise<{ success: boolean; userId?: string; teamId?: string; flow?: string; error?: string }> {
  const supabase = getAdminClient()

  const { data: users } = await supabase.auth.admin.listUsers()
  const user = users?.users?.find(u => u.email?.toLowerCase() === userEmail.toLowerCase())

  if (!user) {
    return { success: false, error: `User not found: ${userEmail}` }
  }

  try {
    const result = await ensureTeamForUser(user.id, {
      joiningTeamId: forceTeamId || null,
    })
    return {
      success: true,
      userId: user.id,
      teamId: result.teamId,
      flow: result.flow,
    }
  } catch (err: any) {
    return { success: false, userId: user.id, error: err.message }
  }
}
