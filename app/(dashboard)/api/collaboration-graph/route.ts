import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

interface CollabEdge {
  user_a: string
  user_b: string
  email_count: number
  chat_count: number
  meeting_count: number
  commitment_count: number
  strength: number
}

interface MemberProfile {
  user_id: string
  department_id: string | null
  team_id: string | null
  role: string
  profiles: { display_name: string; avatar_url: string | null; job_title: string | null } | null
}

/**
 * GET /api/collaboration-graph
 * Returns collaboration network data: nodes (people) + edges (interaction strength).
 * Identifies siloed employees, connectors, and bottlenecks.
 * Computes live from communication data if no pre-computed edges exist.
 */
export async function GET(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    // Try organization_members first, fall back to team_members
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, team_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .maybeSingle()

    let members: MemberProfile[]

    if (callerMembership?.organization_id) {
      // Org-based: get all org members
      const { data: orgMembers } = await admin
        .from('organization_members')
        .select('user_id, department_id, team_id, role, profiles(display_name, avatar_url, job_title)')
        .eq('organization_id', callerMembership.organization_id) as { data: MemberProfile[] | null }
      members = orgMembers || []
    } else {
      // Fallback: team-based (no org hierarchy — use team_members + profiles)
      const { data: profile } = await admin
        .from('profiles')
        .select('current_team_id')
        .eq('id', callerId)
        .single()

      if (!profile?.current_team_id) {
        return NextResponse.json({ error: 'No team found' }, { status: 404 })
      }

      const { data: teamMembers } = await admin
        .from('team_members')
        .select('user_id, role, team_id, profiles(display_name, avatar_url, job_title)')
        .eq('team_id', profile.current_team_id)

      members = (teamMembers || []).map((m: any) => ({
        user_id: m.user_id,
        department_id: null,
        team_id: m.team_id,
        role: m.role || 'member',
        profiles: m.profiles,
      }))
    }

    if (!members || members.length === 0) {
      return NextResponse.json({
        nodes: [],
        edges: [],
        insights: {
          totalNodes: 0,
          totalEdges: 0,
          avgConnections: 0,
          crossDeptCollaboration: 0,
          siloed: [],
          connectors: [],
          bottlenecks: [],
        },
      })
    }

    const memberIds = members.map((m: MemberProfile) => m.user_id)
    const memberMap = new Map<string, MemberProfile>()
    for (const m of members) memberMap.set(m.user_id, m)

    // Try pre-computed edges first (only if org-based)
    let edges: CollabEdge[]
    const orgId = callerMembership?.organization_id

    if (orgId) {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString().split('T')[0]

      const { data: precomputed } = await admin
        .from('collaboration_edges')
        .select('user_a, user_b, email_count, chat_count, meeting_count, commitment_count, strength')
        .eq('organization_id', orgId)
        .eq('month_start', monthStart)

      if (precomputed && precomputed.length > 0) {
        edges = precomputed as CollabEdge[]
      } else {
        edges = await computeLiveEdges(admin, memberIds, memberMap, orgId)
      }
    } else {
      // Team-based: always compute live
      edges = await computeLiveEdges(admin, memberIds, memberMap, null)
    }

    // Build nodes
    const nodes = members.map((m: MemberProfile) => {
      const profile = m.profiles as { display_name: string; avatar_url: string | null; job_title: string | null } | null
      // Count connections for this person
      const connections = edges.filter(
        (e: CollabEdge) => e.user_a === m.user_id || e.user_b === m.user_id
      )
      const totalInteractions = connections.reduce(
        (sum: number, e: CollabEdge) => sum + e.email_count + e.chat_count + e.meeting_count + e.commitment_count,
        0
      )
      const connectionCount = connections.length
      const avgStrength = connectionCount > 0
        ? connections.reduce((s: number, e: CollabEdge) => s + e.strength, 0) / connectionCount
        : 0

      return {
        userId: m.user_id,
        name: profile?.display_name || 'Unknown',
        avatar: profile?.avatar_url || null,
        jobTitle: profile?.job_title || null,
        department: m.department_id,
        team: m.team_id,
        role: m.role,
        connectionCount,
        totalInteractions,
        avgStrength: Math.round(avgStrength * 100) / 100,
      }
    })

    // Identify insights
    const insights = computeInsights(nodes, edges, members)

    return NextResponse.json({
      nodes,
      edges: edges.map((e: CollabEdge) => ({
        source: e.user_a,
        target: e.user_b,
        emailCount: e.email_count,
        chatCount: e.chat_count,
        meetingCount: e.meeting_count,
        commitmentCount: e.commitment_count,
        strength: e.strength,
        total: e.email_count + e.chat_count + e.meeting_count + e.commitment_count,
      })),
      insights,
    })
  } catch (err) {
    console.error('Collaboration graph error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

async function computeLiveEdges(
  admin: any, // eslint-disable-line
  memberIds: string[],
  memberMap: Map<string, MemberProfile>,
  _orgId: string | null
): Promise<CollabEdge[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const edgeMap = new Map<string, { email: number; chat: number; meeting: number; commitment: number }>()

  function addEdge(a: string, b: string, channel: 'email' | 'chat' | 'meeting' | 'commitment') {
    if (a === b || !memberIds.includes(a) || !memberIds.includes(b)) return
    const key = [a, b].sort().join('|')
    if (!edgeMap.has(key)) edgeMap.set(key, { email: 0, chat: 0, meeting: 0, commitment: 0 })
    edgeMap.get(key)![channel]++
  }

  // Query the actual communication data tables (not just missed/flagged items)
  const [emailsResult, slackResult, meetingsResult, commitmentsResult] = await Promise.all([
    // outlook_messages: all synced emails (the primary email data source)
    admin
      .from('outlook_messages')
      .select('user_id, from_email, to_recipients')
      .in('user_id', memberIds)
      .gte('received_at', thirtyDaysAgo)
      .limit(2000),
    // slack_messages: all processed Slack messages
    admin
      .from('slack_messages')
      .select('team_id, user_id, sender_name, metadata')
      .in('user_id', memberIds)
      .gte('created_at', thirtyDaysAgo)
      .limit(2000),
    admin
      .from('meeting_transcripts')
      .select('user_id, attendees')
      .in('user_id', memberIds)
      .gte('start_time', thirtyDaysAgo)
      .limit(500),
    admin
      .from('commitments')
      .select('creator_id, assignee_id')
      .in('creator_id', memberIds)
      .gte('created_at', thirtyDaysAgo)
      .not('assignee_id', 'is', null)
      .limit(1000),
  ])

  // Build email lookup: email address -> user_id
  const { data: profilesData } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', memberIds)
  const emailToUser = new Map<string, string>()
  for (const p of profilesData || []) {
    if (p.email) emailToUser.set(p.email.toLowerCase(), p.id)
  }

  // Process emails from outlook_messages
  // Edge: from_email sender → user_id (recipient), and also parse to_recipients for reverse edges
  for (const email of (emailsResult.data || []) as Array<{ user_id: string; from_email: string; to_recipients: string | null }>) {
    // Sender → recipient
    const senderId = emailToUser.get(email.from_email?.toLowerCase() || '')
    if (senderId) addEdge(email.user_id, senderId, 'email')

    // Also check if any team members are in to_recipients (catches emails the user sent to teammates)
    if (email.to_recipients) {
      const recipientEmails = email.to_recipients.toLowerCase().split(',').map(s => s.trim())
      for (const recipEmail of recipientEmails) {
        // Match against known member emails (partial match since to_recipients may include names)
        for (const [knownEmail, uid] of emailToUser) {
          if (recipEmail.includes(knownEmail) && uid !== email.user_id) {
            addEdge(email.user_id, uid, 'email')
          }
        }
      }
    }
  }

  // Process Slack messages
  // slack_messages has user_id (whose inbox it belongs to) and metadata may have sender info
  // Also use slack_user_id mappings from profiles or integrations
  const { data: slackProfiles } = await admin
    .from('profiles')
    .select('id, slack_user_id')
    .in('id', memberIds)
    .not('slack_user_id', 'is', null)
  const slackToUser = new Map<string, string>()
  for (const p of (slackProfiles || []) as Array<{ id: string; slack_user_id: string | null }>) {
    if (p.slack_user_id) slackToUser.set(p.slack_user_id, p.id)
  }

  for (const msg of (slackResult.data || []) as Array<{ user_id: string; sender_name: string; metadata: any }>) {
    // Try to match sender to a team member via slack_user_id in metadata
    const senderSlackId = msg.metadata?.sender_slack_id || msg.metadata?.slackUserId
    if (senderSlackId) {
      const senderId = slackToUser.get(senderSlackId)
      if (senderId) addEdge(msg.user_id, senderId, 'chat')
    }
    // Also try matching sender_name to profile display_name
    if (msg.sender_name) {
      for (const [uid, member] of memberMap) {
        const profile = member.profiles as { display_name: string } | null
        if (profile?.display_name && uid !== msg.user_id &&
            msg.sender_name.toLowerCase().includes(profile.display_name.toLowerCase().split(' ')[0])) {
          addEdge(msg.user_id, uid, 'chat')
          break
        }
      }
    }
  }

  // Process meetings (attendees is JSONB array)
  for (const meeting of (meetingsResult.data || []) as Array<{ user_id: string; attendees: Array<{ email?: string }> | null }>) {
    const attendeeIds: string[] = [meeting.user_id]
    if (meeting.attendees) {
      for (const att of meeting.attendees) {
        if (att.email) {
          const uid = emailToUser.get(att.email.toLowerCase())
          if (uid && !attendeeIds.includes(uid)) attendeeIds.push(uid)
        }
      }
    }
    // Create edges between all pairs
    for (let i = 0; i < attendeeIds.length; i++) {
      for (let j = i + 1; j < attendeeIds.length; j++) {
        addEdge(attendeeIds[i], attendeeIds[j], 'meeting')
      }
    }
  }

  // Process commitments
  for (const c of (commitmentsResult.data || []) as Array<{ creator_id: string; assignee_id: string | null }>) {
    if (c.assignee_id) addEdge(c.creator_id, c.assignee_id, 'commitment')
  }

  // Normalize to CollabEdge[]
  const maxTotal = Math.max(
    1,
    ...Array.from(edgeMap.values()).map(v => v.email + v.chat + v.meeting + v.commitment)
  )

  return Array.from(edgeMap.entries()).map(([key, counts]) => {
    const [userA, userB] = key.split('|')
    const total = counts.email + counts.chat + counts.meeting + counts.commitment
    return {
      user_a: userA,
      user_b: userB,
      email_count: counts.email,
      chat_count: counts.chat,
      meeting_count: counts.meeting,
      commitment_count: counts.commitment,
      strength: Math.round((total / maxTotal) * 100) / 100,
    }
  })
}

function computeInsights(
  nodes: Array<{ userId: string; name: string; connectionCount: number; totalInteractions: number; avgStrength: number; department: string | null }>,
  edges: CollabEdge[],
  members: MemberProfile[]
) {
  const avgConnections = nodes.length > 0
    ? nodes.reduce((s, n) => s + n.connectionCount, 0) / nodes.length
    : 0

  // Siloed: fewer connections than half the average, or zero
  const siloThreshold = Math.max(1, Math.floor(avgConnections * 0.5))
  const siloed = nodes
    .filter(n => n.connectionCount < siloThreshold)
    .map(n => ({ userId: n.userId, name: n.name, connectionCount: n.connectionCount }))

  // Connectors: most connections (top 10%)
  const sortedByConnections = [...nodes].sort((a, b) => b.connectionCount - a.connectionCount)
  const connectorCount = Math.max(1, Math.ceil(nodes.length * 0.1))
  const connectors = sortedByConnections.slice(0, connectorCount)
    .map(n => ({ userId: n.userId, name: n.name, connectionCount: n.connectionCount, totalInteractions: n.totalInteractions }))

  // Bottlenecks: people who appear in many edges with high strength (everyone depends on them)
  const bottleneckThreshold = avgConnections * 1.5
  const bottlenecks = nodes
    .filter(n => n.connectionCount > bottleneckThreshold && n.avgStrength > 0.5)
    .map(n => ({ userId: n.userId, name: n.name, connectionCount: n.connectionCount, avgStrength: n.avgStrength }))

  // Cross-department collaboration: count edges between different departments
  const deptMap = new Map<string, string | null>()
  for (const m of members) deptMap.set(m.user_id, m.department_id)

  let crossDeptEdges = 0
  let sameDeptEdges = 0
  for (const e of edges) {
    const dA = deptMap.get(e.user_a)
    const dB = deptMap.get(e.user_b)
    if (dA && dB && dA !== dB) crossDeptEdges++
    else sameDeptEdges++
  }

  const totalEdges = crossDeptEdges + sameDeptEdges
  const crossDeptRatio = totalEdges > 0 ? Math.round((crossDeptEdges / totalEdges) * 100) : 0

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    avgConnections: Math.round(avgConnections * 10) / 10,
    crossDeptCollaboration: crossDeptRatio,
    siloed,
    connectors,
    bottlenecks,
  }
}

export const dynamic = 'force-dynamic'
