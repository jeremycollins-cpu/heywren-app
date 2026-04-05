'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Users, Network, AlertTriangle, Moon, Activity,
  Flame, Clock, Timer,
  Shield, Zap, TrendingDown, ChevronDown, ChevronUp,
  Target, Link2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CollabNode {
  userId: string
  name: string
  avatar: string | null
  jobTitle: string | null
  department: string | null
  team: string | null
  role: string
  connectionCount: number
  totalInteractions: number
  avgStrength: number
}

interface CollabEdge {
  source: string
  target: string
  emailCount: number
  chatCount: number
  meetingCount: number
  commitmentCount: number
  strength: number
  total: number
}

interface CollabInsights {
  totalNodes: number
  totalEdges: number
  avgConnections: number
  crossDeptCollaboration: number
  siloed: Array<{ userId: string; name: string; connections: number }>
  connectors: Array<{ userId: string; name: string; connections: number; interactions: number }>
  bottlenecks: Array<{ userId: string; name: string; connections: number; avgStrength: number }>
}

interface CollabData {
  nodes: CollabNode[]
  edges: CollabEdge[]
  insights: CollabInsights
}

interface BurnoutSignals {
  afterHours: { score: number; days: number }
  meetingOverload: { score: number; pct: number }
  commitmentOverload: { score: number; open: number; overdue: number }
  responseAcceleration: { score: number }
  sentimentDecline: { score: number }
  streakIntensity: { score: number; weeks: number }
}

interface BurnoutScore {
  userId: string
  name: string
  avatar: string | null
  jobTitle: string | null
  department: string | null
  riskScore: number
  riskLevel: 'low' | 'moderate' | 'high' | 'critical'
  signals: BurnoutSignals
}

interface BurnoutData {
  scores: BurnoutScore[]
  riskDistribution: { critical: number; high: number; moderate: number; low: number }
  orgAvgRisk: number
}

interface DisconnectPerson {
  userId: string
  name: string
  avatar: string | null
  department: string | null
  disconnectScore: number
  afterHoursCount: number
  afterHoursDays: number
  weekendCount: number
  weekendDays: number
  lateNightCount: number
  totalActivity: number
  hourlyHeatmap: number[]
  weekdayHeatmap: number[]
  weeklyTrend: Array<{ week: string; afterHours: number; weekend: number; total: number }>
  schedule: { workDays: number[]; startTime: string; endTime: string }
}

