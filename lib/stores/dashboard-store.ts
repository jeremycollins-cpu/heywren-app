import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'

export interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_ref: string | null
  source_url?: string | null
  created_at: string
  updated_at: string
  metadata?: Record<string, any> | null
}

export interface SlackMention {
  id: string
  message_text: string
  user_id: string
  channel_id: string
  message_ts: string
  created_at: string
  commitments_found: number
}

interface DashboardState {
  commitments: Commitment[]
  mentions: SlackMention[]
  integrationCount: number
  expiredIntegrations: string[] // provider names with expired tokens
  teamId: string | null
  loading: boolean
  error: string | null

  fetchDashboard: () => Promise<void>
  markDone: (id: string) => Promise<void>
  snooze: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  clearError: () => void

  // Real-time actions
  addCommitment: (commitment: Commitment) => void
  updateCommitment: (commitment: Commitment) => void
  removeCommitment: (id: string) => void
  addMention: (mention: SlackMention) => void
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  commitments: [],
  mentions: [],
  integrationCount: 0,
  expiredIntegrations: [],
  teamId: null,
  loading: true,
  error: null,

  clearError: () => set({ error: null }),

  fetchDashboard: async () => {
    try {
      set({ loading: true, error: null })
      const supabase = createClient()

      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!userData?.user) {
        set({ loading: false })
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('current_team_id, slack_user_id')
        .eq('id', userData.user.id)
        .single()

      if (profileError) throw profileError

      const teamId = profile?.current_team_id
      if (!teamId) {
        set({ loading: false })
        return
      }

      const [commitResult, mentionResult, intStatusRes] = await Promise.all([
        supabase
          .from('commitments')
          .select('*')
          .eq('team_id', teamId)
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .order('created_at', { ascending: false })
          .limit(200),
        profile.slack_user_id
          ? supabase
              .from('slack_messages')
              .select('*')
              .eq('team_id', teamId)
              .eq('user_id', profile.slack_user_id)
              .order('created_at', { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [], error: null }),
        // Use server-side API for integrations (bypasses RLS)
        fetch('/api/integrations/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : { integrations: [] }),
      ])

      if (commitResult.error) throw commitResult.error
      if (mentionResult.error) throw mentionResult.error

      set({
        commitments: commitResult.data || [],
        mentions: mentionResult.data || [],
        integrationCount: intStatusRes.integrations?.length || 0,
        expiredIntegrations: (intStatusRes.integrations || [])
          .filter((i: any) => i.tokenExpired)
          .map((i: any) => i.provider as string),
        teamId,
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data'
      set({ error: message, loading: false })
    }
  },

  markDone: async (id: string) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'completed' })
      .eq('id', id)
    if (error) throw error
    set(s => ({ commitments: s.commitments.filter(c => c.id !== id) }))
  },

  snooze: async (id: string) => {
    const supabase = createClient()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('commitments')
      .update({ updated_at: now })
      .eq('id', id)
    if (error) throw error
    set(s => ({
      commitments: s.commitments.map(c =>
        c.id === id ? { ...c, updated_at: now } : c
      ),
    }))
  },

  dismiss: async (id: string) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'dismissed' })
      .eq('id', id)
    if (error) throw error
    set(s => ({ commitments: s.commitments.filter(c => c.id !== id) }))
  },

  // Real-time actions — called from useRealtime hook
  addCommitment: (commitment: Commitment) => {
    set(s => {
      // Avoid duplicates
      if (s.commitments.some(c => c.id === commitment.id)) return s
      return { commitments: [commitment, ...s.commitments] }
    })
  },

  updateCommitment: (commitment: Commitment) => {
    set(s => ({
      commitments: s.commitments.map(c => c.id === commitment.id ? { ...c, ...commitment } : c),
    }))
  },

  removeCommitment: (id: string) => {
    set(s => ({ commitments: s.commitments.filter(c => c.id !== id) }))
  },

  addMention: (mention: SlackMention) => {
    set(s => {
      if (s.mentions.some(m => m.id === mention.id)) return s
      return { mentions: [mention, ...s.mentions].slice(0, 10) }
    })
  },
}))
