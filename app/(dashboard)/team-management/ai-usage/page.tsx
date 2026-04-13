'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, ArrowRight, Cpu, Users, Hash, Sparkles, AlertCircle,
  Info, Mail, Clock, Building2,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import toast from 'react-hot-toast'

// ── Types ───────────────────────────────────────────────────────

interface UserRow {
  user_id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  job_title: string | null
  role: string | null
  department_id: string | null
  department_name: string | null
  sessions: number
  tokens: number
  cost_cents: number
  messages: number
  tool_calls: number
  last_sync: string | null
  is_opportunity_department: boolean
  status: 'active' | 'dormant' | 'never'
}

interface TeamAiUsageData {
  team: { id: string; name: string }
  filter: { days: number; departments: string[] }
  summary: {
    totalSessions: number
    totalTokens: number
    totalCostCents: number
    activeUsers: number
    eligibleUsers: number
    adoptionRate: number
    days: number
  }
  dailyUsage: Array<{ date: string; sessions: number; tokens: number; activeUsers: number }>
  byModel: Array<{ model: string; sessions: number; tokens: number }>
  byTool: Array<{ tool: string; sessions: number; tokens: number }>
  byDepartment: Array<{ department_id: string | null; department_name: string; sessions: number; tokens: number; activeUsers: number; eligibleUsers: number }>
  users: UserRow[]
  adoptionOpportunities: Array<{
    user_id: string
    full_name: string | null
    email: string | null
    avatar_url: string | null
    job_title: string | null
    department_id: string | null
    department_name: string | null
    last_sync: string | null
  }>
  opportunityDepartmentIds: string[]
  allDepartments: Array<{ id: string; name: string; slug: string }>
}

// ── Helpers ─────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toString()
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Components ──────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Cpu
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-1">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon size={16} className={color} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  )
}

function UsageSparkline({ data }: { data: Array<{ date: string; sessions: number }> }) {
  const max = Math.max(...data.map(d => d.sessions), 1)
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map(d => (
        <div
          key={d.date}
          className="flex-1 bg-indigo-200 dark:bg-indigo-900 rounded-t min-w-[3px] relative group"
          style={{ height: `${Math.max((d.sessions / max) * 100, d.sessions > 0 ? 4 : 0)}%` }}
          title={`${d.date}: ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
        >
          <div className="absolute inset-0 bg-indigo-500 dark:bg-indigo-400 rounded-t opacity-0 group-hover:opacity-100 transition" />
        </div>
      ))}
    </div>
  )
}

function Avatar({ src, name, size = 32 }: { src: string | null; name: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name || ''} width={size} height={size} className="rounded-full" />
  }
  const initials = (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div
      className="rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 flex items-center justify-center text-xs font-semibold"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}

function PrivacyNote() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-medium text-blue-900 dark:text-blue-200 w-full text-left"
      >
        <Info size={14} />
        <span>What HeyWren sees (and doesn&apos;t)</span>
        <ArrowRight size={12} className={`ml-auto transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="text-xs text-blue-900 dark:text-blue-200 mt-2 space-y-1.5 leading-relaxed">
          <p>
            <strong>Collected:</strong> session IDs, start/end timestamps, message count, tool-call
            count, model name, project path, git branch.
          </p>
          <p>
            <strong>Never collected:</strong> prompts, Claude&apos;s responses, file contents, tool
            arguments, terminal output, diffs.
          </p>
          <p>
            This page is visible to team admins and super-admins only. Treat this data as adoption
            telemetry, not a productivity ranking.
          </p>
        </div>
      )}
    </div>
  )
}

