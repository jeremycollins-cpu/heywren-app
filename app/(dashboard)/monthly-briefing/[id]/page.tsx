'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, RotateCw, Sparkles, AlertTriangle, FileText, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import UpgradeGate from '@/components/upgrade-gate'
import type {
  BriefingMessage, BriefingSection, BriefingUpload, MonthlyBriefing,
} from '@/lib/monthly-briefing/types'
import SectionCard from './section-card'
import RefineChat from './refine-chat'
import UploadsPanel from './uploads-panel'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
function periodLabel(periodStart: string): string {
  const d = new Date(periodStart + 'T00:00:00Z')
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export default function MonthlyBriefingDetailPage() {
  return (
    <UpgradeGate featureKey="monthly_briefing">
      <Detail />
    </UpgradeGate>
  )
}

interface DetailState {
  briefing: MonthlyBriefing | null
  sections: BriefingSection[]
  uploads: BriefingUpload[]
  messages: BriefingMessage[]
}

function Detail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const briefingId = params.id

  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<DetailState>({
    briefing: null, sections: [], uploads: [], messages: [],
  })
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const fetchBriefing = async () => {
    try {
      const res = await fetch(`/api/monthly-briefing/${briefingId}`)
      if (res.status === 404) {
        toast.error('Briefing not found.')
        router.push('/monthly-briefing')
        return
      }
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not load briefing.')
        return
      }
      setState({
        briefing: json.briefing,
        sections: json.sections || [],
        uploads: json.uploads || [],
        messages: json.messages || [],
      })
      if (!activeSectionId && json.sections?.length) {
        setActiveSectionId(json.sections[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBriefing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingId])

  // Poll while generation is in progress or uploads are being extracted.
  const inFlight = useMemo(() => {
    if (!state.briefing) return false
    const genInFlight = ['pending', 'aggregating', 'extracting', 'synthesizing'].includes(state.briefing.status)
    const uploadsExtracting = state.uploads.some(u =>
      u.extraction_status === 'pending' || u.extraction_status === 'extracting'
    )
    return genInFlight || uploadsExtracting
  }, [state.briefing, state.uploads])

  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(fetchBriefing, 4_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight])

  const activeSection = useMemo(
    () => state.sections.find(s => s.id === activeSectionId) || null,
    [state.sections, activeSectionId],
  )

  // ── Mutation helpers (applied to local state by child components) ──
  const upsertSection = (section: BriefingSection) => {
    setState(prev => {
      const exists = prev.sections.some(s => s.id === section.id)
      return {
        ...prev,
        sections: exists
          ? prev.sections.map(s => (s.id === section.id ? section : s))
          : [...prev.sections, section],
      }
    })
    setActiveSectionId(section.id)
  }
  const removeSection = (sectionId: string) => {
    setState(prev => ({ ...prev, sections: prev.sections.filter(s => s.id !== sectionId) }))
    if (activeSectionId === sectionId) setActiveSectionId(null)
  }
  const addUpload = (upload: BriefingUpload) => setState(prev => ({ ...prev, uploads: [...prev.uploads, upload] }))
  const removeUpload = (uploadId: string) => setState(prev => ({ ...prev, uploads: prev.uploads.filter(u => u.id !== uploadId) }))
  const appendMessage = (m: BriefingMessage) =>
    setState(prev => ({ ...prev, messages: [...prev.messages.filter(x => x.id !== m.id), m] }))

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const res = await fetch(`/api/monthly-briefing/${briefingId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not regenerate.')
        return
      }
      toast.success('Regenerating — pinned and edited sections are preserved.')
      fetchBriefing()
    } finally {
      setRegenerating(false)
    }
  }

  const deleteBriefing = async () => {
    if (!confirm('Delete this briefing permanently?')) return
    try {
      const res = await fetch(`/api/monthly-briefing/${briefingId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Briefing deleted.')
        router.push('/monthly-briefing')
      }
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <LoadingSkeleton />
      </div>
    )
  }

  if (!state.briefing) return null

  const b = state.briefing
  const isReady = b.status === 'ready'
  const isFailed = b.status === 'failed'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Back */}
      <Link
        href="/monthly-briefing"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        All briefings
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-violet-600" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-600">
              Monthly Briefing · {periodLabel(b.period_start)}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1" style={{ letterSpacing: '-0.025em' }}>
            {b.title || `${periodLabel(b.period_start)} Briefing`}
          </h1>
          {b.subtitle && (
            <p className="text-gray-600 dark:text-gray-300">{b.subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isReady && (
            <button
              onClick={regenerate}
              disabled={regenerating || inFlight}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg disabled:opacity-60"
            >
              {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
              Regenerate
            </button>
          )}
          <button
            onClick={deleteBriefing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status / in-progress banner */}
      {!isReady && !isFailed && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl p-4 mb-6 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Wren is working on your briefing</p>
            <p className="text-xs text-blue-700 dark:text-blue-300">{b.status_detail || 'Hang tight — this usually takes under a minute.'}</p>
          </div>
        </div>
      )}
      {isFailed && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-900 dark:text-red-100">Generation failed</p>
            <p className="text-xs text-red-700 dark:text-red-300 mb-2">{b.error_message || 'Unknown error.'}</p>
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60"
            >
              {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Sections column */}
        <div className="lg:col-span-2 space-y-3">
          {state.sections.length === 0 && isReady ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
              <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-gray-500">No sections yet. Ask Wren to add one in the chat.</p>
            </div>
          ) : (
            state.sections
              .slice()
              .sort((a, b) => a.order_index - b.order_index)
              .map(section => (
                <SectionCard
                  key={section.id}
                  briefingId={briefingId}
                  section={section}
                  active={section.id === activeSectionId}
                  onSelect={() => setActiveSectionId(section.id)}
                  onUpdated={upsertSection}
                  onDeleted={removeSection}
                />
              ))
          )}
        </div>

        {/* Side column: uploads + chat */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <UploadsPanel
            briefingId={briefingId}
            uploads={state.uploads}
            canRegenerate={isReady || isFailed}
            onAdded={addUpload}
            onRemoved={removeUpload}
            onRegenerate={regenerate}
            regenerating={regenerating}
          />
          <div className="h-[520px]">
            <RefineChat
              briefingId={briefingId}
              messages={state.messages}
              activeSection={activeSection}
              onMessageAppended={appendMessage}
              onSectionUpdated={upsertSection}
              onSectionDeleted={removeSection}
              disabled={!isReady}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
