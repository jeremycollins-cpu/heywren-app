'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, Mail } from 'lucide-react'
import toast from 'react-hot-toast'

type SyncResult = {
  channels_processed?: number
  total_channels?: number
  messages_scanned?: number
  emails_scanned?: number
  commitments_detected: number
  duration_seconds: number
  pages_processed?: number
  errors?: string[]
}

export default function SyncClient() {
  const [syncingSlack, setSyncingSlack] = useState(false)
  const [syncingOutlook, setSyncingOutlook] = useState(false)
  const [slackResult, setSlackResult] = useState<SyncResult | null>(null)
  const [outlookResult, setOutlookResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const handleSlackSync = async () => {
    setSyncingSlack(true)
    setSlackResult(null)
    setError(null)

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) {
        setError('Not authenticated. Please log in again.')
        setSyncingSlack(false)
        return
      }

      toast('Syncing Slack history... This may take a few minutes.', { icon: '🔄' })

      const response = await fetch('/api/integrations/slack/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          daysBack: 30,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Slack sync failed')
        toast.error(data.error || 'Slack sync failed')
      } else {
        setSlackResult(data.summary)
        toast.success('Slack sync complete! Found ' + data.summary.commitments_detected + ' commitments.')
      }
    } catch (err) {
      setError('Network error. Please try again.')
      toast.error('Network error')
    } finally {
      setSyncingSlack(false)
    }
  }

  const handleOutlookSync = async () => {
    setSyncingOutlook(true)
    setOutlookResult(null)
    setError(null)

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) {
        setError('Not authenticated. Please log in again.')
        setSyncingOutlook(false)
        return
      }

      toast('Syncing Outlook emails... This may take a few minutes.', { icon: '📧' })

      const response = await fetch('/api/integrations/outlook/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          daysBack: 30,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Outlook sync failed')
        toast.error(data.error || 'Outlook sync failed')
      } else {
        setOutlookResult(data.summary)
        toast.success('Outlook sync complete! Found ' + data.summary.commitments_detected + ' commitments.')
      }
    } catch (err) {
      setError('Network error. Please try again.')
      toast.error('Network error')
    } finally {
      setSyncingOutlook(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
          Sync History
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Pull in your message history and scan for commitments, tasks, and follow-ups
        </p>
      </div>

      {/* Slack Sync Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: '#4A154B' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="white"/>
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Slack History Sync</h2>
            <p className="text-sm text-gray-500 mt-1">
              Scans public channels, private channels, and DMs from the last 30 days.
              Uses AI to find commitments, promises, deadlines, and tasks.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSlackSync}
            disabled={syncingSlack}
            className="inline-flex items-center gap-2 px-6 py-3 text-white rounded-lg transition font-medium text-sm disabled:opacity-60"
            style={{
              background: syncingSlack ? '#9CA3AF' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              boxShadow: syncingSlack ? 'none' : '0 2px 8px rgba(79, 70, 229, 0.25)',
            }}
          >
            {syncingSlack ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing Slack... (this may take a few minutes)
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Sync Slack — Last 30 Days
              </>
            )}
          </button>
        </div>

        {slackResult && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-green-900 text-sm">Slack Sync Complete</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-bold text-green-900">{slackResult.channels_processed}</p>
                <p className="text-xs text-green-700">Channels scanned</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-900">{slackResult.messages_scanned}</p>
                <p className="text-xs text-green-700">Messages analyzed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-900">{slackResult.commitments_detected}</p>
                <p className="text-xs text-green-700">Commitments found</p>
              </div>
            </div>
            {slackResult.errors && slackResult.errors.length > 0 && (
              <div className="mt-3 text-xs text-yellow-700">
                <p className="font-medium">Some channels had issues:</p>
                {slackResult.errors.map((e: string, i: number) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Outlook Sync Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: '#0078D4' }}>
            <Mail className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Outlook Email & Calendar Sync</h2>
            <p className="text-sm text-gray-500 mt-1">
              Scans your inbox emails from the last 30 days.
              Uses AI to find commitments, promises, deadlines, and action items from emails.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleOutlookSync}
            disabled={syncingOutlook}
            className="inline-flex items-center gap-2 px-6 py-3 text-white rounded-lg transition font-medium text-sm disabled:opacity-60"
            style={{
              background: syncingOutlook ? '#9CA3AF' : 'linear-gradient(135deg, #0078D4 0%, #005A9E 100%)',
              boxShadow: syncingOutlook ? 'none' : '0 2px 8px rgba(0, 120, 212, 0.25)',
            }}
          >
            {syncingOutlook ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing Outlook... (this may take a few minutes)
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                Sync Outlook — Last 30 Days
              </>
            )}
          </button>
        </div>

        {outlookResult && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-green-900 text-sm">Outlook Sync Complete</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-bold text-green-900">{outlookResult.pages_processed}</p>
                <p className="text-xs text-green-700">Pages fetched</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-900">{outlookResult.emails_scanned}</p>
                <p className="text-xs text-green-700">Emails analyzed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-900">{outlookResult.commitments_detected}</p>
                <p className="text-xs text-green-700">Commitments found</p>
              </div>
            </div>
            {outlookResult.errors && outlookResult.errors.length > 0 && (
              <div className="mt-3 text-xs text-yellow-700">
                <p className="font-medium">Some issues occurred:</p>
                {outlookResult.errors.map((e: string, i: number) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-5">
        <h3 className="font-semibold text-indigo-900 text-sm mb-2">How it works</h3>
        <p className="text-xs text-indigo-700 leading-relaxed">
          HeyWren reads messages from your connected Slack channels and Outlook inbox.
          Each message is analyzed by AI to detect commitments, promises, and tasks.
          Results appear on your Dashboard and Commitments page. HeyWren only has read
          access — it never posts, sends, or modifies anything in Slack or Outlook.
        </p>
      </div>
    </div>
  )
}
