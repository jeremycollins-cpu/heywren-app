'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WrenFullLogo } from '@/components/logo'
import { usePlan } from '@/lib/contexts/plan-context'
import { featureForRoute, hasAccess, PLAN_DISPLAY, type PlanKey } from '@/lib/plans'
import {
  X, BarChart3, CheckCircle2, Zap, Settings, Users, Brain,
  Calendar, FileText, Edit, Briefcase, Hand, Trophy, CreditCard, Lightbulb, HelpCircle, MailWarning,
  Lock,
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onHelpClick?: () => void
}

export default function Sidebar({ open, onToggle, onHelpClick }: SidebarProps) {
  const pathname = usePathname()
  const [userRole, setUserRole] = useState<string | null>(null)
  const { plan } = usePlan()
  const supabase = createClient()

  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const { data: user } = await supabase.auth.getUser()
        if (!user?.user) return

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.user.id)
          .single()

        setUserRole(profile?.role || 'user')
      } catch (err) {
        console.error('Error fetching user role:', err)
      }
    }

    fetchUserRole()
  }, [supabase])

  const mainLinks = [
    { href: '/', label: 'Dashboard', icon: BarChart3, tourId: 'nav-dashboard' },
    { href: '/commitments', label: 'Commitments', icon: CheckCircle2, tourId: 'nav-commitments' },
    { href: '/relationships', label: 'Relationships', icon: Users, tourId: 'nav-relationships' },
    { href: '/coach', label: 'Coach', icon: Brain, tourId: 'nav-coach' },
    { href: '/weekly', label: 'Weekly', icon: Calendar, tourId: 'nav-weekly' },
    { href: '/playbooks', label: 'Playbooks', icon: FileText, tourId: 'nav-playbooks' },
    { href: '/draft-queue', label: 'Draft Queue', icon: Edit, tourId: 'nav-draft-queue' },
    { href: '/missed-emails', label: 'Missed Emails', icon: MailWarning, tourId: 'nav-missed-emails' },
    { href: '/briefings', label: 'Briefings', icon: Briefcase, tourId: 'nav-briefings' },
    { href: '/handoff', label: 'Handoff', icon: Hand, tourId: 'nav-handoff' },
    { href: '/achievements', label: 'Achievements', icon: Trophy, tourId: 'nav-achievements' },
    { href: '/integrations', label: 'Integrations', icon: Zap, tourId: 'nav-integrations' },
    { href: '/ideas', label: 'Ideas', icon: Lightbulb, tourId: 'nav-ideas' },
  ]

  const adminLinks = [
    { href: '/billing', label: 'Billing', icon: CreditCard },
    { href: '/team-management', label: 'Team Management', icon: Users },
    { href: '/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  /** Check if a nav route is locked for the current plan. */
  const isLocked = (href: string): { locked: boolean; requiredPlan: string } => {
    const feature = featureForRoute(href)
    if (!feature) return { locked: false, requiredPlan: '' }
    const locked = !hasAccess(plan, feature.minPlan)
    const requiredPlan = locked
      ? PLAN_DISPLAY[feature.minPlan as Exclude<PlanKey, 'trial'>]?.name || feature.minPlan
      : ''
    return { locked, requiredPlan }
  }

  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 glass lg:hidden z-40 animate-fade-in"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 w-64 bg-white dark:bg-surface-dark-secondary border-r border-gray-200 dark:border-border-dark transform transition-transform duration-300 ease-brand z-50 lg:z-0 ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-screen flex flex-col">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-5 border-b border-gray-200 dark:border-border-dark">
            <Link href="/" className="flex items-center group" data-tour="logo">
              <WrenFullLogo width={110} />
            </Link>
            <button
              onClick={onToggle}
              className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Close sidebar"
            >
              <X aria-hidden="true" className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* Navigation */}
          <nav aria-label="Main navigation" className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            <ul role="list" className="space-y-0.5">
            {mainLinks.map(({ href, label, icon: Icon, tourId }) => {
              const active = isActive(href)
              const { locked, requiredPlan } = isLocked(href)
              return (
                <li key={href}>
                <Link
                  href={href}
                  data-tour={tourId}
                  onClick={() => open && onToggle()}
                  aria-current={active ? 'page' : undefined}
                  title={locked ? `Requires ${requiredPlan} plan` : undefined}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                    active
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                      : locked
                        ? 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  <Icon aria-hidden="true" className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${
                    active
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : locked
                        ? 'text-gray-300 dark:text-gray-600'
                        : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                  }`} />
                  <span className="truncate">{label}</span>
                  {locked && (
                    <div className="ml-auto flex items-center gap-1.5" aria-label={`Requires ${requiredPlan}`}>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 hidden group-hover:inline">
                        {requiredPlan}
                      </span>
                      <Lock aria-hidden="true" className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                    </div>
                  )}
                  {!locked && active && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-scale-in" aria-hidden="true" />
                  )}
                </Link>
                </li>
              )
            })}
            </ul>

            {/* Admin Section */}
            {isAdmin && (
              <div className="pt-4 mt-4 border-t border-gray-200 dark:border-border-dark">
                <p className="px-3 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  Administration
                </p>
                <ul role="list" className="space-y-0.5">
                {adminLinks.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href)
                  const { locked, requiredPlan } = isLocked(href)
                  return (
                    <li key={href}>
                    <Link
                      href={href}
                      onClick={() => open && onToggle()}
                      aria-current={active ? 'page' : undefined}
                      title={locked ? `Requires ${requiredPlan} plan` : undefined}
                      className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                        active
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                          : locked
                            ? 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      <Icon aria-hidden="true" className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${
                        active
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : locked
                            ? 'text-gray-300 dark:text-gray-600'
                            : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                      }`} />
                      <span className="truncate">{label}</span>
                      {locked && (
                        <div className="ml-auto flex items-center gap-1.5" aria-label={`Requires ${requiredPlan}`}>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 hidden group-hover:inline">
                            {requiredPlan}
                          </span>
                          <Lock aria-hidden="true" className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                        </div>
                      )}
                      {!locked && active && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-scale-in" aria-hidden="true" />
                      )}
                    </Link>
                    </li>
                  )
                })}
                </ul>
              </div>
            )}
          </nav>

          {/* Help Button */}
          <div className="px-3 py-4 border-t border-gray-200 dark:border-border-dark flex-shrink-0">
            <button
              onClick={onHelpClick}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200 transition-all duration-200 font-medium text-[13px]"
            >
              <HelpCircle aria-hidden="true" className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="truncate">Help & Tips</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
