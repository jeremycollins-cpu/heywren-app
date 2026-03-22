'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { getStripe } from '@/lib/stripe/client'

type Plan = 'basic' | 'pro' | 'team'

interface PlanConfig {
  name: string
  price: string
  description: string
  features: string[]
  cta: string
  highlighted?: boolean
}

const PLANS: Record<Plan, PlanConfig> = {
  basic: {
    name: 'Basic',
    price: '$5',
    description: 'Perfect for small teams getting started',
    features: [
      'Up to 5 users',
      'Slack integration',
      'Basic commitment tracking',
      'Email nudges',
      '14-day free trial',
      'Credit card required',
    ],
    cta: 'Start 14-day free trial',
  },
  pro: {
    name: 'Pro',
    price: '$10',
    description: 'For growing teams who need more power',
    features: [
      'Up to 25 users',
      'All integrations',
      'AI coaching',
      'Playbooks',
      'Advanced analytics',
      '14-day free trial',
      'Credit card required',
    ],
    cta: 'Start 14-day free trial',
    highlighted: true,
  },
  team: {
    name: 'Team',
    price: '$20',
    description: 'For large organizations with advanced needs',
    features: [
      'Unlimited users',
      'Everything in Pro',
      'Priority support',
      'Custom playbooks',
      'Team insights',
      'Admin controls',
      '14-day free trial',
      'Credit card required',
    ],
    cta: 'Start 14-day free trial',
  },
}

export default function PlanPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)

  useEffect(() => {
    // In a real app, you'd get teamId from the auth state or previous step
    // For now, we'll need to create the team on plan selection
    const initTeam = async () => {
      try {
        // Team will be created during checkout callback
        setTeamId('temp-team-id')
      } catch (err) {
        console.error('Error initializing team:', err)
      }
    }

    initTeam()
  }, [])

  const handleSelectPlan = async (plan: Plan) => {

    setSelectedPlan(plan)
    setLoading(true)

    try {
      // Create a temporary team for this signup
      const tempTeamId = `temp-${Date.now()}`
      sessionStorage.setItem('tempTeamId', tempTeamId)
      sessionStorage.setItem('selectedPlan', plan)

      // Create checkout session
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          teamId: tempTeamId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
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
    } catch (err) {
      console.error('Error:', err)
      toast.error('Failed to start checkout. Please try again.')
      setLoading(false)
      setSelectedPlan(null)
    }
  }

  return (
    <div className="w-full space-y-8">
      <div className="text-center">
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium mb-2">
          Step 2 of 3
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Choose your plan</h2>
        <p className="text-gray-600 mt-2">All plans include a 14-day free trial with credit card required.</p>
      </div>

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
                {plan.price !== 'Custom' && <span className="text-gray-600">/month</span>}
              </div>

              <button
                onClick={() => handleSelectPlan(planKey as Plan)}
                disabled={loading && selectedPlan === planKey}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all mb-8 ${
                  plan.highlighted
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:shadow-lg disabled:opacity-50'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200 disabled:opacity-50'
                }`}
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

      <div className="text-center space-y-4">
        <p className="text-gray-600">
          Can't decide? <Link href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">Start for free</Link>
        </p>
      </div>
    </div>
  )
}
