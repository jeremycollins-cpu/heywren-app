// app/(dashboard)/api/sidebar-counts/route.ts
// Single source of truth for the sidebar badge counts.
//
// Each count here mirrors the filter/group logic the matching section page
// applies before rendering its list, so the sidebar badges agree in real time
// with what the user sees inside the section.

import { NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function normalizeSubject(subject: string | null): string {
  if (!subject) return '(no subject)'
  return subject.replace(/^(re:\s*|fwd?:\s*|fw:\s*)+/i, '').trim().toLowerCase()
}

// Mirrors isCalendarInviteItem in /api/awaiting-replies. Kept inline so the
// counts endpoint doesn't import from another route handler.
function isCalendarInviteItem(subject: string | null, bodyPreview: string | null): boolean {
  const s = (subject || '').trim()
  if (/^(Accepted|Declined|Tentative|Cancell?ed):/i.test(s)) return true
  const lower = s.toLowerCase()
  if (lower.includes('out of office') || lower.includes('automatic reply')) return true
  if (/^\w+\s*\/\s*\w+/i.test(s)) return true
  if (/^(FW|Fwd):/i.test(s) && /\b(onsite|on-site|offsite|off-site)\b/i.test(s)) return true

  const body = (bodyPreview || '').toLowerCase()
  if (!body) return false

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
  if (body.includes('join the meeting now') || body.includes('microsoft teams meeting')) return true
  if (body.includes('join zoom meeting') || body.includes('zoom.us/j/')) return true
  if (body.includes('you updated the meeting for')) return true
  if (body.includes('meet.google.com/')) return true
  if (body.includes('meeting id:') && body.includes('passcode:')) return true

  const schedulingPatterns = [
    /any chance .{0,30}(works|free|available)/i,
    /\b(works for you|work for you)\b/i,
    /i'?ll send (a |the )?calendar/i,
    /let'?s (do|meet|schedule|connect)/i,
    /was just scheduled/i,
    /weekly agenda/i,
  ]
  const hasSchedulingBody = schedulingPatterns.some(p => p.test(body))

  const strongMeetingPatterns = [
    /\bsync\b/i, /\bstandup\b/i, /\bstand-up\b/i, /\b1[:\-]1\b/i, /\bone.on.one\b/i,
    /\bweekly\b/i, /\bbiweekly\b/i, /\bmonthly\b/i, /\bdaily\b/i, /\brecurring\b/i,
    /\bhuddle\b/i, /\bcatch.up\b/i, /\btouchbase\b/i, /\btouch.base\b/i,
    /\bretro\b/i, /\bretrospective\b/i,
    /\bsales updates?\b/i, /\bstatus updates?\b/i, /\bproject updates?\b/i,
    /\bonsite\b/i, /\bon-site\b/i, /\boffsite\b/i, /\boff-site\b/i,
  ]
  if (strongMeetingPatterns.some(p => p.test(s))) return true
  if (hasSchedulingBody) return true

  const weakMeetingPatterns = [
    /\bcheck.in\b/i, /\bcheckin\b/i, /\breview\b/i,
    /\bplanning\b/i, /\bgrooming\b/i, /\brefinement\b/i, /\bkickoff\b/i, /\bkick.off\b/i,
  ]
  const hasWeakMeetingSubject = weakMeetingPatterns.some(p => p.test(s))
  if (hasWeakMeetingSubject && signatureCount >= 1) return true
  if (hasWeakMeetingSubject && body.includes('when:')) return true

  return false
}

// Mirrors the commitments page isPersonallyRelevant check.
function isPersonallyRelevant(c: any, userId: string, userName: string): boolean {
  if (c.assignee_id === userId) return true
  if (c.creator_id === userId) return true

  const nameLower = userName.toLowerCase()
  const firstName = nameLower.split(' ')[0]
  if (!firstName || firstName.length < 3) return false

  const stakeholders = c.metadata?.stakeholders
  if (Array.isArray(stakeholders)) {
    for (const s of stakeholders) {
      if (!s?.name) continue
      const sLower = String(s.name).toLowerCase()
      if (sLower === nameLower || sLower.includes(firstName) || nameLower.includes(sLower)) {
        return true
      }
    }
  }

  const combined = (
    (c.title || '') + ' ' + (c.description || '') + ' ' + (c.metadata?.originalQuote || '')
  ).toLowerCase()
  return combined.includes(firstName)
}

export async function GET() {
  const empty = {
    overdue: 0, urgent: 0, draftQueue: 0, missedEmails: 0, missedChats: 0,
    waitingRoom: 0, openCommitments: 0, pendingReview: 0, securityAlerts: 0,
  }

  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized', counts: empty }, { status: 401 })
    }
    const userId = userData.user.id

    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id, organization_id, display_name, wren_preferences, email')
      .eq('id', userId)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(admin, userId)
    if (!teamId) {
      return NextResponse.json({ counts: empty })
    }

    const orgId = profile?.organization_id || null
    const userName = profile?.display_name || profile?.email?.split('@')[0] || ''

    // Mirror /api/missed-emails sensitivity → confidence threshold mapping.
    const sensitivity = (profile?.wren_preferences as any)?.sensitivity || 'balanced'
    const minConfidence = sensitivity === 'focused' ? 0.8 : sensitivity === 'comprehensive' ? 0.4 : 0.6

    // Mirror commitments page scope: organization_id when present, otherwise team_id.
    const commitmentsScopeField = orgId ? 'organization_id' : 'team_id'
    const commitmentsScopeValue = orgId || teamId

    const [
      commitmentsRes,
      pendingReviewRes,
      draftRes,
      missedEmailsRes,
      missedChatsRes,
      awaitingRes,
      threatRes,
    ] = await Promise.all([
      // Commitments: same scope/filter as the commitments page (creator OR assignee,
      // excluding pending_review which has its own badge).
      admin
        .from('commitments')
        .select('id, status, created_at, assignee_id, creator_id, title, description, metadata')
        .eq(commitmentsScopeField, commitmentsScopeValue!)
        .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
        .not('status', 'eq', 'pending_review')
        .limit(500),
      admin
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .eq(commitmentsScopeField, commitmentsScopeValue!)
        .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
        .eq('status', 'pending_review'),
      admin
        .from('drafts')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'pending'),
      // Missed emails: same status + confidence filter as /api/missed-emails so the
      // count matches the rendered list.
      admin
        .from('missed_emails')
        .select('id, subject')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .in('status', ['pending', 'snoozed'])
        .gte('confidence', minConfidence)
        .limit(500),
      admin
        .from('missed_chats')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'pending'),
      // Awaiting replies: same status filter as /api/awaiting-replies. Calendar
      // invites are filtered out post-query just like the page does.
      admin
        .from('awaiting_replies')
        .select('id, conversation_id, channel_id, source, subject, body_preview')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .in('status', ['waiting', 'snoozed'])
        .limit(500)
        .then(res => res.error ? { data: [], error: res.error } : res),
      admin
        .from('email_threat_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'unreviewed')
        .then(res => res.error ? { count: 0, error: res.error } : res),
    ])

    // Commitments — mirror commitments page splits.
    const allCommitments = commitmentsRes.data || []
    const openCommitments = allCommitments.filter(c =>
      c.status !== 'completed' && c.status !== 'dismissed' && c.status !== 'dropped'
    )
    const forYouCount = openCommitments.filter(c => isPersonallyRelevant(c, userId, userName)).length

    const now = Date.now()
    const overdueCount = openCommitments.filter(c => c.status === 'overdue').length
    const urgentCount = openCommitments.filter(c =>
      c.status === 'open' && (now - new Date(c.created_at).getTime()) > 5 * 86400000
    ).length

    // Missed emails — dedupe by normalized subject to match /api/missed-emails grouping.
    const missedEmails = missedEmailsRes.data || []
    const missedEmailGroups = new Set<string>()
    for (const e of missedEmails) {
      const key = normalizeSubject(e.subject)
      missedEmailGroups.add(key || e.id)
    }

    // Awaiting replies — match the waiting-room page grouping: outlook by
    // conversation_id, slack by channel_id, calendar invites filtered out.
    const awaitingItems = (awaitingRes as any).data || []
    const waitingGroups = new Set<string>()
    let waitingUngrouped = 0
    for (const item of awaitingItems) {
      if (isCalendarInviteItem(item.subject, item.body_preview)) continue
      if (item.conversation_id && item.source === 'outlook') {
        waitingGroups.add(`outlook:${item.conversation_id}`)
      } else if (item.channel_id && item.source === 'slack') {
        waitingGroups.add(`slack:${item.channel_id}`)
      } else {
        waitingUngrouped++
      }
    }

    return NextResponse.json({
      counts: {
        overdue: overdueCount,
        urgent: urgentCount,
        pendingReview: pendingReviewRes.count || 0,
        draftQueue: draftRes.count || 0,
        missedEmails: missedEmailGroups.size,
        missedChats: missedChatsRes.count || 0,
        waitingRoom: waitingGroups.size + waitingUngrouped,
        openCommitments: forYouCount,
        securityAlerts: (threatRes as any).count || 0,
      },
    })
  } catch (err) {
    console.error('[sidebar-counts] error:', err)
    return NextResponse.json({ error: 'Internal error', counts: empty }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
