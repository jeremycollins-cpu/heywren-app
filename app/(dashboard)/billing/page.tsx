'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CreditCard, AlertCircle, CheckCircle2, ArrowUpRight, Crown,
  Check, Sparkles, Shield, Zap, X, AlertTriangle, Clock, ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { type PlanKey, type PlanDisplay, PLAN_DISPLAY } from '@/lib/plans'
import { getStripe } from '@/lib/stripe/client'

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'cancelling' | 'incomplete'

interface BillingInfo {
  teamId: string
  plan: PlanKey
  status: SubscriptionStatus
  trialEndsAt: string | null
  maxUsers: number
  memberCount: number
  stripeCustomerId: string | null
}

const PLANS = PLAN_DISPLAY

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string; description: string }> = {
  trialing: {
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800',
    icon: <Clock className="w-4 h-4" />,
    label: 'Trial Active',
    description: 'Your free trial is active. You\'ll be charged when it ends.',
  },
  active: {
    color: 'text-green-700 dark:text-green-300',
    bg: 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800',
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: 'Active',
    description: 'Your subscription is active and in good standing.',
  },
  past_due: {
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: 'Past Due',
    description: 'Your payment failed. Please update your payment method.',
  },
  cancelled: {
    color: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Cancelled',
    description: 'Your subscription has been cancelled.',
  },
  cancelling: {
    color: 'text-orange-700 dark:text-orange-300',
    bg: 'bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-800',
    icon: <Clock className="w-4 h-4" />,
    label: 'Cancelling',
    description: 'Your subscription will end at the current billing period.',
  },
}

