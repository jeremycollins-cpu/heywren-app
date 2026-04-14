// lib/ai/validate-community-signal.ts
// AI validation pipeline for community-submitted signals ("Teach Wren").
//
// When a user submits an example of something HeyWren missed or got wrong,
// this pipeline:
//   1. Validates whether the signal is actionable and not spam/noise
//   2. Extracts a concrete detection pattern from the example
//   3. Checks for duplicates against existing community patterns

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface ValidationResult {
  isValid: boolean
  confidence: number
  reason: string
  extractedPattern: string | null
  patternType: 'urgency_boost' | 'new_detection' | 'priority_rule' | 'sender_context' | 'response_time' | null
  patternRule: string | null
  appliesTo: 'email' | 'slack' | 'both' | null
  isDuplicate: boolean
  duplicateOf: string | null
}

interface SignalInput {
  signalType: string
  title: string
  description: string
  exampleContent: string | null
  expectedBehavior: string
  sourcePlatform: string | null
}

// ============================================================
// Tool definition for structured validation output
// ============================================================

const VALIDATION_TOOL: Anthropic.Messages.Tool = {
  name: 'report_validation',
  description: 'Report validation results for a community signal submission.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isValid: { type: 'boolean' },
      confidence: { type: 'number', description: '0.0-1.0' },
      reason: { type: 'string', description: 'Why valid/invalid -- be specific' },
      extractedPattern: { type: 'string', description: 'Human-readable pattern description' },
      patternType: { type: 'string', enum: ['urgency_boost', 'new_detection', 'priority_rule', 'sender_context', 'response_time'] },
      patternRule: { type: 'string', description: 'Concise rule for injection into AI detection prompt' },
      appliesTo: { type: 'string', enum: ['email', 'slack', 'both'] },
      isDuplicate: { type: 'boolean' },
      duplicateOf: { type: 'string', description: 'Description of existing pattern it duplicates, or null' },
    },
    required: ['isValid', 'confidence', 'reason', 'isDuplicate'],
  },
}

/**
 * Validates a community signal submission and extracts an actionable pattern.
 */
export async function validateCommunitySignal(
  signal: SignalInput,
  existingPatterns: Array<{ id: string; pattern_description: string; pattern_rule: string }>
): Promise<ValidationResult> {
  const existingPatternsText = existingPatterns.length > 0
    ? existingPatterns.map((p, i) => `[${i + 1}] ${p.pattern_description} -> ${p.pattern_rule}`).join('\n')
    : '(none)'

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [{ type: 'text', text: `Validate community feedback for HeyWren (AI commitment/missed-email detector for Slack + Outlook).

Users submit examples of misses or errors. Your job:
1. Is it valid and actionable (not spam, vague, or duplicate)?
2. Extract a reusable detection pattern for this class of problem.
3. Check against existing patterns.

Criteria:
- VALID: specific example + clear expected behavior + real detection gap + broadly applicable
- INVALID: vague ("it doesn't work"), spam, too personal, no actionable fix
- DUPLICATE: core pattern already exists (even if worded differently)

Pattern rules:
- Specific enough to act on, general enough for all users
- Focus on the CLASS, not the instance
- Phrase as instruction to an AI classifier
- Good: "Emails with 'please let me know a convenient time' are scheduling requests expecting same-day response"
- Bad: "Flag emails from Fareed at outsourcetel.com"`, cache_control: { type: 'ephemeral' } } as any],
    tools: [VALIDATION_TOOL],
    tool_choice: { type: 'tool', name: 'report_validation' },
    messages: [{
      role: 'user',
      content: `Validate this signal:

Type: ${signal.signalType}
Title: ${signal.title}
Description: ${signal.description}
${signal.exampleContent ? `Example:\n${signal.exampleContent}` : ''}
Expected: ${signal.expectedBehavior}
Platform: ${signal.sourcePlatform || 'not specified'}

Existing patterns:
${existingPatternsText}`,
    }],
  })

  recordTokenUsage(message.usage)

  const toolBlock = message.content.find((b) => b.type === 'tool_use')
  if (toolBlock && toolBlock.type === 'tool_use') {
    const result = toolBlock.input as ValidationResult
    return {
      isValid: result.isValid ?? false,
      confidence: result.confidence ?? 0,
      reason: result.reason ?? 'Unknown',
      extractedPattern: result.extractedPattern ?? null,
      patternType: result.patternType ?? null,
      patternRule: result.patternRule ?? null,
      appliesTo: result.appliesTo ?? null,
      isDuplicate: result.isDuplicate ?? false,
      duplicateOf: result.duplicateOf ?? null,
    }
  }

  return {
    isValid: false,
    confidence: 0,
    reason: 'Failed to analyze signal',
    extractedPattern: null,
    patternType: null,
    patternRule: null,
    appliesTo: null,
    isDuplicate: false,
    duplicateOf: null,
  }
}

/**
 * Validates a signal and updates the database.
 * If confidence >= 0.8 and valid, auto-promotes to a community pattern.
 */
export async function validateAndPromoteSignal(signalId: string): Promise<void> {
  const supabase = getAdminClient()

  const { data: signal, error } = await supabase
    .from('community_signals')
    .select('*')
    .eq('id', signalId)
    .single()

  if (error || !signal) {
    console.error('Failed to fetch signal for validation:', error?.message)
    return
  }

  const { data: existingPatterns } = await supabase
    .from('community_patterns')
    .select('id, pattern_description, pattern_rule')
    .eq('active', true)

  const result = await validateCommunitySignal(
    {
      signalType: signal.signal_type,
      title: signal.title,
      description: signal.description,
      exampleContent: signal.example_content,
      expectedBehavior: signal.expected_behavior,
      sourcePlatform: signal.source_platform,
    },
    existingPatterns || []
  )

  const validationStatus = result.isDuplicate
    ? 'duplicate'
    : result.isValid && result.confidence >= 0.8
      ? 'promoted'
      : result.isValid
        ? 'validated'
        : 'rejected'

  await supabase
    .from('community_signals')
    .update({
      validation_status: validationStatus,
      validation_confidence: result.confidence,
      validation_reason: result.reason,
      extracted_pattern: result.extractedPattern,
    })
    .eq('id', signalId)

  if (validationStatus === 'promoted' && result.patternRule && result.patternType) {
    await supabase
      .from('community_patterns')
      .insert({
        signal_id: signalId,
        pattern_type: result.patternType,
        pattern_description: result.extractedPattern || signal.title,
        pattern_rule: result.patternRule,
        applies_to: result.appliesTo || 'both',
      })

    console.log(`Community signal ${signalId} promoted to pattern: ${result.extractedPattern}`)
  }
}

/**
 * Fetches all active community patterns for injection into detection prompts.
 */
export async function getActiveCommunityPatterns(
  appliesTo: 'email' | 'slack' | 'both'
): Promise<string[]> {
  const supabase = getAdminClient()

  const { data: patterns } = await supabase
    .from('community_patterns')
    .select('pattern_rule')
    .eq('active', true)
    .in('applies_to', [appliesTo, 'both'])
    .order('positive_feedback', { ascending: false })
    .limit(20)

  return (patterns || []).map(p => p.pattern_rule)
}
