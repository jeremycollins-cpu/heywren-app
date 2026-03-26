'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Users, Mail, Crown, Shield, UserPlus, BarChart3,
  CheckCircle2, AlertTriangle, Building2, Layers,
  ChevronDown, ChevronRight, Star,
} from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

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

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  org_admin: { label: 'Org Admin', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  dept_manager: { label: 'Dept Manager', icon: Building2, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  team_lead: { label: 'Team Lead', icon: Star, color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
  member: { label: 'Member', icon: Users, color: 'text-gray-700 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  admin: { label: 'Admin', icon: Shield, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

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
  const supabase = createClient()

  useEffect(() => {
    loadTeamData()
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

      if (data.organization) {
        setOrganization(data.organization)
      }
      if (data.departments) {
        setDepartments(data.departments)
        setExpandedDepts(new Set(data.departments.map((d: Department) => d.id)))
      }
      if (data.teams) {
        setTeams(data.teams)
      }
      if (data.callerRole) {
        setCallerRole(data.callerRole)
      }

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

      const enrichedMembers: OrgMember[] = data.members.map((m: any) => {
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

  if (loading) {
    return <LoadingSkeleton variant="dashboard" />
  }

  const hasDeptView = departments.length > 0 && callerRole !== 'member'
  const headerTitle = organization?.name || 'Your Team'
  const headerSubtitle = callerRole === 'org_admin'
    ? `Organization overview · ${departments.length} department${departments.length !== 1 ? 's' : ''} · ${members.length} member${members.length !== 1 ? 's' : ''}`
    : callerRole === 'dept_manager'
    ? `Department view · ${members.length} member${members.length !== 1 ? 's' : ''}`
    : `${members.length} team member${members.length !== 1 ? 's' : ''}`

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{headerTitle}</h1>
            {callerRole === 'org_admin' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                <Crown className="w-3 h-3" />
                Org Admin
              </span>
            )}
            {callerRole === 'dept_manager' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400">
                <Building2 className="w-3 h-3" />
                Dept Manager
              </span>
            )}
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{headerSubtitle}</p>
        </div>
        {(callerRole === 'org_admin' || callerRole === 'dept_manager') && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            <UserPlus className="w-4 h-4" />
            Invite Member
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-indigo-200 dark:border-indigo-800/50 rounded-xl p-4 flex items-center gap-3">
          <Mail className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
          />
          <button
            onClick={() => {
              if (inviteEmail) {
                toast.success(`Invitation sent to ${inviteEmail}`)
                setInviteEmail('')
                setShowInvite(false)
              }
            }}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 transition"
          >
            Send Invite
          </button>
          <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-indigo-500" />
            <p className="text-xs font-medium text-gray-500">Members</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{teamStats.totalMembers}</p>
          <p className="text-xs text-gray-400 mt-1">
            {callerRole === 'org_admin' ? 'across organization' : 'in your scope'}
          </p>
        </div>
        {hasDeptView && (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-purple-500" />
              <p className="text-xs font-medium text-gray-500">Departments</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{departments.length}</p>
            <p className="text-xs text-gray-400 mt-1">{teams.length} team{teams.length !== 1 ? 's' : ''} total</p>
          </div>
        )}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-violet-500" />
            <p className="text-xs font-medium text-gray-500">Commitments</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{teamStats.totalCommitments}</p>
          <p className="text-xs text-gray-400 mt-1">tracked total</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <p className="text-xs font-medium text-gray-500">Follow-Through</p>
          </div>
          <p className="text-2xl font-bold text-green-600">{teamStats.followThrough}%</p>
          <p className="text-xs text-gray-400 mt-1">{teamStats.totalCompleted} completed</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-medium text-gray-500">Missed Emails</p>
          </div>
          <p className="text-2xl font-bold text-amber-600">{teamStats.totalMissedEmails}</p>
          <p className="text-xs text-gray-400 mt-1">pending across scope</p>
        </div>
      </div>

      {/* Members — Grouped by Department/Team for org_admin/dept_manager */}
      {hasDeptView ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Organization Structure</h2>
          {departments.map(dept => {
            const deptTeams = teams.filter(t => t.department_id === dept.id)
            const deptMembers = members.filter(m => m.department_id === dept.id)
            const isExpanded = expandedDepts.has(dept.id)

            return (
              <div key={dept.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleDept(dept.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <Building2 className="w-5 h-5 text-indigo-500" />
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{dept.name}</h3>
                      <p className="text-xs text-gray-500">
                        {deptTeams.length} team{deptTeams.length !== 1 ? 's' : ''} · {deptMembers.length} member{deptMembers.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">
                      {deptMembers.reduce((s, m) => s + m.commitments_completed, 0)} completed
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    {deptTeams.map(team => {
                      const teamMembersList = deptMembers.filter(m => m.team_id === team.id)
                      if (teamMembersList.length === 0) return null

                      return (
                        <div key={team.id} className="px-5 py-3">
                          <div className="flex items-center gap-2 mb-3 pl-7">
                            <Users className="w-4 h-4 text-violet-500" />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{team.name}</span>
                            <span className="text-xs text-gray-400">({teamMembersList.length})</span>
                          </div>
                          <div className="space-y-2 pl-7">
                            {teamMembersList.map(member => (
                              <MemberRow key={member.id} member={member} />
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
          <div className="space-y-3">
            {members.length === 0 ? (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No team members found</p>
                <p className="text-sm text-gray-400 mt-1">Invite colleagues to start tracking commitments together</p>
              </div>
            ) : (
              members.map(member => (
                <MemberRow key={member.id} member={member} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
    </UpgradeGate>
  )
}

function MemberRow({ member }: { member: OrgMember }) {
  const roleConfig = ROLE_CONFIG[member.role] || ROLE_CONFIG.member
  const RoleIcon = roleConfig.icon
  const bgColor = AVATAR_COLORS[member.full_name.charCodeAt(0) % AVATAR_COLORS.length]
  const totalCommitments = member.commitments_open + member.commitments_completed
  const followThrough = totalCommitments > 0 ? Math.round(member.commitments_completed / totalCommitments * 100) : 0

  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 hover:shadow-md transition">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
          {getInitials(member.full_name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">{member.full_name}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${roleConfig.bg} ${roleConfig.color}`}>
              <RoleIcon className="w-3 h-3" />
              {roleConfig.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {member.job_title || member.email}
          </p>
        </div>

        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900 dark:text-white">{member.commitments_open}</p>
            <p className="text-[10px] text-gray-400 font-medium">Open</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">{member.commitments_completed}</p>
            <p className="text-[10px] text-gray-400 font-medium">Done</p>
          </div>
          <div className="text-center">
            <p className={`text-lg font-bold ${followThrough >= 50 ? 'text-green-600' : followThrough > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {followThrough}%
            </p>
            <p className="text-[10px] text-gray-400 font-medium">Follow-through</p>
          </div>
          {member.missed_emails > 0 && (
            <div className="text-center">
              <p className="text-lg font-bold text-amber-600">{member.missed_emails}</p>
              <p className="text-[10px] text-gray-400 font-medium">Missed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
