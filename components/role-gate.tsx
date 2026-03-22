'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/auth/roles'

interface RoleGateProps {
  requiredRole: UserRole
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGate({ requiredRole, children, fallback }: RoleGateProps) {
  const [hasAccess, setHasAccess] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const checkRole = async () => {
      try {
        const { data: user } = await supabase.auth.getUser()
        if (!user?.user) {
          setHasAccess(false)
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.user.id)
          .single()

        const roleHierarchy = {
          user: 0,
          admin: 1,
          super_admin: 2,
        }

        const userLevel = roleHierarchy[profile?.role as UserRole] || 0
        const requiredLevel = roleHierarchy[requiredRole]

        setHasAccess(userLevel >= requiredLevel)
      } catch (error) {
        console.error('Error checking role:', error)
        setHasAccess(false)
      } finally {
        setLoading(false)
      }
    }

    checkRole()
  }, [supabase, requiredRole])

  if (loading) {
    return null
  }

  if (!hasAccess) {
    return fallback || null
  }

  return <>{children}</>
}
