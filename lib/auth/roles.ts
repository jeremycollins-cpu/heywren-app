import { createClient } from '@/lib/supabase/server'

export type UserRole = 'user' | 'admin' | 'super_admin'

/**
 * Get the user's role in their current team
 */
export async function getUserRole(userId: string): Promise<UserRole> {
  const supabase = await createClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return 'user'
  }

  return (profile.role as UserRole) || 'user'
}

/**
 * Check if user is an admin
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId)
  return role === 'admin' || role === 'super_admin'
}

/**
 * Check if user is a super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId)
  return role === 'super_admin'
}

/**
 * Require a specific role, throw error if not met
 */
export async function requireRole(
  userId: string,
  requiredRole: UserRole
): Promise<void> {
  const role = await getUserRole(userId)

  const roleHierarchy = { user: 0, admin: 1, super_admin: 2 }
  const userLevel = roleHierarchy[role]
  const requiredLevel = roleHierarchy[requiredRole]

  if (userLevel < requiredLevel) {
    throw new Error(`Insufficient permissions. Required role: ${requiredRole}`)
  }
}
