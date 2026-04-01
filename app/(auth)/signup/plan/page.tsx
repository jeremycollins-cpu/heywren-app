// app/(auth)/signup/plan/page.tsx
// Plan selection page v2 — passes joining context through to Stripe checkout
// Every user pays individually (owner or joiner), but joiners see context about their team

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { getStripe } from '@/lib/stripe/client'
import { PLAN_DISPLAY } from '@/lib/plans'

type Plan = 'basic' | 'pro' | 'team'

const PLANS: Record<Plan, { name: string; price: string; description: string; features: string[]; cta: string; highlighted?: boolean }> = {
  basic: {
    ...PLAN_DISPLAY.basic,
    features: [...PLAN_DISPLAY.basic.features, '14-day free trial'],
    cta: 'Start Free Trial',
  },
  pro: {
    ...PLAN_DISPLAY.pro,
    features: [...PLAN_DISPLAY.pro.features, '14-day free trial'],
    cta: 'Start Free Trial',
  },
  team: {
    ...PLAN_DISPLAY.team,
    features: [...PLAN_DISPLAY.team.features, '14-day free trial'],
    cta: 'Start Free Trial',
  },
}

export default function PlanPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
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

  const handleSelectPlan = async (plan: Plan) => {
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

  return (
    <div className="w-full space-y-8" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 2 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Choose your plan</h2>
        <p className="text-gray-500 mt-2 text-sm">All plans include a 14-day free trial. Credit card required.</p>
      </div>

      {/* Joining team banner */}
      {joiningTeamName && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <p className="text-emerald-700 text-sm">
            <span className="font-semibold">{joiningTeamName}</span> is already on HeyWren — you&apos;ll be added to their team after checkout
          </p>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        {Object.entries(PLANS).map(([planKey, plan]) => (
          <div
            key={planKey}
            className={`relative rounded-2xl border-2 transition-all ${
              plan.highlighted
                ? 'border-indigo-500 bg-indigo-50 shadow-xl scale-105'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {plan.highlighted && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                Most Popular
              </div>
            )}

            <div className="p-8">
              <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>
              <p className="text-gray-600 text-sm mt-2">{plan.description}</p>

              <div className="mt-6 mb-8">
                <span className="text-5xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-gray-600">/month</span>
              </div>

              <button
                onClick={() => handleSelectPlan(planKey as Plan)}
                disabled={loading && selectedPlan === planKey}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mb-8 disabled:opacity-50 ${
                  plan.highlighted
                    ? 'text-white hover:shadow-lg'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                }`}
                style={plan.highlighted ? {
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
                } : undefined}
              >
                {loading && selectedPlan === planKey ? 'Processing...' : plan.cta}
              </button>

              <div className="space-y-4">
                {plan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
