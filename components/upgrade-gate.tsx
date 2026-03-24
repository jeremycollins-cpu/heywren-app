'use client'

import { useRouter } from 'next/navigation'
import { Lock, ArrowUpRight, Check, Sparkles } from 'lucide-react'
import { usePlan } from '@/lib/contexts/plan-context'
import {
  type PlanKey,
  type FeatureDefinition,
  FEATURES,
  featureForRoute,
  upgradeTarget,
  PLAN_DISPLAY,
  hasAccess,
} from '@/lib/plans'

interface UpgradeGateProps {
  /** Feature key from the FEATURES registry. */
  featureKey?: string
  /** Or pass a route path to auto-detect the feature. */
  route?: string
  /** Content to render when the user HAS access. */
  children: React.ReactNode
}

/**
 * Wraps a feature's content. If the user's plan is too low,
 * renders an upgrade prompt instead of the children.
 */
export default function UpgradeGate({ featureKey, route, children }: UpgradeGateProps) {
  const { plan, loading } = usePlan()
  const router = useRouter()

  // Resolve the feature definition
  let feature: FeatureDefinition | undefined
  if (featureKey) {
    feature = FEATURES[featureKey]
  } else if (route) {
    feature = featureForRoute(route)
  }

  // If we can't identify the feature, or still loading, show children
  if (!feature || loading) {
    return <>{children}</>
  }

  // If user has access, show children
  if (hasAccess(plan, feature.minPlan)) {
    return <>{children}</>
  }

  // Otherwise show upgrade prompt
  const targetPlan = upgradeTarget(feature.minPlan)
  const planInfo = PLAN_DISPLAY[targetPlan]

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-lg w-full text-center">
        {/* Lock icon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
          }}
        >
          <Lock className="w-7 h-7 text-indigo-600" />
        </div>

        {/* Feature name */}
        <h2
          className="text-2xl font-bold text-gray-900 dark:text-white mb-2"
          style={{ letterSpacing: '-0.025em' }}
        >
          {feature.label} requires {planInfo.name}
        </h2>

        <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-md mx-auto">
          {feature.description} Upgrade to the <strong>{planInfo.name}</strong> plan
          to unlock this feature.
        </p>

        {/* Plan preview card */}
        <div className="bg-white dark:bg-gray-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-2xl p-6 mb-6 text-left">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-gray-900 dark:text-white">{planInfo.name} Plan</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{planInfo.description}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{planInfo.price}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">/user/mo</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {planInfo.features.slice(0, 6).map((feat, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-gray-600 dark:text-gray-400">{feat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => router.push('/billing')}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.25)',
          }}
        >
          <ArrowUpRight className="w-4 h-4" />
          Upgrade to {planInfo.name}
        </button>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          All plans include a 14-day free trial. Cancel anytime.
        </p>
      </div>
    </div>
  )
}
