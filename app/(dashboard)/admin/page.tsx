'use client'

import { useState, useEffect } from 'react'
import { RoleGate } from '@/components/role-gate'
import { PageHeader } from '@/components/ui/page-header'
import {
  Shield, Building2, Users, Search, ChevronRight, AlertTriangle,
  CheckCircle2, XCircle, Mail, MessageSquare, Calendar, ArrowLeft,
  RotateCcw, Zap, UserX, RefreshCw, Clock, Key, Link2, Trash2,
  Globe, Database, Activity, Eye, Send, Plus, X, Copy,
  TrendingUp, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface TeamHealth {
  id: string; name: string; slug: string; domain: string; created_at: string
  memberCount: number; integrationCount: number; commitmentCount: number
  emailCount: number; slackMessageCount: number
  integrations: { provider: string; user_id: string }[]
}

interface IntegrationHealth {
  id: string; provider: string; hasToken: boolean; hasRefreshToken: boolean
  tokenPreview: string; connectedAt: string; lastUpdated: string
  config: { slackTeamName: string | null; slackTeamId: string | null; botId: string | null; connectedBy: string | null }
}

interface UserDetail {
  profile: {
    id: string; email: string; full_name: string; display_name: string; role: string
    current_team_id: string; onboarding_completed: boolean
    onboarding_step: string; slack_user_id: string; created_at: string
  }
  integrations: { id: string; provider: string; updated_at: string }[]
  diagnostics: {
    commitments: { total: number; open: number; completed: number; bySource: Record<string, number> }
    emails: { total: number; processed: number; unprocessed: number }
    slackMessages: { total: number; processed: number; unprocessed: number }
    calendarEvents: number
    waitingRoomItems: number
  }
  integrationHealth?: IntegrationHealth[]
  dataMigration?: {
    emails: { total: number; unowned: number }
    calendar: { total: number; unowned: number }
    slack: { total: number; processed: number }
  }
  activityLog?: {
    lastSignIn: string | null
    accountCreated: string
    onboardingCompleted: boolean
    onboardingStep: string
  }
  organization?: {
    id: string | null
    domains: string[]
  }
  recentActivity?: {
    commitments: { title: string; status: string; source: string; created_at: string }[]
    waitingRoom: { subject: string; status: string; urgency: string; sent_at: string; days_waiting: number }[]
    emails: { subject: string; from_name: string; received_at: string; processed: boolean }[]
  }
  engagement?: {
    lastActiveDate: string | null
    daysSinceActive: number | null
    timeToValue: number | null
    weeklyTrend: number[]
    gamificationScore: number
    streakWeeks: number
  }
  syncHealth?: { provider: string; daysSinceSync: number | null; stale: boolean; tokenExpired: boolean; tokenExpiresSoon: boolean; tokenExpiresAt: string | null }[]
  featureAdoption?: {
    features: Record<string, boolean>
    adoptedCount: number
    totalFeatures: number
  }
  backlogAlerts?: { type: string; count: number; message: string }[]
  teamHealth?: { totalMembers: number; activeMembers: number; invitedCount: number } | null
  adminNotes?: string | null
}

interface TeamMember {
  id: string; email: string; full_name: string; display_name: string; role: string
  onboarding_completed: boolean; slack_user_id: string; created_at: string
  teamRole: string; joinedAt: string; integrations: string[]; commitmentCount: number
}

function HealthBadge({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  const ok = value >= threshold
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  )
}

function AdminContent() {
  const [view, setView] = useState<'overview' | 'team' | 'user'>('overview')
  const [teams, setTeams] = useState<TeamHealth[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)
  const [editDomains, setEditDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [showDomainEditor, setShowDomainEditor] = useState(false)
  const [actionLog, setActionLog] = useState<Array<{ time: string; action: string; result: string; success: boolean }>>([])
  const [adminNotes, setAdminNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)

  useEffect(() => { loadOverview() }, [])

  const loadOverview = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/dashboard?view=overview')
      if (res.ok) {
        const data = await res.json()
        setTeams(data.teams || [])
      }
    } catch (err) {
      toast.error('Failed to load admin data')
    }
    setLoading(false)
  }

  const loadTeam = async (teamId: string) => {
    setLoading(true)
    setSelectedTeam(teamId)
    setView('team')
    try {
      const res = await fetch(`/api/admin/dashboard?view=team&teamId=${teamId}`)
      if (res.ok) {
        const data = await res.json()
        setTeamMembers(data.members || [])
      }
    } catch { toast.error('Failed to load team') }
    setLoading(false)
  }

  const loadUser = async (userId: string) => {
    setLoading(true)
    setSelectedUser(null)
    setView('user')
    try {
      const res = await fetch(`/api/admin/dashboard?view=user&userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedUser(data)
        setAdminNotes(data.adminNotes || '')
        setNotesSaved(true)
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast.error(err.error || `Failed to load user (${res.status})`)
      }
    } catch { toast.error('Failed to load user') }
    setLoading(false)
  }

  const runAction = async (action: string, params: Record<string, any>) => {
    setActionLoading(action)
    setMagicLink(null)
    const timestamp = new Date().toLocaleTimeString()
    try {
      const res = await fetch('/api/admin/user-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        if (data.link) setMagicLink(data.link)
        setActionLog(prev => [{ time: timestamp, action, result: data.message, success: true }, ...prev].slice(0, 20))
        if (selectedUser) loadUser(selectedUser.profile.id)
      } else {
        const msg = data.message || data.error || `Failed (${res.status})`
        toast.error(msg)
        setActionLog(prev => [{ time: timestamp, action, result: msg, success: false }, ...prev].slice(0, 20))
      }
    } catch (err) {
      const msg = `Action failed: ${(err as Error).message || 'Network error or timeout'}`
      toast.error(msg)
      setActionLog(prev => [{ time: timestamp, action, result: msg, success: false }, ...prev].slice(0, 20))
    }
    setActionLoading(null)
  }

  const filteredTeams = teams.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.domain?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Overview: all companies
  if (view === 'overview') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Support Dashboard"
          description={`${teams.length} companies on the platform`}
        />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search companies by name or domain..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Team List */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-2">
            {filteredTeams.map((team) => {
              const hasIssues = team.commitmentCount === 0 && team.integrationCount > 0
              return (
                <button
                  key={team.id}
                  onClick={() => loadTeam(team.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors hover:bg-gray-50 ${
                    hasIssues ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Building2 className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{team.name}</p>
                        <p className="text-xs text-gray-500">{team.domain || 'No domain'} &middot; Created {new Date(team.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-2">
                        <HealthBadge value={team.memberCount} threshold={1} label={`${team.memberCount} users`} />
                        <HealthBadge value={team.integrationCount} threshold={1} label={`${team.integrationCount} integrations`} />
                        <HealthBadge value={team.commitmentCount} threshold={1} label={`${team.commitmentCount} commitments`} />
                      </div>
                      {hasIssues && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {team.emailCount.toLocaleString()} emails</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {team.slackMessageCount.toLocaleString()} messages</span>
                  </div>
                </button>
              )
            })}
            {filteredTeams.length === 0 && (
              <p className="text-center py-8 text-gray-500">No companies found</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Team view: users in a company
  if (view === 'team') {
    const teamName = teams.find(t => t.id === selectedTeam)?.name || 'Team'
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => { setView('overview'); setSelectedTeam(null) }} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <PageHeader title={teamName} description={`${teamMembers.length} members`} />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-2">
            {teamMembers.map((member) => {
              const hasIssues = member.onboarding_completed && member.integrations.length > 0 && member.commitmentCount === 0
              return (
                <button
                  key={member.id}
                  onClick={() => loadUser(member.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors hover:bg-gray-50 ${
                    hasIssues ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{member.full_name || member.display_name || member.email || 'Unknown user'}</p>
                        <p className="text-xs text-gray-500">{member.email || 'No email'} &middot; {member.teamRole}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-2">
                        <HealthBadge value={member.onboarding_completed ? 1 : 0} threshold={1} label={member.onboarding_completed ? 'Onboarded' : 'Not onboarded'} />
                        <HealthBadge value={member.integrations.length} threshold={1} label={member.integrations.join(', ') || 'No integrations'} />
                        <HealthBadge value={member.commitmentCount} threshold={1} label={`${member.commitmentCount} commitments`} />
                      </div>
                      {hasIssues && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // User detail view
  if (view === 'user') {
    if (loading || !selectedUser) {
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <button onClick={() => { setView('team'); if (selectedTeam) loadTeam(selectedTeam) }} className="text-gray-500 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <PageHeader title="User Details" description="Loading user diagnostics..." />
          </div>
          {loading ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
              <p>Loading user data...</p>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
              <p>Failed to load user data.</p>
              <button onClick={() => { setView('team'); if (selectedTeam) loadTeam(selectedTeam) }} className="mt-3 text-indigo-600 text-sm font-medium hover:underline">
                Go back to team
              </button>
            </div>
          )}
        </div>
      )
    }

    const { profile, integrations, diagnostics } = selectedUser
    const d = diagnostics
    const processedRate = d.emails.total > 0 ? Math.round(d.emails.processed / d.emails.total * 100) : 0
    const slackProcessedRate = d.slackMessages.total > 0 ? Math.round(d.slackMessages.processed / d.slackMessages.total * 100) : 0

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => { setView('team'); loadTeam(profile.current_team_id) }} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <PageHeader title={profile.full_name || profile.display_name || profile.email} description={profile.email} />
        </div>

        {(
          <>
            {/* User Status + Activity Log */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Role</p>
                <p className="font-semibold">{profile.role}</p>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Onboarding</p>
                <p className={`font-semibold ${profile.onboarding_completed ? 'text-green-600' : 'text-amber-600'}`}>
                  {profile.onboarding_completed ? 'Complete' : profile.onboarding_step || 'Not started'}
                </p>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Last Sign In</p>
                <p className="font-semibold text-sm">{selectedUser.activityLog?.lastSignIn ? new Date(selectedUser.activityLog.lastSignIn).toLocaleString() : 'Never'}</p>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Slack User ID</p>
                <p className="font-semibold text-sm truncate">{profile.slack_user_id || 'Not set'}</p>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Account Created</p>
                <p className="font-semibold text-sm">{new Date(profile.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Proactive Alerts */}
            {selectedUser.backlogAlerts && selectedUser.backlogAlerts.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alerts ({selectedUser.backlogAlerts.length})
                </h3>
                <div className="space-y-1.5">
                  {selectedUser.backlogAlerts.map((alert, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-red-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      {alert.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Engagement & Health Signals */}
            {selectedUser.engagement && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  Engagement Health
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className={`text-xl font-bold ${
                      selectedUser.engagement.daysSinceActive === null ? 'text-gray-400' :
                      selectedUser.engagement.daysSinceActive <= 3 ? 'text-green-600' :
                      selectedUser.engagement.daysSinceActive <= 7 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {selectedUser.engagement.daysSinceActive !== null ? `${selectedUser.engagement.daysSinceActive}d` : '?'}
                    </p>
                    <p className="text-xs text-gray-500">Since Active</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className={`text-xl font-bold ${
                      selectedUser.engagement.timeToValue === null ? 'text-gray-400' :
                      selectedUser.engagement.timeToValue <= 1 ? 'text-green-600' : 'text-blue-600'
                    }`}>
                      {selectedUser.engagement.timeToValue !== null ? `${selectedUser.engagement.timeToValue}d` : 'N/A'}
                    </p>
                    <p className="text-xs text-gray-500">Time to Value</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xl font-bold text-violet-600">{selectedUser.engagement.gamificationScore}</p>
                    <p className="text-xs text-gray-500">Score</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xl font-bold text-amber-600">{selectedUser.engagement.streakWeeks}w</p>
                    <p className="text-xs text-gray-500">Streak</p>
                  </div>
                </div>
                {/* Weekly Trend */}
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Commitments per Week (last 4 weeks)</p>
                  <div className="flex items-end gap-1.5 h-12">
                    {selectedUser.engagement.weeklyTrend.map((count, i) => {
                      const max = Math.max(...selectedUser.engagement!.weeklyTrend, 1)
                      const height = Math.max((count / max) * 100, 4)
                      const isLatest = i === selectedUser.engagement!.weeklyTrend.length - 1
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                          <span className="text-[10px] text-gray-400">{count}</span>
                          <div
                            className={`w-full rounded-t ${isLatest ? 'bg-indigo-500' : 'bg-indigo-200'}`}
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-[10px] text-gray-400">{i === 0 ? '4w' : i === 1 ? '3w' : i === 2 ? '2w' : '1w'}</span>
                        </div>
                      )
                    })}
                  </div>
                  {selectedUser.engagement.weeklyTrend.length >= 2 && (() => {
                    const trend = selectedUser.engagement!.weeklyTrend
                    const recent = trend[trend.length - 1]
                    const previous = trend[trend.length - 2]
                    if (recent > previous) return <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Engagement increasing</p>
                    if (recent < previous) return <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Engagement declining</p>
                    return <p className="text-xs text-gray-500 mt-1">Steady engagement</p>
                  })()}
                </div>
              </div>
            )}

            {/* Feature Adoption */}
            {selectedUser.featureAdoption && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  Feature Adoption ({selectedUser.featureAdoption.adoptedCount}/{selectedUser.featureAdoption.totalFeatures})
                </h3>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                  <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${Math.round(selectedUser.featureAdoption.adoptedCount / selectedUser.featureAdoption.totalFeatures * 100)}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedUser.featureAdoption.features).map(([feature, adopted]) => (
                    <span key={feature} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      adopted ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-400 border border-gray-200'
                    }`}>
                      {adopted ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {feature.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Team Health */}
            {selectedUser.teamHealth && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  Team Health
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xl font-bold">{selectedUser.teamHealth.totalMembers}</p>
                    <p className="text-xs text-gray-500">Members</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xl font-bold text-green-600">{selectedUser.teamHealth.activeMembers}</p>
                    <p className="text-xs text-gray-500">Active (30d)</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xl font-bold text-blue-600">{selectedUser.teamHealth.invitedCount}</p>
                    <p className="text-xs text-gray-500">Invites Sent</p>
                  </div>
                </div>
              </div>
            )}

            {/* Sync Health */}
            {selectedUser.syncHealth && selectedUser.syncHealth.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-teal-500" />
                  Sync Health
                </h3>
                <div className="space-y-2">
                  {selectedUser.syncHealth.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                      <span className="capitalize font-medium text-sm">{s.provider}</span>
                      <div className="flex items-center gap-2">
                        {s.daysSinceSync !== null && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            s.stale ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {s.stale ? `Stale (${s.daysSinceSync}d ago)` : `Synced ${s.daysSinceSync}d ago`}
                          </span>
                        )}
                        {s.tokenExpired && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">Token Expired</span>
                        )}
                        {s.tokenExpiresSoon && !s.tokenExpired && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Expires Soon</span>
                        )}
                        {!s.tokenExpired && !s.tokenExpiresSoon && !s.stale && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Healthy</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Integration Health */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                Integration Health
              </h3>
              {(!selectedUser.integrationHealth || selectedUser.integrationHealth.length === 0) ? (
                <p className="text-sm text-red-600 flex items-center gap-1"><XCircle className="w-4 h-4" /> No integrations connected</p>
              ) : (
                <div className="space-y-3">
                  {selectedUser.integrationHealth.map(int => (
                    <div key={int.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="capitalize font-semibold">{int.provider}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${int.hasToken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {int.hasToken ? 'Token Active' : 'No Token'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${int.hasRefreshToken ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {int.hasRefreshToken ? 'Refresh OK' : 'No Refresh'}
                          </span>
                        </div>
                        <button
                          onClick={() => runAction('refresh_token', { userId: profile.id, provider: int.provider })}
                          disabled={actionLoading === 'refresh_token'}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
                        >
                          <Key className="w-3 h-3" />
                          {actionLoading === 'refresh_token' ? 'Refreshing...' : 'Refresh Token'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-500">
                        <div>Token: <span className="font-mono text-gray-700">{int.tokenPreview}</span></div>
                        <div>Connected: {new Date(int.connectedAt).toLocaleDateString()}</div>
                        <div>Last Updated: {new Date(int.lastUpdated).toLocaleString()}</div>
                        {int.config.slackTeamName && <div>Workspace: {int.config.slackTeamName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Data Ownership */}
            {selectedUser.dataMigration && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Database className="w-4 h-4 text-violet-500" />
                  Data Ownership
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Mail className="w-3 h-3 text-blue-500" />
                      <p className="text-xs text-gray-500">Emails</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-green-500 rounded-full h-2" style={{ width: `${selectedUser.dataMigration.emails.total + selectedUser.dataMigration.emails.unowned > 0 ? Math.round(selectedUser.dataMigration.emails.total / (selectedUser.dataMigration.emails.total + selectedUser.dataMigration.emails.unowned) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs text-gray-600">{selectedUser.dataMigration.emails.total}/{selectedUser.dataMigration.emails.total + selectedUser.dataMigration.emails.unowned}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="w-3 h-3 text-teal-500" />
                      <p className="text-xs text-gray-500">Calendar</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-green-500 rounded-full h-2" style={{ width: `${selectedUser.dataMigration.calendar.total + selectedUser.dataMigration.calendar.unowned > 0 ? Math.round(selectedUser.dataMigration.calendar.total / (selectedUser.dataMigration.calendar.total + selectedUser.dataMigration.calendar.unowned) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs text-gray-600">{selectedUser.dataMigration.calendar.total}/{selectedUser.dataMigration.calendar.total + selectedUser.dataMigration.calendar.unowned}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <MessageSquare className="w-3 h-3 text-purple-500" />
                      <p className="text-xs text-gray-500">Slack</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-purple-500 rounded-full h-2" style={{ width: `${selectedUser.dataMigration.slack.total > 0 ? Math.round(selectedUser.dataMigration.slack.processed / selectedUser.dataMigration.slack.total * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs text-gray-600">{selectedUser.dataMigration.slack.processed}/{selectedUser.dataMigration.slack.total}</span>
                    </div>
                  </div>
                </div>
                {(selectedUser.dataMigration.emails.unowned > 0 || selectedUser.dataMigration.calendar.unowned > 0) && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Unowned rows found — run Full Re-Sync to assign to this user
                  </p>
                )}
              </div>
            )}

            {/* Company Domains */}
            {selectedUser.organization && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-500" />
                  Company Domains
                  {!showDomainEditor && (
                    <button onClick={() => { setEditDomains(selectedUser.organization?.domains || []); setShowDomainEditor(true) }} className="ml-auto text-xs text-indigo-600 hover:underline">Edit</button>
                  )}
                </h3>
                {showDomainEditor ? (
                  <div className="space-y-2">
                    {editDomains.map((domain, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="flex-1 text-sm px-3 py-1.5 bg-gray-50 rounded border">{domain}</span>
                        <button onClick={() => setEditDomains(editDomains.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input type="text" value={newDomain} onChange={e => setNewDomain(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newDomain.trim()) { setEditDomains([...editDomains, newDomain.trim().toLowerCase()]); setNewDomain('') } }} placeholder="acme.com" className="flex-1 px-3 py-1.5 text-sm border rounded" />
                      <button onClick={() => { if (newDomain.trim()) { setEditDomains([...editDomains, newDomain.trim().toLowerCase()]); setNewDomain('') } }} className="px-2 py-1.5 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100"><Plus className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { runAction('update_domains', { organizationId: selectedUser.organization?.id, domains: editDomains }); setShowDomainEditor(false) }} disabled={actionLoading === 'update_domains'} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">Save</button>
                      <button onClick={() => setShowDomainEditor(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  selectedUser.organization.domains.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedUser.organization.domains.map(d => (
                        <span key={d} className="px-2 py-1 bg-blue-50 border border-blue-200 rounded text-sm">{d}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No domains configured</p>
                  )
                )}
              </div>
            )}

            {/* Data Pipeline Health */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Data Pipeline</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Mail className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium">Outlook Emails</span>
                  </div>
                  <p className="text-2xl font-bold">{d.emails.total.toLocaleString()}</p>
                  <div className="flex gap-2 mt-1">
                    <span className="text-xs text-green-600">{d.emails.processed} processed</span>
                    <span className="text-xs text-amber-600">{d.emails.unprocessed} pending</span>
                  </div>
                  {d.emails.total > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${processedRate}%` }} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-4 h-4 text-purple-600" />
                    <span className="text-sm font-medium">Slack Messages</span>
                  </div>
                  <p className="text-2xl font-bold">{d.slackMessages.total.toLocaleString()}</p>
                  <div className="flex gap-2 mt-1">
                    <span className="text-xs text-green-600">{d.slackMessages.processed} processed</span>
                    <span className="text-xs text-amber-600">{d.slackMessages.unprocessed} pending</span>
                  </div>
                  {d.slackMessages.total > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${slackProcessedRate}%` }} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-teal-600" />
                    <span className="text-sm font-medium">Calendar Events</span>
                  </div>
                  <p className="text-2xl font-bold">{d.calendarEvents.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Commitment Output */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Commitments</h3>
              {d.commitments.total === 0 ? (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <p className="text-sm font-medium">No commitments found — pipeline may be broken</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold">{d.commitments.total}</p>
                    <p className="text-xs text-gray-500">Total</p>
                  </div>
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-2xl font-bold text-blue-600">{d.commitments.open}</p>
                    <p className="text-xs text-gray-500">Open</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{d.commitments.completed}</p>
                    <p className="text-xs text-gray-500">Completed</p>
                  </div>
                  <div className="text-center p-2 bg-violet-50 rounded-lg">
                    <p className="text-2xl font-bold text-violet-600">{d.waitingRoomItems}</p>
                    <p className="text-xs text-gray-500">Waiting Room</p>
                  </div>
                </div>
              )}
              {d.commitments.total > 0 && (
                <div className="flex gap-3 mt-3 text-xs text-gray-500">
                  <span>Slack: {d.commitments.bySource.slack || 0}</span>
                  <span>Outlook: {d.commitments.bySource.outlook || 0}</span>
                  <span>Calendar: {d.commitments.bySource.calendar || 0}</span>
                </div>
              )}
            </div>

            {/* Recent Activity — What the user sees */}
            {selectedUser.recentActivity && (
              <div className="space-y-4">
                {/* Recent Commitments */}
                {selectedUser.recentActivity.commitments.length > 0 && (
                  <div className="bg-white dark:bg-surface-dark-secondary border rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                      Recent Commitments
                    </h3>
                    <div className="space-y-2">
                      {selectedUser.recentActivity.commitments.map((c, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'completed' ? 'bg-green-500' : c.status === 'open' ? 'bg-blue-500' : 'bg-gray-400'}`} />
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{c.title}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {c.source && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{c.source}</span>}
                            <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Waiting Room Items */}
                {selectedUser.recentActivity.waitingRoom.length > 0 && (
                  <div className="bg-white dark:bg-surface-dark-secondary border rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-500" />
                      Waiting Room ({d.waitingRoomItems} active)
                    </h3>
                    <div className="space-y-2">
                      {selectedUser.recentActivity.waitingRoom.map((item, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              item.urgency === 'critical' ? 'bg-red-100 text-red-700' :
                              item.urgency === 'high' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{item.urgency}</span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.subject || '(no subject)'}</span>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{item.days_waiting}d waiting</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Emails */}
                {selectedUser.recentActivity.emails.length > 0 && (
                  <div className="bg-white dark:bg-surface-dark-secondary border rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-blue-500" />
                      Recent Emails
                    </h3>
                    <div className="space-y-2">
                      {selectedUser.recentActivity.emails.map((email, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${email.processed ? 'bg-green-500' : 'bg-amber-500'}`} />
                            <div className="min-w-0">
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">{email.subject || '(no subject)'}</span>
                              <span className="text-xs text-gray-400">{email.from_name || 'Unknown'}</span>
                            </div>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{new Date(email.received_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Admin Notes */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Mail className="w-4 h-4 text-amber-500" />
                CS Notes
                {!notesSaved && <span className="text-xs text-amber-600 font-normal">(unsaved)</span>}
              </h3>
              <textarea
                value={adminNotes}
                onChange={(e) => { setAdminNotes(e.target.value); setNotesSaved(false) }}
                placeholder="Add notes about this user (support context, call notes, issues)..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y min-h-[80px]"
                rows={3}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={async () => {
                    const res = await fetch('/api/admin/user-actions', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'save_notes', userId: profile.id, notes: adminNotes }),
                    })
                    const data = await res.json()
                    if (data.success) {
                      setNotesSaved(true)
                      toast.success('Notes saved')
                    } else {
                      toast.error(data.error || 'Failed to save notes')
                    }
                  }}
                  disabled={notesSaved}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Notes
                </button>
                {notesSaved && adminNotes && <span className="text-xs text-green-600">Saved</span>}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>

              {/* Sync & Data */}
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Sync &amp; Data</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => runAction('full_resync', { userId: profile.id })}
                  disabled={actionLoading === 'full_resync'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {actionLoading === 'full_resync' ? 'Syncing...' : 'Full Re-Sync'}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`This will DELETE all of ${profile.email}'s Outlook data and re-fetch from scratch. Continue?`)) {
                      runAction('clear_resync', { userId: profile.id })
                    }
                  }}
                  disabled={actionLoading === 'clear_resync'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {actionLoading === 'clear_resync' ? 'Clearing...' : 'Clear & Re-Sync'}
                </button>
                <button
                  onClick={() => runAction('trigger_backfill', { userId: profile.id })}
                  disabled={actionLoading === 'trigger_backfill'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {actionLoading === 'trigger_backfill' ? 'Triggering...' : 'Trigger Reprocessing'}
                </button>
                <button
                  onClick={() => runAction('reset_processed', { teamId: profile.current_team_id })}
                  disabled={actionLoading === 'reset_processed'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {actionLoading === 'reset_processed' ? 'Resetting...' : 'Reset Processed Flags'}
                </button>
              </div>

              {/* Account & Access */}
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Account &amp; Access</p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => runAction('generate_magic_link', { userId: profile.id })}
                  disabled={actionLoading === 'generate_magic_link'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {actionLoading === 'generate_magic_link' ? 'Generating...' : 'Login as User'}
                </button>
                <button
                  onClick={() => runAction('send_password_reset', { userId: profile.id })}
                  disabled={actionLoading === 'send_password_reset'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {actionLoading === 'send_password_reset' ? 'Sending...' : 'Send Password Reset'}
                </button>
                <button
                  onClick={() => runAction('fix_onboarding', { userId: profile.id })}
                  disabled={actionLoading === 'fix_onboarding'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {actionLoading === 'fix_onboarding' ? 'Fixing...' : 'Mark Onboarding Complete'}
                </button>
              </div>

              {/* Magic Link Result */}
              {magicLink && (
                <div className="mb-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                  <p className="text-xs text-violet-700 font-medium mb-1">Magic Login Link (opens as this user):</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-white px-2 py-1 rounded border flex-1 overflow-x-auto">{magicLink}</code>
                    <button onClick={() => { navigator.clipboard.writeText(magicLink); toast.success('Copied!') }} className="px-2 py-1 bg-violet-100 rounded hover:bg-violet-200">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <a href={magicLink} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-violet-600 text-white rounded text-xs hover:bg-violet-700">Open</a>
                  </div>
                </div>
              )}

              {/* Danger Zone */}
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Danger Zone</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete ${profile.email}? This cannot be undone.`)) {
                      runAction('delete_user', { userId: profile.id })
                    }
                  }}
                  disabled={actionLoading === 'delete_user'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 text-red-700"
                >
                  <UserX className="w-3.5 h-3.5" />
                  {actionLoading === 'delete_user' ? 'Deleting...' : 'Delete User'}
                </button>
                <button
                  onClick={() => loadUser(profile.id)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>
            </div>

            {/* Action Log */}
            {actionLog.length > 0 && (
              <div className="bg-white border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-gray-500" />
                    Action Log
                  </h3>
                  <button
                    onClick={() => setActionLog([])}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {actionLog.map((entry, i) => (
                    <div key={i} className={`text-xs p-2 rounded-lg ${entry.success ? 'bg-green-50 border border-green-100' : 'bg-red-50 border border-red-100'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`font-semibold ${entry.success ? 'text-green-700' : 'text-red-700'}`}>
                          {entry.success ? 'OK' : 'ERROR'}
                        </span>
                        <span className="text-gray-500">{entry.time}</span>
                        <span className="font-mono text-gray-600">{entry.action}</span>
                      </div>
                      <p className={`${entry.success ? 'text-green-800' : 'text-red-800'} break-words`}>{entry.result}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return null
}

export default function AdminPage() {
  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto">
      <RoleGate
        requiredRole="super_admin"
        fallback={
          <div className="text-center py-16">
            <Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900">Access Denied</h2>
            <p className="text-gray-500 mt-2">This page requires super admin access.</p>
          </div>
        }
      >
        <AdminContent />
      </RoleGate>
    </div>
  )
}
