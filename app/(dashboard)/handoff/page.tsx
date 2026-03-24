'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { Hand, Calendar, CheckCircle2, AlertCircle, ChevronDown, Loader2 } from 'lucide-react'

// ── Types ──

interface CalendarEvent {
  id: string
  subject: string
  organizer_name: string
  organizer_email: string
  start_time: string
  end_time: string
}

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  due_date: string | null
  creator_id: string | null
  assignee_id: string | null
  created_at: string
}

interface TeamMember {
  id: string
  user_id: string
  role: string
  profiles: {
    email: string
    full_name: string
    avatar_url?: string
  }
}

interface PTOHandoff {
  personName: string
  personEmail: string
  userId: string | null
  startDate: string
  endDate: string
  events: CalendarEvent[]
  commitments: Commitment[]
}

// ── Constants ──

const PTO_KEYWORDS = ['PTO', 'OOO', 'Out of Office', 'Vacation', 'Time Off', 'Holiday', 'Leave']

const CHECKLIST_ITEMS = [
  'All commitments documented',
  'Backup assigned for each item',
  'Handoff meeting completed',
  'Backup confirmed understanding',
]

// ── Helpers ──

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString('en-US', opts)
  }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getChecklistKey(personEmail: string): string {
  return `handoff_checklist_${personEmail}`
}

function loadChecklist(personEmail: string): boolean[] {
  if (typeof window === 'undefined') return CHECKLIST_ITEMS.map(() => false)
  try {
    const stored = localStorage.getItem(getChecklistKey(personEmail))
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore
  }
  return CHECKLIST_ITEMS.map(() => false)
}

function saveChecklist(personEmail: string, values: boolean[]) {
  try {
    localStorage.setItem(getChecklistKey(personEmail), JSON.stringify(values))
  } catch {
    // ignore
  }
}

// ── Component ──

