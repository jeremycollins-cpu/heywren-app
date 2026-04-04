'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Users, Mail, Crown, Shield, UserPlus, BarChart3,
  CheckCircle2, AlertTriangle, Building2, Layers,
  ChevronDown, ChevronRight, Star, Eye, EyeOff,
  Ghost, Moon, Clock, TrendingDown, AlertCircle,
  X, MessageSquare,
} from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface OrgInfo {
  id: string
  name: string
  slug: string
  domain: string | null
}

interface TeamStats {
  totalMembers: number
  totalCommitments: number
  totalCompleted: number
  totalMissedEmails: number
  followThrough: number
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

interface AnomalySummary {
  total: number
  ghostDays: number
  idlePeriods: number
  afterHours: number
  responseDrops: number
  overloaded: number
  membersWithAnomalies: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  org_admin: { label: 'Org Admin', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  dept_manager: { label: 'Dept Manager', icon: Building2, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  team_lead: { label: 'Team Lead', icon: Star, color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
  member: { label: 'Member', icon: Users, color: 'text-gray-700 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  admin: { label: 'Admin', icon: Shield, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
}

const ANOMALY_CONFIG: Record<string, { label: string; icon: typeof Ghost; color: string; bg: string; borderColor: string }> = {
  ghost_day: { label: 'Ghost Day', icon: Ghost, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', borderColor: 'border-red-200 dark:border-red-800' },
  idle: { label: 'Idle Period', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', borderColor: 'border-amber-200 dark:border-amber-800' },
  after_hours: { label: 'After Hours', icon: Moon, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', borderColor: 'border-blue-200 dark:border-blue-800' },
  response_drop: { label: 'Response Drop', icon: TrendingDown, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', borderColor: 'border-orange-200 dark:border-orange-800' },
  overloaded: { label: 'Overloaded', icon: AlertCircle, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', borderColor: 'border-purple-200 dark:border-purple-800' },
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (dateStr === today.toISOString().split('T')[0]) return 'Today'
  if (dateStr === yesterday.toISOString().split('T')[0]) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TeamManagementPage() {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [organization, setOrganization] = useState<OrgInfo | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [callerRole, setCallerRole] = useState<string>('member')
  const [teamStats, setTeamStats] = useState<TeamStats>({ totalMembers: 0, totalCommitments: 0, totalCompleted: 0, totalMissedEmails: 0, followThrough: 0 })
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set())
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [anomalySummary, setAnomalySummary] = useState<AnomalySummary | null>(null)
  const [showAnomalies, setShowAnomalies] = useState(true)
  const [anomalyFilter, setAnomalyFilter] = useState<string>('all')
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadTeamData()
    loadAnomalies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleDept = (deptId: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      if (next.has(deptId)) next.delete(deptId)
      else next.add(deptId)
      return next
    })
  }

  const loadTeamData = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      const res = await fetch(`/api/team-members?userId=${user.user.id}`, { cache: 'no-store' })
      if (!res.ok) { setLoading(false); return }
      const data = await res.json()

      if (data.organization) setOrganization(data.organization)
      if (data.departments) {
        setDepartments(data.departments)
        setExpandedDepts(new Set(data.departments.map((d: Department) => d.id)))
      }
      if (data.teams) setTeams(data.teams)
      if (data.callerRole) setCallerRole(data.callerRole)

      const teamId = data.teamId
      if (!data.members || data.members.length === 0) {
        setLoading(false)
        return
      }

      // Enrich members with commitment stats (counts only)
      const { data: commitments } = await supabase
        .from('commitments')
        .select('creator_id, status')
        .eq('team_id', teamId)

      const memberCommitments = new Map<string, { open: number; completed: number }>()
      for (const c of commitments || []) {
        const key = c.creator_id
        if (!key) continue
        if (!memberCommitments.has(key)) memberCommitments.set(key, { open: 0, completed: 0 })
        const stats = memberCommitments.get(key)!
        if (c.status === 'open' || c.status === 'overdue') stats.open++
        if (c.status === 'completed') stats.completed++
      }

      const { data: missedEmails } = await supabase
        .from('missed_emails')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('status', 'pending')

      const memberMissed = new Map<string, number>()
      for (const e of missedEmails || []) {
        memberMissed.set(e.user_id, (memberMissed.get(e.user_id) || 0) + 1)
      }

      const enrichedMembers: OrgMember[] = data.members.map((m: OrgMember) => {
        const cStats = memberCommitments.get(m.user_id) || { open: 0, completed: 0 }
        return {
          ...m,
          commitments_open: cStats.open,
          commitments_completed: cStats.completed,
          missed_emails: memberMissed.get(m.user_id) || 0,
        }
      }).sort((a: OrgMember, b: OrgMember) => {
        const roleOrder: Record<string, number> = { org_admin: 0, dept_manager: 1, team_lead: 2, member: 3, owner: 0, admin: 1 }
        return (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4)
      })

      setMembers(enrichedMembers)

      const totalOpen = enrichedMembers.reduce((s: number, m: OrgMember) => s + m.commitments_open, 0)
      const totalCompleted = enrichedMembers.reduce((s: number, m: OrgMember) => s + m.commitments_completed, 0)
      const totalMissed = enrichedMembers.reduce((s: number, m: OrgMember) => s + m.missed_emails, 0)
      const total = totalOpen + totalCompleted
      setTeamStats({
        totalMembers: enrichedMembers.length,
        totalCommitments: total,
        totalCompleted,
        totalMissedEmails: totalMissed,
        followThrough: total > 0 ? Math.round(totalCompleted / total * 100) : 0,
      })
    } catch (err) {
      console.error('Error fetching team data:', err)
      toast.error('Failed to load team data')
    } finally {
      setLoading(false)
    }
  }

  const loadAnomalies = async () => {
    try {
      const res = await fetch('/api/activity-anomalies?days=7', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setAnomalies(data.anomalies || [])
      setAnomalySummary(data.summary || null)
    } catch {
      // Anomalies are optional — don't block the page
    }
  }

  const dismissAnomaly = async (anomaly: Anomaly, reason?: string) => {
    try {
      const res = await fetch('/api/activity-anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: anomaly.userId,
          anomalyDate: anomaly.date,
          anomalyType: anomaly.type,
          reason,
        }),
      })
      if (!res.ok) throw new Error()
      // Update local state
      setAnomalies(prev => prev.map(a =>
        a.userId === anomaly.userId && a.date === anomaly.date && a.type === anomaly.type
          ? { ...a, dismissed: true }
          : a
      ))
      toast.success('Anomaly dismissed')
    } catch {
      toast.error('Failed to dismiss')
    }
  }

  if (loading) return <LoadingSkeleton variant="dashboard" />

  const hasDeptView = departments.length > 0 && callerRole !== 'member'
  const isManager = callerRole !== 'member'
  const headerTitle = organization?.name || 'Your Team'
  const headerSubtitle = callerRole === 'org_admin'
    ? `Organization · ${departments.length} dept${departments.length !== 1 ? 's' : ''} · ${members.length} member${members.length !== 1 ? 's' : ''}`
    : callerRole === 'dept_manager'
    ? `Department · ${members.length} member${members.length !== 1 ? 's' : ''}`
    : `${members.length} team member${members.length !== 1 ? 's' : ''}`

  const undismissedAnomalies = anomalies.filter(a => !a.dismissed)
  const filteredAnomalies = anomalyFilter === 'all'
    ? undismissedAnomalies
    : undismissedAnomalies.filter(a => a.type === anomalyFilter)

  // Count anomalies per member for the member rows
  const memberAnomalyCount = new Map<string, number>()
  for (const a of undismissedAnomalies) {
    memberAnomalyCount.set(a.userId, (memberAnomalyCount.get(a.userId) || 0) + 1)
  }

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{headerTitle}</h1>
            {callerRole === 'org_admin' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                <Crown className="w-3 h-3" />
                Org Admin
              </span>
            )}
            {callerRole === 'dept_manager' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400">
                <Building2 className="w-3 h-3" />
                Dept Manager
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{headerSubtitle}</p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg transition shrink-0"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Invite Member</span>
            <span className="sm:hidden">Invite</span>
          </button>
        )}
      </div>

      {/* ── Invite Form ─────────────────────────────────────────────────── */}
      {showInvite && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-indigo-200 dark:border-indigo-800/50 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Mail className="w-5 h-5 text-indigo-500 flex-shrink-0 hidden sm:block" />
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (inviteEmail) {
                    toast.success(`Invitation sent to ${inviteEmail}`)
                    setInviteEmail('')
                    setShowInvite(false)
                  }
                }}
                className="flex-1 sm:flex-initial px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 transition"
              >
                Send
              </button>
              <button onClick={() => setShowInvite(false)} className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats Overview ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={<Users className="w-4 h-4 text-indigo-500" />} label="Members" value={teamStats.totalMembers} detail={callerRole === 'org_admin' ? 'across organization' : 'in your scope'} />
        {hasDeptView && (
          <StatCard icon={<Layers className="w-4 h-4 text-purple-500" />} label="Departments" value={departments.length} detail={`${teams.length} team${teams.length !== 1 ? 's' : ''}`} />
        )}
        <StatCard icon={<BarChart3 className="w-4 h-4 text-violet-500" />} label="Commitments" value={teamStats.totalCommitments} detail="tracked total" />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          label="Follow-Through"
          value={`${teamStats.followThrough}%`}
          valueColor={teamStats.followThrough >= 50 ? 'text-green-600' : teamStats.followThrough > 0 ? 'text-amber-600' : undefined}
          detail={`${teamStats.totalCompleted} completed`}
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
          label="Missed Emails"
          value={teamStats.totalMissedEmails}
          valueColor={teamStats.totalMissedEmails > 0 ? 'text-amber-600' : undefined}
          detail="pending response"
        />
      </div>

