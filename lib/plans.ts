/**
 * Centralized plan configuration and feature gating.
 *
 * Every feature in the app maps to a minimum required plan.
 * When adding new features, register them here so they are
 * automatically gated for the correct tier.
 *
 * Pricing model (April 2026):
 *   Pro   — $25/mo (monthly) or $20/mo (annual) — individuals & small teams
 *   Team  — $25/mo (monthly) or $20/mo (annual) — 5-user minimum, unlocks team features
 *   Enterprise — custom pricing, sales-led (not self-serve)
 *
 * 'basic' is retained as an alias for backwards compatibility with
 * existing database rows — it maps to 'pro' access level.
 */

// ── Plan hierarchy (higher index = higher tier) ──────────────────────
export const PLAN_TIERS = ['trial', 'basic', 'pro', 'team'] as const
export type PlanKey = (typeof PLAN_TIERS)[number]

export function planLevel(plan: PlanKey): number {
  // 'basic' is a legacy alias — treat it as 'pro' in all access checks
  if (plan === 'basic') return PLAN_TIERS.indexOf('pro')
  return PLAN_TIERS.indexOf(plan)
}

/** Returns true when `userPlan` is at least `requiredPlan`.
 *  Trial users get full Pro-level access during their trial period.
 *  Legacy 'basic' users are treated as Pro. */
export function hasAccess(userPlan: PlanKey, requiredPlan: PlanKey): boolean {
  const effectivePlan: PlanKey = userPlan === 'trial' ? 'pro' : userPlan
  return planLevel(effectivePlan) >= planLevel(requiredPlan)
}

/** The minimum plan needed to unlock `requiredPlan`. */
export function upgradeTarget(requiredPlan: PlanKey): Exclude<PlanKey, 'trial' | 'basic'> {
  if (requiredPlan === 'trial' || requiredPlan === 'basic') return 'pro'
  return requiredPlan as Exclude<PlanKey, 'trial' | 'basic'>
}

// ── Feature registry ─────────────────────────────────────────────────
// Every gated feature in the app should have an entry here.
// `minPlan` is the *lowest* plan that unlocks the feature.

export interface FeatureDefinition {
  /** Unique key used for programmatic checks. */
  key: string
  /** Human-readable name shown in upgrade prompts. */
  label: string
  /** Short description for the upgrade gate. */
  description: string
  /** Minimum plan required. */
  minPlan: PlanKey
  /** The route this feature lives at (if applicable). */
  route?: string
}

const def = (
  key: string,
  label: string,
  description: string,
  minPlan: PlanKey,
  route?: string,
): FeatureDefinition => ({ key, label, description, minPlan, route })

/**
 * Master feature registry.
 * Keep alphabetically sorted within each tier for readability.
 *
 * All individual features are gated at 'pro' (the base paid plan).
 * Team features require 'team' (5-user minimum).
 */
export const FEATURES: Record<string, FeatureDefinition> = {
  // ── Pro (all individual features) ──────────────────────────────────
  dashboard:        def('dashboard',        'Dashboard',          'Overview of your commitments and activity.',                      'pro', '/'),
  commitments:      def('commitments',      'Commitments',        'Track and manage your commitments.',                             'pro', '/commitments'),
  relationships:    def('relationships',     'Relationships',      'Manage your professional relationships.',                        'pro', '/relationships'),
  coach:            def('coach',            'Coach',              'AI coaching and recommendations.',                               'pro', '/coach'),
  weekly:           def('weekly',           'Weekly Review',      'Weekly summary and reflection.',                                 'pro', '/weekly'),
  missed_emails:    def('missed_emails',    'Missed Emails',      'Surface emails that need follow-up.',                            'pro', '/missed-emails'),
  achievements:     def('achievements',     'Achievements',       'Track your milestones and streaks.',                             'pro', '/achievements'),
  integrations:     def('integrations',     'Integrations',       'Connect Slack, email, and other tools.',                         'pro', '/integrations'),
  ideas:            def('ideas',            'Ideas',              'Capture and organize ideas.',                                    'pro', '/ideas'),
  triage:           def('triage',           'Triage',             'Keyboard-driven rapid commitment processing.',                   'pro', '/triage'),
  wren_score:       def('wren_score',       'Wren Score',         'Your personal reliability index based on follow-through.',       'pro', '/wren-score'),
  draft_queue:      def('draft_queue',      'Draft Queue',        'AI-drafted follow-ups ready for your review.',                   'pro',  '/draft-queue'),
  briefings:        def('briefings',        'Briefings',          'Pre-meeting briefings with context on participants.',            'pro',  '/briefings'),
  ai_nudges:        def('ai_nudges',        'AI Nudges & Scoring','Smart nudges with priority scoring.',                            'pro'),
  calendar_sync:    def('calendar_sync',    'Calendar Sync',      'Sync your calendar for meeting-aware workflows.',                'pro'),
  meeting_transcripts: def('meeting_transcripts', 'Meeting Transcripts', 'Upload meeting transcripts to detect commitments. Say "Hey Wren" in meetings to flag action items.', 'pro', '/meetings'),
  insights:         def('insights',         'Commitment Insights', 'Behavioral pattern analysis and actionable insights from your commitment history.', 'pro',  '/insights'),
  unsubscribe:      def('unsubscribe',      'Unsubscribe',        'One-click unsubscribe from newsletters and marketing emails.',    'pro',  '/unsubscribe'),
  ai_usage:         def('ai_usage',         'AI Usage',           'Track AI tool usage across sessions for work observability.',     'pro',  '/ai-usage'),
  dev_activity:     def('dev_activity',     'Dev Activity',       'Track GitHub commits, PRs, and reviews for engineering observability.', 'pro', '/dev-activity'),

  // ── Team (5-user minimum) ──────────────────────────────────────────
  playbooks:        def('playbooks',        'Playbooks',          'Automate workflows with trigger-based playbooks.',               'team', '/playbooks'),
  handoff:          def('handoff',          'Handoff',            'PTO handoff protocol for seamless coverage.',                    'team', '/handoff'),
  team_dashboards:  def('team_dashboards',  'Team Dashboards',    'Analytics and dashboards across your team.',                     'team'),
  team_management:  def('team_management',  'Team Management',    'Manage team members, roles, and permissions.',                   'team', '/team-management'),
}

