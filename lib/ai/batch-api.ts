// lib/ai/batch-api.ts
// Wrapper around the Anthropic Message Batches API for non-latency-sensitive
// AI processing at 50% cost. Uses the REST API directly to avoid SDK version
// constraints.
//
// Flow: createBatch → pollBatch → fetchBatchResults
// Typical latency: seconds to minutes for small batches.

import { recordTokenUsage } from './token-usage'

const API_BASE = 'https://api.anthropic.com/v1/messages/batches'

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  return key
}

function headers(): Record<string, string> {
  return {
    'x-api-key': getApiKey(),
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export interface BatchRequest {
  custom_id: string
  params: {
    model: string
    max_tokens: number
    system?: any
    tools?: any[]
    tool_choice?: any
    messages: Array<{ role: string; content: string }>
  }
}

interface BatchStatus {
  id: string
  processing_status: 'in_progress' | 'canceling' | 'ended'
  request_counts: {
    processing: number
    succeeded: number
    errored: number
    canceled: number
    expired: number
  }
  results_url?: string
}

export interface BatchResultItem {
  custom_id: string
  result: {
    type: 'succeeded' | 'errored' | 'canceled' | 'expired'
    message?: {
      content: any[]
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }
    error?: { type: string; message: string }
  }
}

// ── Core functions ─────────────────────────────────────────────────────

/**
 * Submit a batch of message requests to the Anthropic Batches API.
 * Returns the batch ID for polling.
 */
export async function createBatch(requests: BatchRequest[]): Promise<string> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ requests }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Batch create failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as BatchStatus
  return json.id
}

/**
 * Poll a batch until it reaches the 'ended' state.
 * Returns the final batch status.
 */
export async function pollBatch(
  batchId: string,
  opts?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<BatchStatus> {
  const pollInterval = opts?.pollIntervalMs ?? 10_000
  const maxWait = opts?.maxWaitMs ?? 10 * 60_000 // 10 minutes default
  const start = Date.now()

  while (true) {
    const res = await fetch(`${API_BASE}/${batchId}`, {
      method: 'GET',
      headers: headers(),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Batch poll failed (${res.status}): ${body.slice(0, 300)}`)
    }

    const status = (await res.json()) as BatchStatus

    if (status.processing_status === 'ended') return status

    if (Date.now() - start > maxWait) {
      throw new Error(`Batch ${batchId} did not complete within ${maxWait}ms (status: ${status.processing_status}, succeeded: ${status.request_counts.succeeded})`)
    }

    await new Promise(r => setTimeout(r, pollInterval))
  }
}

/**
 * Fetch results for a completed batch. Returns a map of custom_id → result.
 * Automatically records token usage for succeeded requests.
 */
export async function fetchBatchResults(batchId: string): Promise<Map<string, BatchResultItem>> {
  const res = await fetch(`${API_BASE}/${batchId}/results`, {
    method: 'GET',
    headers: headers(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Batch results fetch failed (${res.status}): ${body.slice(0, 300)}`)
  }

  // Results come as JSONL (one JSON object per line)
  const text = await res.text()
  const results = new Map<string, BatchResultItem>()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line) as BatchResultItem
      results.set(item.custom_id, item)

      // Track token usage for succeeded requests
      if (item.result.type === 'succeeded' && item.result.message?.usage) {
        recordTokenUsage(item.result.message.usage)
      }
    } catch {
      // Skip malformed lines
    }
  }

  return results
}

// ── Convenience ────────────────────────────────────────────────────────

/**
 * All-in-one: create a batch, poll until done, return results.
 * Use this from Inngest step.run() for non-latency-sensitive AI work.
 */
export async function runBatch(
  requests: BatchRequest[],
  opts?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<Map<string, BatchResultItem>> {
  if (requests.length === 0) return new Map()

  const batchId = await createBatch(requests)
  await pollBatch(batchId, opts)
  return fetchBatchResults(batchId)
}

/**
 * Extract the tool_use input from a succeeded batch result item.
 * Returns null if the result failed or has no tool_use block.
 */
export function extractToolResult<T>(item: BatchResultItem | undefined): T | null {
  if (!item || item.result.type !== 'succeeded' || !item.result.message) return null

  const toolBlock = item.result.message.content.find(
    (b: any) => b.type === 'tool_use'
  )
  if (!toolBlock) return null
  return toolBlock.input as T
}
