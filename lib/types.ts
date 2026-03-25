export type CommitmentSource = 'slack' | 'email' | 'meeting' | 'manual'
export type CommitmentStatus = 'open' | 'in_progress' | 'completed' | 'overdue' | 'dropped' | 'likely_complete'
export type IntegrationProvider = 'slack' | 'outlook' | 'google' | 'zoom' | 'teams' | 'google_meet'
export type IntegrationStatus = 'connected' | 'disconnected' | 'error'
export type TeamMemberRole = 'owner' | 'admin' | 'member'
export type NudgeChannel = 'slack' | 'email' | 'in_app'
export type NudgeStatus = 'pending' | 'sent' | 'dismissed'
export type ActivityAction = 'created' | 'updated' | 'completed' | 'nudged' | 'commented' | 'auto_completed'

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
  subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'cancelling' | 'incomplete'
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

export type MeetingProvider = 'zoom' | 'teams' | 'google_meet' | 'manual' | 'chrome_extension'
export type TranscriptStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface MeetingTranscript {
  id: string
  team_id: string
  user_id: string
  provider: MeetingProvider
  external_meeting_id?: string
  title?: string
  start_time?: string
  duration_minutes?: number
  organizer_name?: string
  organizer_email?: string
  attendees: Array<{ name?: string; email?: string }>
  transcript_text: string
  transcript_segments?: Array<{ speaker?: string; text: string; start_s?: number; end_s?: number }>
  transcript_status: TranscriptStatus
  processed: boolean
  commitments_found: number
  hey_wren_triggers: number
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PlatformSyncCursor {
  id: string
  team_id: string
  provider: 'zoom' | 'google_meet' | 'teams'
  last_synced_at?: string
  last_recording_id?: string
  cursor_token?: string
  sync_status: 'idle' | 'syncing' | 'error'
  sync_error?: string
  recordings_synced: number
  created_at: string
  updated_at: string
}

export interface ExtensionToken {
  id: string
  team_id: string
  user_id: string
  token_hash: string
  device_name?: string
  last_used_at?: string
  expires_at: string
  revoked: boolean
  created_at: string
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