/** Convenience: look up feature definition by route path. */
export function featureForRoute(pathname: string): FeatureDefinition | undefined {
  return Object.values(FEATURES).find(f => f.route === pathname)
}

/** Get all features that require a specific plan. */
export function featuresForPlan(plan: PlanKey): FeatureDefinition[] {
  return Object.values(FEATURES).filter(f => f.minPlan === plan)
}

/** Check whether a user on `userPlan` can access a feature by key. */
export function canAccessFeature(userPlan: PlanKey, featureKey: string): boolean {
  const feature = FEATURES[featureKey]
  if (!feature) return true // unknown features are ungated
  return hasAccess(userPlan, feature.minPlan)
}

/** Check whether a user on `userPlan` can access a route. */
export function canAccessRoute(userPlan: PlanKey, pathname: string): boolean {
  const feature = featureForRoute(pathname)
  if (!feature) return true // ungated routes
  return hasAccess(userPlan, feature.minPlan)
}

// ── Plan metadata for display ────────────────────────────────────────
export interface PlanDisplay {
  name: string
  price: string
  priceValue: number
  /** Annual price per user per month (billed yearly). */
  annualPrice: string
  annualPriceValue: number
  description: string
  maxUsers: number
  /** Minimum users required for this plan (1 = no minimum). */
  minUsers: number
  features: string[]
  highlighted?: boolean
}

export type DisplayablePlan = Exclude<PlanKey, 'trial' | 'basic'>

export const PLAN_DISPLAY: Record<DisplayablePlan, PlanDisplay> = {
  pro: {
    name: 'Pro',
    price: '$25',
    priceValue: 25,
    annualPrice: '$20',
    annualPriceValue: 20,
    description: 'For individuals & small teams',
    highlighted: true,
    minUsers: 1,
    maxUsers: 25,
    features: [
      'Slack & email monitoring',
      'AI nudges & priority scoring',
      'Draft queue',
      'Pre-meeting briefings',
      'Calendar sync',
      'Meeting transcript analysis',
      '"Hey Wren" wake word triggers',
      'Wren Chat AI assistant',
      'Commitment insights & patterns',
      'AI coaching recommendations',
      'Missed email surfacing',
      'One-click unsubscribe',
      'Wren Score reliability index',
      'Weekly review & reflection',
      'Rapid triage mode',
      'Achievements & streaks',
      'Ideas capture',
      'Unlimited commitments',
      'Priority support',
    ],
  },
  team: {
    name: 'Team',
    price: '$25',
    priceValue: 25,
    annualPrice: '$20',
    annualPriceValue: 20,
    description: 'For growing teams (5-user minimum)',
    maxUsers: 100,
    minUsers: 5,
    features: [
      'Everything in Pro',
      'Team dashboards & analytics',
      'Playbooks & automation',
      'PTO handoff protocol',
      'Admin controls',
      'Up to 100 team members',
      'Dedicated support',
    ],
  },
}