interface DisconnectData {
  individuals: DisconnectPerson[]
  orgSummary: {
    avgDisconnectScore: number
    totalAfterHoursEvents: number
    totalWeekendEvents: number
    peopleWorkingAfterHours: number
    peopleWorkingWeekends: number
  }
  lookbackDays: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']

const RISK_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', ring: 'ring-red-500' },
  high: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-400', ring: 'ring-orange-500' },
  moderate: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400', ring: 'ring-yellow-500' },
  low: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', ring: 'ring-green-500' },
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function Avatar({ name, avatar, size = 'sm' }: { name: string; avatar: string | null; size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-9 h-9' : 'w-7 h-7'
  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]'
  if (avatar) return <img src={avatar} alt="" className={`${dim} rounded-full`} />
  return (
    <div className={`${dim} rounded-full flex items-center justify-center ${textSize} font-bold text-white ${
      AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
    }`}>
      {getInitials(name)}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = 'collaboration' | 'burnout' | 'disconnect'

export default function PeopleInsightsPage() {
  const [tab, setTab] = useState<Tab>('collaboration')
  const [collab, setCollab] = useState<CollabData | null>(null)
  const [burnout, setBurnout] = useState<BurnoutData | null>(null)
  const [disconnect, setDisconnect] = useState<DisconnectData | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) { setLoading(false); return }

      // Load all three independently — one failure shouldn't block others
      const results = await Promise.allSettled([
        fetch('/api/collaboration-graph', { cache: 'no-store' }),
        fetch('/api/burnout-risk', { cache: 'no-store' }),
        fetch('/api/disconnect-tracking', { cache: 'no-store' }),
      ])

      for (const [i, result] of results.entries()) {
        if (result.status !== 'fulfilled' || !result.value.ok) continue
        try {
          const d = await result.value.json()
          if (d.error) continue
          if (i === 0) setCollab(d)
          else if (i === 1) setBurnout(d)
          else if (i === 2) setDisconnect(d)
        } catch (parseErr) {
          console.error(`Error parsing API response ${i}:`, parseErr)
        }
      }
    } catch (err) {
      console.error('Error loading people insights:', err)
      toast.error('Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <LoadingSkeleton variant="dashboard" />

  const tabs: Array<{ key: Tab; label: string; icon: typeof Network }> = [
    { key: 'collaboration', label: 'Collaboration', icon: Network },
    { key: 'burnout', label: 'Burnout Risk', icon: Flame },
    { key: 'disconnect', label: 'Disconnect', icon: Moon },
  ]

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">People Insights</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Collaboration patterns, wellbeing signals, and work-life balance
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.key
                ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'collaboration' && <CollaborationTab data={collab} />}
      {tab === 'burnout' && <BurnoutTab data={burnout} />}
      {tab === 'disconnect' && <DisconnectTab data={disconnect} />}
    </div>
    </UpgradeGate>
  )
}

// ── Collaboration Tab ─────────────────────────────────────────────────────────

function CollaborationTab({ data }: { data: CollabData | null }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!data) {
    return <EmptyPanel icon={Network} message="No collaboration data available yet" detail="Data populates as emails, chats, and meetings flow through the system" />
  }

