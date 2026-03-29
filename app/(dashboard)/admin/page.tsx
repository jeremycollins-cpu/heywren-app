'use client'

import { useState, useEffect } from 'react'
import { RoleGate } from '@/components/role-gate'
import { PageHeader } from '@/components/ui/page-header'
import {
  Shield, Building2, Users, Search, ChevronRight, AlertTriangle,
  CheckCircle2, XCircle, Mail, MessageSquare, Calendar, ArrowLeft,
  RotateCcw, Zap, UserX, RefreshCw, Clock,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface TeamHealth {
  id: string; name: string; slug: string; domain: string; created_at: string
  memberCount: number; integrationCount: number; commitmentCount: number
  emailCount: number; slackMessageCount: number
  integrations: { provider: string; user_id: string }[]
}

interface UserDetail {
  profile: {
    id: string; email: string; full_name: string; display_name: string; role: string
    current_team_id: string; onboarding_completed: boolean
    onboarding_step: string; slack_user_id: string; created_at: string
  }
  integrations: { id: string; provider: string; created_at: string }[]
  diagnostics: {
    commitments: { total: number; open: number; completed: number; bySource: Record<string, number> }
    emails: { total: number; processed: number; unprocessed: number }
    slackMessages: { total: number; processed: number; unprocessed: number }
    calendarEvents: number
    waitingRoomItems: number
  }
  recentActivity?: {
    commitments: { title: string; status: string; source: string; created_at: string }[]
    waitingRoom: { subject: string; status: string; urgency: string; sent_at: string; days_waiting: number }[]
    emails: { subject: string; from_name: string; received_at: string; processed: boolean }[]
  }
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
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast.error(err.error || `Failed to load user (${res.status})`)
      }
    } catch { toast.error('Failed to load user') }
    setLoading(false)
  }

  const runAction = async (action: string, params: Record<string, string>) => {
    setActionLoading(action)
    try {
      const res = await fetch('/api/admin/user-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        // Refresh current view
        if (selectedUser) loadUser(selectedUser.profile.id)
      } else {
        toast.error(data.message || data.error)
      }
    } catch { toast.error('Action failed') }
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
            {/* User Status */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                <p className="text-xs text-gray-500">Slack User ID</p>
                <p className="font-semibold text-sm truncate">{profile.slack_user_id || 'Not set'}</p>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-gray-500">Joined</p>
                <p className="font-semibold text-sm">{new Date(profile.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Integrations */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Integrations</h3>
              {integrations.length === 0 ? (
                <p className="text-sm text-red-600 flex items-center gap-1"><XCircle className="w-4 h-4" /> No integrations connected</p>
              ) : (
                <div className="flex gap-3">
                  {integrations.map(i => (
                    <div key={i.id} className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="capitalize font-medium">{i.provider}</span>
                      <span className="text-xs text-gray-500">{new Date(i.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

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

            {/* Quick Actions */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runAction('trigger_backfill', { userId: profile.id })}
                  disabled={actionLoading === 'trigger_backfill'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {actionLoading === 'trigger_backfill' ? 'Triggering...' : 'Trigger Reprocessing'}
                </button>
                <button
                  onClick={() => runAction('full_resync', { userId: profile.id })}
                  disabled={actionLoading === 'full_resync'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {actionLoading === 'full_resync' ? 'Syncing...' : 'Full Re-Sync'}
                </button>
                <button
                  onClick={() => runAction('reset_processed', { teamId: profile.current_team_id })}
                  disabled={actionLoading === 'reset_processed'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {actionLoading === 'reset_processed' ? 'Resetting...' : 'Reset Processed Flags'}
                </button>
                <button
                  onClick={() => runAction('fix_onboarding', { userId: profile.id })}
                  disabled={actionLoading === 'fix_onboarding'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {actionLoading === 'fix_onboarding' ? 'Fixing...' : 'Mark Onboarding Complete'}
                </button>
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
