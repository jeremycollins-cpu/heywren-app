'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, Loader2,
  RefreshCw, XCircle, Clock, Mail, Target, Link2, MessageSquare,
  CalendarDays, Database, TrendingUp, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

type PipelineStatus = 'healthy' | 'stale' | 'broken' | 'unknown'

interface PipelineHealth {
  name: string
  description: string
  status: PipelineStatus
  lastRunAt: string | null
  lastRunAgeHours: number | null
  itemsLast24h: number
  apiCallsLast24h: number
  recentErrors: number
  note: string | null
}

interface Integration {
  provider: string
  connectedAt: string | null
  lastSyncAt: string | null
  expiresAt: string | null
  expired: boolean
  canRefresh: boolean
  status: string
}

interface HealthData {
  dataFlow: {
    lastCommitmentAt: string | null
    commitmentAgeHours: number | null
    lastEmailAt: string | null
    emailAgeHours: number | null
    stuckEmailBacklog: number
  }
  dataVolume: {
    emails: number
    slackMessages: number
    slackLinked: boolean
    calendarEvents: number
  }
  coverage: {
    total: number
    open: number
    completed: number
    thisWeek: number
    followThroughRate: number | null
  }
  pipelines: PipelineHealth[]
  integrations: Integration[]
  recentErrors: Array<{
    id: string
    source: string
    message: string
    severity: string
    error_key: string | null
    created_at: string
  }>
}

