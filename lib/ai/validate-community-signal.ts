// lib/ai/validate-community-signal.ts
// AI validation pipeline for community-submitted signals ("Teach Wren").
//
// When a user submits an example of something HeyWren missed or got wrong,
// this pipeline:
//   1. Validates whether the signal is actionable and not spam/noise
//   2. Extracts a concrete detection pattern from the example
//   3. Checks for duplicates against existing community patterns
//
// High-confidence validated signals get promoted to community_patterns,
// which are injected into the detection prompts for all users.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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

/**
 * Validates a community signal submission and extracts an actionable pattern.
 */
export async function validateCommunitySignal(
  signal: SignalInput,
  existingPatterns: Array<{ id: string; pattern_description: string; pattern_rule: string }>
): Promise<ValidationResult> {
  const existingPatternsText = existingPatterns.length > 0
    ? existingPatterns.map((p, i) => `[${i + 1}] ${p.pattern_description} → ${p.pattern_rule}`).join('\n')
    : '(none yet)'

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You validate community feedback for HeyWren, an AI tool that detects commitments, missed emails, and action items in Slack messages and Outlook emails.

Users submit examples of things HeyWren missed or got wrong. Your job is to:
1. Determine if the feedback is valid and actionable (not spam, vague complaints, or duplicates)
2. Extract a concrete, reusable detection pattern that would fix this class of problem
3. Check if a similar pattern already exists

Return ONLY valid JSON (no markdown, no code fences):
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "reason": "Why this signal is valid/invalid — be specific",
  "extractedPattern": "A human-readable description of the pattern, e.g. 'Vendor/service-provider follow-up emails requesting feedback should be classified as high urgency'",
  "patternType": "urgency_boost|new_detection|priority_rule|sender_context|response_time|null",
  "patternRule": "A concise rule that can be injected into an AI detection prompt, e.g. 'When a vendor or service provider sends a follow-up email asking about satisfaction, deliverable quality, or requesting a meeting, classify as urgency: high with expectedResponseTime: same_day'",
  "appliesTo": "email|slack|both|null",
  "isDuplicate": true/false,
  "duplicateOf": "description of the existing pattern it duplicates, or null"
}

Validation criteria:
- VALID: Specific example with clear expected behavior; describes a real detection gap; pattern would help other users
- INVALID: Vague ("it doesn't work"), spam, personal preference without broader applicability, complaint without actionable fix
- DUPLICATE: The core pattern already exists in the existing patterns list (even if worded differently)

Pattern extraction guidelines:
- Be specific enough to be actionable but general enough to help all users
- Focus on the CLASS of problem, not the specific instance
- The patternRule should be phrased as an instruction to an AI classifier
- Good: "Emails containing 'please let me know a convenient time' are scheduling requests expecting same-day response"
- Bad: "Flag emails from Fareed at outsourcetel.com" (too specific to one sender)`,
    messages: [{
      role: 'user',
      content: `Validate this community signal:

Type: ${signal.signalType}
Title: ${signal.title}
Description: ${signal.description}
${signal.exampleContent ? `Example content:\n${signal.exampleContent}` : ''}
Expected behavior: ${signal.expectedBehavior}
Platform: ${signal.sourcePlatform || 'not specified'}

Existing community patterns:
${existingPatternsText}`,
    }],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const jsonStr = extractJSON(content.text)
    return JSON.parse(jsonStr)
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

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) return jsonMatch[0]
  return text.trim()
}

/**
 * Validates a signal and updates the database.
 * If confidence >= 0.8 and valid, auto-promotes to a community pattern.
 */
export async function validateAndPromoteSignal(signalId: string): Promise<void> {
  const supabase = getAdminClient()

  // Fetch the signal
  const { data: signal, error } = await supabase
    .from('community_signals')
    .select('*')
    .eq('id', signalId)
    .single()

  if (error || !signal) {
    console.error('Failed to fetch signal for validation:', error?.message)
    return
  }

  // Fetch existing patterns for duplicate checking
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

  // Update the signal with validation results
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

  // Auto-promote high-confidence valid signals to community patterns
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