export default function BillingPage() {
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState<Exclude<PlanKey, 'trial'> | null>(null)
  const supabase = createClient()

  const fetchBillingInfo = async () => {
    try {
      const { data: user } = await supabase.auth.getUser()
      if (!user?.user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', user.user.id)
        .single()

      if (!profile?.current_team_id) return

      const { data: team } = await supabase
        .from('teams')
        .select('id, subscription_plan, subscription_status, trial_ends_at, max_users, stripe_customer_id')
        .eq('id', profile.current_team_id)
        .single()

      const { count } = await supabase
        .from('team_members')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', profile.current_team_id)

      if (team) {
        setBillingInfo({
          teamId: team.id,
          plan: team.subscription_plan || 'trial',
          status: team.subscription_status || 'trialing',
          trialEndsAt: team.trial_ends_at,
          maxUsers: team.max_users || 5,
          memberCount: count || 1,
          stripeCustomerId: team.stripe_customer_id,
        })
      }
    } catch (err) {
      console.error('Error fetching billing info:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBillingInfo()
  }, [supabase])

  const handleChangePlan = async (newPlan: Exclude<PlanKey, 'trial'>) => {
    if (!billingInfo) return
    setActionLoading(newPlan)
    try {
      // Trial users, cancelled users, or those without a Stripe subscription need a fresh checkout
      if (!billingInfo.stripeCustomerId || billingInfo.status === 'cancelled') {
        const response = await fetch('/api/stripe/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: newPlan }),
        })

        const result = await response.json()
        if (!response.ok) throw new Error(result.error)

        const stripe = await getStripe()
        if (!stripe) throw new Error('Failed to load Stripe')
        await stripe.redirectToCheckout({ sessionId: result.sessionId })
        return
      }

      // Existing Stripe customers — change plan in place
      const response = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: billingInfo.teamId, newPlan }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      toast.success(`Switched to ${PLANS[newPlan].name} plan!`)
      setShowUpgradeModal(null)
      // Refresh billing info
      setLoading(true)
      await fetchBillingInfo()
    } catch (err: any) {
      toast.error(err.message || 'Failed to change plan')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancel = async (immediately: boolean) => {
    if (!billingInfo) return
    setActionLoading('cancel')
    try {
      const response = await fetch('/api/stripe/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: billingInfo.teamId,
          cancelImmediately: immediately,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      toast.success(immediately ? 'Subscription cancelled' : 'Subscription will cancel at period end')
      setShowCancelModal(false)
      setLoading(true)
      await fetchBillingInfo()
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel subscription')
    } finally {
      setActionLoading(null)
    }
  }

  const handleManageBilling = async () => {
    if (!billingInfo) return
    setActionLoading('portal')
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: billingInfo.teamId }),
      })

      if (!response.ok) throw new Error('Failed to create portal session')

      const { url } = await response.json()
      window.location.href = url
    } catch (err) {
      toast.error('Failed to open billing portal')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-4 w-96 bg-gray-100 rounded animate-pulse" />
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-80 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const currentPlan = billingInfo?.plan || 'trial'
  const currentStatus = STATUS_CONFIG[billingInfo?.status || 'trialing']
  const isActivePaid = billingInfo?.status === 'active' || billingInfo?.status === 'trialing'
  const isCancelled = billingInfo?.status === 'cancelled'
  const canChangePlan = isActivePaid || isCancelled

  const daysUntilTrialEnds = billingInfo?.trialEndsAt
    ? Math.ceil((new Date(billingInfo.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="max-w-5xl mx-auto space-y-8" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
          Billing & Subscription
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Manage your plan, payment methods, and invoices
        </p>
      </div>

      {/* Status banner */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${currentStatus.bg}`}>
        <div className={`mt-0.5 ${currentStatus.color}`}>
          {currentStatus.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-sm ${currentStatus.color}`}>
              {currentStatus.label}
            </span>
            {currentPlan !== 'trial' && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                — {PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.name || 'Trial'} Plan
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {currentStatus.description}
          </p>
          {daysUntilTrialEnds !== null && daysUntilTrialEnds > 0 && billingInfo?.status === 'trialing' && (
            <p className="text-sm font-medium mt-1">
              {daysUntilTrialEnds} days remaining in your trial
            </p>
          )}
        </div>
        {billingInfo?.stripeCustomerId && (
          <button
            onClick={handleManageBilling}
            disabled={actionLoading === 'portal'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition flex-shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {actionLoading === 'portal' ? 'Opening...' : 'Payment Settings'}
          </button>
        )}
      </div>

      {/* Current plan overview */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
            Current Plan
          </h2>
          {currentPlan !== 'trial' && (
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-indigo-600">
                {PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.name}
              </span>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plan</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {currentPlan === 'trial' ? 'Trial' : PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.name}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {currentPlan === 'trial' ? 'Free' : `${PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.price}/user/mo`}
            </p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Team Members</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {billingInfo?.memberCount || 1}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              of {billingInfo?.maxUsers || 5} seats used
            </p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Monthly Cost</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {currentPlan === 'trial'
                ? '$0'
                : `$${(PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.priceValue || 0) * (billingInfo?.memberCount || 1)}`}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {currentPlan === 'trial' ? 'During trial' : 'Billed monthly'}
            </p>
          </div>
        </div>
      </div>

      {/* Plan comparison */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
            {currentPlan === 'trial' || currentPlan === 'basic' ? 'Upgrade Your Plan' : 'Change Plan'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">All plans include a 14-day free trial</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {(Object.entries(PLANS) as [Exclude<PlanKey, 'trial'>, PlanDisplay][]).map(([planKey, plan]: [Exclude<PlanKey, 'trial'>, PlanDisplay]) => {
            const isCurrent = currentPlan === planKey
            const isUpgrade = !isCurrent && plan.priceValue > (PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.priceValue || 0)
            const isDowngrade = !isCurrent && plan.priceValue < (PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.priceValue || 0)

            return (
              <div
                key={planKey}
                className={`relative rounded-2xl border-2 transition-all ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20 dark:border-indigo-600'
                    : plan.highlighted
                      ? 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900'
                      : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                }`}
              >
                {/* Current / Popular badges */}
                {isCurrent && (
                  <div className="absolute -top-3 left-4 bg-indigo-600 text-white px-3 py-0.5 rounded-full text-xs font-semibold">
                    Current Plan
                  </div>
                )}
                {!isCurrent && plan.highlighted && (
                  <div className="absolute -top-3 left-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-3 py-0.5 rounded-full text-xs font-semibold">
                    Most Popular
                  </div>
                )}

                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{plan.description}</p>

                  <div className="mt-4 mb-5">
                    <span className="text-4xl font-bold text-gray-900 dark:text-white">{plan.price}</span>
                    <span className="text-gray-500 dark:text-gray-400 text-sm">/user/month</span>
                  </div>

                  {/* Action button */}
                  {isCurrent ? (
                    <div className="w-full py-2.5 px-4 rounded-lg font-medium text-sm text-center bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                      Your current plan
                    </div>
                  ) : canChangePlan ? (
                    <button
                      onClick={() => setShowUpgradeModal(planKey)}
                      disabled={actionLoading !== null}
                      className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                        isUpgrade || isCancelled
                          ? 'text-white hover:opacity-90'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      style={(isUpgrade || isCancelled) ? {
                        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                        boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
                      } : undefined}
                    >
                      {(isUpgrade || isCancelled) && <ArrowUpRight className="w-4 h-4" />}
                      {isCancelled ? 'Subscribe' : isUpgrade ? 'Upgrade' : 'Downgrade'}
                    </button>
                  ) : (
                    <div className="w-full py-2.5 px-4 rounded-lg font-medium text-sm text-center bg-gray-100 dark:bg-gray-800 text-gray-400">
                      {billingInfo?.status === 'cancelled' ? 'Resubscribe to change' : 'Not available'}
                    </div>
                  )}

                  {/* Features */}
                  <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700 space-y-3">
                    {plan.features.map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4" style={{ letterSpacing: '-0.025em' }}>
          Billing Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          {billingInfo?.stripeCustomerId && (
            <button
              onClick={handleManageBilling}
              disabled={actionLoading === 'portal'}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              <CreditCard className="w-4 h-4" />
              Update Payment Method
            </button>
          )}

          {billingInfo?.stripeCustomerId && (
            <button
              onClick={handleManageBilling}
              disabled={actionLoading === 'portal'}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              <Shield className="w-4 h-4" />
              View Invoices
            </button>
          )}

          {isActivePaid && currentPlan !== 'trial' && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition"
            >
              <X className="w-4 h-4" />
              Cancel Subscription
            </button>
          )}
        </div>
      </div>

      {/* FAQ */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4" style={{ letterSpacing: '-0.025em' }}>
          Frequently Asked Questions
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            {
              q: 'What happens when I upgrade?',
              a: 'Your plan changes immediately. You\'ll be charged a prorated amount for the remainder of your billing period.',
            },
            {
              q: 'What happens when I downgrade?',
              a: 'Your plan changes immediately. You\'ll receive a prorated credit toward your next invoice.',
            },
            {
              q: 'Can I cancel anytime?',
              a: 'Yes. You can cancel at the end of your billing period (recommended) or immediately. No long-term contracts.',
            },
            {
              q: 'What happens to my data if I cancel?',
              a: 'Your data is preserved for 30 days after cancellation. You can resubscribe anytime to restore access.',
            },
          ].map((faq, idx) => (
            <div key={idx} className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="font-semibold text-sm text-gray-900 dark:text-white">{faq.q}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade confirmation modal */}
      {showUpgradeModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowUpgradeModal(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">
                    {PLANS[showUpgradeModal].priceValue > (PLANS[currentPlan as Exclude<PlanKey, 'trial'>]?.priceValue || 0) ? 'Upgrade' : 'Downgrade'} to {PLANS[showUpgradeModal].name}
                  </h3>
                  <p className="text-sm text-gray-500">{PLANS[showUpgradeModal].price}/user/month</p>
                </div>
              </div>
              <button onClick={() => setShowUpgradeModal(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                Your plan will change immediately. Billing will be adjusted with a prorated charge or credit.
                {billingInfo?.memberCount && billingInfo.memberCount > 1 && (
                  <span className="block mt-2 font-medium">
                    Estimated new cost: ${PLANS[showUpgradeModal].priceValue * (billingInfo.memberCount || 1)}/month for {billingInfo.memberCount} members
                  </span>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgradeModal(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleChangePlan(showUpgradeModal)}
                disabled={actionLoading !== null}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
                }}
              >
                {actionLoading ? 'Processing...' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowCancelModal(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Cancel Subscription</h3>
                  <p className="text-sm text-gray-500">We&apos;re sorry to see you go</p>
                </div>
              </div>
              <button onClick={() => setShowCancelModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4">
              <p className="text-sm text-red-800 dark:text-red-300 leading-relaxed">
                If you cancel, you&apos;ll lose access to all premium features including AI nudges, draft queue, briefings, and advanced analytics.
                Your data will be preserved for 30 days.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleCancel(false)}
                disabled={actionLoading !== null}
                className="w-full px-4 py-2.5 text-sm font-medium text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/30 transition disabled:opacity-50"
              >
                {actionLoading === 'cancel' ? 'Processing...' : 'Cancel at End of Billing Period'}
              </button>
              <button
                onClick={() => handleCancel(true)}
                disabled={actionLoading !== null}
                className="w-full px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition disabled:opacity-50"
              >
                Cancel Immediately
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                }}
              >
                Keep My Subscription
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