const statusStyle: Record<PipelineStatus, { bg: string; text: string; Icon: any; label: string }> = {
  healthy: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', Icon: CheckCircle2, label: 'Healthy' },
  stale: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', Icon: Clock, label: 'Stale' },
  broken: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', Icon: XCircle, label: 'Broken' },
  unknown: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', Icon: AlertCircle, label: 'Unknown' },
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

const PROVIDER_LABEL: Record<string, string> = {
  slack: 'Slack',
  outlook: 'Outlook',
  teams: 'Teams',
  asana: 'Asana',
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/system-health')
      if (!res.ok) throw new Error('Failed')
      setData(await res.json())
    } catch {
      toast.error('Failed to load system health')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // Derived diagnostics — the "check engine" list of actionable issues.
  const issues = useMemo(() => {
    if (!data) return [] as Array<{ severity: 'red' | 'amber'; title: string; detail: string; cta?: { label: string; href: string } }>
    const out: Array<{ severity: 'red' | 'amber'; title: string; detail: string; cta?: { label: string; href: string } }> = []

    const brokenPipelines = data.pipelines.filter(p => p.status === 'broken')
    for (const p of brokenPipelines) {
      out.push({
        severity: 'red',
        title: `${p.name} is broken`,
        detail: p.note || 'Pipeline has not run recently.',
      })
    }

    const stalePipelines = data.pipelines.filter(p => p.status === 'stale')
    for (const p of stalePipelines) {
      out.push({
        severity: 'amber',
        title: `${p.name} is running behind`,
        detail: p.note || 'Pipeline last ran longer ago than expected.',
      })
    }

    if (data.dataFlow.commitmentAgeHours !== null && data.dataFlow.commitmentAgeHours > 72) {
      out.push({
        severity: 'red',
        title: 'No new commitments in 3+ days',
        detail: `Last commitment detected ${formatRelative(data.dataFlow.lastCommitmentAt)}.`,
      })
    }
    if (data.dataFlow.emailAgeHours !== null && data.dataFlow.emailAgeHours > 24) {
      out.push({
        severity: 'amber',
        title: 'Email sync is behind',
        detail: `Last email synced ${formatRelative(data.dataFlow.lastEmailAt)}.`,
      })
    }
    if (data.dataFlow.stuckEmailBacklog > 100) {
      out.push({
        severity: 'red',
        title: 'Email backlog is large',
        detail: `${data.dataFlow.stuckEmailBacklog} emails waiting to be processed.`,
      })
    } else if (data.dataFlow.stuckEmailBacklog > 20) {
      out.push({
        severity: 'amber',
        title: 'Emails are queuing up',
        detail: `${data.dataFlow.stuckEmailBacklog} emails haven't been processed yet.`,
      })
    }

    for (const i of data.integrations) {
      if (i.status === 'reconnect_required') {
        out.push({
          severity: 'red',
          title: `${PROVIDER_LABEL[i.provider] || i.provider} reconnection required`,
          detail: 'The access token has expired and can\'t be refreshed automatically.',
          cta: { label: 'Reconnect', href: '/integrations' },
        })
      }
    }

    if (data.integrations.length === 0) {
      out.push({
        severity: 'amber',
        title: 'No integrations connected',
        detail: 'Connect Slack or Outlook to start capturing commitments.',
        cta: { label: 'Connect a source', href: '/integrations' },
      })
    }

    return out
  }, [data])

  const overall = useMemo(() => {
    if (!data) return { tone: 'green' as const, label: 'Checking…', detail: '' }
    const hasRed = issues.some(i => i.severity === 'red')
    const hasAmber = issues.some(i => i.severity === 'amber')
    if (hasRed) return { tone: 'red' as const, label: `${issues.length} issue${issues.length === 1 ? '' : 's'} need attention`, detail: 'See the diagnostic checklist below for what to fix first.' }
    if (hasAmber) return { tone: 'amber' as const, label: `${issues.length} warning${issues.length === 1 ? '' : 's'}`, detail: 'Nothing broken, but a few things are running behind.' }
    return { tone: 'green' as const, label: 'All systems operational', detail: 'Data is flowing and AI pipelines ran recently.' }
  }, [data, issues])

  if (loading) return <LoadingSkeleton variant="list" />
  if (!data) return null

  const { dataFlow, dataVolume, coverage, pipelines, integrations, recentErrors } = data

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            System Health
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Your check-engine light. Whether data is flowing, pipelines are running, and where to look when something&apos;s off.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 flex-shrink-0"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Overall status hero */}
      <OverallHero tone={overall.tone} label={overall.label} detail={overall.detail} issueCount={issues.length} />

      {/* Diagnostic checklist */}
      {issues.length > 0 && (
        <Section title="What needs attention">
          <div className="space-y-2">
            {issues.map((issue, idx) => (
              <div
                key={idx}
                className={`rounded-xl border p-4 flex items-start gap-3 ${
                  issue.severity === 'red'
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50'
                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/50'
                }`}
              >
                {issue.severity === 'red' ? (
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{issue.title}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{issue.detail}</p>
                </div>
                {issue.cta && (
                  <Link
                    href={issue.cta.href}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-white dark:text-gray-900 rounded-lg hover:opacity-90 transition"
                  >
                    {issue.cta.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Data flow */}
      <Section
        title="Data flow"
        subtitle="When did data last reach HeyWren?"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            Icon={Target}
            label="Last commitment"
            value={formatRelative(dataFlow.lastCommitmentAt)}
            tone={
              dataFlow.commitmentAgeHours === null || dataFlow.commitmentAgeHours > 72
                ? 'red'
                : dataFlow.commitmentAgeHours > 24
                  ? 'amber'
                  : 'green'
            }
          />
          <MetricCard
            Icon={Mail}
            label="Last email synced"
            value={formatRelative(dataFlow.lastEmailAt)}
            tone={
              dataFlow.emailAgeHours === null || dataFlow.emailAgeHours > 24
                ? 'red'
                : dataFlow.emailAgeHours > 6
                  ? 'amber'
                  : 'green'
            }
          />
          <MetricCard
            Icon={AlertCircle}
            label="Stuck in backlog"
            value={`${dataFlow.stuckEmailBacklog.toLocaleString()} email${dataFlow.stuckEmailBacklog === 1 ? '' : 's'}`}
            tone={dataFlow.stuckEmailBacklog > 100 ? 'red' : dataFlow.stuckEmailBacklog > 20 ? 'amber' : 'green'}
          />
        </div>
      </Section>

      {/* Data volume */}
      <Section
        title="Data volume"
        subtitle="How much HeyWren has pulled in for you"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <VolumeCard Icon={Mail} label="Emails" count={dataVolume.emails} hint="in Outlook mirror" />
          <VolumeCard
            Icon={MessageSquare}
            label="Slack messages"
            count={dataVolume.slackMessages}
            hint={dataVolume.slackLinked ? 'authored by you' : 'Slack user not linked yet'}
            muted={!dataVolume.slackLinked}
          />
          <VolumeCard Icon={CalendarDays} label="Calendar events" count={dataVolume.calendarEvents} hint="from Outlook calendar" />
          <VolumeCard
            Icon={Target}
            label="Commitments tracked"
            count={coverage.total}
            hint={
              coverage.followThroughRate !== null
                ? `${coverage.followThroughRate}% follow-through`
                : 'none yet'
            }
          />
        </div>
        {coverage.total > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <MiniStat label="Open" value={coverage.open.toString()} Icon={Clock} />
            <MiniStat label="Completed" value={coverage.completed.toString()} Icon={CheckCircle2} />
            <MiniStat label="New this week" value={coverage.thisWeek.toString()} Icon={TrendingUp} />
          </div>
        )}
      </Section>

      {/* AI pipelines */}
      <Section title="AI pipelines" subtitle="Background jobs that process your data">
        <div className="space-y-2">
          {pipelines.map(p => {
            const s = statusStyle[p.status]
            return (
              <div
                key={p.name}
                className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${s.bg} ${s.text}`}>
                        <s.Icon className="w-3 h-3" />
                        {s.label}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">{p.name}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.description}</p>
                    {p.note && (
                      <p className={`text-xs mt-2 ${p.status === 'broken' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {p.note}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 space-y-0.5 min-w-[140px]">
                    <div>Last run: <span className="text-gray-900 dark:text-gray-200">{formatRelative(p.lastRunAt)}</span></div>
                    <div>{p.itemsLast24h.toLocaleString()} items in 24h</div>
                    <div>{p.apiCallsLast24h.toLocaleString()} API calls</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Integrations */}
      <Section title="Integrations" subtitle="Connected sources and their token status">
        {integrations.length === 0 ? (
          <EmptyState
            Icon={Link2}
            title="No integrations connected"
            detail="Connect Slack or Outlook so HeyWren can capture commitments."
            cta={{ label: 'Connect a source', href: '/integrations' }}
          />
        ) : (
          <div className="space-y-2">
            {integrations.map(i => (
              <div
                key={i.provider}
                className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    i.provider === 'slack' ? 'bg-[#4A154B]' :
                    i.provider === 'outlook' ? 'bg-[#0078D4]' :
                    'bg-gray-400'
                  }`}>
                    {i.provider === 'slack' ? (
                      <MessageSquare className="w-4 h-4 text-white" />
                    ) : i.provider === 'outlook' ? (
                      <Mail className="w-4 h-4 text-white" />
                    ) : (
                      <Zap className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white text-sm">{PROVIDER_LABEL[i.provider] || i.provider}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {i.connectedAt ? `Connected ${formatRelative(i.connectedAt)}` : 'Connected'}
                      {i.lastSyncAt && <> · last sync {formatRelative(i.lastSyncAt)}</>}
                      {i.expired
                        ? i.canRefresh
                          ? ' · token refreshing on next run'
                          : ' · token expired — reconnect required'
                        : i.expiresAt
                          ? ` · token renews ${formatRelative(i.expiresAt)}`
                          : ''}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-xs font-semibold flex-shrink-0 ${
                    i.status === 'reconnect_required'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      : i.status === 'refreshing'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  }`}
                >
                  {i.status === 'reconnect_required' ? 'Reconnect' : i.status === 'refreshing' ? 'Refreshing' : 'Connected'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent errors */}
      <Section title="Recent errors" subtitle="Logged in the last 24 hours">
        {recentErrors.length === 0 ? (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Nothing to show — no errors in the last 24 hours.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentErrors.map(e => (
              <div
                key={e.id}
                className={`border rounded-xl p-3 ${
                  e.severity === 'critical'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : e.severity === 'error'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold uppercase text-gray-700 dark:text-gray-300">{e.severity}</span>
                      <span className="text-gray-500 dark:text-gray-400">{e.source}</span>
                    </div>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-1 break-words">{e.message}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatRelative(e.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function OverallHero({ tone, label, detail, issueCount }: { tone: 'green' | 'amber' | 'red'; label: string; detail: string; issueCount: number }) {
  const palette =
    tone === 'green'
      ? { bg: 'from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10', border: 'border-green-200 dark:border-green-900/50', ring: 'text-green-600 dark:text-green-400', Icon: CheckCircle2 }
      : tone === 'amber'
        ? { bg: 'from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10', border: 'border-amber-200 dark:border-amber-900/50', ring: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle }
        : { bg: 'from-red-50 to-orange-50 dark:from-red-900/10 dark:to-orange-900/10', border: 'border-red-200 dark:border-red-900/50', ring: 'text-red-600 dark:text-red-400', Icon: XCircle }
  const { Icon } = palette
  return (
    <div className={`bg-gradient-to-br ${palette.bg} border ${palette.border} rounded-2xl p-6`}>
      <div className="flex items-center gap-5">
        <div className={`w-14 h-14 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm ${palette.ring}`}>
          <Icon className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={`text-xl font-bold ${palette.ring}`}>{label}</h2>
            {issueCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/70 dark:bg-black/30 ${palette.ring}`}>
                {issueCount}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ Icon, label, value, tone }: { Icon: any; label: string; value: string; tone: 'green' | 'amber' | 'red' }) {
  const toneClass =
    tone === 'green'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-xl font-bold mt-2 ${toneClass}`}>{value}</div>
    </div>
  )
}

function VolumeCard({ Icon, label, count, hint, muted }: { Icon: any; label: string; count: number; hint?: string; muted?: boolean }) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-bold mt-2 ${muted ? 'text-gray-400 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>
        {muted ? '—' : formatCount(count)}
      </div>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function MiniStat({ Icon, label, value }: { Icon: any; label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg px-3 py-2 flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
      </div>
    </div>
  )
}

function EmptyState({ Icon, title, detail, cta }: { Icon: any; title: string; detail: string; cta?: { label: string; href: string } }) {
  return (
    <div className="bg-white dark:bg-surface-dark-secondary border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 mb-3">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{detail}</p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
        >
          <Database className="w-3 h-3" />
          {cta.label}
        </Link>
      )}
    </div>
  )
}
