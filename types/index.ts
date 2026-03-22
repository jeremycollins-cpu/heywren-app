export interface User {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
}

export interface Team {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface Commitment {
  id: string
  team_id: string
  creator_id?: string
  assignee_id?: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled'
  priority_score: number
  source: string
  source_message_id?: string
  due_date?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface Integration {
  id: string
  team_id: string
  provider: 'slack' | 'outlook' | 'teams'
  access_token: string
  refresh_token?: string
  config: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Nudge {
  id: string
  commitment_id: string
  user_id: string
  message: string
  channel: 'slack' | 'email' | 'in_app'
  status: 'pending' | 'sent' | 'failed'
  sent_at?: string
  created_at: string
}
