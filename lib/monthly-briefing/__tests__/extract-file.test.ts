/**
 * Tests for the uploaded-file extractor.
 *
 * We only test the parts that don't require real PDF/PPTX/XLSX parsing —
 * the classifier and the truncation behavior. The actual parsers are
 * thin wrappers around well-tested libraries.
 */

import { classifyFileKind, extractFile } from '../extract-file'

describe('classifyFileKind', () => {
  it('classifies PDFs by extension and mime type', () => {
    expect(classifyFileKind('deck.pdf')).toBe('pdf')
    expect(classifyFileKind('board-report.PDF')).toBe('pdf')
    expect(classifyFileKind('file', 'application/pdf')).toBe('pdf')
  })

  it('classifies Office documents by extension', () => {
    expect(classifyFileKind('Q1_board_deck.pptx')).toBe('pptx')
    expect(classifyFileKind('strategy.docx')).toBe('docx')
    expect(classifyFileKind('Financials.xlsx')).toBe('xlsx')
    expect(classifyFileKind('pipeline.xls')).toBe('xlsx')
  })

  it('classifies CSV/text files', () => {
    expect(classifyFileKind('data.csv')).toBe('csv')
    expect(classifyFileKind('any', 'text/csv')).toBe('csv')
    expect(classifyFileKind('notes.txt')).toBe('text')
    expect(classifyFileKind('outline.md')).toBe('text')
    expect(classifyFileKind('readme', 'text/plain')).toBe('text')
  })

  it('classifies image files by extension and mime', () => {
    expect(classifyFileKind('chart.png')).toBe('image')
    expect(classifyFileKind('photo.JPG')).toBe('image')
    expect(classifyFileKind('diagram.webp')).toBe('image')
    expect(classifyFileKind('thing', 'image/jpeg')).toBe('image')
  })

  it('falls back to "other" for unknown extensions', () => {
    expect(classifyFileKind('mystery.xyz')).toBe('other')
  })
})

describe('extractFile (text paths)', () => {
  it('extracts plain-text files directly', async () => {
    const buf = Buffer.from('Hello world\nSecond line', 'utf8')
    const result = await extractFile(buf, 'notes.txt', 'text/plain')
    expect(result.text).toContain('Hello world')
    expect(result.needsVision).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('flags images as needing vision', async () => {
    const buf = Buffer.from([137, 80, 78, 71]) // PNG header bytes — not a real image but enough
    const result = await extractFile(buf, 'chart.png', 'image/png')
    expect(result.text).toBeNull()
    expect(result.needsVision).toBe(true)
  })

  it('returns null text for empty/short inputs', async () => {
    const buf = Buffer.from('', 'utf8')
    const result = await extractFile(buf, 'empty.txt')
    expect(result.text).toBeNull()
  })

  it('truncates very long text with a truncation marker', async () => {
    const long = 'x'.repeat(120_000)
    const buf = Buffer.from(long, 'utf8')
    const result = await extractFile(buf, 'huge.txt')
    expect(result.truncated).toBe(true)
    expect(result.text!.length).toBeLessThan(120_000)
    expect(result.text).toContain('truncated')
  })
})
