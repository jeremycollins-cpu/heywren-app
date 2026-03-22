'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface Integration {
  id: string
  provider: string
  created_at: string
  config: Record<string, any>
}

const availableIntegrations = [
  { id: 'slack', name: 'Slack', icon: '💬', description: 'Monitor conversations for commitments', color: 'bg-blue-50 border-blue-200' },
  { id: 'outlook', name: 'Outlook', icon: '📧', description: 'Track emails and calendar events', color: 'bg-cyan-50 border-cyan-200' },
  { id: 'asana', name: 'Asana', icon: '✓', description: 'Sync tasks and projects', color: 'bg-blue-50 border-blue-200' },
  { id: 'jira', name: 'Jira', icon: '⚙️', description: 'Track issues and sprints', color: 'bg-indigo-50 border-indigo-200' },
  { id: 'confluence', name: 'Confluence', icon: '📄', description: 'Monitor documentation updates', color: 'bg-blue-50 border-blue-200' },
  { id: 'salesforce', name: 'Salesforce', icon: '📊', description: 'Track deals and opportunities', color: 'bg-blue-50 border-blue-200' },
]

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const { data } = await supabase
          .from('integrations')
          .select('*')
          .order('created_at', { ascending: false })

        setIntegrations(data || [])
      } catch (err) {
        console.error('Error fetching integrations:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchIntegrations()
  }, [supabase])

  const handleSlackConnect = () => {
    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/connect`
    const scopes = [
      'chat:write',
      'channels:read',
      'users:read',
      'team:read',
      'emoji:read',
    ].join(',')

    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`

    window.location.href = authUrl
  }

  const handleDisconnect = async (id: string) => {
    const { error } = await supabase
      .from('integrations')
      .delete()
      .eq('id', id)

    if (!error) {
      setIntegrations(integrations.filter((i) => i.id !== id))
      toast.success('Integration disconnected')
    } else {
      toast.error('Failed to disconnect')
    }
  }

  const isConnected = (provider: string) => {
    return integrations.some((i) => i.provider === provider)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading integrations...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
        <p className="text-gray-600 mt-1">
          Manage connected tools — add more sources to improve follow-through quality
        </p>
      </div>

      {/* Connected Count */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 mb-1">Connected Integrations</p>
            <p className="text-3xl font-bold text-gray-900">{integrations.length}/{availableIntegrations.length}</p>
          </div>
          <Zap className="w-12 h-12 text-indigo-100" />
        </div>
      </div>

      {/* Available Integrations */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableIntegrations.map((integration) => {
            const connected = isConnected(integration.id)
            return (
              <div
                key={integration.id}
                className={`border-2 rounded-lg p-6 transition-all ${
                  connected
                    ? 'bg-green-50 border-green-300'
                    : integration.color + ' border'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl">{integration.icon}</div>
                  {connected && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                </div>
                <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                <p className="text-sm text-gray-600 mt-1 mb-4">{integration.description}</p>

                {connected ? (
                  <button
                    onClick={() => {
                      const integ = integrations.find((i) => i.provider === integration.id)
                      if (integ) handleDisconnect(integ.id)
                    }}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (integration.id === 'slack') {
                        handleSlackConnect()
                      } else {
                        toast.error('Coming soon!')
                      }
                    }}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium disabled:opacity-50"
                    disabled={integration.id !== 'slack'}
                  >
                    {integration.id === 'slack' ? 'Connect' : 'Coming Soon'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Integration Details */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 mb-3">Why Connect Integrations?</h3>
        <ul className="text-sm text-indigo-800 space-y-2">
          <li>✓ <strong>Better Detection:</strong> More data sources = more accurate commitment detection</li>
          <li>✓ <strong>Real-Time Sync:</strong> Commitments auto-sync from your connected tools</li>
          <li>✓ <strong>Unified View:</strong> See all commitments in one place, regardless of source</li>
          <li>✓ <strong>Smart Coaching:</strong> AI coaches have more context to provide better insights</li>
          <li>✓ <strong>Automated Handoffs:</strong> Ensure nothing falls through the cracks on PTO</li>
        </ul>
      </div>

      {/* Connected Details */}
      {integrations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Connections</h2>
          <div className="space-y-3">
            {integrations.map((integration) => {
              const details = availableIntegrations.find(a => a.id === integration.provider)
              return (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{details?.icon}</span>
                    <div>
                      <p className="font-medium text-gray-900 capitalize">{integration.provider}</p>
                      <p className="text-xs text-gray-600">
                        Connected {new Date(integration.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
