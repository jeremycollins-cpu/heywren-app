import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from '@/lib/ai/token-usage'
import { logAiUsage } from '@/lib/ai/persist-usage'

// Aggregates "invalid" feedback across users into community patterns.
//
// When multiple users independently reject the same type of email,
// it's strong signal that the AI classifier is wrong for everyone.
// This function:
//   1. Finds domains/senders rejected by 2+ distinct users in the last 30 days
//   2. Collects example subjects + body previews from those rejections
//   3. Asks AI to extract a reusable detection pattern (not user-specific)
//   4. Inserts into community_patterns so getActiveCommunityPatterns() picks it up
//
// This closes the loop: user clicks "invalid" → eventually improves detection for all.

const MIN_USERS_FOR_PATTERN = 2     // 2+ distinct users must reject the same domain
const MIN_REJECTIONS = 3            // 3+ total rejections from that domain
const MAX_PATTERNS_PER_RUN = 5      // Don't flood patterns table
const LOOKBACK_DAYS = 30

// Domains where rejections reflect individual senders, not the domain itself.
// "3 users rejected different gmail senders" ≠ "block gmail".
const PERSONAL_DOMAIN_SAFELIST = new Set([
  // Consumer email
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'zoho.com',
  'mail.com', 'email.com', 'ymail.com', 'rocketmail.com',
  'gmx.com', 'gmx.net', 'fastmail.com',
  // ISP email
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
  'cox.net', 'charter.net', 'earthlink.net',
  // Regional
  'outlook.co.uk', 'btinternet.com', 'sky.com',
  'orange.fr', 'wanadoo.fr', 'web.de', 'gmx.de',
  'qq.com', '163.com', '126.com',
])

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const PATTERN_EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_pattern',
  description: 'Extract a reusable email detection pattern from rejected email examples.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isActionable: {
        type: 'boolean',
        description: 'true if a useful general pattern can be extracted (not just one sender)',
      },
      patternType: {
        type: 'string',
        enum: ['urgency_boost', 'new_detection', 'priority_rule', 'sender_context', 'response_time'],
      },
      patternDescription: {
        type: 'string',
        description: 'Human-readable description of the pattern',
      },
      patternRule: {
        type: 'string',
        description: 'Concise instruction for injection into AI detection prompt. Must be general enough for all users, not specific to one company or person.',
      },
    },
    required: ['isActionable', 'patternDescription', 'patternRule'],
  },
}

interface RejectionCluster {
  fromDomain: string
  uniqueUsers: number
  totalRejections: number
  examples: Array<{
    subject: string
    bodyPreview: string
    fromEmail: string
    fromName: string
  }>
}

async function findRejectionClusters(supabase: ReturnType<typeof getAdminClient>): Promise<RejectionCluster[]> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()

  // Get all recent invalid feedback with linked email content
  const { data: feedback, error } = await supabase
    .from('missed_email_feedback')
    .select('user_id, from_email, from_domain, missed_email_id')
    .eq('feedback', 'invalid')
    .gte('created_at', cutoff)

  if (error || !feedback || feedback.length === 0) return []

  // Group by domain: count unique users and total rejections
  // Skip personal/shared email domains — rejections there are about individual
  // senders, not the domain. "3 users rejected different gmail senders" ≠ "block gmail".
  const domainStats = new Map<string, { users: Set<string>; emailIds: string[] }>()
  for (const f of feedback) {
    if (!f.from_domain) continue
    if (PERSONAL_DOMAIN_SAFELIST.has(f.from_domain.toLowerCase())) continue
    if (!domainStats.has(f.from_domain)) {
      domainStats.set(f.from_domain, { users: new Set(), emailIds: [] })
    }
    const stats = domainStats.get(f.from_domain)!
    stats.users.add(f.user_id)
    if (f.missed_email_id) stats.emailIds.push(f.missed_email_id)
  }

  // Filter to domains meeting threshold
  const candidateDomains = [...domainStats.entries()]
    .filter(([, stats]) => stats.users.size >= MIN_USERS_FOR_PATTERN && (stats.users.size + stats.emailIds.length) >= MIN_REJECTIONS)
    .sort((a, b) => b[1].users.size - a[1].users.size)
    .slice(0, MAX_PATTERNS_PER_RUN * 2) // fetch extra, some may not be actionable

  if (candidateDomains.length === 0) return []

  // Get existing patterns to avoid duplicates
  const { data: existingPatterns } = await supabase
    .from('community_patterns')
    .select('pattern_description, pattern_rule')
    .eq('active', true)

  const existingRules = new Set((existingPatterns || []).map(p => p.pattern_rule.toLowerCase()))

  // Fetch example email content for each candidate domain
  const clusters: RejectionCluster[] = []
  for (const [domain, stats] of candidateDomains) {
    // Skip if we already have a pattern mentioning this domain
    if ([...existingRules].some(r => r.includes(domain.toLowerCase()))) continue

    const emailIds = stats.emailIds.slice(0, 10)
    if (emailIds.length === 0) continue

    const { data: emails } = await supabase
      .from('missed_emails')
      .select('subject, body_preview, from_email, from_name')
      .in('id', emailIds)

    if (!emails || emails.length === 0) continue

    clusters.push({
      fromDomain: domain,
      uniqueUsers: stats.users.size,
      totalRejections: stats.emailIds.length,
      examples: emails.map(e => ({
        subject: e.subject || '',
        bodyPreview: e.body_preview || '',
        fromEmail: e.from_email || '',
        fromName: e.from_name || '',
      })),
    })
  }

  return clusters.slice(0, MAX_PATTERNS_PER_RUN)
}

