/**
 * Tests for the monthly data aggregator. We stub the Supabase client with a
 * minimal table-router that returns canned rows per query.
 */

import { aggregateMonthlyData, monthlyPeriodFor } from '../aggregate-data'

function makeSupabase(tables: Record<string, any[]>) {
  // Each call to .from() returns a chainable query object whose terminal
  // .single()/.maybeSingle() resolves to { data, error }, and plain
  // awaits resolve to { data, error } with the full row list.
  function builder(rows: any[]) {
    const ctx = {
      filter(fn: (r: any) => boolean) {
        rows = rows.filter(fn)
        return ctx
      },
    }
    const chain: any = {
      select(_sel: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head && opts.count === 'exact') {
          return { ...chain, _headCount: true }
        }
        return chain
      },
      eq(col: string, val: any) { ctx.filter(r => r[col] === val); return chain },
      or(_clause: string) { return chain },
      in(_col: string, _vals: any[]) { return chain },
      gte(col: string, v: any) { ctx.filter(r => r[col] >= v); return chain },
      lte(col: string, v: any) { ctx.filter(r => r[col] <= v); return chain },
      not() { return chain },
      order() { return chain },
      limit() { return chain },
      single: async () => ({ data: rows[0] || null, error: null }),
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      then: (resolve: (v: any) => void) => {
        if (chain._headCount) resolve({ count: rows.length, error: null })
        else resolve({ data: rows, error: null })
      },
    }
    return chain
  }
  return {
    from(table: string) {
      return builder(tables[table] ?? [])
    },
  }
}

describe('monthlyPeriodFor', () => {
  it('anchors to the 1st of the month in UTC', () => {
    const p = monthlyPeriodFor(new Date('2026-03-17T12:34:56Z'))
    expect(p.start).toBe('2026-03-01T00:00:00.000Z')
    expect(p.end.startsWith('2026-03-31')).toBe(true)
    expect(p.label).toBe('March 2026')
  })
})

describe('aggregateMonthlyData', () => {
  const period = monthlyPeriodFor(new Date('2026-03-15T00:00:00Z'))

  const baseTables: Record<string, any[]> = {
    profiles: [{
      id: 'u1', display_name: 'Jane CEO', full_name: 'Jane CEO',
      job_title: 'CEO', company: 'Acme', email: 'jane@acme.test',
    }],
    commitments: [
      { id: 'c1', team_id: 't1', user_id: 'u1', title: 'Close Acme renewal', status: 'completed', source: 'email',
        priority_score: 90, due_date: null, completed_at: '2026-03-05T00:00:00Z',
        created_at: '2026-03-01T00:00:00Z', category: 'sales' },
      { id: 'c2', team_id: 't1', user_id: 'u1', title: 'Hire India lead', status: 'overdue', source: 'manual',
        priority_score: 85, due_date: '2026-02-15', completed_at: null,
        created_at: '2026-03-05T00:00:00Z', category: 'hiring' },
      { id: 'c3', team_id: 't1', user_id: 'u1', title: 'Ship Elements v2', status: 'pending', source: 'manual',
        priority_score: 70, due_date: '2026-04-30', completed_at: null,
        created_at: '2026-03-10T00:00:00Z', category: 'product' },
    ],
    outlook_calendar_events: [
      { team_id: 't1', subject: 'Board prep sync', start_time: '2026-03-05T15:00:00Z', end_time: '2026-03-05T16:00:00Z',
        attendees: [{ name: 'Pat', email: 'p@acme.test' }, { name: 'Jordan', email: 'j@acme.test' }] },
      { team_id: 't1', subject: 'Board prep review', start_time: '2026-03-12T15:00:00Z', end_time: '2026-03-12T16:00:00Z',
        attendees: [{ name: 'Pat', email: 'p@acme.test' }] },
    ],
    meeting_transcripts: [],
    missed_emails: [
      { team_id: 't1', user_id: 'u1', from_name: 'Acme Legal', urgency: 'urgent', category: 'contract', status: 'pending', received_at: '2026-03-09T00:00:00Z' },
      { team_id: 't1', user_id: 'u1', from_name: 'Acme Legal', urgency: 'normal', category: 'contract', status: 'pending', received_at: '2026-03-10T00:00:00Z' },
    ],
    awaiting_replies: [
      { id: 'a1', team_id: 't1', user_id: 'u1', sent_at: '2026-03-01T00:00:00Z' },
      { id: 'a2', team_id: 't1', user_id: 'u1', sent_at: '2026-03-02T00:00:00Z' },
    ],
    missed_chats: [
      { team_id: 't1', user_id: 'u1', channel_name: 'exec', urgency: 'high', status: 'pending', created_at: '2026-03-08T00:00:00Z' },
    ],
  }

  it('produces a populated snapshot from the canned tables', async () => {
    const supabase = makeSupabase(baseTables) as any
    const snap = await aggregateMonthlyData(supabase, {
      userId: 'u1', teamId: 't1', period,
    })

    expect(snap.period.label).toBe('March 2026')
    expect(snap.user.display_name).toBe('Jane CEO')
    expect(snap.user.job_title).toBe('CEO')

    expect(snap.commitments.total_created).toBe(3)
    expect(snap.commitments.total_completed).toBe(1)
    expect(snap.commitments.total_overdue).toBe(1)
    expect(snap.commitments.completion_rate_pct).toBe(33)
    expect(snap.commitments.top_by_priority[0].title).toBe('Close Acme renewal')

    expect(snap.calendar.total_meetings).toBe(2)
    expect(snap.calendar.total_meeting_hours).toBeGreaterThan(0)
    expect(snap.calendar.top_attendees[0]).toEqual(expect.objectContaining({ name: 'Pat' }))

    expect(snap.emails.missed_total).toBe(2)
    expect(snap.emails.missed_urgent).toBe(1)
    expect(snap.emails.top_correspondents[0]).toEqual({ name: 'Acme Legal', count: 2 })

    expect(snap.chats.missed_total).toBe(1)
    expect(snap.chats.missed_urgent).toBe(1)
    expect(snap.chats.channels_active).toContain('exec')
  })

  it('surfaces uploaded context and user notes in the snapshot', async () => {
    const supabase = makeSupabase(baseTables) as any
    const snap = await aggregateMonthlyData(supabase, {
      userId: 'u1',
      teamId: 't1',
      period,
      uploads: [{ file_name: 'Q1_board_deck.pdf', file_kind: 'pdf', extracted_summary: 'Q1 highlights…' }],
      userNotes: 'Focus on UK attainment.',
    })
    expect(snap.uploaded_context).toHaveLength(1)
    expect(snap.uploaded_context[0].file_name).toBe('Q1_board_deck.pdf')
    expect(snap.user_notes).toBe('Focus on UK attainment.')
  })

  it('handles empty tables gracefully', async () => {
    const supabase = makeSupabase({
      profiles: [{ id: 'u1', email: 'x@y', display_name: null, full_name: null, job_title: null, company: null }],
      commitments: [], outlook_calendar_events: [], meeting_transcripts: [],
      missed_emails: [], awaiting_replies: [], missed_chats: [],
    }) as any
    const snap = await aggregateMonthlyData(supabase, { userId: 'u1', teamId: 't1', period })
    expect(snap.commitments.total_created).toBe(0)
    expect(snap.commitments.completion_rate_pct).toBe(0)
    expect(snap.calendar.total_meetings).toBe(0)
    expect(snap.emails.missed_total).toBe(0)
  })
})
