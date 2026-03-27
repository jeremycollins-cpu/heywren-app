/**
 * Slack message relevance scoring.
 *
 * Determines whether a Slack message (and any commitments extracted from it)
 * are relevant to a specific HeyWren user. This prevents noisy commitments
 * from large channels where the user has no involvement.
 *
 * Scoring is deterministic and free — no AI calls.
 */

export interface RelevanceContext {
  /** Slack user ID of the message author */
  messageAuthorSlackId: string
  /** Slack channel ID */
  channelId: string
  /** Raw message text */
  messageText: string
  /** The HeyWren user's Slack user ID (null if not yet mapped) */
  targetUserSlackId: string | null
  /** Number of members in the channel (from Slack API) */
  channelMemberCount?: number
  /** Whether this message is in a thread */
  isThread?: boolean
}

export interface RelevanceResult {
  /** 0.0 – 1.0 overall relevance score */
  score: number
  /** Human-readable explanation */
  reason: string
  /** Whether the message is FROM the user */
  isAuthor: boolean
  /** Whether the message @mentions the user */
  isMentioned: boolean
  /** Whether it's a small/focused channel */
  isSmallChannel: boolean
}

/** Minimum score to create a commitment. Below this = noise. */
export const RELEVANCE_THRESHOLD = 0.4

/**
 * Score how relevant a Slack message is to a specific HeyWren user.
 *
 * | Signal                        | Score |
 * |-------------------------------|-------|
 * | User is the author            | 1.0   |
 * | User is @mentioned            | 0.9   |
 * | DM / small channel (< 10)    | 0.7   |
 * | Medium channel (10–30)        | 0.35  |
 * | Large channel (30+)           | 0.15  |
 * | No Slack identity mapped      | 0.5   |
 */
export function scoreRelevance(ctx: RelevanceContext): RelevanceResult {
  const {
    messageAuthorSlackId,
    messageText,
    targetUserSlackId,
    channelMemberCount,
  } = ctx

  // If we don't know the user's Slack ID, degrade gracefully.
  // Score 0.5 preserves current behavior for unmapped users while
  // still allowing the threshold to filter out the worst noise
  // once channel-size data is available.
  if (!targetUserSlackId) {
    const channelScore = channelSizeScore(channelMemberCount)
    // Blend: unmapped baseline (0.5) weighted with channel size
    const score = channelMemberCount !== undefined
      ? Math.max(channelScore, 0.4)
      : 0.5
    return {
      score,
      reason: channelMemberCount !== undefined
        ? `No Slack identity mapped; channel has ${channelMemberCount} members`
        : 'No Slack identity mapped; defaulting to moderate relevance',
      isAuthor: false,
      isMentioned: false,
      isSmallChannel: (channelMemberCount ?? 0) < 10,
    }
  }

  // 1. Author match — they made the commitment themselves
  const isAuthor = messageAuthorSlackId === targetUserSlackId
  if (isAuthor) {
    return {
      score: 1.0,
      reason: 'User is the message author',
      isAuthor: true,
      isMentioned: false,
      isSmallChannel: (channelMemberCount ?? 0) < 10,
    }
  }

  // 2. @mention — someone assigned/directed something at the user
  //    Slack encodes mentions as <@U12345> in message text
  const isMentioned = messageText.includes(`<@${targetUserSlackId}>`)
  if (isMentioned) {
    return {
      score: 0.9,
      reason: `User was @mentioned in the message`,
      isAuthor: false,
      isMentioned: true,
      isSmallChannel: (channelMemberCount ?? 0) < 10,
    }
  }

  // 3. Channel size — proxy for how likely a random message is relevant
  const isSmallChannel = (channelMemberCount ?? 0) < 10
  const chScore = channelSizeScore(channelMemberCount)

  let reason: string
  if (channelMemberCount === undefined) {
    reason = 'User not involved; channel size unknown'
  } else if (channelMemberCount < 10) {
    reason = `Small channel (${channelMemberCount} members) — likely relevant`
  } else if (channelMemberCount < 30) {
    reason = `Medium channel (${channelMemberCount} members) — uncertain relevance`
  } else {
    reason = `Large channel (${channelMemberCount} members) — likely noise`
  }

  return {
    score: chScore,
    reason,
    isAuthor: false,
    isMentioned: false,
    isSmallChannel,
  }
}

/** Map channel member count to a base relevance score */
function channelSizeScore(memberCount?: number): number {
  if (memberCount === undefined) return 0.4 // unknown — moderate
  if (memberCount < 10) return 0.7
  if (memberCount < 30) return 0.35
  return 0.15
}
