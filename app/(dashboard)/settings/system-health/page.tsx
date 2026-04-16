'use client'

import { useEffect, useState } from 'react'
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, Loader2,
  RefreshCw, XCircle, Clock, Mail, Target, Link2,
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

interface HealthData {
  dataFlow: {
    lastCommitmentAt: string | null
    commitmentAgeHours: number | null
    lastEmailAt: string | null
    emailAgeHours: number | null
    stuckEmailBacklog: number
  }
  pipelines: PipelineHealth[]
  integrations: Array<{
    provider: string
    expiresAt: string | null
    expired: boolean
    canRefresh: boolean
    status: string
  }>
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
  const hours = Math.round(ms / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
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

  if (loading) return <LoadingSkeleton variant="list" />
  if (!data) return null

  const { dataFlow, pipelines, integrations, recentErrors } = data

  const hasBroken = pipelines.some(p => p.status === 'broken')
  const hasStale = pipelines.some(p => p.status === 'stale')
  const commitmentIsStale = dataFlow.commitmentAgeHours !== null && dataFlow.commitmentAgeHours > 72
  const overallOk = !hasBroken && !hasStale && !commitmentIsStale

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            System Health
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Are Wren&apos;s background jobs running? When did data last flow in?
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Overall banner */}
      <div
        className={`rounded-xl border p-5 ${
          overallOk
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : hasBroken || commitmentIsStale
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        }`}
      >
        <div className="flex items-start gap-3">
          {overallOk ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          ) : hasBroken || commitmentIsStale ? (
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {overallOk
                ? 'All pipelines healthy'
                : hasBroken
                  ? 'One or more pipelines are broken'
                  : commitmentIsStale
                    ? 'No new commitments in 3+ days'
                    : 'Some pipelines are running behind'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {overallOk
                ? 'Data is flowing and AI jobs ran recently.'
                : 'See the details below and check the Errors section for specific failures.'}
            </p>
          </div>
        </div>
      </div>

      {/* Data flow */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Data flow
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <FlowCard
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
          <FlowCard
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
          <FlowCard
            Icon={AlertCircle}
            label="Stuck in backlog"
            value={`${dataFlow.stuckEmailBacklog} email${dataFlow.stuckEmailBacklog === 1 ? '' : 's'}`}
            tone={dataFlow.stuckEmailBacklog > 100 ? 'red' : dataFlow.stuckEmailBacklog > 20 ? 'amber' : 'green'}
          />
        </div>
      </div>

      {/* Pipelines */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          AI pipelines
        </h2>
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
                    <div className="flex items-center gap-2">
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
                  <div className="text-right text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 space-y-0.5">
                    <div>Last run: {formatRelative(p.lastRunAt)}</div>
                    <div>{p.itemsLast24h} items in 24h</div>
                    <div>{p.apiCallsLast24h} API calls</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Integrations */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Integrations
        </h2>
        <div className="space-y-2">
          {integrations.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No integrations connected.</p>
          )}
          {integrations.map(i => (
            <div
              key={i.provider}
              className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Link2 className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white text-sm capitalize">{i.provider}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {i.expired
                      ? i.canRefresh
                        ? 'Token expired — will refresh on next run'
                        : 'Token expired — reconnect required'
                      : i.expiresAt
                        ? `Token expires ${formatRelative(i.expiresAt)}`
                        : 'Connected'}
                  </div>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
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
      </div>

      {/* Recent errors */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Recent errors (24h)
        </h2>
        {recentErrors.length === 0 ? (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No errors in the last 24 hours.</p>
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
      </div>
    </div>
  )
}

function FlowCard({ Icon, label, value, tone }: { Icon: any; label: string; value: string; tone: 'green' | 'amber' | 'red' }) {
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
