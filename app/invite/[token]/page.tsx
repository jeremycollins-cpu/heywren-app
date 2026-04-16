// app/invite/[token]/page.tsx
// Public invite acceptance page — outside the dashboard layout

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface InviteDetails {
  id: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  organization_id: string
  organization_name: string
  inviter_name: string
  department_id: string | null
  department_name: string | null
  team_id: string | null
  team_name: string | null
  expires_at: string
}

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organization Admin',
  dept_manager: 'Department Manager',
  team_lead: 'Team Lead',
  member: 'Member',
}

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [success, setSuccess] = useState(false)
  const [acceptResult, setAcceptResult] = useState<{
    organization_name: string | null
    team_name: string | null
  } | null>(null)

  const supabase = createClient()

  // Check auth status and fetch invite details
  useEffect(() => {
    async function init() {
      // Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession()
      setIsAuthenticated(!!session)

      // Fetch invite details
      try {
        const res = await fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`)
        if (!res.ok) {
          const body = await res.json()
          setError(body.error || 'Invitation not found')
          setLoading(false)
          return
        }
        const data = await res.json()
        setInvite(data.invitation)
      } catch {
        setError('Failed to load invitation details')
      }
      setLoading(false)
    }

    init()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAccept = useCallback(async () => {
    if (!invite) return

    setAccepting(true)
    setError(null)

    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to accept invitation')
        setAccepting(false)
        return
      }

      setSuccess(true)
      setAcceptResult({
        organization_name: data.organization_name,
        team_name: data.team_name,
      })

      // Redirect to dashboard after a brief delay
      setTimeout(() => {
        router.push('/')
      }, 2500)
    } catch {
      setError('An unexpected error occurred')
      setAccepting(false)
    }
  }, [invite, token, router])

  const handleSignupRedirect = useCallback(() => {
    router.push(`/signup?invite=${encodeURIComponent(token)}`)
  }, [token, router])

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-r-transparent" />
          <p className="mt-4 text-sm text-gray-500">Loading invitation...</p>
        </div>
      </div>
    )
  }

  // Error state (invite not found)
  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Invitation Not Found</h2>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
          <a
            href="/login"
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    )
  }

  // Expired or revoked invite
  if (invite && (invite.status === 'expired' || invite.status === 'revoked')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            Invitation {invite.status === 'expired' ? 'Expired' : 'Revoked'}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {invite.status === 'expired'
              ? 'This invitation has expired. Please ask the person who invited you to send a new one.'
              : 'This invitation has been revoked. Please contact your organization administrator.'}
          </p>
          <a
            href="/login"
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    )
  }

  // Already accepted
  if (invite && invite.status === 'accepted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Already Accepted</h2>
          <p className="mt-2 text-sm text-gray-500">
            This invitation has already been accepted.
          </p>
          <a
            href="/"
            className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    )
  }

  // Success state after accepting
  if (success && acceptResult) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Welcome to {acceptResult.organization_name}!</h2>
          <p className="mt-2 text-sm text-gray-500">
            You have successfully joined the organization
            {acceptResult.team_name ? ` and the ${acceptResult.team_name} team` : ''}.
            Redirecting to your dashboard...
          </p>
          <div className="mt-4 inline-block h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-r-transparent" />
        </div>
      </div>
    )
  }

  // Main invite view — pending invite
  if (!invite) return null

  const roleLabel = ROLE_LABELS[invite.role] || invite.role
  const expiresDate = new Date(invite.expires_at)
  const daysLeft = Math.max(0, Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div
          className="px-8 py-8 text-center"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
        >
          <h1 className="text-2xl font-bold text-white tracking-tight">HeyWren</h1>
          <p className="mt-1 text-sm text-indigo-200">AI-Powered Follow-Through</p>
        </div>

        {/* Body */}
        <div className="px-8 py-8">
          <h2 className="text-xl font-semibold text-gray-900">You&apos;re invited!</h2>
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">
            <span className="font-medium text-gray-900">{invite.inviter_name}</span> has
            invited you to join{' '}
            <span className="font-medium text-gray-900">{invite.organization_name}</span>{' '}
            as a <span className="font-medium text-indigo-600">{roleLabel}</span>.
          </p>

          {(invite.department_name || invite.team_name) && (
            <div className="mt-4 rounded-lg bg-indigo-50 p-3">
              <p className="text-xs font-medium text-indigo-700">
                {invite.department_name && (
                  <span>Department: {invite.department_name}</span>
                )}
                {invite.department_name && invite.team_name && <span> &middot; </span>}
                {invite.team_name && <span>Team: {invite.team_name}</span>}
              </p>
            </div>
          )}

          <p className="mt-4 text-sm text-gray-500">
            HeyWren monitors your team&apos;s conversations and helps ensure nothing falls through the cracks.
          </p>

          {/* Error message */}
          {error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6">
            {isAuthenticated ? (
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
              >
                {accepting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    Accepting...
                  </span>
                ) : (
                  'Accept Invitation'
                )}
              </button>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handleSignupRedirect}
                  className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  Create Account & Accept
                </button>
                <a
                  href={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
                  className="block w-full rounded-lg border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  I already have an account
                </a>
              </div>
            )}
          </div>

          {/* Expiry notice */}
          <p className="mt-6 text-center text-xs text-gray-400">
            This invitation expires in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}.
          </p>
        </div>
      </div>
    </div>
  )
}
