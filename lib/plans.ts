/**
 * Centralized plan configuration and feature gating.
 *
 * Every feature in the app maps to a minimum required plan.
 * When adding new features, register them here so they are
 * automatically gated for the correct tier.
 */

// ── Plan hierarchy (higher index = higher tier) ──────────────────────
export const PLAN_TIERS = ['trial', 'basic', 'pro', 'team'] as const
export type PlanKey = (typeof PLAN_TIERS)[number]

export function planLevel(plan: PlanKey): number {
  return PLAN_TIERS.indexOf(plan)
}

/** Returns true when `userPlan` is at least `requiredPlan`.
 *  Trial users get full Pro-level access during their trial period. */
export function hasAccess(userPlan: PlanKey, requiredPlan: PlanKey): boolean {
  const effectivePlan: PlanKey = userPlan === 'trial' ? 'pro' : userPlan
  return planLevel(effectivePlan) >= planLevel(requiredPlan)
}

/** The minimum plan needed to unlock `requiredPlan`. */
export function upgradeTarget(requiredPlan: PlanKey): Exclude<PlanKey, 'trial'> {
  if (requiredPlan === 'trial') return 'basic'
  return requiredPlan as Exclude<PlanKey, 'trial'>
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
 */
export const FEATURES: Record<string, FeatureDefinition> = {
  // ── Basic (and Trial) ──────────────────────────────────────────────
  dashboard:        def('dashboard',        'Dashboard',          'Overview of your commitments and activity.',                      'basic', '/'),
  commitments:      def('commitments',      'Commitments',        'Track and manage your commitments.',                             'basic', '/commitments'),
  relationships:    def('relationships',     'Relationships',      'Manage your professional relationships.',                        'basic', '/relationships'),
  coach:            def('coach',            'Coach',              'AI coaching and recommendations.',                               'basic', '/coach'),
  weekly:           def('weekly',           'Weekly Review',      'Weekly summary and reflection.',                                 'basic', '/weekly'),
  missed_emails:    def('missed_emails',    'Missed Emails',      'Surface emails that need follow-up.',                            'basic', '/missed-emails'),
  achievements:     def('achievements',     'Achievements',       'Track your milestones and streaks.',                             'basic', '/achievements'),
  integrations:     def('integrations',     'Integrations',       'Connect Slack, email, and other tools.',                         'basic', '/integrations'),
  ideas:            def('ideas',            'Ideas',              'Capture and organize ideas.',                                    'basic', '/ideas'),
  triage:           def('triage',           'Triage',             'Keyboard-driven rapid commitment processing.',                   'basic', '/triage'),
  wren_score:       def('wren_score',       'Wren Score',         'Your personal reliability index based on follow-through.',       'basic', '/wren-score'),

  // ── Pro ────────────────────────────────────────────────────────────
  draft_queue:      def('draft_queue',      'Draft Queue',        'AI-drafted follow-ups ready for your review.',                   'pro',  '/draft-queue'),
  briefings:        def('briefings',        'Briefings',          'Pre-meeting briefings with context on participants.',            'pro',  '/briefings'),
  ai_nudges:        def('ai_nudges',        'AI Nudges & Scoring','Smart nudges with priority scoring.',                            'pro'),
  calendar_sync:    def('calendar_sync',    'Calendar Sync',      'Sync your calendar for meeting-aware workflows.',                'pro'),
  meeting_transcripts: def('meeting_transcripts', 'Meeting Transcripts', 'Upload meeting transcripts to detect commitments. Say "Hey Wren" in meetings to flag action items.', 'pro', '/meetings'),

  dependencies:     def('dependencies',     'Dependencies',       'See who is waiting on you and who you are waiting on.',          'pro',  '/dependencies'),
  insights:         def('insights',         'Commitment Insights', 'Behavioral pattern analysis and actionable insights from your commitment history.', 'pro',  '/insights'),

  // ── Team ───────────────────────────────────────────────────────────
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
  description: string
  maxUsers: number
  features: string[]
  highlighted?: boolean
}

export const PLAN_DISPLAY: Record<Exclude<PlanKey, 'trial'>, PlanDisplay> = {
  basic: {
    name: 'Basic',
    price: '$5',
    priceValue: 5,
    description: 'For individuals getting started',
    maxUsers: 5,
    features: [
      'Slack & email monitoring',
      'Basic nudges',
      'Rapid triage mode',
      'Wren Score reliability index',
      'Up to 50 commitments',
      'Up to 5 team members',
      'Email support',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$10',
    priceValue: 10,
    description: 'For professionals & small teams',
    highlighted: true,
    maxUsers: 25,
    features: [
      'Everything in Basic',
      'AI nudges & scoring',
      'Draft queue',
      'Pre-meeting briefings',
      'Calendar sync',
      'Meeting transcript analysis',
      '"Hey Wren" wake word triggers',
      'Dependency tracking',
      'Commitment insights & patterns',
      'Unlimited commitments',
      'Up to 25 team members',
      'Priority support',
    ],
  },
  team: {
    name: 'Team',
    price: '$20',
    priceValue: 20,
    description: 'For scaling teams',
    maxUsers: 100,
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
