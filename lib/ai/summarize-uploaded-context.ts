// lib/ai/summarize-uploaded-context.ts
// Compresses the extracted text of a single uploaded file (deck, doc,
// spreadsheet) into a dense 200-500 token summary. This is the "map" half
// of the map-reduce synthesis pipeline — by pre-summarizing each file we
// keep the final synthesis prompt small and cheap.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const SYSTEM_PROMPT = `You compress executive documents (board decks, financial reports, strategy memos, spreadsheets) into dense, faithful summaries.

Your output is consumed by another model that synthesizes a CEO's monthly briefing — so preserve:
- Concrete numbers (ARR, EBITDA, attainment %, headcount, churn)
- Named risks, named projects, named people, named customers
- Direct quotes that capture stance or tone
- Time references (Q1, last 30 days, since April 2025)
- Decisions made and decisions pending

Avoid:
- Generic restatement ("the company is doing well")
- Fluff or marketing language
- Inventing information not present in the source

Length: 200-500 words. Use bullet points organized by theme. Lead with the headline finding.`

interface SummarizeParams {
  fileName: string
  fileKind: string
  extractedText: string
}

/**
 * Returns a compact summary of the file, or null on failure.
 * Caller should still record the file in the briefing even if summary is null.
 */
export async function summarizeUploadedContext(
  params: SummarizeParams,
): Promise<string | null> {
  const { fileName, fileKind, extractedText } = params
  if (!extractedText || extractedText.trim().length < 80) return null

  const userMessage = `File: ${fileName}
Type: ${fileKind}

---
${extractedText}
---

Produce the dense summary described above.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      messages: [{ role: 'user', content: userMessage }],
    })

    recordTokenUsage(response.usage)

    const block = response.content.find(b => b.type === 'text')
    if (block && block.type === 'text') {
      return block.text.trim()
    }
  } catch (err) {
    console.error('[summarize-uploaded-context] failed for', fileName, (err as Error).message)
  }
  return null
}
