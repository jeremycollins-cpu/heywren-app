'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { type PlanKey, canAccessFeature, canAccessRoute, hasAccess, FEATURES } from '@/lib/plans'

interface PlanContextValue {
  /** Current team's subscription plan. */
  plan: PlanKey
  /** Whether the plan data has loaded. */
  loading: boolean
  /** Current team ID. */
  teamId: string | null
  /** Check if a feature key is accessible on the current plan. */
  canAccess: (featureKey: string) => boolean
  /** Check if a route is accessible on the current plan. */
  canAccessRoute: (pathname: string) => boolean
  /** Check if current plan meets a minimum plan level. */
  hasAccess: (requiredPlan: PlanKey) => boolean
  /** Refresh plan data (e.g. after an upgrade). */
  refresh: () => Promise<void>
}

const PlanContext = createContext<PlanContextValue>({
  plan: 'trial',
  loading: true,
  teamId: null,
  canAccess: () => true,
  canAccessRoute: () => true,
  hasAccess: () => true,
  refresh: async () => {},
})

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<PlanKey>('trial')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchPlan = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', user.user.id)
        .single()

      if (!profile?.current_team_id) return

      setTeamId(profile.current_team_id)

      const { data: team } = await supabase
        .from('teams')
        .select('subscription_plan')
        .eq('id', profile.current_team_id)
        .single()

      if (team?.subscription_plan) {
        setPlan(team.subscription_plan as PlanKey)
      }
    } catch (err) {
      console.error('Error fetching plan:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlan()
  }, [supabase])

  const value: PlanContextValue = {
    plan,
    loading,
    teamId,
    canAccess: (featureKey: string) => canAccessFeature(plan, featureKey),
    canAccessRoute: (pathname: string) => canAccessRoute(plan, pathname),
    hasAccess: (requiredPlan: PlanKey) => hasAccess(plan, requiredPlan),
    refresh: fetchPlan,
  }

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>
}

export function usePlan() {
  return useContext(PlanContext)
}
