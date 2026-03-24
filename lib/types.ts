export type CommitmentSource = 'slack' | 'email' | 'meeting' | 'manual'
export type CommitmentStatus = 'open' | 'in_progress' | 'completed' | 'overdue' | 'dropped'
export type IntegrationProvider = 'slack' | 'outlook' | 'google'
export type IntegrationStatus = 'connected' | 'disconnected' | 'error'
export type TeamMemberRole = 'owner' | 'admin' | 'member'
export type NudgeChannel = 'slack' | 'email' | 'in_app'
export type NudgeStatus = 'pending' | 'sent' | 'dismissed'
export type ActivityAction = 'created' | 'updated' | 'completed' | 'nudged' | 'commented'

export interface Profile {
  id: string
  display_name: string
  email: string
  role: 'user' | 'admin' | 'super_admin'
  company?: string
  team_size?: string
  avatar_url?: string
  current_team_id?: string
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  slug: string
  owner_id: string
  slack_team_id?: string
  stripe_customer_id?: string
  stripe_subscription_id?: string
  subscription_plan: 'trial' | 'basic' | 'pro' | 'team'
  subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'incomplete'
  trial_ends_at?: string
  max_users: number
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: TeamMemberRole
  joined_at: string
}

export interface Integration {
  id: string
  team_id: string
  provider: IntegrationProvider
  nango_connection_id?: string
  status: IntegrationStatus
  config: Record<string, any>
  connected_at?: string
  updated_at: string
}

export type CommitmentUrgency = 'low' | 'medium' | 'high' | 'critical'
export type CommitmentTone = 'casual' | 'professional' | 'urgent' | 'demanding'
export type CommitmentType = 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'

export interface CommitmentStakeholder {
  name: string
  role: 'owner' | 'assignee' | 'stakeholder'
}

export interface CommitmentMetadata {
  urgency?: CommitmentUrgency
  tone?: CommitmentTone
  commitmentType?: CommitmentType
  stakeholders?: CommitmentStakeholder[]
  originalQuote?: string
  channelName?: string
}

export interface Commitment {
  id: string
  team_id: string
  creator_id: string
  assignee_id?: string
  title: string
  description?: string
  source: CommitmentSource
  source_ref?: string
  source_url?: string
  status: CommitmentStatus
  priority_score: number
  due_date?: string
  metadata?: CommitmentMetadata
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface Nudge {
  id: string
  commitment_id: string
  team_id: string
  recipient_id: string
  message: string
  channel: NudgeChannel
  status: NudgeStatus
  sent_at?: string
  dismissed_at?: string
  created_at: string
}

export interface Activity {
  id: string
  team_id: string
  user_id: string
  commitment_id?: string
  action: ActivityAction
  metadata: Record<string, any>
  created_at: string
}

export interface SlackMessage {
  id: string
  team_id: string
  slack_channel_id: string
  slack_message_ts: string
  sender_slack_id: string
  content_hash: string
  processed: boolean
  commitments_found: number
  created_at: string
}

export interface DetectedCommitment {
  title: string
  description?: string
  assignee?: string
  due_date?: string
  priority_score: number
  has_commitment: boolean
}

export interface CommitmentStats {
  total_open: number
  total_overdue: number
  total_completed_this_week: number
  team_health_score: number
}

export interface DashboardData {
  stats: CommitmentStats
  recent_commitments: Commitment[]
  recent_nudges: Nudge[]
  activities: Activity[]
}
