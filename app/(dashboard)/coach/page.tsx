// app/(dashboard)/coach/page.tsx
// AI-powered Communication Coach — personalized insights from Claude

'use client'

import { useEffect, useState, useCallback } from 'react'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import {
  CheckCircle2,
  X,
  Target,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Clock,
  MessageSquare,
  Users,
  Zap,
  BarChart3,
  Minus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface CoachingInsight {
  id: string
  category: 'responsiveness' | 'tone' | 'follow_through' | 'relationship' | 'workload' | 'communication_style'
  categoryLabel?: string
  priority: 'critical' | 'high' | 'medium' | 'growth'
  title: string
  description: string
  evidence?: string
  evidenceAttribution?: string
  action: string
  metric?: { label: string; value: string; trend?: 'up' | 'down' | 'stable' }
  researchBasis?: string
}

interface CommunicationProfile {
  avgResponseTimeHours: number
  responseTimeByUrgency: Record<string, number>
  dominantTone: string
  toneDistribution: Record<string, number>
  topStakeholders: Array<{ name: string; interactions: number; openCommitments: number }>
  completionRate: number
  avgCompletionDays: number
  commitmentVolume: { weekly: number; trend: 'increasing' | 'decreasing' | 'stable' }
  commonCommitmentTypes: Record<string, number>
  missedEmailRate: number
  peakActivityHours: number[]
}

interface CachedCoachData {
  insights: CoachingInsight[]
  profile: CommunicationProfile
  generatedAt: string
}

const CACHE_KEY = 'coach-ai-insights'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function getCachedData(): CachedCoachData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedCoachData
    const age = Date.now() - new Date(cached.generatedAt).getTime()
    if (age > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return cached
  } catch {
    return null
  }
}

