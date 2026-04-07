// app/(auth)/signup/plan/page.tsx
// Plan selection page — two self-serve plans (Pro / Team) + Enterprise CTA
// Supports monthly/annual billing toggle

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import toast from 'react-hot-toast'
import { Check, Users, Building2 } from 'lucide-react'
import { getStripe } from '@/lib/stripe/client'
import { PLAN_DISPLAY, type DisplayablePlan } from '@/lib/plans'

type BillingInterval = 'monthly' | 'annual'

export default function PlanPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<DisplayablePlan | null>(null)
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('annual')
  const [joiningTeamName, setJoiningTeamName] = useState<string | null>(null)
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null)

  useEffect(() => {
    // Check if user is joining an existing team (set by signup page)
    try {
      const teamName = sessionStorage.getItem('joiningTeamName')
      const teamId = sessionStorage.getItem('joiningTeamId')
      if (teamName && teamId) {
        setJoiningTeamName(teamName)
        setJoiningTeamId(teamId)
      }
    } catch (e) {
      // sessionStorage not available — that's fine
    }
  }, [])

  const handleSelectPlan = async (plan: DisplayablePlan) => {
    setSelectedPlan(plan)
    setLoading(true)

    try {
      // Store selected plan in sessionStorage as fallback
      try {
        sessionStorage.setItem('selectedPlan', plan)
      } catch (e) {}

      // Create checkout session — pass joining context if applicable
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          billingInterval,
          joiningTeamId: joiningTeamId || null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create checkout session')
      }

      const { sessionId } = await response.json()

      // Redirect to Stripe Checkout
      const stripe = await getStripe()
      if (!stripe) {
        throw new Error('Failed to load Stripe')
      }

      const { error } = await stripe.redirectToCheckout({ sessionId })
      if (error) {
        throw error
      }
    } catch (err: any) {
      console.error('Checkout error:', err)
      toast.error(err.message || 'Failed to start checkout. Please try again.')
      setLoading(false)
      setSelectedPlan(null)
    }
  }

  const getPrice = (plan: DisplayablePlan) =>
    billingInterval === 'annual' ? PLAN_DISPLAY[plan].annualPrice : PLAN_DISPLAY[plan].price

  const getPriceValue = (plan: DisplayablePlan) =>
    billingInterval === 'annual' ? PLAN_DISPLAY[plan].annualPriceValue : PLAN_DISPLAY[plan].priceValue

  const annualSavings = PLAN_DISPLAY.pro.priceValue - PLAN_DISPLAY.pro.annualPriceValue

  return (
    <div className="w-full space-y-8" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 2 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Choose your plan</h2>
        <p className="text-gray-500 mt-2 text-sm">All plans include a 14-day free trial. Cancel anytime.</p>
      </div>

      {/* Billing interval toggle */}
      <div className="flex justify-center">
        <div className="inline-flex items-center bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setBillingInterval('monthly')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              billingInterval === 'monthly'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingInterval('annual')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
              billingInterval === 'annual'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Annual
            <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs font-semibold">
              Save ${annualSavings * 12}/yr
            </span>
          </button>
        </div>
      </div>

      {/* Joining team banner */}
      {joiningTeamName && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <p className="text-emerald-700 text-sm">
            <span className="font-semibold">{joiningTeamName}</span> is already on HeyWren — you&apos;ll be added to their team after checkout
          </p>
        </div>
      )}

      {/* Plans Grid — 2 plans + Enterprise CTA */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Pro */}
        <div className="relative rounded-2xl border-2 border-indigo-500 bg-indigo-50 shadow-xl scale-105">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-3 py-1 rounded-full text-sm font-medium">
            Most Popular
          </div>

          <div className="p-8">
            <h3 className="text-2xl font-bold text-gray-900">{PLAN_DISPLAY.pro.name}</h3>
            <p className="text-gray-600 text-sm mt-2">{PLAN_DISPLAY.pro.description}</p>

            <div className="mt-6 mb-8">
              <span className="text-5xl font-bold text-gray-900">{getPrice('pro')}</span>
              <span className="text-gray-600">/user/mo</span>
              {billingInterval === 'annual' && (
                <span className="block text-sm text-gray-500 mt-1">Billed annually</span>
              )}
            </div>

            <button
              onClick={() => handleSelectPlan('pro')}
              disabled={loading && selectedPlan === 'pro'}
              className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mb-8 disabled:opacity-50 text-white hover:shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
              }}
            >
              {loading && selectedPlan === 'pro' ? 'Processing...' : 'Start Free Trial'}
            </button>

            <div className="space-y-4">
              {PLAN_DISPLAY.pro.features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 text-sm">{feature}</span>
                </div>
              ))}
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700 text-sm">14-day free trial</span>
              </div>
            </div>
          </div>
        </div>

        {/* Team */}
        <div className="relative rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 transition-all">
          <div className="p-8">
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-bold text-gray-900">{PLAN_DISPLAY.team.name}</h3>
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <p className="text-gray-600 text-sm mt-2">{PLAN_DISPLAY.team.description}</p>

            <div className="mt-6 mb-8">
              <span className="text-5xl font-bold text-gray-900">{getPrice('team')}</span>
              <span className="text-gray-600">/user/mo</span>
              {billingInterval === 'annual' && (
                <span className="block text-sm text-gray-500 mt-1">Billed annually</span>
              )}
              <span className="block text-sm text-indigo-600 font-medium mt-1">5-user minimum</span>
            </div>

            <button
              onClick={() => handleSelectPlan('team')}
              disabled={loading && selectedPlan === 'team'}
              className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mb-8 disabled:opacity-50 bg-gray-100 text-gray-900 hover:bg-gray-200"
            >
              {loading && selectedPlan === 'team' ? 'Processing...' : 'Start Free Trial'}
            </button>

            <div className="space-y-4">
              {PLAN_DISPLAY.team.features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 text-sm">{feature}</span>
                </div>
              ))}
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700 text-sm">14-day free trial</span>
              </div>
            </div>
          </div>
        </div>

        {/* Enterprise CTA */}
        <div className="relative rounded-2xl border-2 border-gray-200 bg-gradient-to-b from-gray-50 to-white hover:border-gray-300 transition-all">
          <div className="p-8">
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-bold text-gray-900">Enterprise</h3>
              <Building2 className="w-5 h-5 text-gray-600" />
            </div>
            <p className="text-gray-600 text-sm mt-2">For organizations with advanced needs</p>

            <div className="mt-6 mb-8">
              <span className="text-3xl font-bold text-gray-900">Custom</span>
              <span className="block text-sm text-gray-500 mt-1">Tailored to your org</span>
            </div>

            <a
              href="mailto:sales@heywren.ai?subject=Enterprise%20Plan%20Inquiry"
              className="block w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-center transition-all mb-8 bg-gray-900 text-white hover:bg-gray-800"
            >
              Contact Sales
            </a>

            <div className="space-y-4">
              {[
                'Everything in Team',
                'Unlimited team members',
                'SSO / SAML authentication',
                'Custom integrations',
                'Dedicated account manager',
                'SLA & uptime guarantees',
                'Custom data retention',
                'On-premises deployment option',
              ].map((feature, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
