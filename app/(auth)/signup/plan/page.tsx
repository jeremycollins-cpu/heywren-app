'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Check, Sparkles } from 'lucide-react'
import { getStripe } from '@/lib/stripe/client'

type Plan = 'basic' | 'pro' | 'team'

interface PlanConfig {
  name: string
  price: string
  priceNote: string
  description: string
  features: string[]
  cta: string
  highlighted?: boolean
}

const PLANS: Record<Plan, PlanConfig> = {
  basic: {
    name: 'Basic',
    price: '$5',
    priceNote: '/month after beta',
    description: 'For individuals getting started',
    features: [
      'Slack & email monitoring',
      'Basic nudges',
      'Up to 50 commitments',
      'Email support',
    ],
    cta: 'Get Started Free',
  },
  pro: {
    name: 'Pro',
    price: '$10',
    priceNote: '/month after beta',
    description: 'For professionals & small teams',
    features: [
      'Slack, email & calendar',
      'AI nudges & scoring',
      'Draft queue',
      'Pre-meeting briefings',
      'Unlimited commitments',
      'Priority support',
    ],
    cta: 'Get Started Free',
    highlighted: true,
  },
  team: {
    name: 'Team',
    price: '$20',
    priceNote: '/month after beta',
    description: 'For scaling teams',
    features: [
      'Everything in Pro',
      'Team dashboards',
      'Playbooks & automation',
      'PTO handoff protocol',
      'Admin controls',
      'Dedicated support',
    ],
    cta: 'Get Started Free',
  },
}

export default function PlanPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)

  const handleSelectPlan = async (plan: Plan) => {
    setSelectedPlan(plan)
    setLoading(true)

    try {
      sessionStorage.setItem('selectedPlan', plan)

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          email: sessionStorage.getItem('signupEmail') || undefined,
          userId: sessionStorage.getItem('signupUserId') || undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create checkout session')
      }

      const { sessionId } = await response.json()

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
        <div className="flex items-center justify-center gap-2 mt-3">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <p className="text-amber-700 text-sm font-medium bg-amber-50 px-3 py-1 rounded-full">
            Free during beta — no charge until launch
          </p>
        </div>
        <p className="text-gray-500 mt-2 text-sm">Pick the plan that fits your needs. You won't be charged during beta.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {Object.entries(PLANS).map(([planKey, plan]) => (
          <div
            key={planKey}
            className={`relative rounded-2xl border-2 transition-all ${
              plan.highlighted
                ? 'border-indigo-500 shadow-lg md:scale-105'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
            }`}
            style={plan.highlighted ? {
              background: 'linear-gradient(180deg, #eef2ff 0%, #ffffff 40%)',
            } : undefined}
          >
            {plan.highlighted && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-1 rounded-full text-xs font-semibold whitespace-nowrap">
                Most Popular
              </div>
            )}

            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
              <p className="text-gray-500 text-sm mt-1 leading-snug">{plan.description}</p>

              <div className="mt-5 mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-400 text-sm line-through">/mo</span>
                </div>
                <p className="text-green-600 text-xs font-semibold mt-1">FREE during beta</p>
              </div>

              <button
                onClick={() => handleSelectPlan(planKey as Plan)}
                disabled={loading}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mb-6 disabled:opacity-50 disabled:cursor-not-allowed ${
                  plan.highlighted
                    ? 'text-white hover:shadow-lg hover:opacity-90'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                }`}
                style={plan.highlighted ? {
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(79, 70, 229, 0.3)',
                } : undefined}
              >
                {loading && selectedPlan === planKey ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : plan.cta}
              </button>

              <div className="space-y-3">
                {plan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-600 text-sm leading-snug">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center">
        <p className="text-gray-500 text-sm">
          Questions? <Link href="mailto:support@heywren.ai" className="text-indigo-600 hover:text-indigo-700 font-medium">Contact us</Link>
        </p>
      </div>
    </div>
  )
}