  const { nodes, edges, insights } = data

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Users className="w-4 h-4 text-indigo-500" />} label="People" value={insights.totalNodes} />
        <StatCard icon={<Link2 className="w-4 h-4 text-blue-500" />} label="Connections" value={insights.totalEdges} />
        <StatCard icon={<Activity className="w-4 h-4 text-green-500" />} label="Avg Connections" value={insights.avgConnections} />
        <StatCard icon={<Network className="w-4 h-4 text-purple-500" />} label="Cross-Dept" value={`${insights.crossDeptCollaboration}%`} />
      </div>

      {/* Siloed Employees */}
      {insights.siloed.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">
              Siloed Employees ({insights.siloed.length})
            </h3>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400 mb-3">
            These people have significantly fewer connections than the team average ({insights.avgConnections}). They may be isolated or working independently.
          </p>
          <div className="space-y-2">
            {insights.siloed.map(person => (
              <div key={person.userId} className="flex items-center gap-3 bg-white/60 dark:bg-surface-dark/60 rounded-lg px-3 py-2">
                <Avatar name={person.name} avatar={null} />
                <span className="text-sm font-medium text-gray-900 dark:text-white">{person.name}</span>
                <span className="text-xs text-red-500 ml-auto">
                  {person.connections} connection{person.connections !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connectors */}
      {insights.connectors.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top Connectors</h3>
          </div>
          <div className="space-y-2">
            {insights.connectors.map(person => (
              <div key={person.userId} className="flex items-center gap-3">
                <Avatar name={person.name} avatar={null} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{person.name}</span>
                </div>
                <span className="text-xs text-gray-500">{person.connections} connections</span>
                <span className="text-xs text-indigo-500">{person.interactions} interactions</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottlenecks */}
      {insights.bottlenecks.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Potential Bottlenecks</h3>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
            High connection count + high interaction strength. Many people depend on them.
          </p>
          <div className="space-y-2">
            {insights.bottlenecks.map(person => (
              <div key={person.userId} className="flex items-center gap-3">
                <Avatar name={person.name} avatar={null} />
                <span className="text-sm font-medium text-gray-900 dark:text-white">{person.name}</span>
                <span className="text-xs text-amber-600 ml-auto">{person.connections} connections, {Math.round(person.avgStrength * 100)}% avg strength</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full People List */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">All Connections</h3>
        <div className="space-y-1">
          {nodes
            .sort((a, b) => b.totalInteractions - a.totalInteractions)
            .map(node => {
              const isExpanded = expanded === node.userId
              const nodeEdges = edges.filter(e => e.source === node.userId || e.target === node.userId)

              return (
                <div key={node.userId}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : node.userId)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left"
                  >
                    <Avatar name={node.name} avatar={node.avatar} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{node.name}</p>
                      {node.jobTitle && <p className="text-[11px] text-gray-400 truncate">{node.jobTitle}</p>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{node.connectionCount} conn</span>
                      <span>{node.totalInteractions} interactions</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </div>
                  </button>

                  {isExpanded && nodeEdges.length > 0 && (
                    <div className="ml-12 pb-2 space-y-1">
                      {nodeEdges
                        .sort((a, b) => b.total - a.total)
                        .slice(0, 10)
                        .map((edge, i) => {
                          const otherId = edge.source === node.userId ? edge.target : edge.source
                          const other = nodes.find(n => n.userId === otherId)
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs text-gray-500 px-3 py-1">
                              <span className="text-gray-700 dark:text-gray-300 font-medium">{other?.name || 'Unknown'}</span>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              {edge.emailCount > 0 && <span>{edge.emailCount} emails</span>}
                              {edge.chatCount > 0 && <span>{edge.chatCount} chats</span>}
                              {edge.meetingCount > 0 && <span>{edge.meetingCount} meetings</span>}
                              {edge.commitmentCount > 0 && <span>{edge.commitmentCount} commitments</span>}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

// ── Burnout Risk Tab ──────────────────────────────────────────────────────────

function BurnoutTab({ data }: { data: BurnoutData | null }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!data) {
    return <EmptyPanel icon={Flame} message="No burnout risk data available yet" detail="Scores compute from calendar events, commitments, and weekly activity" />
  }

  const { scores, riskDistribution, orgAvgRisk } = data

  return (
    <div className="space-y-4">
      {/* Risk Distribution */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard
          icon={<Activity className="w-4 h-4 text-gray-500" />}
          label="Org Average"
          value={orgAvgRisk}
          detail={<span className="text-[10px]">/ 100</span>}
        />
        <StatCard icon={<AlertTriangle className="w-4 h-4 text-red-500" />} label="Critical" value={riskDistribution.critical} />
        <StatCard icon={<Flame className="w-4 h-4 text-orange-500" />} label="High" value={riskDistribution.high} />
        <StatCard icon={<Timer className="w-4 h-4 text-yellow-500" />} label="Moderate" value={riskDistribution.moderate} />
        <StatCard icon={<Shield className="w-4 h-4 text-green-500" />} label="Low" value={riskDistribution.low} />
      </div>

      {/* Risk Cards */}
      <div className="space-y-2">
        {scores.map(person => {
          const colors = RISK_COLORS[person.riskLevel]
          const isExpanded = expanded === person.userId

          return (
            <div key={person.userId} className={`border rounded-xl transition ${colors.bg} ${
              person.riskLevel === 'critical' ? 'border-red-200 dark:border-red-800' :
              person.riskLevel === 'high' ? 'border-orange-200 dark:border-orange-800' :
              'border-gray-200 dark:border-border-dark'
            }`}>
              <button
                onClick={() => setExpanded(isExpanded ? null : person.userId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <Avatar name={person.name} avatar={person.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{person.name}</p>
                  {person.jobTitle && <p className="text-[11px] text-gray-500 truncate">{person.jobTitle}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className={`text-lg font-bold ${colors.text}`}>{person.riskScore}</p>
                    <p className={`text-[10px] font-medium uppercase ${colors.text}`}>{person.riskLevel}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <SignalCard label="After Hours" score={person.signals.afterHours.score} detail={`${person.signals.afterHours.days} days`} icon={<Moon className="w-3.5 h-3.5" />} />
                  <SignalCard label="Meeting Load" score={person.signals.meetingOverload.score} detail={`${person.signals.meetingOverload.pct}% of time`} icon={<Clock className="w-3.5 h-3.5" />} />
                  <SignalCard label="Commitments" score={person.signals.commitmentOverload.score} detail={`${person.signals.commitmentOverload.open} open, ${person.signals.commitmentOverload.overdue} overdue`} icon={<Target className="w-3.5 h-3.5" />} />
                  <SignalCard label="Response Accel" score={person.signals.responseAcceleration.score} detail="Working faster?" icon={<Zap className="w-3.5 h-3.5" />} />
                  <SignalCard label="Sentiment" score={person.signals.sentimentDecline.score} detail="Tone declining?" icon={<TrendingDown className="w-3.5 h-3.5" />} />
                  <SignalCard label="Streak Intensity" score={person.signals.streakIntensity.score} detail={`${person.signals.streakIntensity.weeks} weeks`} icon={<Flame className="w-3.5 h-3.5" />} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SignalCard({ label, score, detail, icon }: { label: string; score: number; detail: string; icon: React.ReactNode }) {
  const color = score >= 60 ? 'text-red-500' : score >= 30 ? 'text-amber-500' : 'text-green-500'
  const bg = score >= 60 ? 'bg-red-100 dark:bg-red-900/20' : score >= 30 ? 'bg-amber-100 dark:bg-amber-900/20' : 'bg-green-100 dark:bg-green-900/20'
  return (
    <div className={`${bg} rounded-lg p-3`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span className={`text-sm font-bold ml-auto ${color}`}>{score}</span>
      </div>
      <p className="text-[10px] text-gray-500">{detail}</p>
    </div>
  )
}

// ── Disconnect Tab ────────────────────────────────────────────────────────────

function DisconnectTab({ data }: { data: DisconnectData | null }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!data) {
    return <EmptyPanel icon={Moon} message="No disconnect data available yet" detail="Tracking starts after emails, chats, and calendar events are synced" />
  }

  const { individuals, orgSummary } = data

  return (
    <div className="space-y-4">
      {/* Org Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Shield className="w-4 h-4 text-indigo-500" />}
          label="Avg Disconnect Score"
          value={`${orgSummary.avgDisconnectScore}%`}
        />
        <StatCard icon={<Moon className="w-4 h-4 text-violet-500" />} label="After-Hours Events" value={orgSummary.totalAfterHoursEvents} />
        <StatCard icon={<AlertTriangle className="w-4 h-4 text-orange-500" />} label="Working After Hours" value={`${orgSummary.peopleWorkingAfterHours} people`} />
        <StatCard icon={<Clock className="w-4 h-4 text-red-500" />} label="Working Weekends" value={`${orgSummary.peopleWorkingWeekends} people`} />
      </div>

      {/* Individual Cards */}
      <div className="space-y-2">
        {individuals.map(person => {
          const isExpanded = expanded === person.userId
          const scoreColor = person.disconnectScore >= 80 ? 'text-green-600' : person.disconnectScore >= 50 ? 'text-amber-600' : 'text-red-600'
          const scoreBg = person.disconnectScore >= 80 ? 'bg-green-50 dark:bg-green-900/10' : person.disconnectScore >= 50 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-red-50 dark:bg-red-900/10'

          return (
            <div key={person.userId} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : person.userId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <Avatar name={person.name} avatar={person.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{person.name}</p>
                  <div className="flex gap-3 text-[11px] text-gray-400">
                    {person.afterHoursDays > 0 && <span>{person.afterHoursDays}d after-hours</span>}
                    {person.weekendDays > 0 && <span>{person.weekendDays}d weekends</span>}
                    {person.lateNightCount > 0 && <span>{person.lateNightCount} late nights</span>}
                  </div>
                </div>
                <div className={`px-2.5 py-1 rounded-lg ${scoreBg}`}>
                  <span className={`text-sm font-bold ${scoreColor}`}>{person.disconnectScore}%</span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Hourly Heatmap */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-500 mb-2">Activity by Hour (UTC)</p>
                    <div className="flex gap-[2px]">
                      {person.hourlyHeatmap.map((count, hour) => {
                        const max = Math.max(...person.hourlyHeatmap, 1)
                        const intensity = count / max
                        const startHour = parseInt(person.schedule.startTime.split(':')[0], 10)
                        const endHour = parseInt(person.schedule.endTime.split(':')[0], 10)
                        const isWorkHour = hour >= startHour && hour < endHour
                        return (
                          <div key={hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                            <div
                              className={`w-full h-6 rounded-sm ${
                                count === 0 ? 'bg-gray-100 dark:bg-gray-800' :
                                !isWorkHour ? (intensity > 0.5 ? 'bg-red-400' : 'bg-red-200 dark:bg-red-900/40') :
                                intensity > 0.7 ? 'bg-indigo-500' : intensity > 0.3 ? 'bg-indigo-300' : 'bg-indigo-100 dark:bg-indigo-900/30'
                              }`}
                            />
                            {hour % 4 === 0 && (
                              <span className="text-[8px] text-gray-400">{hour}</span>
                            )}
                            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                              <div className="bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">
                                {hour}:00 — {count} events{!isWorkHour ? ' (outside work)' : ''}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-300 inline-block" /> Work hours</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" /> After hours</span>
                    </div>
                  </div>

                  {/* Day of Week */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-500 mb-2">Activity by Day</p>
                    <div className="flex gap-1">
                      {person.weekdayHeatmap.map((count, day) => {
                        const max = Math.max(...person.weekdayHeatmap, 1)
                        const pct = (count / max) * 100
                        const isWorkDay = person.schedule.workDays.includes(day)
                        return (
                          <div key={day} className="flex-1 text-center">
                            <div className="h-12 flex flex-col justify-end mb-1">
                              <div
                                className={`w-full rounded-t ${
                                  !isWorkDay && count > 0 ? 'bg-red-400' : 'bg-indigo-400 dark:bg-indigo-500'
                                }`}
                                style={{ height: `${Math.max(2, pct)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500">{DAY_LABELS[day]}</span>
                            <p className="text-[9px] text-gray-400">{count}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Weekly Trend */}
                  {person.weeklyTrend.length > 1 && (
                    <div>
                      <p className="text-[11px] font-medium text-gray-500 mb-2">Weekly After-Hours Trend</p>
                      <div className="flex items-end gap-1 h-12">
                        {person.weeklyTrend.map((w, i) => {
                          const max = Math.max(...person.weeklyTrend.map(x => x.afterHours + x.weekend), 1)
                          const total = w.afterHours + w.weekend
                          const pct = (total / max) * 100
                          return (
                            <div key={i} className="flex-1 flex flex-col justify-end h-full group relative">
                              <div className="flex flex-col justify-end h-full">
                                {w.weekend > 0 && (
                                  <div className="w-full bg-red-400 rounded-t" style={{ height: `${(w.weekend / max) * 100}%` }} />
                                )}
                                {w.afterHours > 0 && (
                                  <div className={`w-full bg-orange-400 ${w.weekend === 0 ? 'rounded-t' : ''}`} style={{ height: `${(w.afterHours / max) * 100}%` }} />
                                )}
                                {total === 0 && <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-t" style={{ height: '4%' }} />}
                              </div>
                              <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                                <div className="bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">
                                  {w.afterHours} after-hours, {w.weekend} weekend
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Shared Components ─────────────────────────────────────────────────────────

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {detail && <div className="text-xs text-gray-400 mt-1">{detail}</div>}
    </div>
  )
}

function EmptyPanel({ icon: Icon, message, detail }: { icon: typeof Network; message: string; detail: string }) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-12 text-center">
      <Icon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <p className="text-gray-500 font-medium">{message}</p>
      <p className="text-sm text-gray-400 mt-1">{detail}</p>
    </div>
  )
}