function setCachedData(data: CachedCoachData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {}
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const priorityConfig = {
  critical: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400', dot: 'bg-red-500', icon: AlertTriangle },
  high: { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400', dot: 'bg-orange-500', icon: Target },
  medium: { border: 'border-l-yellow-500', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400', dot: 'bg-yellow-500', icon: TrendingUp },
  growth: { border: 'border-l-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400', dot: 'bg-green-500', icon: Sparkles },
}

const categoryConfig: Record<string, { label: string; icon: typeof Clock }> = {
  responsiveness: { label: 'Responsiveness', icon: Clock },
  tone: { label: 'Tone', icon: MessageSquare },
  follow_through: { label: 'Follow-through', icon: CheckCircle2 },
  relationship: { label: 'Relationships', icon: Users },
  workload: { label: 'Workload', icon: BarChart3 },
  communication_style: { label: 'Communication Style', icon: Zap },
}

function TrendArrow({ trend }: { trend?: 'up' | 'down' | 'stable' }) {
  if (!trend) return null
  if (trend === 'up') return <TrendingUp className="w-3.5 h-3.5 text-green-500" />
  if (trend === 'down') return <TrendingDown className="w-3.5 h-3.5 text-red-500" />
  return <Minus className="w-3.5 h-3.5 text-gray-400" />
}

function ResponseGauge({ hours }: { hours: number }) {
  // Gauge: <4h = great, 4-12h = good, 12-24h = fair, 24+ = slow
  let color = 'text-green-600'
  let label = 'Fast'
  if (hours > 24) { color = 'text-red-600'; label = 'Slow' }
  else if (hours > 12) { color = 'text-amber-600'; label = 'Fair' }
  else if (hours > 4) { color = 'text-blue-600'; label = 'Good' }

  const display = hours < 1 ? '<1h' : hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`

  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{display}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}

function VolumeTrendLabel({ trend }: { trend: 'increasing' | 'decreasing' | 'stable' }) {
  if (trend === 'increasing') return <span className="text-amber-600 flex items-center gap-0.5"><TrendingUp className="w-3 h-3" /> increasing</span>
  if (trend === 'decreasing') return <span className="text-blue-600 flex items-center gap-0.5"><TrendingDown className="w-3 h-3" /> decreasing</span>
  return <span className="text-gray-400 flex items-center gap-0.5"><Minus className="w-3 h-3" /> stable</span>
}

export default function CoachPage() {
  const [insights, setInsights] = useState<CoachingInsight[]>([])
  const [profile, setProfile] = useState<CommunicationProfile | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set())

  // Load persisted dismiss/accept state from localStorage
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem('coach-dismissed')
      const accepted = localStorage.getItem('coach-accepted')
      if (dismissed) setDismissedIds(new Set(JSON.parse(dismissed)))
      if (accepted) setAcceptedIds(new Set(JSON.parse(accepted)))
    } catch {}
  }, [])

  const fetchInsights = useCallback(async (skipCache = false) => {
    try {
      // Check cache first (unless forcing refresh)
      if (!skipCache) {
        const cached = getCachedData()
        if (cached) {
          setInsights(cached.insights)
          setProfile(cached.profile)
          setGeneratedAt(cached.generatedAt)
          setLoading(false)
          return
        }
      }

      if (!loading) setRefreshing(true)

      const res = await fetch('/api/coach', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to generate insights (${res.status})`)
      }

      const data = await res.json()
      const coachData: CachedCoachData = {
        insights: data.insights || [],
        profile: data.profile,
        generatedAt: data.generatedAt,
      }

      setCachedData(coachData)
      setInsights(coachData.insights)
      setProfile(coachData.profile)
      setGeneratedAt(coachData.generatedAt)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load coaching insights'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loading])

  useEffect(() => {
    fetchInsights()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = () => {
    setError(null)
    fetchInsights(true)
  }

  const dismissInsight = (id: string) => {
    const next = new Set(dismissedIds)
    next.add(id)
    setDismissedIds(next)
    localStorage.setItem('coach-dismissed', JSON.stringify([...next]))
    toast('Insight dismissed', { icon: '\u{1F44D}' })
  }

  const acceptInsight = (id: string) => {
    const next = new Set(acceptedIds)
    next.add(id)
    setAcceptedIds(next)
    localStorage.setItem('coach-accepted', JSON.stringify([...next]))
    toast.success('Challenge accepted! Track your progress this week.')
  }

  const resetDismissed = () => {
    setDismissedIds(new Set())
    setAcceptedIds(new Set())
    localStorage.removeItem('coach-dismissed')
    localStorage.removeItem('coach-accepted')
  }

  if (loading) {
    return <LoadingSkeleton variant="card" />
  }

  const activeInsights = insights.filter(i => !dismissedIds.has(i.id))
  const acceptedInsights = activeInsights.filter(i => acceptedIds.has(i.id))
  const pendingInsights = activeInsights.filter(i => !acceptedIds.has(i.id))
  const dismissedCount = insights.length - activeInsights.length

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your Communication Profile</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">AI-powered coaching based on your real communication patterns</p>
        </div>
        <div className="flex items-center gap-3">
          {generatedAt && (
            <span className="text-xs text-gray-400">
              Last analyzed: {timeAgo(generatedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Analyzing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Communication Profile Summary */}
      {profile && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Response Speed
            </p>
            <ResponseGauge hours={profile.avgResponseTimeHours} />
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Follow-through Rate
            </p>
            <div className="flex items-center gap-2">
              <p className={`text-2xl font-bold ${profile.completionRate >= 70 ? 'text-green-600' : profile.completionRate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                {profile.completionRate}%
              </p>
              <VolumeTrendLabel trend={profile.commitmentVolume.trend} />
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {profile.completionRate >= 70 ? 'Top tier' : profile.completionRate >= 40 ? 'Room to grow' : 'Needs attention'}
            </p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
              <BarChart3 className="w-3 h-3" /> Active Commitments
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{profile.commitmentVolume.weekly}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">this week</p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Communication Style
            </p>
            <p className="text-2xl font-bold text-indigo-600 capitalize">{profile.dominantTone}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">dominant tone</p>
          </div>
        </div>
      )}

      {/* Coach Header Card */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-violet-950/50 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Wren Coach</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {activeInsights.length} personalized insight{activeInsights.length !== 1 ? 's' : ''} generated by AI
              </div>
            </div>
          </div>
          {dismissedCount > 0 && (
            <button
              onClick={resetDismissed}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Show {dismissedCount} dismissed
            </button>
          )}
        </div>
      </div>

      {/* Accepted challenges */}
      {acceptedInsights.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-indigo-600" />
            Your Active Challenges
          </h2>
          <div className="space-y-2">
            {acceptedInsights.map(insight => {
              const catConfig = categoryConfig[insight.category]
              return (
                <div key={insight.id} className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800/50 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {catConfig && (
                        <span className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 uppercase tracking-wide">
                          {catConfig.label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{insight.title}</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">{insight.action}</p>
                  </div>
                  {insight.metric && (
                    <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                      <div>
                        <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{insight.metric.value}</p>
                        <p className="text-[10px] text-gray-400">{insight.metric.label}</p>
                      </div>
                      <TrendArrow trend={insight.metric.trend} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Strategic Coaching Insights */}
      <div className="space-y-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Strategic Coaching Insights</h2>
        {pendingInsights.map(insight => {
          const config = priorityConfig[insight.priority]
          const isCritical = insight.priority === 'critical' || insight.priority === 'high'

          return (
            <article key={insight.id} className={`bg-white dark:bg-surface-dark-secondary rounded-xl p-6 transition ${
              isCritical
                ? 'border-2 border-dashed border-red-300 dark:border-red-700'
                : 'border border-gray-200 dark:border-border-dark'
            }`}>
              {/* Category label + dismiss */}
              <div className="flex items-start justify-between mb-3">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${config.badge}`}>
                  {insight.categoryLabel || insight.priority}
                </span>
                <button
                  onClick={() => dismissInsight(insight.id)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded"
                  title="Dismiss this insight"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Title */}
              <h3 className="font-bold text-gray-900 dark:text-white text-lg mb-3">{insight.title}</h3>

              {/* Description */}
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-4">{insight.description}</p>

              {/* Evidence / YOUR OWN WORDS quote */}
              {insight.evidence && (
                <div className="mb-4">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">
                    {insight.evidenceAttribution ? 'Your own words' : 'Evidence from this week'}
                  </div>
                  <div className="border-l-3 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded-r-lg px-4 py-3">
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic leading-relaxed">
                      &ldquo;{insight.evidence}&rdquo;
                    </p>
                    {insight.evidenceAttribution && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        — {insight.evidenceAttribution}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Action recommendation — highlighted box */}
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border-l-3 border-indigo-500 rounded-r-lg px-4 py-3 mb-4">
                <p className="text-sm leading-relaxed">
                  <span className="font-bold text-indigo-800 dark:text-indigo-300">Action: </span>
                  <span className="text-indigo-900 dark:text-indigo-200">{insight.action}</span>
                </p>
              </div>

              {/* Metric + Research */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {insight.metric && (
                    <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-semibold text-gray-900 dark:text-white">{insight.metric.value}</span>
                      {insight.metric.label}
                      <TrendArrow trend={insight.metric.trend} />
                    </span>
                  )}
                  {insight.researchBasis && (
                    <p className="text-xs italic text-gray-400 dark:text-gray-500">
                      {insight.researchBasis}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => acceptInsight(insight.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  <Target className="w-3.5 h-3.5" />
                  Accept Challenge
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {/* Empty state */}
      {pendingInsights.length === 0 && acceptedInsights.length === 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">All caught up!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {dismissedCount > 0
              ? `You've dismissed ${dismissedCount} insight${dismissedCount > 1 ? 's' : ''}. Hit refresh or check back later for new AI-generated insights.`
              : 'New insights will be generated as Wren analyzes more of your communication patterns.'}
          </p>
        </div>
      )}
    </div>
  )
}