      {/* ── Activity Anomalies (managers only) ──────────────────────────── */}
      {isManager && anomalySummary && anomalySummary.total > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
          {/* Anomaly Header */}
          <button
            onClick={() => setShowAnomalies(!showAnomalies)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
          >
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Work Activity Insights</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 dark:bg-red-900/20 text-red-600">
                {anomalySummary.total} finding{anomalySummary.total !== 1 ? 's' : ''}
              </span>
            </div>
            {showAnomalies ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>

          {showAnomalies && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              {/* Anomaly Type Filters */}
              <div className="px-4 py-3 flex gap-2 overflow-x-auto scrollbar-hide">
                <FilterPill label="All" count={anomalySummary.total} active={anomalyFilter === 'all'} onClick={() => setAnomalyFilter('all')} />
                {anomalySummary.ghostDays > 0 && (
                  <FilterPill label="Ghost Days" count={anomalySummary.ghostDays} active={anomalyFilter === 'ghost_day'} onClick={() => setAnomalyFilter('ghost_day')} />
                )}
                {anomalySummary.idlePeriods > 0 && (
                  <FilterPill label="Idle" count={anomalySummary.idlePeriods} active={anomalyFilter === 'idle'} onClick={() => setAnomalyFilter('idle')} />
                )}
                {anomalySummary.afterHours > 0 && (
                  <FilterPill label="After Hours" count={anomalySummary.afterHours} active={anomalyFilter === 'after_hours'} onClick={() => setAnomalyFilter('after_hours')} />
                )}
                {anomalySummary.responseDrops > 0 && (
                  <FilterPill label="Response Drop" count={anomalySummary.responseDrops} active={anomalyFilter === 'response_drop'} onClick={() => setAnomalyFilter('response_drop')} />
                )}
                {anomalySummary.overloaded > 0 && (
                  <FilterPill label="Overloaded" count={anomalySummary.overloaded} active={anomalyFilter === 'overloaded'} onClick={() => setAnomalyFilter('overloaded')} />
                )}
              </div>

              {/* Anomaly List */}
              <div className="px-4 pb-4 space-y-2 max-h-96 overflow-y-auto">
                {filteredAnomalies.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No findings in this category</p>
                ) : (
                  filteredAnomalies.slice(0, 20).map((anomaly, i) => (
                    <AnomalyRow key={`${anomaly.userId}-${anomaly.date}-${anomaly.type}-${i}`} anomaly={anomaly} onDismiss={dismissAnomaly} />
                  ))
                )}
                {filteredAnomalies.length > 20 && (
                  <p className="text-xs text-gray-400 text-center pt-2">
                    Showing 20 of {filteredAnomalies.length} findings
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Members ─────────────────────────────────────────────────────── */}
      {hasDeptView ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Organization</h2>
          {departments.map(dept => {
            const deptTeams = teams.filter(t => t.department_id === dept.id)
            const deptMembers = members.filter(m => m.department_id === dept.id)
            const isExpanded = expandedDepts.has(dept.id)

            return (
              <div key={dept.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleDept(dept.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <Building2 className="w-4 h-4 text-indigo-500" />
                    <div className="text-left">
                      <h3 className="font-semibold text-sm text-gray-900 dark:text-white">{dept.name}</h3>
                      <p className="text-xs text-gray-500">
                        {deptTeams.length} team{deptTeams.length !== 1 ? 's' : ''} · {deptMembers.length} member{deptMembers.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {deptMembers.reduce((s, m) => s + m.commitments_completed, 0)} completed
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    {deptTeams.map(team => {
                      const teamMembersList = deptMembers.filter(m => m.team_id === team.id)
                      if (teamMembersList.length === 0) return null

                      return (
                        <div key={team.id} className="px-4 py-3">
                          <div className="flex items-center gap-2 mb-2 pl-4 sm:pl-6">
                            <Users className="w-3.5 h-3.5 text-violet-500" />
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{team.name}</span>
                            <span className="text-xs text-gray-400">({teamMembersList.length})</span>
                          </div>
                          <div className="space-y-2 pl-4 sm:pl-6">
                            {teamMembersList.map(member => (
                              <MemberRow
                                key={member.id}
                                member={member}
                                anomalyCount={memberAnomalyCount.get(member.user_id) || 0}
                                isExpanded={expandedMember === member.user_id}
                                onToggle={() => setExpandedMember(expandedMember === member.user_id ? null : member.user_id)}
                                memberAnomalies={undismissedAnomalies.filter(a => a.userId === member.user_id)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Team Members</h2>
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No team members found</p>
                <p className="text-sm text-gray-400 mt-1">Invite colleagues to start tracking commitments together</p>
              </div>
            ) : (
              members.map(member => (
                <MemberRow
                  key={member.id}
                  member={member}
                  anomalyCount={memberAnomalyCount.get(member.user_id) || 0}
                  isExpanded={expandedMember === member.user_id}
                  onToggle={() => setExpandedMember(expandedMember === member.user_id ? null : member.user_id)}
                  memberAnomalies={undismissedAnomalies.filter(a => a.userId === member.user_id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
    </UpgradeGate>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, detail, valueColor }: {
  icon: React.ReactNode
  label: string
  value: string | number
  detail: string
  valueColor?: string
}) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${valueColor || 'text-gray-900 dark:text-white'}`}>{value}</p>
      <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{detail}</p>
    </div>
  )
}

function FilterPill({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
        active
          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      {label}
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
        active ? 'bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
      }`}>
        {count}
      </span>
    </button>
  )
}

function AnomalyRow({ anomaly, onDismiss }: { anomaly: Anomaly; onDismiss: (a: Anomaly, reason?: string) => void }) {
  const config = ANOMALY_CONFIG[anomaly.type] || ANOMALY_CONFIG.idle
  const Icon = config.icon
  const bgColor = AVATAR_COLORS[(anomaly.displayName || '').charCodeAt(0) % AVATAR_COLORS.length]

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${config.bg} ${config.borderColor}`}>
      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {anomaly.avatarUrl ? (
            <img src={anomaly.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
          ) : (
            <div className={`w-5 h-5 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-[8px]`}>
              {getInitials(anomaly.displayName)}
            </div>
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-white">{anomaly.displayName}</span>
          <span className="text-[11px] text-gray-400">{formatDate(anomaly.date)}</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{anomaly.detail}</p>
      </div>
      <button
        onClick={() => onDismiss(anomaly)}
        className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function MemberRow({ member, anomalyCount, isExpanded, onToggle, memberAnomalies }: {
  member: OrgMember
  anomalyCount: number
  isExpanded: boolean
  onToggle: () => void
  memberAnomalies: Anomaly[]
}) {
  const roleConfig = ROLE_CONFIG[member.role] || ROLE_CONFIG.member
  const RoleIcon = roleConfig.icon
  const bgColor = AVATAR_COLORS[member.full_name.charCodeAt(0) % AVATAR_COLORS.length]
  const totalCommitments = member.commitments_open + member.commitments_completed
  const followThrough = totalCommitments > 0 ? Math.round(member.commitments_completed / totalCommitments * 100) : 0

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-3 sm:p-4 hover:shadow-sm transition text-left"
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {member.avatar_url ? (
              <img src={member.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className={`w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-sm`}>
                {getInitials(member.full_name)}
              </div>
            )}
            {anomalyCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {anomalyCount}
              </span>
            )}
          </div>

          {/* Name + Role */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate">{member.full_name}</h3>
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${roleConfig.bg} ${roleConfig.color}`}>
                <RoleIcon className="w-2.5 h-2.5" />
                {roleConfig.label}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {member.job_title || member.email}
            </p>
          </div>

          {/* Stats — responsive grid instead of flex row */}
          <div className="hidden sm:grid grid-cols-3 gap-4 flex-shrink-0 text-center">
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{member.commitments_open}</p>
              <p className="text-[9px] text-gray-400 font-medium">Open</p>
            </div>
            <div>
              <p className="text-sm font-bold text-green-600">{member.commitments_completed}</p>
              <p className="text-[9px] text-gray-400 font-medium">Done</p>
            </div>
            <div>
              <p className={`text-sm font-bold ${followThrough >= 50 ? 'text-green-600' : followThrough > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {followThrough}%
              </p>
              <p className="text-[9px] text-gray-400 font-medium">Follow-thru</p>
            </div>
          </div>

          {/* Mobile: compact stats */}
          <div className="sm:hidden flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-bold text-gray-900 dark:text-white">{followThrough}%</span>
            {member.missed_emails > 0 && (
              <span className="text-xs font-medium text-amber-600">{member.missed_emails} missed</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="mx-2 -mt-1 mb-1 p-3 bg-gray-50 dark:bg-gray-800/50 border border-t-0 border-gray-200 dark:border-border-dark rounded-b-xl">
          {/* Mobile stats */}
          <div className="grid grid-cols-4 gap-3 text-center sm:hidden mb-3">
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{member.commitments_open}</p>
              <p className="text-[10px] text-gray-500">Open</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-600">{member.commitments_completed}</p>
              <p className="text-[10px] text-gray-500">Done</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${followThrough >= 50 ? 'text-green-600' : followThrough > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {followThrough}%
              </p>
              <p className="text-[10px] text-gray-500">Follow-thru</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${member.missed_emails > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {member.missed_emails}
              </p>
              <p className="text-[10px] text-gray-500">Missed</p>
            </div>
          </div>

          {/* Desktop missed emails (not shown in grid above) */}
          {member.missed_emails > 0 && (
            <div className="hidden sm:flex items-center gap-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs text-amber-600 font-medium">{member.missed_emails} missed email{member.missed_emails !== 1 ? 's' : ''} pending</span>
            </div>
          )}

          {/* Member-specific anomalies */}
          {memberAnomalies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Activity Insights</p>
              {memberAnomalies.slice(0, 5).map((a, i) => {
                const config = ANOMALY_CONFIG[a.type] || ANOMALY_CONFIG.idle
                const Icon = config.icon
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Icon className={`w-3 h-3 ${config.color} flex-shrink-0`} />
                    <span className="text-gray-600 dark:text-gray-400">{formatDate(a.date)}</span>
                    <span className="text-gray-500 dark:text-gray-400 truncate">{a.detail}</span>
                  </div>
                )
              })}
            </div>
          )}

          {memberAnomalies.length === 0 && member.missed_emails === 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              No concerns detected
            </div>
          )}
        </div>
      )}
    </div>
  )
}
