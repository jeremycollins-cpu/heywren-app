'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { Zap, CheckCircle2, Shield, ChevronDown, ChevronUp, Copy, ExternalLink, Mic, Video, Chrome, Monitor } from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Integration {
  id: string
  provider: string
  created_at?: string
  config?: Record<string, any>
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
    id: 'zoom',
    name: 'Zoom',
    description: 'Auto-sync cloud recording transcripts for commitment detection',
    color: '#2D8CFF',
    icon: <Video className="w-5 h-5 text-white" />,
  },
  {
    id: 'google_meet',
    name: 'Google Meet',
    description: 'Pull meeting transcripts from Google Workspace recordings',
    color: '#00897B',
    icon: <Monitor className="w-5 h-5 text-white" />,
  },
  {
    id: 'meetings',
    name: 'Meeting Transcripts',
    description: 'Upload transcripts to detect commitments. Say "Hey Wren" in meetings!',
    color: '#7c3aed',
    icon: <Mic className="w-5 h-5 text-white" />,
    isPage: true,
    pageUrl: '/meetings',
  },
  {
    id: 'chrome-extension',
    name: 'Chrome Extension',
    description: 'Capture live captions from any meeting in your browser (Meet, Zoom, Teams)',
    color: '#4f46e5',
    icon: <Chrome className="w-5 h-5 text-white" />,
    isPage: true,
    pageUrl: '/settings?tab=extension',
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
    id: 'gmail',
    name: 'Gmail',
    description: 'Monitor email commitments',
    color: '#EA4335',
    icon: <span className="text-white font-bold text-sm">G</span>,
    comingSoon: true,
  },
]

const OUTLOOK_ADMIN_CONSENT_URL = `https://login.microsoftonline.com/common/adminconsent?client_id=${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || '328441fc-bec2-4dcc-a9b6-0910b84d3ffe'}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai')}`