export default function HandoffPage() {
  const [handoffs, setHandoffs] = useState<PTOHandoff[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedHandoff, setExpandedHandoff] = useState<string | null>(null)
  const [checklists, setChecklists] = useState<Record<string, boolean[]>>({})
  const [reassigning, setReassigning] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
    const supabase = createClient()

    // ── SECURITY: Get user's team_id first ──
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      setLoading(false)
      return
    }

    // ── Fetch team members with profiles ──
    const { data: members } = await supabase
      .from('team_members')
      .select(
        `
        id,
        user_id,
        role,
        profiles (
          email,
          full_name,
          avatar_url
        )
      `
      )
      .eq('team_id', teamId)

    const teamMembersList = (members || []) as unknown as TeamMember[]
    setTeamMembers(teamMembersList)

    // ── Fetch PTO/OOO calendar events ──
    // Get events that are currently active or upcoming
    const now = new Date().toISOString()

    const { data: calendarEvents } = await supabase
      .from('outlook_calendar_events')
      .select('id, subject, organizer_name, organizer_email, start_time, end_time')
      .eq('team_id', teamId)
      .eq('is_cancelled', false)
      .gte('end_time', now)
      .order('start_time', { ascending: true })

    if (!calendarEvents || calendarEvents.length === 0) {
      setLoading(false)
      return
    }

    // Filter to PTO-related events by subject keywords
    const ptoEvents = calendarEvents.filter((evt) => {
      const subject = (evt.subject || '').toLowerCase()
      return PTO_KEYWORDS.some((kw) => subject.includes(kw.toLowerCase()))
    })

    if (ptoEvents.length === 0) {
      setLoading(false)
      return
    }

    // ── Group events by organizer ──
    const byOrganizer = new Map<string, CalendarEvent[]>()
    for (const evt of ptoEvents) {
      const key = evt.organizer_email
      if (!byOrganizer.has(key)) byOrganizer.set(key, [])
      byOrganizer.get(key)!.push(evt)
    }

    // ── Build handoffs: find open commitments per person ──
    const handoffList: PTOHandoff[] = []

    for (const [email, events] of byOrganizer) {
      // Find the team member matching this organizer
      const member = teamMembersList.find(
        (m) => m.profiles?.email?.toLowerCase() === email.toLowerCase()
      )
      const userId = member?.user_id || null

      // Compute the overall date range across all their PTO events
      const starts = events.map((e) => e.start_time)
      const ends = events.map((e) => e.end_time)
      const earliestStart = starts.sort()[0]
      const latestEnd = ends.sort().reverse()[0]

      // Fetch open commitments where this person is creator or assignee
      let commitments: Commitment[] = []
      if (userId) {
        const { data: creatorCommitments } = await supabase
          .from('commitments')
          .select('id, title, description, status, source, due_date, creator_id, assignee_id, created_at')
          .eq('team_id', teamId)
          .eq('creator_id', userId)
          .in('status', ['pending', 'in_progress', 'overdue'])

        const { data: assigneeCommitments } = await supabase
          .from('commitments')
          .select('id, title, description, status, source, due_date, creator_id, assignee_id, created_at')
          .eq('team_id', teamId)
          .eq('assignee_id', userId)
          .in('status', ['pending', 'in_progress', 'overdue'])

        // Deduplicate by id
        const allCommitments = [...(creatorCommitments || []), ...(assigneeCommitments || [])]
        const seen = new Set<string>()
        commitments = allCommitments.filter((c) => {
          if (seen.has(c.id)) return false
          seen.add(c.id)
          return true
        })
      }

      handoffList.push({
        personName: events[0].organizer_name || email,
        personEmail: email,
        userId,
        startDate: earliestStart,
        endDate: latestEnd,
        events,
        commitments,
      })
    }

    setHandoffs(handoffList)

    // Load checklists from localStorage
    const initialChecklists: Record<string, boolean[]> = {}
    for (const h of handoffList) {
      initialChecklists[h.personEmail] = loadChecklist(h.personEmail)
    }
    setChecklists(initialChecklists)

    setLoading(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load handoff data'
      setError(message)
      toast.error(message)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Reassign a commitment ──
  async function handleReassign(commitmentId: string, newAssigneeId: string) {
    setReassigning(commitmentId)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('commitments')
        .update({ assignee_id: newAssigneeId })
        .eq('id', commitmentId)

      if (error) throw error

      // Update local state
      setHandoffs((prev) =>
        prev.map((h) => ({
          ...h,
          commitments: h.commitments.map((c) =>
            c.id === commitmentId ? { ...c, assignee_id: newAssigneeId } : c
          ),
        }))
      )

      const assignee = teamMembers.find((m) => m.user_id === newAssigneeId)
      toast.success(`Reassigned to ${assignee?.profiles?.full_name || 'team member'}`)
    } catch {
      toast.error('Failed to reassign commitment')
    } finally {
      setReassigning(null)
    }
  }

  // ── Toggle checklist item ──
  function toggleChecklistItem(personEmail: string, index: number) {
    setChecklists((prev) => {
      const current = prev[personEmail] || CHECKLIST_ITEMS.map(() => false)
      const updated = [...current]
      updated[index] = !updated[index]
      saveChecklist(personEmail, updated)
      return { ...prev, [personEmail]: updated }
    })
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">PTO Handoff Protocol</h1>
          <p className="text-gray-600 mt-1">
            When someone goes OOO, HeyWren surfaces every open commitment and ensures clean transfers
          </p>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  // ── Render ──
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">PTO Handoff Protocol</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          When someone goes OOO, HeyWren surfaces every open commitment and ensures clean transfers
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-sm text-red-800">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Handoff Items */}
      <div className="space-y-3">
        {handoffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <Hand className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No PTO handoffs scheduled</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
              When you schedule time off in your calendar, HeyWren will automatically surface all open
              commitments and help you delegate to the right team members. Plan your next PTO and ensure
              zero commitments slip through.
            </p>
            <a
              href="/commitments"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              View Your Commitments
            </a>
          </div>
        ) : (
          handoffs.map((handoff) => {
            const isExpanded = expandedHandoff === handoff.personEmail
            const checklistValues = checklists[handoff.personEmail] || CHECKLIST_ITEMS.map(() => false)
            const allChecked = checklistValues.every(Boolean)
            const hasCommitments = handoff.commitments.length > 0
            const allReassigned = hasCommitments && handoff.commitments.every(
              (c) => c.assignee_id && c.assignee_id !== handoff.userId
            )
            const status: 'completed' | 'pending' =
              allChecked && (!hasCommitments || allReassigned) ? 'completed' : 'pending'

            return (
              <div
                key={handoff.personEmail}
                className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition"
              >
                {/* Header - clickable */}
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() =>
                    setExpandedHandoff(isExpanded ? null : handoff.personEmail)
                  }
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                        <span className="text-indigo-600 font-bold text-sm">
                          {getInitials(handoff.personName)}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{handoff.personName}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mt-0.5">
                          <Calendar className="w-4 h-4" />
                          {formatDateRange(handoff.startDate, handoff.endDate)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right ml-4 flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-1 justify-end">
                        {status === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-yellow-600" />
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {handoff.commitments.length} commitment
                        {handoff.commitments.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <ChevronDown
                      className={`w-5 h-5 text-gray-400 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <>
                    <hr className="my-4 border-gray-100" />
                    <div className="space-y-4">
                      {/* Open Commitments */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">
                          Open Commitments to Handoff
                        </h4>
                        {handoff.commitments.length === 0 ? (
                          <p className="text-sm text-gray-500">
                            No open commitments found for this person.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {handoff.commitments.map((commitment) => {
                              const currentAssignee = teamMembers.find(
                                (m) => m.user_id === commitment.assignee_id
                              )
                              const isReassignedAway =
                                commitment.assignee_id &&
                                commitment.assignee_id !== handoff.userId

                              return (
                                <div
                                  key={commitment.id}
                                  className="flex items-start gap-3 text-sm bg-gray-50 rounded-lg p-3"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-gray-900">
                                        {commitment.title}
                                      </p>
                                      {isReassignedAway && (
                                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                                          Reassigned
                                        </span>
                                      )}
                                    </div>
                                    {commitment.due_date && (
                                      <p className="text-gray-500 text-xs mt-0.5">
                                        Due:{' '}
                                        {new Date(commitment.due_date).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                        })}
                                      </p>
                                    )}
                                    {currentAssignee && (
                                      <p className="text-gray-400 text-xs mt-0.5">
                                        Currently assigned to:{' '}
                                        {currentAssignee.profiles?.full_name ||
                                          currentAssignee.profiles?.email}
                                      </p>
                                    )}
                                  </div>

                                  {/* Reassign dropdown */}
                                  <div className="flex-shrink-0 relative">
                                    {reassigning === commitment.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                    ) : (
                                      <select
                                        className="text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        value={commitment.assignee_id || ''}
                                        onChange={(e) => {
                                          if (e.target.value) {
                                            handleReassign(commitment.id, e.target.value)
                                          }
                                        }}
                                      >
                                        <option value="">Reassign to...</option>
                                        {teamMembers
                                          .filter((m) => m.user_id !== handoff.userId)
                                          .map((m) => (
                                            <option key={m.user_id} value={m.user_id}>
                                              {m.profiles?.full_name || m.profiles?.email}
                                            </option>
                                          ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Handoff Checklist */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-blue-900 mb-2">
                          Handoff Checklist
                        </h4>
                        <div className="space-y-2 text-sm text-blue-800">
                          {CHECKLIST_ITEMS.map((item, idx) => (
                            <label
                              key={idx}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checklistValues[idx] || false}
                                onChange={() =>
                                  toggleChecklistItem(handoff.personEmail, idx)
                                }
                              />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {status === 'completed' && (
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="font-medium">Handoff complete - all items addressed</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info Box */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h3 className="font-semibold text-green-900 mb-2">PTO Protocol Benefits</h3>
        <p className="text-sm text-green-800 mb-3">
          Ensure zero commitments slip through the cracks when team members take time off.
        </p>
        <ul className="text-sm text-green-800 space-y-1">
          <li>&#10003; Automatic backup assignment</li>
          <li>&#10003; Commitment handoff tracking</li>
          <li>&#10003; Stakeholder notifications</li>
          <li>&#10003; Post-PTO sync reminders</li>
        </ul>
      </div>
    </div>
  )
}