async function extractPattern(
  cluster: RejectionCluster,
  existingPatterns: string[]
): Promise<{ isActionable: boolean; patternType?: string; patternDescription: string; patternRule: string } | null> {
  const examplesText = cluster.examples
    .map((e, i) => `[${i + 1}] From: ${e.fromName} <${e.fromEmail}>\nSubject: ${e.subject}\nBody: ${e.bodyPreview}`)
    .join('\n\n')

  const existingText = existingPatterns.length > 0
    ? `\n\nExisting patterns (do not duplicate):\n${existingPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : ''

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: [{
        type: 'text',
        text: `You analyze emails that multiple users independently marked as "should not have been flagged as important."

Your job: extract a GENERAL pattern that helps the AI classifier avoid this mistake for ALL users.

Rules:
- Pattern must be about the CLASS of email, not a specific sender or company
- Good: "Emails from recruiting/staffing agencies asking about open roles are unsolicited cold outreach, not actionable requests"
- Bad: "Emails from sendbetteremployees.com should be filtered" (too specific)
- If the rejections are all from one niche sender with no generalizable lesson, set isActionable=false
- The patternRule should be a concise instruction to an AI email classifier${existingText}`,
        cache_control: { type: 'ephemeral' },
      } as any],
      tools: [PATTERN_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_pattern' },
      messages: [{
        role: 'user',
        content: `${cluster.uniqueUsers} different users rejected emails from domain "${cluster.fromDomain}" (${cluster.totalRejections} total rejections). Here are examples:\n\n${examplesText}`,
      }],
    })

    recordTokenUsage(message.usage)

    const toolBlock = message.content.find(b => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      return toolBlock.input as any
    }
  } catch (err) {
    console.error('[feedback-patterns] AI extraction failed:', (err as Error).message)
  }

  return null
}

export const aggregateFeedbackPatterns = inngest.createFunction(
  { id: 'aggregate-feedback-patterns' },
  { cron: 'TZ=America/Los_Angeles 0 5 * * 1' }, // Monday 5 AM PT — weekly
  async ({ step }) => {
    const supabase = getAdminClient()

    const clusters = await step.run('find-rejection-clusters', async () => {
      return findRejectionClusters(supabase)
    })

    if (clusters.length === 0) {
      return { success: true, message: 'No rejection clusters met threshold', patternsCreated: 0 }
    }

    // Fetch existing patterns for dedup
    const existingPatterns = await step.run('fetch-existing-patterns', async () => {
      const { data } = await supabase
        .from('community_patterns')
        .select('pattern_rule')
        .eq('active', true)

      return (data || []).map((p: any) => p.pattern_rule)
    })

    let patternsCreated = 0

    for (const cluster of clusters) {
      const result = await step.run(`extract-pattern-${cluster.fromDomain}`, async () => {
        return extractPattern(cluster, existingPatterns)
      })

      if (result && result.isActionable && result.patternRule) {
        await step.run(`insert-pattern-${cluster.fromDomain}`, async () => {
          const { error } = await supabase
            .from('community_patterns')
            .insert({
              pattern_type: result.patternType || 'new_detection',
              pattern_description: result.patternDescription,
              pattern_rule: result.patternRule,
              applies_to: 'email',
            })

          if (error) {
            console.error('[feedback-patterns] Insert failed:', error.message)
          } else {
            patternsCreated++
            console.log(`[feedback-patterns] New pattern from ${cluster.uniqueUsers} users rejecting ${cluster.fromDomain}: ${result.patternDescription}`)
          }
        })
      }
    }

    // ── Commitment feedback aggregation ──
    // Find commitment types/sources that multiple users mark as "inaccurate"
    const commitmentPatterns = await step.run('aggregate-commitment-feedback', async () => {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
      let created = 0

      const { data: feedback } = await supabase
        .from('commitment_feedback')
        .select('user_id, feedback, source, commitment_type, direction, original_quote')
        .eq('feedback', 'inaccurate')
        .gte('created_at', cutoff)

      if (!feedback || feedback.length === 0) return 0

      // Group by source+type+direction to find systematic false positives
      const groups = new Map<string, { users: Set<string>; quotes: string[] }>()
      for (const f of feedback) {
        const key = `${f.source || 'unknown'}:${f.commitment_type || 'unknown'}:${f.direction || 'unknown'}`
        if (!groups.has(key)) groups.set(key, { users: new Set(), quotes: [] })
        const g = groups.get(key)!
        g.users.add(f.user_id)
        if (f.original_quote) g.quotes.push(f.original_quote)
      }

      for (const [key, stats] of groups) {
        if (stats.users.size < MIN_USERS_FOR_PATTERN) continue
        if (stats.quotes.length === 0) continue

        const [source, type, direction] = key.split(':')
        const examplesText = stats.quotes.slice(0, 5).map((q, i) => `[${i + 1}] "${q}"`).join('\n')

        try {
          const message = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: [{
              type: 'text',
              text: `You analyze Slack/email messages that were incorrectly detected as commitments by an AI. Multiple users independently marked these as false positives. Extract a GENERAL pattern to help the AI avoid this mistake. The patternRule should be a concise instruction to an AI commitment detector. Set isActionable=false if the examples are too varied to generalize.`,
              cache_control: { type: 'ephemeral' },
            } as any],
            tools: [PATTERN_EXTRACTION_TOOL],
            tool_choice: { type: 'tool', name: 'extract_pattern' },
            messages: [{
              role: 'user',
              content: `${stats.users.size} users marked ${source}/${type}/${direction} commitments as false positives. Examples:\n\n${examplesText}`,
            }],
          })

          recordTokenUsage(message.usage)
          const toolBlock = message.content.find(b => b.type === 'tool_use')
          if (toolBlock && toolBlock.type === 'tool_use') {
            const result = toolBlock.input as any
            if (result.isActionable && result.patternRule) {
              await supabase.from('community_patterns').insert({
                pattern_type: result.patternType || 'new_detection',
                pattern_description: result.patternDescription,
                pattern_rule: result.patternRule,
                applies_to: source === 'outlook' ? 'email' : 'slack',
              })
              created++
              console.log(`[feedback-patterns] Commitment pattern from ${stats.users.size} users: ${result.patternDescription}`)
            }
          }
        } catch (err) {
          console.error('[feedback-patterns] Commitment pattern extraction failed:', (err as Error).message)
        }
      }

      return created
    })

    patternsCreated += commitmentPatterns

    // ── Threat feedback aggregation ──
    // Find threat types that multiple users mark as "safe" (false positive)
    const threatPatterns = await step.run('aggregate-threat-feedback', async () => {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
      let created = 0

      const { data: threats } = await supabase
        .from('email_threat_alerts')
        .select('user_id, threat_type, from_email, subject, user_feedback')
        .eq('status', 'safe')
        .gte('updated_at', cutoff)

      if (!threats || threats.length === 0) return 0

      // Group by threat_type to find systematic false positives
      const groups = new Map<string, { users: Set<string>; examples: Array<{ from: string; subject: string }> }>()
      for (const t of threats) {
        const key = t.threat_type || 'unknown'
        if (!groups.has(key)) groups.set(key, { users: new Set(), examples: [] })
        const g = groups.get(key)!
        if (t.user_id) g.users.add(t.user_id)
        g.examples.push({ from: t.from_email || '', subject: t.subject || '' })
      }

      for (const [threatType, stats] of groups) {
        if (stats.users.size < MIN_USERS_FOR_PATTERN) continue

        const examplesText = stats.examples.slice(0, 5)
          .map((e, i) => `[${i + 1}] From: ${e.from} — Subject: ${e.subject}`)
          .join('\n')

        try {
          const message = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: [{
              type: 'text',
              text: `You analyze emails that were flagged as threats but confirmed safe by multiple users. Extract a GENERAL pattern to reduce false positives in email threat detection. The patternRule should be a concise instruction to an AI threat classifier. Set isActionable=false if examples are too varied.`,
              cache_control: { type: 'ephemeral' },
            } as any],
            tools: [PATTERN_EXTRACTION_TOOL],
            tool_choice: { type: 'tool', name: 'extract_pattern' },
            messages: [{
              role: 'user',
              content: `${stats.users.size} users confirmed "${threatType}" threat alerts as safe (false positive). Examples:\n\n${examplesText}`,
            }],
          })

          recordTokenUsage(message.usage)
          const toolBlock = message.content.find(b => b.type === 'tool_use')
          if (toolBlock && toolBlock.type === 'tool_use') {
            const result = toolBlock.input as any
            if (result.isActionable && result.patternRule) {
              await supabase.from('community_patterns').insert({
                pattern_type: result.patternType || 'new_detection',
                pattern_description: result.patternDescription,
                pattern_rule: result.patternRule,
                applies_to: 'email',
              })
              created++
              console.log(`[feedback-patterns] Threat FP pattern from ${stats.users.size} users: ${result.patternDescription}`)
            }
          }
        } catch (err) {
          console.error('[feedback-patterns] Threat pattern extraction failed:', (err as Error).message)
        }
      }

      return created
    })

    patternsCreated += threatPatterns

    await logAiUsage(supabase, {
      module: 'aggregate-feedback-patterns',
      trigger: 'cron-weekly',
      teamId: 'system',
      userId: 'system',
      itemsProcessed: clusters.length,
      metadata: { patternsCreated, emailPatterns: patternsCreated - commitmentPatterns - threatPatterns, commitmentPatterns, threatPatterns },
    })

    return {
      success: true,
      clustersAnalyzed: clusters.length,
      patternsCreated,
      commitmentPatterns,
      threatPatterns,
    }
  }
)
