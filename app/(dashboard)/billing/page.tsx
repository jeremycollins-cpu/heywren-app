'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CreditCard, AlertCircle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface BillingInfo {
  plan: string
  status: string
  trialEndsAt: string | null
  maxUsers: number
}

export default function BillingPage() {
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [managingBilling, setManagingBilling] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchBillingInfo = async () => {
      try {
        const { data: user } = await supabase.auth.getUser()
        if (!user?.user) {
          return
        }

        // Get user's current team
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', user.user.id)
          .single()

        if (!profile?.current_team_id) {
          return
        }

        // Get team billing info
        const { data: team } = await supabase
          .from('teams')
          .select('subscription_plan, subscription_status, trial_ends_at, max_users')
          .eq('id', profile.current_team_id)
          .single()

        if (team) {
          setBillingInfo({
            plan: team.subscription_plan,
            status: team.subscription_status,
            trialEndsAt: team.trial_ends_at,
            maxUsers: team.max_users,
          })
        }
      } catch (err) {
        console.error('Error fetching billing info:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchBillingInfo()
  }, [supabase])

  const handleManageBilling = async () => {
    setManagingBilling(true)
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) {
        throw new Error('Not authenticated')
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', user.user.id)
        .single()

      if (!profile?.current_team_id) {
        throw new Error('No team found')
      }

      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: profile.current_team_id }),
      })

      if (!response.ok) {
        throw new Error('Failed to create portal session')
      }

      const { url } = await response.json()
      window.location.href = url
    } catch (err) {
      toast.error('Failed to open billing portal')
    } finally {
      setManagingBilling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500 dark:text-gray-400">Loading billing information...</p>
      </div>
    )
  }

  const planConfig: Record<string, { displayName: string; price: string }> = {
    trial: { displayName: 'Trial', price: 'Free' },
    basic: { displayName: 'Basic', price: '$5/user/month' },
    pro: { displayName: 'Pro', price: '$10/user/month' },
    team: { displayName: 'Team', price: '$20/user/month' },
  }

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    trialing: {
      color: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
      icon: <AlertCircle className="w-5 h-5" />,
      label: 'Trial Active',
    },
    active: {
      color: 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
      icon: <CheckCircle2 className="w-5 h-5" />,
      label: 'Active',
    },
    past_due: {
      color: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800',
      icon: <AlertCircle className="w-5 h-5" />,
      label: 'Past Due',
    },
    cancelled: {
      color: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
      icon: <AlertCircle className="w-5 h-5" />,
      label: 'Cancelled',
    },
  }

  const currentPlan = planConfig[billingInfo?.plan || 'trial']
  const currentStatus = statusConfig[billingInfo?.status || 'trialing']

  const daysUntilTrialEnds = billingInfo?.trialEndsAt
    ? Math.ceil(
        (new Date(billingInfo.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Billing & Subscription</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Manage your plan and billing information</p>
      </div>

      {/* Current Plan */}
      <div className="card dark:bg-surface-dark-secondary dark:border-border-dark">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{currentPlan.displayName} Plan</h2>
            <p className="text-4xl font-bold text-indigo-600 mt-2">{currentPlan.price}</p>
          </div>
          <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 ${currentStatus.color}`}>
            {currentStatus.icon}
            <span className="font-medium">{currentStatus.label}</span>
          </div>
        </div>

        {daysUntilTrialEnds !== null && daysUntilTrialEnds > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <p className="text-blue-900 dark:text-blue-200">
              Your trial ends in <strong>{daysUntilTrialEnds} days</strong>. You&apos;ll be charged when your trial ends.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Included features</h3>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>✓ Up to {billingInfo?.maxUsers || 5} team members</li>
              <li>✓ Slack integration</li>
              <li>✓ Email support</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Team info</h3>
            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <p>Current members: Calculating...</p>
              <p>Max members: {billingInfo?.maxUsers || 5}</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleManageBilling}
          disabled={managingBilling}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
        >
          <CreditCard className="w-5 h-5" />
          {managingBilling ? 'Opening...' : 'Manage Billing'}
        </button>
      </div>

      {/* Billing History */}
      <div className="card dark:bg-surface-dark-secondary dark:border-border-dark">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Billing History</h2>
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No invoices yet. They&apos;ll appear here once you&apos;re on a paid plan.</p>
        </div>
      </div>
    </div>
  )
}
