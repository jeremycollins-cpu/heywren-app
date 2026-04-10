'use client'

import { useEffect, useState } from 'react'
import { Bird, Loader2, Save, Info } from 'lucide-react'
import toast from 'react-hot-toast'

interface NotetakerSettings {
  auto_record_enabled: boolean
  min_attendees: number
  bot_display_name: string
  notetaker_plan: string
  free_meetings_limit: number
  meetings_recorded_this_month: number
}

export default function NotetakerSettingsPage() {
  const [settings, setSettings] = useState<NotetakerSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings/notetaker')
      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings)
      }
    } catch {
      toast.error('Failed to load notetaker settings')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings/notetaker', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_record_enabled: settings.auto_record_enabled,
          min_attendees: settings.min_attendees,
          bot_display_name: settings.bot_display_name,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings)
        toast.success('Notetaker settings saved')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (!settings) return null

  const usagePercent = settings.notetaker_plan === 'free'
    ? Math.min(100, (settings.meetings_recorded_this_month / settings.free_meetings_limit) * 100)
    : 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
          Notetaker Settings
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Configure the HeyWren Notetaker bot that auto-joins your meetings
        </p>
      </div>

      {/* Auto-Record Toggle */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <Bird className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Auto-Record Meetings</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Automatically send HeyWren Notetaker to eligible meetings
              </p>
            </div>
          </div>
          <button
            onClick={() => setSettings({ ...settings, auto_record_enabled: !settings.auto_record_enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              settings.auto_record_enabled ? 'bg-indigo-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition transform ${
                settings.auto_record_enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Minimum Attendees */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Minimum Attendees to Record
          </label>
          <div className="flex items-center gap-3">
            <select
              value={settings.min_attendees}
              onChange={(e) => setSettings({ ...settings, min_attendees: parseInt(e.target.value) })}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value={2}>2+ people (all meetings)</option>
              <option value={3}>3+ people (skip 1:1s)</option>
              <option value={4}>4+ people (only group meetings)</option>
              <option value={5}>5+ people (only large meetings)</option>
            </select>
          </div>
          <div className="flex items-start gap-1.5 mt-2">
            <Info className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-500">
              We recommend <strong>3+ attendees</strong> to avoid the awkwardness of recording 1:1 conversations.
              The bot only joins meetings with a valid Zoom, Google Meet, or Teams link.
            </p>
          </div>
        </div>

        {/* Bot Display Name */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Bot Display Name</label>
          <input
            type="text"
            value={settings.bot_display_name}
            onChange={(e) => setSettings({ ...settings, bot_display_name: e.target.value })}
            placeholder="HeyWren Notetaker"
            maxLength={50}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">
            This is how the bot appears in the meeting participant list.
          </p>
        </div>
      </div>

      {/* Usage */}
      {settings.notetaker_plan === 'free' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Usage This Month</h3>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {settings.meetings_recorded_this_month} / {settings.free_meetings_limit} free meetings
            </span>
            <span className="text-xs text-gray-400">
              {settings.free_meetings_limit - settings.meetings_recorded_this_month} remaining
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {usagePercent >= 100 && (
            <p className="text-xs text-amber-600 mt-2 font-medium">
              You&apos;ve used all your free meetings this month. Upgrade to Unlimited for $19/month to record all eligible meetings.
            </p>
          )}
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          }}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  )
}
