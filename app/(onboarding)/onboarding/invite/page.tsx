'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Users, X, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

type InviteRole = 'member' | 'team_lead' | 'dept_manager'

interface TeamMemberInvite {
  id: string
  email: string
  role: InviteRole
}

interface OrgContext {
  organizationId: string
  organizationName: string
  departmentId: string
  departmentName: string
  teamId: string
  teamName: string
}

const roleLabels: Record<InviteRole, string> = {
  member: 'Member',
  team_lead: 'Team Lead',
  dept_manager: 'Department Manager',
}

export default function InviteTeamPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [invites, setInvites] = useState<TeamMemberInvite[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [roleInput, setRoleInput] = useState<InviteRole>('member')
  const [orgContext, setOrgContext] = useState<OrgContext | null>(null)
  const [contextLoading, setContextLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const loadOrgContext = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData?.user) {
          router.push('/signup')
          return
        }

        // Fetch the user's org membership to display context
        const { data: membership } = await supabase
          .from('organization_members')
          .select('organization_id, department_id, team_id, role')
          .eq('user_id', authData.user.id)
          .limit(1)
          .single()

        if (membership) {
          // Fetch names for org, dept, team
          const [orgResult, deptResult, teamResult] = await Promise.all([
            supabase
              .from('organizations')
              .select('name')
              .eq('id', membership.organization_id)
              .single(),
            supabase
              .from('departments')
              .select('name')
              .eq('id', membership.department_id)
              .single(),
            supabase
              .from('teams')
              .select('name')
              .eq('id', membership.team_id)
              .single(),
          ])

          setOrgContext({
            organizationId: membership.organization_id,
            organizationName: orgResult.data?.name || 'Your Organization',
            departmentId: membership.department_id,
            departmentName: deptResult.data?.name || 'Your Department',
            teamId: membership.team_id,
            teamName: teamResult.data?.name || 'Your Team',
          })
        }
      } catch (err) {
        console.error('Error loading org context:', err)
      } finally {
        setContextLoading(false)
      }
    }

    loadOrgContext()
  }, [supabase, router])

  const handleAddEmail = () => {
    if (!emailInput.trim()) {
      toast.error('Please enter an email address')
      return
    }

    if (!emailInput.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }

    if (invites.some((i) => i.email === emailInput)) {
      toast.error('This email is already added')
      return
    }

    setInvites([
      ...invites,
      {
        id: Date.now().toString(),
        email: emailInput,
        role: roleInput,
      },
    ])

    setEmailInput('')
    setRoleInput('member')
  }

  const handleRemoveInvite = (id: string) => {
    setInvites(invites.filter((i) => i.id !== id))
  }

  const handleContinue = async () => {
    setLoading(true)

    try {
      if (invites.length > 0) {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData?.user) {
          throw new Error('Not authenticated')
        }

        // Send each invitation via the invites API
        const results = await Promise.allSettled(
          invites.map((invite) =>
            fetch('/api/invites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: invite.email,
                role: invite.role,
                departmentId: orgContext?.departmentId || null,
                teamId: orgContext?.teamId || null,
              }),
            }).then(async (res) => {
              const data = await res.json()
              if (!res.ok) throw new Error(data.error || 'Failed to invite')
              return data
            })
          )
        )

        const succeeded = results.filter((r) => r.status === 'fulfilled').length
        const failed = results.filter((r) => r.status === 'rejected').length

        if (succeeded > 0) {
          toast.success(
            `${succeeded} invitation${succeeded > 1 ? 's' : ''} sent!${
              failed > 0 ? ` (${failed} failed)` : ''
            }`
          )
        } else if (failed > 0) {
          const firstError =
            results.find((r) => r.status === 'rejected') as PromiseRejectedResult
          toast.error(firstError?.reason?.message || 'Failed to send invitations')
        }
      }

      router.push('/onboarding/complete')
    } catch (err: any) {
      console.error('Error:', err)
      toast.error(err.message || 'Failed to process invitations. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = async () => {
    setLoading(true)

    try {
      router.push('/onboarding/complete')
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Step Indicator */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600">
          <Users className="w-6 h-6" />
        </div>
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium">
          Step 4 of 4
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Invite your team</h2>
        <p className="text-gray-600 max-w-lg mx-auto">
          HeyWren works best when your whole team is on board to track commitments together
        </p>
      </div>

      {/* Org Context Banner */}
      {!contextLoading && orgContext && (
        <div className="flex items-start gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <Building2 className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="text-sm text-gray-700">
            <p className="font-medium text-gray-900">
              Invite members to {orgContext.teamName} in {orgContext.departmentName}
            </p>
            <p className="text-gray-500 mt-0.5">
              {orgContext.organizationName} &rsaquo; {orgContext.departmentName} &rsaquo; {orgContext.teamName}
            </p>
          </div>
        </div>
      )}

      {/* Email Input */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Email Address
        </label>
        <div className="flex gap-2">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEmail())}
            placeholder="colleague@company.com"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900"
          />
          <select
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value as InviteRole)}
            className="px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900 text-sm"
          >
            <option value="member">Member</option>
            <option value="team_lead">Team Lead</option>
            <option value="dept_manager">Dept Manager</option>
          </select>
          <button
            onClick={handleAddEmail}
            className="px-4 py-3 bg-gray-100 text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition"
          >
            Add
          </button>
        </div>
      </div>

      {/* Invited Team Members */}
      {invites.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">
            {invites.length} team member{invites.length > 1 ? 's' : ''} added
          </p>
          <div className="space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{invite.email}</p>
                  <p className="text-sm text-gray-600">
                    {roleLabels[invite.role]}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveInvite(invite.id)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handleContinue}
          disabled={loading}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? 'Processing...' : (
            <>
              {invites.length > 0 ? 'Send Invitations' : 'Skip for now'}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {invites.length > 0 && (
          <button
            onClick={handleSkip}
            disabled={loading}
            className="w-full py-3 px-4 text-gray-600 font-medium hover:text-gray-900 transition rounded-lg hover:bg-gray-50"
          >
            Skip for now
          </button>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800">
        <p className="font-medium mb-1">Team collaboration</p>
        <p>Adding your team helps HeyWren assign commitments correctly and improves handoff coordination.</p>
      </div>
    </div>
  )
}
