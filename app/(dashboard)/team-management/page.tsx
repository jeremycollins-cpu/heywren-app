'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Users, Mail, Crown, Shield, UserPlus, BarChart3,
  CheckCircle2, Clock, AlertTriangle, TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface TeamMember {
  id: string
  user_id: string
  role: string
  email: string
  full_name: string
  avatar_url?: string
  // Stats
  commitments_open: number
  commitments_completed: number
  missed_emails: number
  last_active: string | null
}

interface TeamStats {
  totalCommitments: number
  totalCompleted: number
  totalMissedEmails: number
  followThrough: number
}

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  admin: { label: 'Admin', icon: Shield, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  member: { label: 'Member', icon: Users, color: 'text-gray-700 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' },
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

export default function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [teamStats, setTeamStats] = useState<TeamStats>({ totalCommitments: 0, totalCompleted: 0, totalMissedEmails: 0, followThrough: 0 })
  const [teamName, setTeamName] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const supabase = createClient()

  useEffect(() => {
    loadTeamData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadTeamData = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      // Fetch team members via server API (uses admin client, bypasses RLS)
      const res = await fetch(`/api/team-members?userId=${user.user.id}`, { cache: 'no-store' })
      if (!res.ok) { setLoading(false); return }
      const teamData = await res.json()

      const teamId = teamData.teamId
      setTeamName(teamData.teamName || 'Your Team')

      if (!teamData.members || teamData.members.length === 0) {
        setLoading(false)
        return
      }

      const profileMap = new Map<string, any>(teamData.members.map((m: any) => [m.user_id, m]))
      const teamMembers: any[] = teamData.members

      // Get commitment stats per member
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

      // Get missed emails count per member
      const { data: missedEmails } = await supabase
        .from('missed_emails')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('status', 'pending')

      const memberMissed = new Map<string, number>()
      for (const e of missedEmails || []) {
        memberMissed.set(e.user_id, (memberMissed.get(e.user_id) || 0) + 1)
      }

      // Build enriched member list
      const enrichedMembers: TeamMember[] = teamMembers.map(m => {
        const p = profileMap.get(m.user_id)
        const cStats = memberCommitments.get(m.user_id) || { open: 0, completed: 0 }
        return {
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          email: p?.email || '',
          full_name: p?.full_name || p?.email?.split('@')[0] || 'Unknown',
          avatar_url: p?.avatar_url,
          commitments_open: cStats.open,
          commitments_completed: cStats.completed,
          missed_emails: memberMissed.get(m.user_id) || 0,
          last_active: null,
        }
      }).sort((a, b) => {
        const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 }
        return (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3)
      })

      setMembers(enrichedMembers)

      // Team-level stats
      const totalOpen = Array.from(memberCommitments.values()).reduce((s, v) => s + v.open, 0)
      const totalCompleted = Array.from(memberCommitments.values()).reduce((s, v) => s + v.completed, 0)
      const totalMissed = Array.from(memberMissed.values()).reduce((s, v) => s + v, 0)
      const total = totalOpen + totalCompleted
      setTeamStats({
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

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{teamName}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{members.length} team member{members.length !== 1 ? 's' : ''} · Team performance and management</p>
        </div>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
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

      {/* Team Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-indigo-500" />
            <p className="text-xs font-medium text-gray-500">Team Size</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{members.length}</p>
          <p className="text-xs text-gray-400 mt-1">active members</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-violet-500" />
            <p className="text-xs font-medium text-gray-500">Commitments</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{teamStats.totalCommitments}</p>
          <p className="text-xs text-gray-400 mt-1">tracked across team</p>
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
          <p className="text-xs text-gray-400 mt-1">pending across team</p>
        </div>
      </div>

      {/* Team Members */}
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
            members.map((member, i) => {
              const roleConfig = ROLE_CONFIG[member.role] || ROLE_CONFIG.member
              const RoleIcon = roleConfig.icon
              const bgColor = AVATAR_COLORS[member.full_name.charCodeAt(0) % AVATAR_COLORS.length]
              const totalCommitments = member.commitments_open + member.commitments_completed
              const followThrough = totalCommitments > 0 ? Math.round(member.commitments_completed / totalCommitments * 100) : 0

              return (
                <div key={member.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 hover:shadow-md transition">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className={`w-12 h-12 ${bgColor} rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                      {getInitials(member.full_name)}
                    </div>

                    {/* Name + Role */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white">{member.full_name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${roleConfig.bg} ${roleConfig.color}`}>
                          <RoleIcon className="w-3 h-3" />
                          {roleConfig.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{member.email}</p>
                    </div>

                    {/* Stats */}
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
            })
          )}
        </div>
      </div>
    </div>
    </UpgradeGate>
  )
}