function AdoptionOpportunities({ users, departments }: {
  users: TeamAiUsageData['adoptionOpportunities']
  departments: Array<{ id: string; name: string }>
}) {
  const [selectedDept, setSelectedDept] = useState<string>('')
  const filtered = selectedDept ? users.filter(u => u.department_id === selectedDept) : users

  if (users.length === 0) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
          <Sparkles size={18} />
          <h3 className="font-semibold">Full adoption</h3>
        </div>
        <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
          Every team member in Product and Engineering has synced at least one Claude Code session in this window. Nice.
        </p>
      </div>
    )
  }

  const uniqueDepts = Array.from(new Set(users.map(u => u.department_id).filter(Boolean) as string[]))
    .map(id => ({ id, name: departments.find(d => d.id === id)?.name || 'Unknown' }))

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Adoption opportunities</h3>
            <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{filtered.length}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
            Team members in Product or Engineering who haven&apos;t synced any Claude Code sessions in this window.
            Share the setup command or ask how to help them get started.
          </p>
        </div>
        {uniqueDepts.length > 1 && (
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All ({users.length})</option>
            {uniqueDepts.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {filtered.map(u => (
          <div key={u.user_id} className="px-5 py-3 flex items-center gap-3">
            <Avatar src={u.avatar_url} name={u.full_name} size={36} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {u.full_name || u.email || 'Unknown'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {u.job_title ? `${u.job_title} · ` : ''}{u.department_name || 'Unassigned'}
              </div>
            </div>
            {u.email && (
              <a
                href={`mailto:${u.email}?subject=${encodeURIComponent('Claude Code — HeyWren integration')}&body=${encodeURIComponent('Hey — we use HeyWren to track AI usage across the team. To have your Claude Code sessions show up, visit /integrations and click Connect under Claude Code, then paste the generated setup command into your terminal. Takes ~30 seconds. Let me know if anything is unclear.')}`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/50 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 rounded-lg transition"
              >
                <Mail size={12} />
                Email setup
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function UserTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center text-sm text-gray-500">
        No team members match this filter.
      </div>
    )
  }
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Team members</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Click a row for per-user detail.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-5 py-2 font-medium">Member</th>
              <th className="text-left px-3 py-2 font-medium">Department</th>
              <th className="text-right px-3 py-2 font-medium">Sessions</th>
              <th className="text-right px-3 py-2 font-medium">Tokens</th>
              <th className="text-right px-3 py-2 font-medium">Last sync</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {users.map(u => (
              <tr key={u.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition">
                <td className="px-5 py-3">
                  <Link
                    href={`/team-management/ai-usage/${u.user_id}`}
                    className="flex items-center gap-2.5 group"
                  >
                    <Avatar src={u.avatar_url} name={u.full_name} size={32} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 truncate">
                        {u.full_name || u.email || 'Unknown'}
                      </div>
                      {u.job_title && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.job_title}</div>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                  {u.department_name || <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-3 text-right text-sm tabular-nums text-gray-900 dark:text-white">{u.sessions}</td>
                <td className="px-3 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300">
                  {u.tokens > 0 ? formatCompact(u.tokens) : '—'}
                </td>
                <td className="px-3 py-3 text-right text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {relativeTime(u.last_sync)}
                </td>
                <td className="px-3 py-3">
                  {u.status === 'active' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Not connected
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DepartmentBreakdown({ departments }: { departments: TeamAiUsageData['byDepartment'] }) {
  if (departments.length === 0) return null
  const maxSessions = Math.max(...departments.map(d => d.sessions), 1)
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">By department</h3>
      <div className="space-y-2.5">
        {departments.map(d => (
          <div key={d.department_id || 'none'}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                <Building2 size={12} className="text-gray-400" />
                {d.department_name}
              </span>
              <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                {d.activeUsers}/{d.eligibleUsers} active · {d.sessions} sessions
              </span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${(d.sessions / maxSessions) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ForbiddenState() {
  return (
    <div className="px-4 sm:px-6 py-16 max-w-md mx-auto text-center">
      <AlertCircle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Admins only</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
        The Team AI Usage dashboard is visible to team admins and super-admins only. Ask your team
        admin to grant access if you need it.
      </p>
      <Link href="/ai-usage" className="inline-block mt-4 text-sm text-indigo-600 underline">
        Go to your personal AI Usage
      </Link>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export default function TeamAiUsagePage() {
  const [data, setData] = useState<TeamAiUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [days, setDays] = useState(30)
  const [departments, setDepartments] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setForbidden(false)
      const qs = new URLSearchParams({ days: String(days) })
      if (departments.length > 0) qs.set('departments', departments.join(','))
      try {
        const res = await fetch(`/api/ai-usage/team?${qs.toString()}`)
        if (res.status === 403) {
          if (!cancelled) setForbidden(true)
          return
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to load')
        }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err: any) {
        if (!cancelled) toast.error(err.message || 'Failed to load team AI usage')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [days, departments])

  const selectedDeptName = useMemo(() => {
    if (!data || departments.length === 0) return null
    if (departments.length === 1) {
      return data.allDepartments.find(d => d.id === departments[0])?.name || null
    }
    return `${departments.length} departments`
  }, [data, departments])

  if (forbidden) return <ForbiddenState />
  if (loading && !data) return <LoadingSkeleton />

  return (
    <UpgradeGate featureKey="ai_usage">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              href="/team-management"
              className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-1"
            >
              <ArrowLeft size={12} />
              Team Management
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Team AI Usage {data?.team?.name ? <span className="text-gray-400 font-normal">· {data.team.name}</span> : null}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {selectedDeptName
                ? <>Filtered to <span className="font-medium text-gray-700 dark:text-gray-300">{selectedDeptName}</span>. Adoption telemetry, not a productivity ranking.</>
                : <>Claude Code adoption across your team. Adoption telemetry, not a productivity ranking.</>
              }
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data && data.allDepartments.length > 0 && (
              <select
                value={departments[0] || ''}
                onChange={(e) => setDepartments(e.target.value ? [e.target.value] : [])}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white max-w-[220px]"
              >
                <option value="">All departments</option>
                {data.allDepartments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>

        <PrivacyNote />

        {!data ? null : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Cpu} label="Sessions" value={data.summary.totalSessions.toString()} color="text-indigo-500" />
              <StatCard
                icon={Users}
                label="Active users"
                value={`${data.summary.activeUsers}/${data.summary.eligibleUsers}`}
                sub={`${data.summary.adoptionRate}% adoption`}
                color="text-emerald-500"
              />
              <StatCard icon={Hash} label="Tokens" value={formatCompact(data.summary.totalTokens)} color="text-violet-500" />
              <StatCard
                icon={Sparkles}
                label="Adoption rate"
                value={`${data.summary.adoptionRate}%`}
                sub={`across ${data.summary.eligibleUsers} people`}
                color="text-amber-500"
              />
            </div>

            {/* Daily usage */}
            {data.summary.totalSessions > 0 && (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Daily sessions</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    <Clock size={11} className="inline -mt-0.5 mr-1" />
                    Last {data.summary.days} days
                  </span>
                </div>
                <UsageSparkline data={data.dailyUsage} />
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
                  <span>{data.dailyUsage[0]?.date}</span>
                  <span>{data.dailyUsage[data.dailyUsage.length - 1]?.date}</span>
                </div>
              </div>
            )}

            {/* Adoption Opportunities — always visible (standing nudge list) */}
            <AdoptionOpportunities
              users={data.adoptionOpportunities}
              departments={data.allDepartments}
            />

            {/* Department breakdown — show when no department filter is active OR show per-dept summary */}
            {departments.length === 0 && data.byDepartment.length > 0 && (
              <DepartmentBreakdown departments={data.byDepartment} />
            )}

            {/* Per-model / per-tool */}
            {(data.byModel.length > 0 || data.byTool.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.byModel.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">By model</h3>
                    <div className="space-y-1.5">
                      {data.byModel.slice(0, 6).map(m => (
                        <div key={m.model} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300 truncate">{m.model}</span>
                          <span className="text-gray-500 dark:text-gray-400 tabular-nums">{m.sessions}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.byTool.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">By tool</h3>
                    <div className="space-y-1.5">
                      {data.byTool.slice(0, 6).map(t => (
                        <div key={t.tool} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300">{t.tool}</span>
                          <span className="text-gray-500 dark:text-gray-400 tabular-nums">{t.sessions}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Full team table */}
            <UserTable users={data.users} />
          </>
        )}
      </div>
    </UpgradeGate>
  )
}
