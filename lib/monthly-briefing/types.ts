// lib/monthly-briefing/types.ts
// Shared TypeScript types for the Monthly Briefing feature.

export type BriefingStatus =
  | 'pending'
  | 'aggregating'
  | 'extracting'
  | 'synthesizing'
  | 'ready'
  | 'failed'

export type SectionType =
  | 'highlights'
  | 'risks'
  | 'priorities'
  | 'projects'
  | 'context'
  | 'lowlights'
  | 'custom'

export type FileKind = 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'csv' | 'image' | 'text' | 'other'

export type ExtractionStatus = 'pending' | 'extracting' | 'ready' | 'failed' | 'skipped'

export interface BriefingBullet {
  heading: string
  detail: string
  severity?: 'info' | 'positive' | 'watch' | 'critical'
  evidence?: string
  /** Optional source tag, e.g. 'email:Acme Q1 review' or 'upload:Q1_deck.pdf' */
  source?: string
}

export interface BriefingSection {
  id: string
  briefing_id: string
  section_type: SectionType | string
  title: string
  summary: string | null
  bullets: BriefingBullet[]
  metadata: Record<string, unknown>
  order_index: number
  pinned: boolean
  user_edited: boolean
  created_at: string
  updated_at: string
}

export interface MonthlyBriefing {
  id: string
  team_id: string
  user_id: string
  period_start: string // YYYY-MM-DD
  period_end: string
  title: string | null
  subtitle: string | null
  status: BriefingStatus
  status_detail: string | null
  error_message: string | null
  data_snapshot: Record<string, unknown>
  total_cost_cents: number
  generated_at: string | null
  created_at: string
  updated_at: string
}

export interface BriefingUpload {
  id: string
  briefing_id: string
  team_id: string
  user_id: string
  file_name: string
  file_path: string
  mime_type: string | null
  file_kind: FileKind
  size_bytes: number | null
  extraction_status: ExtractionStatus
  extracted_text: string | null
  extracted_summary: string | null
  extraction_error: string | null
  uploaded_at: string
  processed_at: string | null
}

export interface BriefingMessage {
  id: string
  briefing_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  target_section_id: string | null
  action: Record<string, unknown>
  created_at: string
}

// ── Aggregated-data structure fed to the AI ──────────────────────────
// This is the "compact summary of the month" the AI synthesizes from.

export interface PeriodWindow {
  start: string // ISO date
  end: string
  label: string // "March 2026"
}

export interface AggregatedDataSnapshot {
  period: PeriodWindow
  user: {
    display_name: string | null
    job_title: string | null
    company: string | null
    email: string
  }
  commitments: {
    total_created: number
    total_completed: number
    total_overdue: number
    completion_rate_pct: number
    top_by_priority: Array<{
      title: string
      status: string
      source: string
      priority_score: number
      due_date: string | null
    }>
    overdue_samples: Array<{ title: string; due_date: string | null; days_overdue: number }>
    completed_samples: Array<{ title: string; completed_at: string | null; source: string }>
  }
  calendar: {
    total_meetings: number
    total_meeting_hours: number
    top_attendees: Array<{ name: string; meetings: number }>
    recurring_themes: string[]
  }
  meetings_with_transcripts: Array<{
    title: string
    start_time: string | null
    summary: string
    decisions: string[]
    open_questions: string[]
    sentiment: string
  }>
  emails: {
    missed_total: number
    missed_urgent: number
    awaiting_replies_total: number
    categories: Record<string, number>
    top_correspondents: Array<{ name: string; count: number }>
  }
  chats: {
    missed_total: number
    missed_urgent: number
    channels_active: string[]
  }
  uploaded_context: Array<{
    file_name: string
    file_kind: FileKind
    summary: string
  }>
  user_notes: string | null // free-text context the user supplied
}

// ── AI output shape ─────────────────────────────────────────────────

export interface SynthesizedSection {
  section_type: SectionType | string
  title: string
  summary: string
  bullets: BriefingBullet[]
}

export interface SynthesizedBriefing {
  title: string
  subtitle: string
  sections: SynthesizedSection[]
}
