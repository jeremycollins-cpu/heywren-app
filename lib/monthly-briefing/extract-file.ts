// lib/monthly-briefing/extract-file.ts
// Server-side text extraction for files uploaded as briefing context.
//
// Strategy:
//   • PDF       → pdf-parse (pure JS, serverless-safe)
//   • PPTX/DOCX → officeparser (pure JS, unzips and reads OOXML)
//   • XLSX/CSV  → xlsx (SheetJS)        → markdown table per sheet
//   • Image     → return null + flag for vision-handoff in synthesis
//   • Text      → utf-8 decode
//
// We bound the extracted text per file to keep AI input costs predictable.

import type { FileKind } from './types'

const PER_FILE_CHAR_BUDGET = 60_000 // ~15K tokens worst case

export interface ExtractionResult {
  text: string | null
  /** True when the file is binary/visual and should be sent to vision-capable
   *  models instead of text-extracted (we don't currently do this). */
  needsVision: boolean
  truncated: boolean
  warning?: string
}

export function classifyFileKind(fileName: string, mimeType?: string | null): FileKind {
  const lower = fileName.toLowerCase()
  if (mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(lower)) return 'image'
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (lower.endsWith('.pptx')) return 'pptx'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (lower.endsWith('.csv') || mimeType === 'text/csv') return 'csv'
  if (lower.endsWith('.txt') || lower.endsWith('.md') || mimeType?.startsWith('text/')) return 'text'
  return 'other'
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= PER_FILE_CHAR_BUDGET) return { text, truncated: false }
  // 70/30 head/tail split — keep the executive summary up top and the
  // appendix/conclusions at the bottom.
  const head = Math.floor(PER_FILE_CHAR_BUDGET * 0.7)
  const tail = PER_FILE_CHAR_BUDGET - head - 40
  return {
    text: text.slice(0, head) + '\n\n[... content truncated ...]\n\n' + text.slice(-tail),
    truncated: true,
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // pdf-parse pulls in a debug shim that tries to read a sample file at
  // import time when NODE_ENV !== 'production'. Importing the inner module
  // directly avoids that.
  // @ts-ignore — no types published for pdf-parse's internal entrypoint
  const mod = await import('pdf-parse/lib/pdf-parse.js')
  const pdfParse = (mod.default || mod) as (data: Buffer) => Promise<{ text: string }>
  const result = await pdfParse(buffer)
  return (result.text || '').trim()
}

async function extractOffice(buffer: Buffer, ext: 'pptx' | 'docx'): Promise<string> {
  const officeparser = await import('officeparser')
  // parseOfficeAsync supports buffers directly.
  const text: string = await (officeparser as any).parseOfficeAsync(buffer, {
    newlineDelimiter: '\n',
    ignoreNotes: false,
  })
  return (text || '').trim()
}

async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sections: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    // Convert sheet to a markdown-flavoured table (csv → pipe-delimited).
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (!csv.trim()) continue
    sections.push(`## Sheet: ${sheetName}\n\n${csv}`)
  }
  return sections.join('\n\n').trim()
}

function extractText(buffer: Buffer): string {
  return buffer.toString('utf8').trim()
}

/**
 * Extract textual content from a file buffer. Returns the extracted text
 * (truncated to the per-file char budget) along with metadata flags.
 *
 * Throws on unrecoverable parser errors so the caller can mark the upload
 * as `failed` with a useful error message.
 */
export async function extractFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string | null,
): Promise<ExtractionResult> {
  const kind = classifyFileKind(fileName, mimeType)

  if (kind === 'image') {
    return { text: null, needsVision: true, truncated: false, warning: 'Image files are noted but not text-extracted in this version.' }
  }

  let raw = ''
  switch (kind) {
    case 'pdf':
      raw = await extractPdf(buffer)
      break
    case 'pptx':
    case 'docx':
      raw = await extractOffice(buffer, kind)
      break
    case 'xlsx':
      raw = await extractSpreadsheet(buffer)
      break
    case 'csv':
    case 'text':
      raw = extractText(buffer)
      break
    case 'other':
      // Best-effort: try to read as utf-8; many "other" files are still text.
      raw = extractText(buffer)
      break
  }

  if (!raw || raw.length < 10) {
    return { text: null, needsVision: false, truncated: false, warning: 'No extractable text found.' }
  }

  const { text, truncated } = truncate(raw)
  return { text, needsVision: false, truncated }
}
