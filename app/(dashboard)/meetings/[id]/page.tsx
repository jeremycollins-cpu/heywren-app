'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Bird, CheckCircle2, Circle, Clock, FileText,
  Loader2, MessageSquare, AlertTriangle, Lightbulb, Users,
  Video, Monitor, Send, ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface MeetingSummary {
  summary: string
  keyTopics: Array<{ topic: string; detail: string }>
  decisionsMade: Array<{ decision: string; context?: string; owner?: string }>
  openQuestions: Array<{ question: string; context?: string }>
  participantHighlights: Array<{ name: string; contribution: string }>
  meetingSentiment: 'positive' | 'neutral' | 'tense' | 'mixed'
}

interface Commitment {
  id: string
  title: string
  description: string
  status: string
  priority_score: number
  due_date: string | null
  metadata: any
  created_at: string
}

interface Draft {
  id: string
  commitment_id: string
  subject: string
  body: string
  recipient_name: string | null
  status: string
  created_at: string
}

interface TranscriptSegment {
  speaker?: string
  text: string
  start_s?: number
  end_s?: number
}

export default function MeetingDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [transcript, setTranscript] = useState<any>(null)
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [botSession, setBotSession] = useState<any>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [transcriptSearch, setTranscriptSearch] = useState('')

  useEffect(() => {
    fetchMeeting()
  }, [id])

  async function fetchMeeting() {
    try {
      const res = await fetch(`/api/meetings/${id}`)
      if (!res.ok) {
        toast.error('Meeting not found')
        router.push('/meetings')
        return
      }
      const data = await res.json()
      setTranscript(data.transcript)
      setCommitments(data.commitments || [])
      setDrafts(data.drafts || [])
      setBotSession(data.botSession)
    } catch {
      toast.error('Failed to load meeting')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (!transcript) return null

  const summary: MeetingSummary | null = transcript.summary_json
  const segments: TranscriptSegment[] = transcript.transcript_segments || []
  const providerLabels: Record<string, string> = {
    recall_bot: 'HeyWren Notetaker',
    zoom: 'Zoom',
    google_meet: 'Google Meet',
    teams: 'Teams',
    manual: 'Manual Upload',
    chrome_extension: 'Live Capture',
  }
  const providerLabel = providerLabels[transcript.provider as string] || transcript.provider

  const sentimentColors = {
    positive: 'bg-green-50 text-green-700',
    neutral: 'bg-gray-50 text-gray-700',
    tense: 'bg-red-50 text-red-700',
    mixed: 'bg-yellow-50 text-yellow-700',
  }

  // Filter transcript segments by search
  const filteredSegments = transcriptSearch
    ? segments.filter((s) =>
        s.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ||
        s.speaker?.toLowerCase().includes(transcriptSearch.toLowerCase())
      )
    : segments

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ${mins % 60}m`
  }

  function formatTimestamp(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push('/meetings')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Meetings
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
              {transcript.title || 'Untitled Meeting'}
            </h1>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500">
              {transcript.provider === 'recall_bot' ? (
                <span className="inline-flex items-center gap-1 text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full text-xs font-medium">
                  <Bird className="w-3 h-3" /> {providerLabel}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full text-xs font-medium">
                  <Video className="w-3 h-3" /> {providerLabel}
                </span>
              )}
              {transcript.start_time && (
                <span>{new Date(transcript.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              )}
              {transcript.duration_minutes && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {transcript.duration_minutes}m
                </span>
              )}
              {botSession?.attendee_count && (
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> {botSession.attendee_count} attendees
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {transcript.hey_wren_triggers > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded-full font-medium">
                <Bird className="w-3 h-3" /> {transcript.hey_wren_triggers} trigger{transcript.hey_wren_triggers !== 1 ? 's' : ''}
              </span>
            )}
            <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full font-medium">
              {commitments.length} commitment{commitments.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {summary ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> AI Meeting Summary
            </h2>
            {summary.meetingSentiment && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sentimentColors[summary.meetingSentiment]}`}>
                {summary.meetingSentiment}
              </span>
            )}
          </div>
          <div className="p-6 space-y-5">
            {/* Summary */}
            <p className="text-sm text-gray-700 leading-relaxed">{summary.summary}</p>

            {/* Key Topics */}
            {summary.keyTopics.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key Topics</h3>
                <div className="space-y-2">
                  {summary.keyTopics.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-indigo-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                      <div>
                        <span className="text-sm font-medium text-gray-900">{t.topic}</span>
                        <span className="text-sm text-gray-500 ml-1">— {t.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decisions Made */}
            {summary.decisionsMade.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Decisions Made</h3>
                <div className="space-y-2">
                  {summary.decisionsMade.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 bg-green-50 rounded-lg p-3">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-900">{d.decision}</p>
                        {d.owner && <p className="text-xs text-gray-500 mt-0.5">Owner: {d.owner}</p>}
                        {d.context && <p className="text-xs text-gray-500 mt-0.5">{d.context}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Open Questions */}
            {summary.openQuestions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Open Questions</h3>
                <div className="space-y-2">
                  {summary.openQuestions.map((q, i) => (
                    <div key={i} className="flex items-start gap-2 bg-yellow-50 rounded-lg p-3">
                      <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-900">{q.question}</p>
                        {q.context && <p className="text-xs text-gray-500 mt-0.5">{q.context}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Participant Highlights */}
            {summary.participantHighlights.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Participant Highlights</h3>
                <div className="space-y-2">
                  {summary.participantHighlights.map((p, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Lightbulb className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-700">
                        <span className="font-medium text-gray-900">{p.name}</span> — {p.contribution}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : transcript.transcript_status === 'processing' ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Generating meeting summary...</p>
        </div>
      ) : null}

      {/* Action Items / Commitments */}
      {commitments.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700">Action Items</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {commitments.map((c) => {
              const draft = drafts.find((d) => d.commitment_id === c.id)
              const isHeyWren = c.metadata?.heyWrenTrigger
              return (
                <div key={c.id} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {c.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                      ) : (
                        <Circle className="w-4 h-4 text-gray-300 mt-0.5" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">{c.title}</p>
                          {isHeyWren && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full font-medium">
                              <Bird className="w-2.5 h-2.5" /> Hey Wren
                            </span>
                          )}
                        </div>
                        {c.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          {c.due_date && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Due {new Date(c.due_date).toLocaleDateString()}
                            </span>
                          )}
                          {c.metadata?.stakeholders?.[0]?.name && (
                            <span>Assigned to: {c.metadata.stakeholders[0].name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {draft && draft.status === 'ready' && (
                      <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-medium">
                        <Send className="w-3 h-3" /> Draft ready
                      </span>
                    )}
                  </div>
                  {c.metadata?.originalQuote && (
                    <div className="ml-7 mt-2 text-xs text-gray-400 italic border-l-2 border-gray-200 pl-3">
                      &quot;{c.metadata.originalQuote}&quot;
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Follow-Up Drafts */}
      {drafts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Follow-Up Drafts
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {drafts.map((d) => (
              <div key={d.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-gray-900">{d.subject}</p>
                  {d.recipient_name && (
                    <span className="text-xs text-gray-500">To: {d.recipient_name}</span>
                  )}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="w-full px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition"
        >
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Full Transcript
            {segments.length > 0 && (
              <span className="text-xs font-normal text-gray-400">({segments.length} segments)</span>
            )}
          </h2>
          {showTranscript ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showTranscript && (
          <div>
            {/* Search */}
            <div className="px-6 py-3 border-b border-gray-100">
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search transcript..."
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Segments */}
            <div className="max-h-[600px] overflow-y-auto">
              {segments.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {filteredSegments.map((seg, i) => (
                    <div key={i} className="px-6 py-2 hover:bg-gray-50 flex gap-3">
                      {seg.start_s !== undefined && (
                        <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0 pt-0.5">
                          {formatTimestamp(seg.start_s)}
                        </span>
                      )}
                      <div>
                        {seg.speaker && (
                          <span className="text-xs font-semibold text-indigo-600">{seg.speaker}</span>
                        )}
                        <p className="text-sm text-gray-700">{seg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-4">
                  <p className="text-sm text-gray-600 whitespace-pre-line font-mono leading-relaxed">
                    {transcript.transcript_text}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
