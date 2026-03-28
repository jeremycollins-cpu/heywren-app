// app/(dashboard)/api/awaiting-replies/route.ts
// API for "The Waiting Room" — items the user sent that haven't received a reply.
//
// GET:  Fetch waiting items for the current user's team
// PATCH: Update status (waiting → dismissed/snoozed/replied)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Detect calendar invites, meeting emails, and scheduling noise that shouldn't be in the waiting room
function isCalendarInviteItem(subject: string | null, bodyPreview: string | null): boolean {
  const s = (subject || '').trim()
  // Response emails
  if (/^(Accepted|Declined|Tentative|Cancell?ed):/i.test(s)) return true
  const lower = s.toLowerCase()
  if (lower.includes('out of office') || lower.includes('automatic reply')) return true

  // Name/Name pattern — "Jeremy/Leah (...)" — almost always a recurring meeting
  if (/^\w+\s*\/\s*\w+/i.test(s)) return true

  // "FW:" + onsite/meeting-logistics subjects
  if (/^(FW|Fwd):/i.test(s) && /\b(onsite|on-site|offsite|off-site)\b/i.test(s)) return true

  // Check body for meeting invite signatures (Teams, Zoom, Google Meet, etc.)
  const body = (bodyPreview || '').toLowerCase()

  if (body) {
    const meetingSignatures = [
      'join the meeting now',
      'meeting id:',
      'microsoft teams meeting',
      'join zoom meeting',
      'zoom.us/j/',
      'meet.google.com/',
      'you updated the meeting',
      'you have been invited to',
      'dial-in number',
      'join on your computer',
      'click here to join',
      'passcode:',
    ]
    const signatureCount = meetingSignatures.filter(sig => body.includes(sig)).length
    if (signatureCount >= 2) return true
    // Strong single signals
    if (body.includes('join the meeting now') || body.includes('microsoft teams meeting')) return true
    if (body.includes('join zoom meeting') || body.includes('zoom.us/j/')) return true
    if (body.includes('you updated the meeting for')) return true
    if (body.includes('meet.google.com/')) return true
    if (body.includes('meeting id:') && body.includes('passcode:')) return true

    // Meeting scheduling language in body — these are scheduling logistics, not actionable follow-ups
    const schedulingPatterns = [
      /any chance .{0,30}(works|free|available)/i,
      /\b(works for you|work for you)\b/i,
      /i'?ll send (a |the )?calendar/i,
      /let'?s (do|meet|schedule|connect)/i,
      /was just scheduled/i,
      /weekly agenda/i,
    ]
    const hasSchedulingBody = schedulingPatterns.some(p => p.test(body))

    // Strong meeting-name subjects — filter without body signals.
    // "Product Leadership Sync", "Team Standup", "Engineering 1:1"
    const strongMeetingPatterns = [
      /\bsync\b/i, /\bstandup\b/i, /\bstand-up\b/i, /\b1[:\-]1\b/i, /\bone.on.one\b/i,
      /\bweekly\b/i, /\bbiweekly\b/i, /\bmonthly\b/i, /\bdaily\b/i, /\brecurring\b/i,
      /\bhuddle\b/i, /\bcatch.up\b/i, /\btouchbase\b/i, /\btouch.base\b/i,
      /\bretro\b/i, /\bretrospective\b/i,
      /\bsales updates?\b/i, /\bstatus updates?\b/i, /\bproject updates?\b/i,
      /\bonsite\b/i, /\bon-site\b/i, /\boffsite\b/i, /\boff-site\b/i,
    ]
    if (strongMeetingPatterns.some(p => p.test(s))) return true

    // Scheduling body alone is enough to filter
    if (hasSchedulingBody) return true

    // Weaker meeting-style subjects — need at least one body signal to confirm
    const weakMeetingPatterns = [
      /\bcheck.in\b/i, /\bcheckin\b/i, /\breview\b/i,
      /\bplanning\b/i, /\bgrooming\b/i, /\brefinement\b/i, /\bkickoff\b/i, /\bkick.off\b/i,
    ]
    const hasWeakMeetingSubject = weakMeetingPatterns.some(p => p.test(s))
    if (hasWeakMeetingSubject && signatureCount >= 1) return true
    if (hasWeakMeetingSubject && body.includes('when:')) return true
  }

  return false
}

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null
    let teamId: string | null = null

    // Try server-side session
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session read failed */ }

    const admin = getAdminClient()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's email and team for matching sent items
    const { data: userProfile } = await admin
      .from('profiles')
      .select('current_team_id, email')
      .eq('id', userId)
      .single()
    teamId = userProfile?.current_team_id || null
    const userEmail = userProfile?.email?.toLowerCase() || ''

    // Fallback team lookup (same as other APIs)
    if (!teamId) {
      const { data: membership } = await admin.from('team_members').select('team_id').eq('user_id', userId).limit(1).single()
      teamId = membership?.team_id || null
    }
    if (!teamId) {
      const { data: orgMembership } = await admin.from('organization_members').select('team_id').eq('user_id', userId).limit(1).single()
      teamId = orgMembership?.team_id || null
    }

    if (!teamId) {
      return NextResponse.json({ items: [], count: 0 })
    }

    // Only show items that belong to THIS user — not other team members.
    // Filter by user_id first (items scanned from this user's Outlook token),
    // then also include items where the user's email appears in the sent data
    // (handles cases where the scan attributed items to a different user_id).
    let query = admin
      .from('awaiting_replies')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .in('status', ['waiting', 'snoozed'])
      .order('urgency', { ascending: true })
      .order('sent_at', { ascending: true })
      .limit(200)

    const { data: items, error } = await query

    if (error) {
      // Table may not exist yet if migration 014 hasn't been run
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json({ items: [], count: 0 })
      }
      console.error('Failed to fetch awaiting replies:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Filter out calendar invite items at read time (catches items created before the filter was added)
    const calendarInviteIds: string[] = []
    const filtered = (items || []).filter(item => {
      if (isCalendarInviteItem(item.subject, item.body_preview)) {
        calendarInviteIds.push(item.id)
        return false
      }
      return true
    })

    // Auto-dismiss calendar invites in the background so they don't come back
    if (calendarInviteIds.length > 0) {
      admin
        .from('awaiting_replies')
        .update({ status: 'dismissed' })
        .in('id', calendarInviteIds)
        .then(() => {
          console.log(`Auto-dismissed ${calendarInviteIds.length} calendar invite items from waiting room`)
        })
    }

    // Update days_waiting on the fly
    const now = Date.now()
    const enriched = filtered.map(item => ({
      ...item,
      days_waiting: Math.floor((now - new Date(item.sent_at).getTime()) / 86400000),
    }))

    // Sort: critical first, then high, then by days waiting desc
    const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    enriched.sort((a, b) => {
      const ua = urgencyOrder[a.urgency] ?? 2
      const ub = urgencyOrder[b.urgency] ?? 2
      if (ua !== ub) return ua - ub
      return b.days_waiting - a.days_waiting
    })

    return NextResponse.json({ items: enriched, count: enriched.length })
  } catch (err: any) {
    console.error('Awaiting replies GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST: Trigger an on-demand scan of sent items
export async function POST(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    const admin = getAdminClient()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userId)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const { scanTeamAwaitingReplies } = await import('@/inngest/functions/scan-awaiting-replies')
    const result = await scanTeamAwaitingReplies(admin, teamId, userId)

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Awaiting replies scan error:', err)
    return NextResponse.json({ error: err.message || 'Scan failed' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status, snoozedUntil } = await request.json()

    if (!id || !status) {
      return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
    }

    if (!['waiting', 'dismissed', 'snoozed', 'replied'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Verify user's team ownership
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const admin = getAdminClient()

    const updateFields: Record<string, any> = { status }
    if (status === 'snoozed' && snoozedUntil) {
      updateFields.snoozed_until = snoozedUntil
    }
    if (status === 'replied') {
      updateFields.replied_at = new Date().toISOString()
    }

    const { error } = await admin
      .from('awaiting_replies')
      .update(updateFields)
      .eq('id', id)
      .eq('team_id', teamId)
      .eq('user_id', userData.user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Awaiting replies PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
