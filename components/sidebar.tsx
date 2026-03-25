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
  Lock, RefreshCw, MessageSquareDashed, Hourglass, Mic, GraduationCap,
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onHelpClick?: () => void
}

interface BadgeCounts {
  overdue: number
  urgent: number
  draftQueue: number
  missedEmails: number
  missedChats: number
  waitingRoom: number
  openCommitments: number
}

export default function Sidebar({ open, onToggle, onHelpClick }: SidebarProps) {
  const pathname = usePathname()
  const [userRole, setUserRole] = useState<string | null>(null)
  const [badges, setBadges] = useState<BadgeCounts>({ overdue: 0, urgent: 0, draftQueue: 0, missedEmails: 0, missedChats: 0, waitingRoom: 0, openCommitments: 0 })
  const { plan } = usePlan()
  const supabase = createClient()

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: user } = await supabase.auth.getUser()
        if (!user?.user) return

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, current_team_id')
          .eq('id', user.user.id)
          .single()

        setUserRole(profile?.role || 'user')

        if (profile?.current_team_id) {
          const teamId = profile.current_team_id

          const [commitResult, draftResult, missedResult, missedChatsResult, waitingResult] = await Promise.all([
            supabase
              .from('commitments')
              .select('status, created_at')
              .eq('team_id', teamId)
              .in('status', ['open', 'overdue']),
            supabase
              .from('drafts')
              .select('id')
              .eq('team_id', teamId)
              .eq('status', 'pending'),
            supabase
              .from('missed_emails')
              .select('id, subject')
              .eq('team_id', teamId)
              .eq('user_id', user.user.id)
              .eq('status', 'pending'),
            supabase
              .from('missed_chats')
              .select('id')
              .eq('team_id', teamId)
              .eq('user_id', user.user.id)
              .eq('status', 'pending'),
            supabase
              .from('awaiting_replies')
              .select('id')
              .eq('team_id', teamId)
              .eq('user_id', user.user.id)
              .eq('status', 'waiting')
              .then(res => res.error ? { data: [] } : res),
          ])

          const commitments = commitResult.data || []
          const now = Date.now()
          const overdueCount = commitments.filter(c => c.status === 'overdue').length
          const urgentCount = commitments.filter(c =>
            c.status === 'open' && (now - new Date(c.created_at).getTime()) > 5 * 86400000
          ).length

          setBadges({
            overdue: overdueCount,
            urgent: urgentCount,
            draftQueue: draftResult.data?.length || 0,
            missedEmails: new Set((missedResult.data || []).map((e: any) => {
              const s = (e.subject || '').replace(/^(re:\s*|fwd?:\s*|fw:\s*)+/i, '').trim().toLowerCase()
              return s || e.id
            })).size,
            missedChats: missedChatsResult.data?.length || 0,
            waitingRoom: waitingResult.data?.length || 0,
            openCommitments: commitments.filter(c => c.status === 'open').length,
          })
        }
      } catch (err) {
        console.error('Error fetching sidebar data:', err)
      }
    }

    fetchUserData()
  }, [supabase])

  const sections = [
    {
      label: 'Overview',
      links: [
        { href: '/', label: 'Dashboard', icon: BarChart3, tourId: 'nav-dashboard', badge: badges.overdue > 0 ? badges.overdue : 0, badgeColor: 'bg-red-500' },
        { href: '/commitments', label: 'Commitments', icon: CheckCircle2, tourId: 'nav-commitments', badge: badges.openCommitments, badgeColor: 'bg-indigo-500' },
        { href: '/weekly', label: 'Weekly Review', icon: Calendar, tourId: 'nav-weekly', badge: 0, badgeColor: '' },
      ],
    },
    {
      label: 'Intelligence',
      links: [
        { href: '/coach', label: 'Coach', icon: Brain, tourId: 'nav-coach', badge: 0, badgeColor: '' },
        { href: '/relationships', label: 'Relationships', icon: Users, tourId: 'nav-relationships', badge: 0, badgeColor: '' },
        { href: '/briefings', label: 'Briefings', icon: Briefcase, tourId: 'nav-briefings', badge: 0, badgeColor: '' },
        { href: '/meetings', label: 'Meetings', icon: Mic, tourId: 'nav-meetings', badge: 0, badgeColor: '' },
        { href: '/achievements', label: 'Achievements', icon: Trophy, tourId: 'nav-achievements', badge: 0, badgeColor: '' },
      ],
    },
    {
      label: 'Action Queue',
      links: [
        { href: '/draft-queue', label: 'Draft Queue', icon: Edit, tourId: 'nav-draft-queue', badge: badges.draftQueue, badgeColor: 'bg-violet-500' },
        { href: '/missed-emails', label: 'Missed Emails', icon: MailWarning, tourId: 'nav-missed-emails', badge: badges.missedEmails, badgeColor: 'bg-amber-500' },
        { href: '/missed-chats', label: 'Missed Chats', icon: MessageSquareDashed, tourId: 'nav-missed-chats', badge: badges.missedChats, badgeColor: 'bg-purple-500' },
        { href: '/waiting-room', label: 'Waiting Room', icon: Hourglass, tourId: 'nav-waiting-room', badge: badges.waitingRoom, badgeColor: 'bg-amber-500' },
        { href: '/handoff', label: 'Handoff', icon: Hand, tourId: 'nav-handoff', badge: 0, badgeColor: '' },
      ],
    },
    {
      label: 'Automation',
      links: [
        { href: '/playbooks', label: 'Playbooks', icon: FileText, tourId: 'nav-playbooks', badge: 0, badgeColor: '' },
        { href: '/integrations', label: 'Integrations', icon: Zap, tourId: 'nav-integrations', badge: 0, badgeColor: '' },
        { href: '/sync', label: 'Data Sync', icon: RefreshCw, tourId: 'nav-sync', badge: 0, badgeColor: '' },
      ],
    },
    {
      label: 'Community',
      links: [
        { href: '/ideas', label: 'Ideas', icon: Lightbulb, tourId: 'nav-ideas', badge: 0, badgeColor: '' },
        { href: '/teach-wren', label: 'Teach Wren', icon: GraduationCap, tourId: 'nav-teach-wren', badge: 0, badgeColor: '' },
      ],
    },
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

  const totalActionItems = badges.overdue + badges.draftQueue + badges.missedEmails + badges.missedChats + badges.waitingRoom

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

          {/* Action summary banner */}
          {totalActionItems > 0 && (
            <div className="mx-3 mt-3 px-3 py-2.5 rounded-lg bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-100 dark:border-indigo-800/50">
              <p className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                {totalActionItems} item{totalActionItems !== 1 ? 's' : ''} need attention
              </p>
              <div className="flex items-center gap-3 mt-1">
                {badges.overdue > 0 && (
                  <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">{badges.overdue} overdue</span>
                )}
                {badges.draftQueue > 0 && (
                  <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">{badges.draftQueue} drafts</span>
                )}
                {badges.missedEmails > 0 && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">{badges.missedEmails} emails</span>
                )}
                {badges.missedChats > 0 && (
                  <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">{badges.missedChats} chats</span>
                )}
                {badges.waitingRoom > 0 && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">{badges.waitingRoom} waiting</span>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav aria-label="Main navigation" className="flex-1 px-3 py-3 overflow-y-auto">
            {sections.map((section) => (
              <div key={section.label} className="mb-3">
                <p className="px-3 mb-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {section.label}
                </p>
                <ul role="list" className="space-y-0.5">
                  {section.links.map(({ href, label, icon: Icon, tourId, badge, badgeColor }) => {
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
                          {!locked && badge > 0 && (
                            <span className={`ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white ${badgeColor} px-1`}>
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                          {!locked && badge === 0 && active && (
                            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-scale-in" aria-hidden="true" />
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}

            {/* Admin Section */}
            {isAdmin && (
              <div className="pt-3 mt-3 border-t border-gray-200 dark:border-border-dark">
                <p className="px-3 mb-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
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
