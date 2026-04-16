'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  X, Mail, Crown, Shield, Building2, Star, Users,
  Ghost, Moon, Clock, TrendingDown, AlertCircle,
  CheckCircle2, AlertTriangle, Settings, Save,
  Send, MessageSquare, ArrowRightLeft, ChevronLeft,
  ChevronRight, BarChart3, Calendar, TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgMember {
  id: string
  user_id: string
  role: string
  email: string
  full_name: string
  avatar_url?: string
  job_title?: string
  department_id: string
  department_name: string
  team_id: string
  team_name: string
  commitments_open: number
  commitments_completed: number
  missed_emails: number
}

interface Department {
  id: string
  name: string
  slug: string
}

interface Team {
  id: string
  name: string
  slug: string
  department_id: string
}

interface Anomaly {
  userId: string
  displayName: string
  avatarUrl: string | null
  type: 'idle' | 'after_hours' | 'ghost_day' | 'response_drop' | 'overloaded'
  severity: 'info' | 'warning' | 'alert'
  date: string
  detail: string
  dismissed: boolean
}

interface WeeklyReview {
  week_start: string
  commitments_created: number
  commitments_completed: number
  commitments_overdue: number
  missed_emails_resolved: number
  missed_chats_resolved: number
  meetings_attended: number
  response_rate: number
  on_time_rate: number
  total_points: number
  is_live?: boolean
}

interface TeamMemberSidebarProps {
  member: OrgMember
  isOpen: boolean
  onClose: () => void
  anomalies: Anomaly[]
  isManager: boolean
  callerRole: string
  departments: Department[]
  teams: Team[]
  onMemberUpdated: () => void
  onDismissAnomaly: (anomaly: Anomaly, reason?: string) => void
}

// ── Constants ────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  org_admin: { label: 'Org Admin', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  dept_manager: { label: 'Dept Manager', icon: Building2, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  team_lead: { label: 'Team Lead', icon: Star, color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
  member: { label: 'Member', icon: Users, color: 'text-gray-700 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  admin: { label: 'Admin', icon: Shield, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
}

