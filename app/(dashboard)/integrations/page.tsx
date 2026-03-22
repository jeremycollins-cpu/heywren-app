'use client'
 
import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Zap, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
 
interface Integration {
  id: string
  provider: string
  created_at: string
  config: Record<string, any>
}
 
const availableIntegrations = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Monitor conversations for commitments',
    color: '#4A154B',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="white"/>
      </svg>
    ),
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    description: 'Track emails and calendar events',
    color: '#0078D4',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M24 7.387v10.478c0 .23-.08.424-.238.583a.793.793 0 01-.584.238h-8.322V6.566h8.322c.228 0 .422.08.584.238.159.16.238.353.238.583zm-10.903-2.58v14.387L0 16.454V7.546l13.097-2.74z" fill="white"/>
        <path d="M8.322 9.652a3.045 3.045 0 00-1.194.242 3.077 3.077 0 00-1.015.675 3.131 3.131 0 00-.686 1.025 3.157 3.157 0 00-.25 1.253c0 .434.084.845.25 1.234.167.388.396.727.686 1.017.29.29.627.517 1.015.682.387.165.78.248 1.178.248.398 0 .79-.083 1.177-.248a3.098 3.098 0 001.016-.682c.29-.29.519-.629.686-1.017a3.072 3.072 0 00.25-1.234c0-.44-.083-.855-.25-1.253a3.132 3.132 0 00-.686-1.025 3.077 3.077 0 00-1.016-.675 3.023 3.023 0 00-1.161-.242zm0 4.986a1.807 1.807 0 01-1.312-.543 1.835 1.835 0 01-.547-1.343c0-.526.182-.974.547-1.343a1.807 1.807 0 011.312-.543c.511 0 .949.181 1.312.543.364.369.547.817.547 1.343s-.183.974-.547 1.343a1.807 1.807 0 01-1.312.543z" fill="white"/>
      </svg>
    ),
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Sync tasks and projects',
    color: '#F06A6A',
    icon: <span className="text-white font-bold text-sm">A</span>,
    comingSoon: true,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Track issues and sprints',
    color: '#0052CC',
    icon: <span className="text-white font-bold text-sm">J</span>,
    comingSoon: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Track meetings and events',
    color: '#4285F4',
    icon: <span className="text-white font-bold text-sm">G</span>,
    comingSoon: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Monitor email commitments',
    color: '#EA4335',
    icon: <span className="text-white font-bold text-sm">G</span>,
    comingSoon: true,
  },
]
 
function IntegrationsContent() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
 
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
 
    // Show success toast if just connected
    if (searchParams.get('status') === 'success') {
      toast.success('Integration connected successfully!')
    }
  }, [supabase, searchParams])
 
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
 
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`
    window.location.href = authUrl
  }
 
  const handleOutlookConnect = () => {
    const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`
    const state = Buffer.from(JSON.stringify({ redirect: 'dashboard' })).toString('base64')
    const scopes = [
      'openid',
      'profile',
      'email',
      'Mail.Read',
      'Calendars.Read',
      'User.Read',
      'offline_access',
    ].join(' ')
 
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&response_mode=query`
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
 
  const handleConnect = (integrationId: string) => {
    if (integrationId === 'slack') {
      handleSlackConnect()
    } else if (integrationId === 'outlook') {
      handleOutlookConnect()
    }
  }
 
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading integrations...</p>
      </div>
    )
  }
 
  const liveIntegrations = availableIntegrations.filter(i => !i.comingSoon)
  const futureIntegrations = availableIntegrations.filter(i => i.comingSoon)
 
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Integrations</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Connect your tools to improve commitment detection and follow-through
        </p>
      </div>
 
      {/* Connected Count */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 mb-1">Connected Integrations</p>
            <p className="text-3xl font-bold text-gray-900">{integrations.length}</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
            <Zap className="w-6 h-6 text-indigo-600" />
          </div>
        </div>
      </div>
 
      {/* Live Integrations */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">Available Now</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liveIntegrations.map((integration) => {
            const connected = isConnected(integration.id)
            return (
              <div
                key={integration.id}
                className={`border rounded-xl p-5 transition-all ${
                  connected
                    ? 'bg-green-50 border-green-200'
                    : 'bg-white border-gray-200 hover:border-indigo-200 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: integration.color }}>
                    {integration.icon}
                  </div>
                  {connected && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">{integration.name}</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4">{integration.description}</p>
 
                {connected ? (
                  <button
                    onClick={() => {
                      const integ = integrations.find((i) => i.provider === integration.id)
                      if (integ) handleDisconnect(integ.id)
                    }}
                    className="w-full px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition font-medium text-sm"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(integration.id)}
                    className="w-full px-4 py-2 text-white rounded-lg transition font-medium text-sm"
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                      boxShadow: '0 2px 8px rgba(79, 70, 229, 0.15)',
                    }}
                  >
                    Connect
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
 
      {/* Coming Soon */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Coming Soon</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {futureIntegrations.map((integration) => (
            <div
              key={integration.id}
              className="border border-gray-100 rounded-lg p-4 bg-gray-50/50"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center opacity-60" style={{ background: integration.color }}>
                  {integration.icon}
                </div>
                <h3 className="font-medium text-gray-600 text-sm">{integration.name}</h3>
              </div>
              <p className="text-xs text-gray-400">{integration.description}</p>
            </div>
          ))}
        </div>
      </div>
 
      {/* Connected Details */}
      {integrations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Your Connections</h2>
          <div className="space-y-3">
            {integrations.map((integration) => {
              const details = availableIntegrations.find(a => a.id === integration.provider)
              return (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 bg-green-50 border border-green-100 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: details?.color }}>
                      {details?.icon}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm capitalize">{integration.provider}</p>
                      <p className="text-xs text-gray-500">
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
 
      {/* Info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-5">
        <h3 className="font-semibold text-indigo-900 text-sm mb-2">Why connect integrations?</h3>
        <p className="text-xs text-indigo-700 leading-relaxed">
          More data sources means better commitment detection, more accurate AI coaching, and a complete picture of your follow-through across all channels. HeyWren uses read-only OAuth — your data stays private and secure.
        </p>
      </div>
    </div>
  )
}
 
export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>}>
      <IntegrationsContent />
    </Suspense>
  )
}