function ITApprovalGuide({ showSlack, showOutlook }: { showSlack: boolean; showOutlook: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    toast.success(`${label} copied!`)
    setTimeout(() => setCopied(null), 3000)
  }

  const tools = [showSlack && 'Slack', showOutlook && 'Outlook'].filter(Boolean).join(' and ')

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 text-left"
      >
        <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-amber-900 text-sm">Need admin approval to connect {tools}?</p>
          <p className="text-xs text-amber-700 mt-1">
            Most organizations require a workspace or IT admin to approve new apps before employees can connect. This is normal and usually only takes a few minutes.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600 flex-shrink-0 mt-1" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 flex-shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 ml-8 space-y-5">
          {/* General Steps */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="text-sm font-medium text-amber-900">Click &quot;Connect&quot; on the integration above</p>
                <p className="text-xs text-amber-700 mt-0.5">You&apos;ll be redirected to Slack or Microsoft&apos;s authorization page</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="text-sm font-medium text-amber-900">If you see &quot;Approval required&quot; or &quot;Request to install&quot; — submit the request</p>
                <p className="text-xs text-amber-700 mt-0.5">Add a message like: &quot;I need HeyWren to track my commitments and follow-ups.&quot; Your admin will be notified.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="text-sm font-medium text-amber-900">Once approved, come back and click &quot;Connect&quot; again</p>
                <p className="text-xs text-amber-700 mt-0.5">After your admin approves the app, connecting will work instantly</p>
              </div>
            </div>
          </div>

          {/* Slack-specific guidance */}
          {showSlack && (
            <div className="bg-white border border-amber-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: '#4A154B' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="white"/></svg>
                </div>
                <p className="text-xs font-semibold text-amber-900">For Slack workspace admins</p>
              </div>
              <p className="text-xs text-amber-700">
                A Slack workspace admin needs to approve HeyWren in the <strong>Slack Admin Dashboard → Manage Apps</strong>. Once approved, all workspace members can connect instantly.
              </p>
            </div>
          )}

          {/* Outlook-specific guidance */}
          {showOutlook && (
            <div className="bg-white border border-amber-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: '#0078D4' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M24 7.387v10.478c0 .23-.08.424-.238.583a.793.793 0 01-.584.238h-8.322V6.566h8.322c.228 0 .422.08.584.238.159.16.238.353.238.583z" fill="white"/></svg>
                </div>
                <p className="text-xs font-semibold text-amber-900">For Microsoft 365 / IT admins</p>
              </div>
              <p className="text-xs text-amber-700">
                Share this link with your IT admin to grant organization-wide access in one click. HeyWren only requests <strong>read-only</strong> permissions — we never send emails or modify calendars.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(OUTLOOK_ADMIN_CONSENT_URL, 'Admin consent link')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg text-xs font-medium text-amber-900 transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied === 'Admin consent link' ? 'Copied!' : 'Copy admin consent link'}
                </button>
                <a
                  href={OUTLOOK_ADMIN_CONSENT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-amber-50 border border-amber-300 rounded-lg text-xs font-medium text-amber-900 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open link
                </a>
              </div>
            </div>
          )}

          <div className="bg-amber-100/50 rounded-lg p-3">
            <p className="text-xs text-amber-800">
              <strong>What permissions does HeyWren need?</strong> Read-only access to your messages, email, and calendar so we can detect commitments and follow-ups. We never send messages, emails, or modify your calendar on your behalf. <a href="https://heywren.ai/security" target="_blank" rel="noopener noreferrer" className="underline font-medium">Learn more about our security practices →</a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function IntegrationsContent() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    async function fetchIntegrations() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setLoading(false); return }

        // Query integrations directly via client-side Supabase
        let teamId: string | null = null

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()
        teamId = profile?.current_team_id || null

        if (!teamId) {
          const { data: membership } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('user_id', userData.user.id)
            .limit(1)
            .single()
          teamId = membership?.team_id || null
        }

        if (teamId) {
          const { data: intData } = await supabase
            .from('integrations')
            .select('id, provider, config')
            .eq('team_id', teamId)
            .eq('user_id', userData.user.id)
          setIntegrations(intData || [])
        }
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
  }, [])

  const handleSlackConnect = async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      toast.error('Please log in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/connect`
    const scopes = [
      'channels:read',
      'channels:history',
      'channels:join',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'chat:write',
      'users:read',
      'team:read',
    ].join(',')

    const state = btoa(JSON.stringify({ userId: userData.user.id, redirect: 'dashboard' }))
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
    window.location.href = authUrl
  }

  const handleOutlookConnect = async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      toast.error('Please log in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`
    const state = btoa(JSON.stringify({ userId: userData.user.id, redirect: 'dashboard' }))
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

  const handleZoomConnect = async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      toast.error('Please log in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_ZOOM_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/zoom/connect`
    const state = btoa(JSON.stringify({ userId: userData.user.id, redirect: 'dashboard' }))

    const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
    window.location.href = authUrl
  }

  const handleGoogleMeetConnect = async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      toast.error('Please log in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google/connect`
    const state = btoa(JSON.stringify({ userId: userData.user.id, redirect: 'dashboard' }))
    const scopes = [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive.readonly',
    ].join(' ')

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&access_type=offline&prompt=consent`
    window.location.href = authUrl
  }

  const handleDisconnect = async (id: string) => {
    try {
      const res = await fetch('/api/integrations/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (res.ok) {
        setIntegrations(integrations.filter((i) => i.id !== id))
        toast.success('Integration disconnected')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to disconnect')
      }
    } catch {
      toast.error('Failed to disconnect')
    }
  }

  const isConnected = (provider: string) => {
    return integrations.some((i) => i.provider === provider)
  }

  const handleConnect = (integrationId: string, pageUrl?: string) => {
    if (pageUrl) {
      router.push(pageUrl)
      return
    }
    if (integrationId === 'slack') {
      handleSlackConnect()
    } else if (integrationId === 'outlook') {
      handleOutlookConnect()
    } else if (integrationId === 'zoom') {
      handleZoomConnect()
    } else if (integrationId === 'google_meet') {
      handleGoogleMeetConnect()
    }
  }

  if (loading) {
    return <LoadingSkeleton variant="card" />
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
                    onClick={() => handleConnect(integration.id, (integration as any).pageUrl)}
                    className="w-full px-4 py-2 text-white rounded-lg transition font-medium text-sm"
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                      boxShadow: '0 2px 8px rgba(79, 70, 229, 0.15)',
                    }}
                  >
                    {(integration as any).isPage ? 'Open' : 'Connect'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* IT Approval Guidance */}
      {(!isConnected('slack') || !isConnected('outlook')) && (
        <ITApprovalGuide showSlack={!isConnected('slack')} showOutlook={!isConnected('outlook')} />
      )}

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
                        Connected {integration.created_at ? new Date(integration.created_at).toLocaleDateString() : ''}
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
