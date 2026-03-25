'use client'

import { useEffect, useState } from 'react'
import { Mic, Upload, FileText, Clock, AlertCircle, CheckCircle2, Loader2, Bird, Video, Monitor, Chrome, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

interface TranscriptRecord {
  id: string
  title: string
  provider: string
  start_time: string
  transcript_status: string
  commitments_found: number
  hey_wren_triggers: number
  created_at: string
}

export default function MeetingsPage() {
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [title, setTitle] = useState('')
  const [transcriptText, setTranscriptText] = useState('')

  useEffect(() => {
    fetchTranscripts()
  }, [])

  async function fetchTranscripts() {
    try {
      const res = await fetch('/api/meetings/list')
      if (res.ok) {
        const data = await res.json()
        setTranscripts(data.transcripts || [])
      }
    } catch (err) {
      console.error('Failed to fetch transcripts:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload() {
    if (!transcriptText.trim()) {
      toast.error('Please paste a meeting transcript')
      return
    }

    if (transcriptText.trim().length < 50) {
      toast.error('Transcript is too short (minimum 50 characters)')
      return
    }

    setUploading(true)
    try {
      const res = await fetch('/api/meetings/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || 'Untitled Meeting',
          transcript_text: transcriptText,
          provider: 'manual',
        }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success('Transcript uploaded! Processing commitments...')
        setTitle('')
        setTranscriptText('')
        setShowUpload(false)
        // Refresh list after a brief delay for processing
        setTimeout(fetchTranscripts, 2000)
      } else {
        toast.error(data.error || 'Upload failed')
      }
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
            Meetings
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload meeting transcripts to detect commitments and action items
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 px-4 py-2 text-white rounded-lg font-medium text-sm transition"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 2px 8px rgba(79, 70, 229, 0.15)',
          }}
        >
          <Upload className="w-4 h-4" />
          Upload Transcript
        </button>
      </div>

      {/* Platform Sync Callout */}
      <div className="bg-gradient-to-r from-blue-50 to-teal-50 border border-blue-200 rounded-xl p-5 mb-0">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <RefreshCw className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 text-sm">Auto-sync from Zoom, Google Meet &amp; Teams</h3>
            <p className="text-xs text-blue-700 mt-1 leading-relaxed">
              Connect your meeting platforms in <a href="/integrations" className="underline font-medium">Integrations</a> to automatically pull recording transcripts. Or install the <strong>HeyWren Chrome Extension</strong> to capture live captions from any browser meeting.
            </p>
          </div>
        </div>
      </div>

      {/* Hey Wren Feature Callout */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <Bird className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-indigo-900 text-sm">Say &quot;Hey Wren&quot; in your meetings</h3>
            <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
              During any meeting, say <strong>&quot;Hey Wren&quot;</strong> followed by a commitment or action item, and we&apos;ll automatically flag it with high priority. Examples:
            </p>
            <ul className="text-xs text-indigo-700 mt-2 space-y-1">
              <li>&quot;Hey Wren, I&apos;ll send the budget report by Friday&quot;</li>
              <li>&quot;Hey Wren, Sarah committed to reviewing the designs by next week&quot;</li>
              <li>&quot;Hey Wren, remind me to follow up with the vendor&quot;</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">Upload Meeting Transcript</h2>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Meeting Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Weekly Product Standup"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Transcript Text
              <span className="text-gray-400 font-normal ml-1">(paste from Zoom, Teams, Otter, etc.)</span>
            </label>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              placeholder="Paste your meeting transcript here...&#10;&#10;Speaker 1: Let's discuss the Q3 roadmap...&#10;Speaker 2: I'll have the mockups ready by Friday.&#10;Speaker 1: Hey Wren, remember to follow up on the vendor contract..."
              rows={12}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
            />
            <p className="text-xs text-gray-400 mt-1">
              {transcriptText.length > 0 && (
                <span>{transcriptText.split(/\s+/).filter(Boolean).length} words</span>
              )}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleUpload}
              disabled={uploading || !transcriptText.trim()}
              className="flex items-center gap-2 px-4 py-2 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              }}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  Analyze Transcript
                </>
              )}
            </button>
            <button
              onClick={() => setShowUpload(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transcript List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      ) : transcripts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="font-semibold text-gray-900 text-sm">No meeting transcripts yet</h3>
          <p className="text-xs text-gray-500 mt-1">
            Upload a transcript to start detecting commitments from your meetings.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700">Recent Transcripts</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {transcripts.map((t) => (
              <div key={t.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  {statusIcon(t.transcript_status)}
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{t.title || 'Untitled Meeting'}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.provider === 'manual' && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Upload className="w-3 h-3" /> Manual upload
                        </span>
                      )}
                      {t.provider === 'zoom' && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">
                          <Video className="w-3 h-3" /> Zoom
                        </span>
                      )}
                      {t.provider === 'google_meet' && (
                        <span className="inline-flex items-center gap-1 text-xs text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded-full font-medium">
                          <Monitor className="w-3 h-3" /> Google Meet
                        </span>
                      )}
                      {t.provider === 'teams' && (
                        <span className="inline-flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full font-medium">
                          <Monitor className="w-3 h-3" /> Teams
                        </span>
                      )}
                      {t.provider === 'chrome_extension' && (
                        <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full font-medium">
                          <Chrome className="w-3 h-3" /> Live capture
                        </span>
                      )}
                      {t.start_time && (
                        <span className="text-xs text-gray-400">
                          {new Date(t.start_time).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {t.hey_wren_triggers > 0 && (
                    <span className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 rounded-full font-medium">
                      <Bird className="w-3 h-3" />
                      {t.hey_wren_triggers} trigger{t.hey_wren_triggers !== 1 ? 's' : ''}
                    </span>
                  )}
                  {t.commitments_found > 0 && (
                    <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full font-medium">
                      {t.commitments_found} commitment{t.commitments_found !== 1 ? 's' : ''}
                    </span>
                  )}
                  {t.transcript_status === 'processing' && (
                    <span className="text-blue-500">Processing...</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
