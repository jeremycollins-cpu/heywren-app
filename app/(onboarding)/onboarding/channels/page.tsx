'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'

interface SlackChannel {
  id: string
  name: string
  is_member: boolean
}

export default function ChannelsSetupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [monitorAll, setMonitorAll] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [hasSlack, setHasSlack] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    checkSlackIntegration()
  }, [supabase])

  const checkSlackIntegration = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        router.push('/signup')
        return
      }

      // Get user's current team
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', authData.user.id)
        .single()

      if (!profile?.current_team_id) {
        setHasSlack(false)
        setInitializing(false)
        return
      }

      const { data: integrations } = await supabase
        .from('integrations')
        .select('id, provider')
        .eq('team_id', profile.current_team_id)

      const hasSlackIntegration = integrations?.some((i) => i.provider === 'slack')
      setHasSlack(!!hasSlackIntegration)

      // For demo purposes, show mock channels
      if (hasSlackIntegration) {
        const mockChannels = [
          { id: 'C001', name: 'general', is_member: true },
          { id: 'C002', name: 'team', is_member: true },
          { id: 'C003', name: 'projects', is_member: true },
          { id: 'C004', name: 'random', is_member: true },
          { id: 'C005', name: 'announcements', is_member: true },
        ]
        setChannels(mockChannels)
        setSelectedChannels(mockChannels.map((c) => c.id))
      }

      setInitializing(false)
    } catch (err) {
      console.error('Error checking integrations:', err)
      setInitializing(false)
    }
  }

  const toggleChannel = (channelId: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    )
  }

  const handleContinue = async () => {
    setLoading(true)

    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        throw new Error('Not authenticated')
      }

      // Store selected channels in preferences or config
      const { error } = await supabase
        .from('profiles')
        .update({
          onboarding_step: 'channels',
          selected_channels: selectedChannels,
        })
        .eq('id', authData.user.id)

      if (error) console.error('Error saving preferences:', error)

      toast.success('Channels saved!')
      router.push('/onboarding/invite')
    } catch (err) {
      console.error('Error:', err)
      toast.error('Failed to save preferences. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <div className="text-center">
        <p className="text-gray-500">Loading channels...</p>
      </div>
    )
  }

  if (!hasSlack) {
    return (
      <div className="space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium">
            Step 3 of 4
          </div>
          <h2 className="text-3xl font-bold text-gray-900">Choose channels to monitor</h2>
          <p className="text-gray-600 max-w-lg mx-auto">
            You'll need Slack connected to select channels. Go back and connect Slack first.
          </p>
        </div>

        <button
          onClick={() => router.back()}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all"
        >
          Go Back to Integrations
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Step Indicator */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600">
          <MessageSquare className="w-6 h-6" />
        </div>
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium">
          Step 3 of 4
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Choose channels to monitor</h2>
        <p className="text-gray-600 max-w-lg mx-auto">
          HeyWren will listen for commitments in these channels. You can change this anytime.
        </p>
      </div>

      {/* Monitor All Toggle */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-900">Monitor all public channels</p>
          <p className="text-sm text-gray-600 mt-1">Automatically monitor new channels as they're created</p>
        </div>
        <button
          onClick={() => {
            setMonitorAll(!monitorAll)
            if (!monitorAll) {
              setSelectedChannels(channels.map((c) => c.id))
            }
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            monitorAll ? 'bg-indigo-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              monitorAll ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Channels List */}
      {!monitorAll && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Select specific channels</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {channels.map((channel) => (
              <label
                key={channel.id}
                className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition"
              >
                <input
                  type="checkbox"
                  checked={selectedChannels.includes(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium text-gray-900">#{channel.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {monitorAll && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800">
          <p className="font-medium mb-1">All channels selected</p>
          <p>HeyWren will monitor all public channels in your Slack workspace.</p>
        </div>
      )}

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={loading}
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? 'Saving...' : (
          <>
            Continue
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800">
        <p className="font-medium mb-1">Pro tip</p>
        <p>Start with your most active channels. You can always add more channels later in settings.</p>
      </div>
    </div>
  )
}
