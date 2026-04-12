// lib/ai/dedup-commitments.ts
// Universal commitment deduplication — checks if a similar commitment already
// exists before inserting. Used by all pipelines (email, Slack, meetings, calendar).

import type { DetectedCommitment } from './detect-commitments'
import { calculatePriorityScore } from './detect-commitments'

// The admin client created with service role key doesn't carry schema types
type SupabaseAdmin = any // eslint-disable-line

// ── Title normalization ─────────────────────────────────────────────────────

// Strip common prefixes, noise words, and normalize for comparison
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(follow up on|follow up with|reply to|respond to|send|review|check on|update|re:|fwd:|fw:)\s*/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Simple word-overlap similarity (0-1). Catches "Budget follow-up" vs "Follow up on budget"
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(w => w.length > 2))
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }
  return overlap / Math.max(wordsA.size, wordsB.size)
}

const SIMILARITY_THRESHOLD = 0.7 // 70% word overlap = likely same commitment

// ── Metadata builder ────────────────────────────────────────────────────────

export function buildCommitmentMetadata(commitment: DetectedCommitment): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (commitment.urgency) metadata.urgency = commitment.urgency
  if (commitment.tone) metadata.tone = commitment.tone
  if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
  if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
  if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote
  return metadata
}

// ── Universal dedup insert ──────────────────────────────────────────────────

interface InsertParams {
  teamId: string
  userId: string
  source: 'slack' | 'outlook' | 'recording' | 'manual' | 'email' | 'calendar'
  sourceRef: string
  sourceUrl?: string
  category?: string
  metadata?: Record<string, unknown>
  // For email thread dedup — checks within the same conversation
  conversationId?: string | null
  // Override status — defaults to 'open'. Use 'pending_review' for auto-detected commitments.
  status?: string
}

/**
 * Insert a commitment only if no similar one already exists.
 * Checks:
 * 1. Same conversation thread (email only, via conversation_id)
 * 2. Same user's recent commitments (last 14 days) with similar title
 *
 * Returns the inserted commitment id, or null if it was a duplicate.
 */
export async function insertCommitmentIfNotDuplicate(
  supabase: SupabaseAdmin,
  commitment: DetectedCommitment,
  params: InsertParams,
): Promise<string | null> {
  const title = commitment.title || 'Untitled commitment'
  const normalized = normalizeTitle(title)

  // ── Check 1: Same email conversation thread ──
  if (params.conversationId) {
    const { data: convMsgs } = await supabase
      .from('outlook_messages')
      .select('id')
      .eq('conversation_id', params.conversationId)

    if (convMsgs && convMsgs.length > 1) {
      const convMsgIds = convMsgs.map((m: any) => m.id)
      const { data: existing } = await supabase
        .from('commitments')
        .select('id, title')
        .eq('team_id', params.teamId)
        .in('source_ref', convMsgIds)

      if (existing) {
        for (const e of existing) {
          if (titleSimilarity(e.title, title) >= SIMILARITY_THRESHOLD) {
            return null // duplicate within same conversation
          }
        }
      }
    }
  }

  // ── Check 2: Same user's recent open commitments with similar title ──
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data: recentCommitments } = await supabase
    .from('commitments')
    .select('id, title')
    .eq('team_id', params.teamId)
    .eq('creator_id', params.userId)
    .in('status', ['open', 'overdue'])
    .gte('created_at', fourteenDaysAgo)

  if (recentCommitments) {
    for (const existing of recentCommitments) {
      if (titleSimilarity(existing.title, title) >= SIMILARITY_THRESHOLD) {
        return null // duplicate — similar title already tracked
      }
    }
  }

  // ── Check 3: Already completed/dismissed commitments (wider lookback) ──
  // Prevents re-creating commitments that were already handled
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()
  const { data: pastCommitments } = await supabase
    .from('commitments')
    .select('id, title')
    .eq('team_id', params.teamId)
    .eq('creator_id', params.userId)
    .in('status', ['completed', 'dismissed', 'dropped'])
    .gte('created_at', ninetyDaysAgo)

  if (pastCommitments) {
    for (const existing of pastCommitments) {
      if (titleSimilarity(existing.title, title) >= SIMILARITY_THRESHOLD) {
        return null // duplicate — already completed or dismissed
      }
    }
  }

  // ── No duplicate found — insert ──
  const metadata = params.metadata || buildCommitmentMetadata(commitment)

  const { data, error } = await supabase
    .from('commitments')
    .insert({
      team_id: params.teamId,
      creator_id: params.userId,
      title,
      description: commitment.description || null,
      status: params.status || 'open',
      priority_score: calculatePriorityScore(commitment),
      source: params.source,
      source_ref: params.sourceRef,
      source_url: params.sourceUrl || null,
      category: params.category || commitment.commitmentType || null,
      due_date: commitment.dueDate || null,
      metadata,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to insert commitment:', error.message)
    return null
  }

  return data?.id || null
}

// ── Batch dedup for existing commitments (admin cleanup) ────────────────────

interface DuplicateGroup {
  keepId: string
  keepTitle: string
  duplicateIds: string[]
}

/**
 * Find duplicate commitment groups for a team.
 * Groups commitments with similar titles that are likely the same thing.
 * Returns groups where the oldest commitment is the "keeper" and newer ones are duplicates.
 */
export async function findDuplicateCommitments(
  supabase: SupabaseAdmin,
  teamId: string,
): Promise<{ groups: DuplicateGroup[]; totalDuplicates: number }> {
  const { data: commitments } = await supabase
    .from('commitments')
    .select('id, title, created_at, status')
    .eq('team_id', teamId)
    .in('status', ['open', 'overdue'])
    .order('created_at', { ascending: true })

  if (!commitments || commitments.length < 2) {
    return { groups: [], totalDuplicates: 0 }
  }

  const groups: DuplicateGroup[] = []
  const assigned = new Set<string>()

  for (let i = 0; i < commitments.length; i++) {
    if (assigned.has(commitments[i].id)) continue

    const duplicates: string[] = []

    for (let j = i + 1; j < commitments.length; j++) {
      if (assigned.has(commitments[j].id)) continue

      if (titleSimilarity(commitments[i].title, commitments[j].title) >= SIMILARITY_THRESHOLD) {
        duplicates.push(commitments[j].id)
        assigned.add(commitments[j].id)
      }
    }

    if (duplicates.length > 0) {
      assigned.add(commitments[i].id)
      groups.push({
        keepId: commitments[i].id,
        keepTitle: commitments[i].title,
        duplicateIds: duplicates,
      })
    }
  }

  return {
    groups,
    totalDuplicates: groups.reduce((sum, g) => sum + g.duplicateIds.length, 0),
  }
}

/**
 * Merge duplicate commitments — dismiss duplicates and keep the oldest.
 */
export async function mergeDuplicateCommitments(
  supabase: SupabaseAdmin,
  teamId: string,
): Promise<{ merged: number; groups: number }> {
  const { groups } = await findDuplicateCommitments(supabase, teamId)

  let merged = 0
  for (const group of groups) {
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'dismissed', metadata: { dismissedReason: 'duplicate', duplicateOf: group.keepId } })
      .eq('team_id', teamId)
      .in('id', group.duplicateIds)

    if (!error) {
      merged += group.duplicateIds.length
    }
  }

  return { merged, groups: groups.length }
}