const ANOMALY_CONFIG: Record<string, { label: string; icon: typeof Ghost; color: string }> = {
  ghost_day: { label: 'Ghost Day', icon: Ghost, color: 'text-red-600' },
  idle: { label: 'Idle Period', icon: Clock, color: 'text-amber-600' },
  after_hours: { label: 'After Hours', icon: Moon, color: 'text-blue-600' },
  response_drop: { label: 'Response Drop', icon: TrendingDown, color: 'text-orange-600' },
  overloaded: { label: 'Overloaded', icon: AlertCircle, color: 'text-purple-600' },
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

const DAY_LABELS = [
  { day: 0, label: 'S' }, { day: 1, label: 'M' }, { day: 2, label: 'T' },
  { day: 3, label: 'W' }, { day: 4, label: 'T' }, { day: 5, label: 'F' }, { day: 6, label: 'S' },
]

const NUDGE_TEMPLATES = [
  'Hey, just checking in — you have some missed emails to follow up on.',
  'Wanted to touch base on your open commitments. Let me know if you need help.',
  'Quick reminder to update your commitment statuses when you get a chance.',
]

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatWeekLabel(dateStr: string, isLive?: boolean): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const end = new Date(d)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmt = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(d)} – ${fmt(end)}${isLive ? ' (current)' : ''}`
}

function formatDate(dateStr: string): string {
  // dateStr is already a local-timezone date (YYYY-MM-DD) from the API.
  // Parse at noon UTC to avoid date-boundary shifts, and render with
  // timeZone: 'UTC' so the browser doesn't re-interpret the date.
  const d = new Date(dateStr + 'T12:00:00Z')
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  if (dateStr === todayStr) return 'Today'
  if (dateStr === yesterdayStr) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TeamMemberSidebar({
  member, isOpen, onClose, anomalies, isManager, callerRole,
  departments, teams, onMemberUpdated, onDismissAnomaly,
}: TeamMemberSidebarProps) {
  // ── Weekly Review State ──
  const [weeklyReviews, setWeeklyReviews] = useState<WeeklyReview[]>([])
  const [weekIndex, setWeekIndex] = useState(0)
  const [loadingReviews, setLoadingReviews] = useState(false)

  // ── Manage Member State ──
  const [showManage, setShowManage] = useState(false)
  const [editRole, setEditRole] = useState(member.role)
  const [editJobTitle, setEditJobTitle] = useState(member.job_title || '')
  const [editDeptId, setEditDeptId] = useState(member.department_id || '')
  const [editSystemRole, setEditSystemRole] = useState('')
  const [systemRoleLoaded, setSystemRoleLoaded] = useState(false)
  const [savingMember, setSavingMember] = useState(false)

  // ── Work Schedule State ──
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedule, setSchedule] = useState({
    work_days: [1, 2, 3, 4, 5] as number[],
    start_time: '08:00',
    end_time: '17:00',
  })
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)

  // ── Reassign Team State ──
  const [showReassign, setShowReassign] = useState(false)
  const [reassignTeamId, setReassignTeamId] = useState(member.team_id)
  const [reassignDeptId, setReassignDeptId] = useState(member.department_id)
  const [savingReassign, setSavingReassign] = useState(false)

  // ── Nudge State ──
  const [showNudge, setShowNudge] = useState(false)
  const [nudgeMessage, setNudgeMessage] = useState('')
  const [nudgeChannels, setNudgeChannels] = useState<Set<string>>(new Set(['slack', 'email']))
  const [sendingNudge, setSendingNudge] = useState(false)

  // ── Load weekly reviews when sidebar opens ──
  const loadWeeklyReviews = useCallback(async () => {
    setLoadingReviews(true)
    try {
      const res = await fetch(`/api/weekly-review?targetUserId=${member.user_id}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setWeeklyReviews(data.weeks || [])
        setWeekIndex(0)
      }
    } catch { /* non-fatal */ }
    setLoadingReviews(false)
  }, [member.user_id])

  useEffect(() => {
    if (isOpen && isManager) {
      loadWeeklyReviews()
    }
    // Reset edit states when member changes
    setShowManage(false)
    setShowSchedule(false)
    setShowReassign(false)
    setShowNudge(false)
    setScheduleLoaded(false)
    setSystemRoleLoaded(false)
    setEditRole(member.role)
    setEditJobTitle(member.job_title || '')
    setEditDeptId(member.department_id || '')
    setReassignTeamId(member.team_id)
    setReassignDeptId(member.department_id)
  }, [isOpen, member.user_id, member.role, member.job_title, member.department_id, member.team_id, isManager, loadWeeklyReviews])

  // ── Handlers ──

  const loadSchedule = async () => {
    if (scheduleLoaded) { setShowSchedule(true); return }
    try {
      const res = await fetch(`/api/work-schedule?targetUserId=${member.user_id}`)
      const data = await res.json()
      if (data.schedule) setSchedule(data.schedule)
      setScheduleLoaded(true)
      setShowSchedule(true)
    } catch { toast.error('Failed to load schedule') }
  }

  const saveSchedule = async () => {
    setSavingSchedule(true)
    try {
      const res = await fetch('/api/work-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...schedule, targetUserId: member.user_id }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Schedule updated for ${member.full_name}`)
      setShowSchedule(false)
    } catch { toast.error('Failed to save schedule') }
    setSavingSchedule(false)
  }

  const openManage = async () => {
    setShowManage(true)
    setEditRole(member.role)
    setEditJobTitle(member.job_title || '')
    setEditDeptId(member.department_id || '')
    if (!systemRoleLoaded && callerRole === 'org_admin') {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const { data } = await supabase.from('profiles').select('role').eq('id', member.user_id).single()
        if (data) setEditSystemRole(data.role || 'user')
        setSystemRoleLoaded(true)
      } catch { /* non-fatal */ }
    }
  }

  const saveMemberChanges = async () => {
    setSavingMember(true)
    try {
      const body: Record<string, string | undefined> = { userId: member.user_id }
      if (editRole !== member.role) body.orgRole = editRole
      if (editJobTitle !== (member.job_title || '')) body.jobTitle = editJobTitle
      if (editDeptId !== (member.department_id || '')) body.departmentId = editDeptId
      if (callerRole === 'org_admin' && editSystemRole && systemRoleLoaded) body.systemRole = editSystemRole
      const res = await fetch('/api/manage-member', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error) } else {
        toast.success(`${member.full_name} updated`)
        setShowManage(false)
        onMemberUpdated()
      }
    } catch { toast.error('Failed to update member') }
    setSavingMember(false)
  }

  const saveReassign = async () => {
    setSavingReassign(true)
    try {
      const body: Record<string, string> = { userId: member.user_id, teamId: reassignTeamId }
      if (reassignDeptId !== member.department_id) body.departmentId = reassignDeptId
      const res = await fetch('/api/reassign-team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error) } else {
        toast.success(`${member.full_name} reassigned`)
        setShowReassign(false)
        onMemberUpdated()
      }
    } catch { toast.error('Failed to reassign') }
    setSavingReassign(false)
  }

  const sendNudge = async () => {
    if (!nudgeMessage.trim()) { toast.error('Enter a message'); return }
    setSendingNudge(true)
    try {
      const res = await fetch('/api/send-nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: member.user_id,
          message: nudgeMessage.trim(),
          channels: Array.from(nudgeChannels),
        }),
      })
      const data = await res.json()
      if (data.success) {
        const sent = data.results?.filter((r: { success: boolean }) => r.success).map((r: { channel: string }) => r.channel).join(' & ')
        toast.success(`Nudge sent via ${sent}`)
        setNudgeMessage('')
        setShowNudge(false)
      } else {
        const errors = data.results?.filter((r: { success: boolean }) => !r.success).map((r: { channel: string; error?: string }) => `${r.channel}: ${r.error}`).join(', ')
        toast.error(errors || 'Failed to send nudge')
      }
    } catch { toast.error('Failed to send nudge') }
    setSendingNudge(false)
  }

  const toggleNudgeChannel = (ch: string) => {
    setNudgeChannels(prev => {
      const next = new Set(prev)
      if (next.has(ch)) { if (next.size > 1) next.delete(ch) } else { next.add(ch) }
      return next
    })
  }

  // ── Derived values ──
  const roleConfig = ROLE_CONFIG[member.role] || ROLE_CONFIG.member
  const RoleIcon = roleConfig.icon
  const bgColor = AVATAR_COLORS[member.full_name.charCodeAt(0) % AVATAR_COLORS.length]
  const totalCommitments = member.commitments_open + member.commitments_completed
  const followThrough = totalCommitments > 0 ? Math.round(member.commitments_completed / totalCommitments * 100) : 0
  const currentWeek = weeklyReviews[weekIndex] || null
  const availableTeams = callerRole === 'org_admin'
    ? teams.filter(t => t.department_id === reassignDeptId)
    : teams.filter(t => t.department_id === member.department_id)

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 md:bg-black/20"
        onClick={onClose}
      />

      {/* Sidebar Panel */}
      <div className={`
        fixed z-50 bg-white dark:bg-surface-dark-secondary overflow-y-auto
        transition-transform duration-300 ease-out
        md:right-0 md:top-0 md:h-full md:w-[420px] md:border-l md:border-gray-200 md:dark:border-border-dark md:shadow-2xl
        inset-x-0 bottom-0 top-[10vh] rounded-t-2xl md:rounded-none md:inset-y-0 md:left-auto
      `}>
        {/* ── Mobile drag handle ── */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* ── Header ── */}
        <div className="sticky top-0 bg-white dark:bg-surface-dark-secondary z-10 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {member.avatar_url ? (
                <img src={member.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className={`w-12 h-12 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0`}>
                  {getInitials(member.full_name)}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{member.full_name}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.job_title || member.email}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${roleConfig.bg} ${roleConfig.color}`}>
                    <RoleIcon className="w-2.5 h-2.5" />
                    {roleConfig.label}
                  </span>
                  {member.department_name && (
                    <span className="text-[10px] text-gray-400">{member.department_name} / {member.team_name}</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* ── Performance Metrics ── */}
          <section>
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Performance</h3>
            <div className="grid grid-cols-4 gap-2">
              <MetricCard label="Open" value={member.commitments_open} />
              <MetricCard label="Done" value={member.commitments_completed} color="text-green-600" />
              <MetricCard label="Follow-thru" value={`${followThrough}%`} color={followThrough >= 50 ? 'text-green-600' : followThrough > 0 ? 'text-amber-600' : undefined} />
              <MetricCard label="Missed" value={member.missed_emails} color={member.missed_emails > 0 ? 'text-amber-600' : undefined} />
            </div>
          </section>

          {/* ── Weekly Review Snapshot ── */}
          {isManager && (
            <section>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Weekly Review</h3>
              {loadingReviews ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-400 animate-pulse">Loading reviews...</p>
                </div>
              ) : weeklyReviews.length === 0 ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 text-center">
                  <Calendar className="w-5 h-5 text-gray-300 mx-auto mb-1" />
                  <p className="text-xs text-gray-400">No weekly data available yet</p>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
                  {/* Week navigator */}
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => setWeekIndex(Math.min(weekIndex + 1, weeklyReviews.length - 1))}
                      disabled={weekIndex >= weeklyReviews.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {currentWeek ? formatWeekLabel(currentWeek.week_start, currentWeek.is_live) : ''}
                    </span>
                    <button
                      onClick={() => setWeekIndex(Math.max(weekIndex - 1, 0))}
                      disabled={weekIndex <= 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  {currentWeek && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{currentWeek.commitments_completed}</p>
                        <p className="text-[9px] text-gray-500">Completed</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-amber-600">{currentWeek.commitments_overdue}</p>
                        <p className="text-[9px] text-gray-500">Overdue</p>
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${currentWeek.response_rate >= 70 ? 'text-green-600' : currentWeek.response_rate >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                          {Math.round(currentWeek.response_rate)}%
                        </p>
                        <p className="text-[9px] text-gray-500">Response</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{currentWeek.commitments_created}</p>
                        <p className="text-[9px] text-gray-500">Created</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{currentWeek.meetings_attended}</p>
                        <p className="text-[9px] text-gray-500">Meetings</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-indigo-600">{currentWeek.total_points}</p>
                        <p className="text-[9px] text-gray-500">Points</p>
                      </div>
                    </div>
                  )}
                  {/* Week dots */}
                  <div className="flex justify-center gap-1.5 mt-3">
                    {weeklyReviews.map((_, i) => (
                      <button key={i} onClick={() => setWeekIndex(i)}
                        className={`w-1.5 h-1.5 rounded-full transition ${i === weekIndex ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Activity Anomalies ── */}
          <section>
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Activity Insights</h3>
            {anomalies.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                No concerns detected
              </div>
            ) : (
              <div className="space-y-1.5">
                {anomalies.slice(0, 8).map((a, i) => {
                  const config = ANOMALY_CONFIG[a.type] || ANOMALY_CONFIG.idle
                  const Icon = config.icon
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs group">
                      <Icon className={`w-3.5 h-3.5 ${config.color} flex-shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-gray-500 dark:text-gray-400">{formatDate(a.date)}</span>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-600 dark:text-gray-300">{a.detail}</span>
                      </div>
                      {isManager && (
                        <button onClick={() => onDismissAnomaly(a)} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-gray-500 transition">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Manager Actions ── */}
          {isManager && (
            <section>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Actions</h3>
              <div className="space-y-2">
                {/* Action buttons row */}
                {!showManage && !showSchedule && !showReassign && !showNudge && (
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton icon={Crown} label="Manage Member" onClick={openManage} />
                    <ActionButton icon={Settings} label="Work Schedule" onClick={loadSchedule} />
                    <ActionButton icon={ArrowRightLeft} label="Reassign Team" onClick={() => setShowReassign(true)} />
                    <ActionButton icon={MessageSquare} label="Send Nudge" onClick={() => setShowNudge(true)} />
                  </div>
                )}

                {/* ── Manage Member Form ── */}
                {showManage && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Manage Member</p>
                      <button onClick={() => setShowManage(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                      <select value={editRole} onChange={e => setEditRole(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white">
                        <option value="member">Member</option>
                        <option value="team_lead">Team Lead</option>
                        <option value="dept_manager">Department Manager</option>
                        {callerRole === 'org_admin' && <option value="org_admin">Org Admin</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Job Title</label>
                      <input type="text" value={editJobTitle} onChange={e => setEditJobTitle(e.target.value)}
                        placeholder="e.g. Senior Engineer"
                        className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white" />
                    </div>
                    {departments.length > 0 && (
                      <div>
                        <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
                        <select value={editDeptId} onChange={e => setEditDeptId(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white">
                          <option value="">No department</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                    {callerRole === 'org_admin' && systemRoleLoaded && (
                      <div>
                        <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">System Access</label>
                        <select value={editSystemRole} onChange={e => setEditSystemRole(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white">
                          <option value="user">Standard User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    )}
                    <button onClick={saveMemberChanges} disabled={savingMember}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 transition">
                      <Save className="w-3 h-3" />
                      {savingMember ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}

                {/* ── Work Schedule Form ── */}
                {showSchedule && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Work Schedule</p>
                      <button onClick={() => setShowSchedule(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                    <div className="flex gap-1">
                      {DAY_LABELS.map(({ day, label }) => (
                        <button key={day}
                          onClick={() => {
                            const updated = schedule.work_days.includes(day)
                              ? schedule.work_days.filter(d => d !== day)
                              : [...schedule.work_days, day].sort()
                            setSchedule({ ...schedule, work_days: updated })
                          }}
                          className={`w-7 h-7 rounded-md text-[11px] font-semibold transition ${
                            schedule.work_days.includes(day)
                              ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="time" value={schedule.start_time}
                        onChange={e => setSchedule({ ...schedule, start_time: e.target.value })}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white" />
                      <span className="text-xs text-gray-400">to</span>
                      <input type="time" value={schedule.end_time}
                        onChange={e => setSchedule({ ...schedule, end_time: e.target.value })}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white" />
                    </div>
                    <button onClick={saveSchedule} disabled={savingSchedule}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 transition">
                      <Save className="w-3 h-3" />
                      {savingSchedule ? 'Saving...' : 'Save Schedule'}
                    </button>
                  </div>
                )}

                {/* ── Reassign Team Form ── */}
                {showReassign && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Reassign Team</p>
                      <button onClick={() => setShowReassign(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                    {callerRole === 'org_admin' && departments.length > 0 && (
                      <div>
                        <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
                        <select value={reassignDeptId}
                          onChange={e => { setReassignDeptId(e.target.value); setReassignTeamId('') }}
                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white">
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">Team</label>
                      <select value={reassignTeamId} onChange={e => setReassignTeamId(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white">
                        <option value="">Select a team</option>
                        {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <button onClick={saveReassign} disabled={savingReassign || !reassignTeamId}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 transition">
                      <ArrowRightLeft className="w-3 h-3" />
                      {savingReassign ? 'Reassigning...' : 'Reassign'}
                    </button>
                  </div>
                )}

                {/* ── Send Nudge Form ── */}
                {showNudge && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Send Nudge</p>
                      <button onClick={() => setShowNudge(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                    {/* Channel toggles */}
                    <div className="flex gap-2">
                      <button onClick={() => toggleNudgeChannel('slack')}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border transition ${
                          nudgeChannels.has('slack')
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-400'
                        }`}>
                        Slack
                      </button>
                      <button onClick={() => toggleNudgeChannel('email')}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border transition ${
                          nudgeChannels.has('email')
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-400'
                        }`}>
                        Email
                      </button>
                    </div>
                    {/* Quick templates */}
                    <div className="space-y-1">
                      {NUDGE_TEMPLATES.map((tpl, i) => (
                        <button key={i} onClick={() => setNudgeMessage(tpl)}
                          className="w-full text-left px-2 py-1.5 text-[11px] text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 rounded transition truncate">
                          {tpl}
                        </button>
                      ))}
                    </div>
                    {/* Custom message */}
                    <textarea
                      value={nudgeMessage}
                      onChange={e => setNudgeMessage(e.target.value)}
                      placeholder="Write a custom message..."
                      rows={3}
                      maxLength={1000}
                      className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-surface-dark text-gray-900 dark:text-white resize-none"
                    />
                    <button onClick={sendNudge} disabled={sendingNudge || !nudgeMessage.trim()}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 transition">
                      <Send className="w-3 h-3" />
                      {sendingNudge ? 'Sending...' : 'Send Nudge'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Contact Info ── */}
          <section>
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Contact</h3>
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="truncate">{member.email}</span>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 text-center">
      <p className={`text-lg font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
      <p className="text-[9px] text-gray-500 font-medium">{label}</p>
    </div>
  )
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Crown; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg transition">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}
