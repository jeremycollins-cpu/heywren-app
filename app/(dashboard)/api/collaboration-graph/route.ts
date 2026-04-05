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

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const orgId = callerMembership.organization_id

    // Get org members
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, department_id, team_id, role, profiles(display_name, avatar_url, job_title)')
      .eq('organization_id', orgId) as { data: MemberProfile[] | null }

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

    // Try pre-computed edges first
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString().split('T')[0]

    const { data: precomputed } = await admin
      .from('collaboration_edges')
      .select('user_a, user_b, email_count, chat_count, meeting_count, commitment_count, strength')
      .eq('organization_id', orgId)
      .eq('month_start', monthStart)

    let edges: CollabEdge[]

    if (precomputed && precomputed.length > 0) {
      edges = precomputed as CollabEdge[]
    } else {
      // Compute live from last 30 days of data
      edges = await computeLiveEdges(admin, memberIds, orgId)
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
  _orgId: string
): Promise<CollabEdge[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const edgeMap = new Map<string, { email: number; chat: number; meeting: number; commitment: number }>()

  function addEdge(a: string, b: string, channel: 'email' | 'chat' | 'meeting' | 'commitment') {
    if (a === b || !memberIds.includes(a) || !memberIds.includes(b)) return
    const key = [a, b].sort().join('|')
    if (!edgeMap.has(key)) edgeMap.set(key, { email: 0, chat: 0, meeting: 0, commitment: 0 })
    edgeMap.get(key)![channel]++
  }

  // Email interactions
  const [emailsResult, chatsResult, meetingsResult, commitmentsResult] = await Promise.all([
    admin
      .from('missed_emails')
      .select('user_id, from_email')
      .in('user_id', memberIds)
      .gte('received_at', thirtyDaysAgo)
      .limit(1000),
    admin
      .from('missed_chats')
      .select('user_id, sender_user_id')
      .in('user_id', memberIds)
      .gte('sent_at', thirtyDaysAgo)
      .limit(1000),
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

  // Process emails
  for (const email of (emailsResult.data || []) as Array<{ user_id: string; from_email: string }>) {
    const senderId = emailToUser.get(email.from_email?.toLowerCase() || '')
    if (senderId) addEdge(email.user_id, senderId, 'email')
  }

  // Process chats — need to map Slack user IDs to our user IDs
  const { data: slackMappings } = await admin
    .from('slack_user_mappings')
    .select('slack_user_id, user_id')
  const slackToUser = new Map<string, string>()
  for (const m of slackMappings || []) {
    slackToUser.set(m.slack_user_id, m.user_id)
  }

  for (const chat of (chatsResult.data || []) as Array<{ user_id: string; sender_user_id: string }>) {
    const senderId = slackToUser.get(chat.sender_user_id)
    if (senderId) addEdge(chat.user_id, senderId, 'chat')
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
    .map(n => ({ userId: n.userId, name: n.name, connections: n.connectionCount }))

  // Connectors: most connections (top 10%)
  const sortedByConnections = [...nodes].sort((a, b) => b.connectionCount - a.connectionCount)
  const connectorCount = Math.max(1, Math.ceil(nodes.length * 0.1))
  const connectors = sortedByConnections.slice(0, connectorCount)
    .map(n => ({ userId: n.userId, name: n.name, connections: n.connectionCount, interactions: n.totalInteractions }))

  // Bottlenecks: people who appear in many edges with high strength (everyone depends on them)
  const bottleneckThreshold = avgConnections * 1.5
  const bottlenecks = nodes
    .filter(n => n.connectionCount > bottleneckThreshold && n.avgStrength > 0.5)
    .map(n => ({ userId: n.userId, name: n.name, connections: n.connectionCount, avgStrength: n.avgStrength }))

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
