'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WrenFullLogo } from '@/components/logo'
import {
  X, BarChart3, CheckCircle2, Zap, Settings, Users, Brain,
  Calendar, FileText, Edit, Briefcase, Hand, Trophy, CreditCard, Lightbulb, HelpCircle
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onHelpClick?: () => void
}

export default function Sidebar({ open, onToggle, onHelpClick }: SidebarProps) {
  const pathname = usePathname()
  const [userRole, setUserRole] = useState<string | null>(null)
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
    { href: '/', label: 'Dashboard', icon: BarChart3 },
    { href: '/commitments', label: 'Commitments', icon: CheckCircle2 },
    { href: '/relationships', label: 'Relationships', icon: Users },
    { href: '/coach', label: 'Coach', icon: Brain },
    { href: '/weekly', label: 'Weekly', icon: Calendar },
    { href: '/playbooks', label: 'Playbooks', icon: FileText },
    { href: '/draft-queue', label: 'Draft Queue', icon: Edit },
    { href: '/briefings', label: 'Briefings', icon: Briefcase },
    { href: '/handoff', label: 'Handoff', icon: Hand },
    { href: '/achievements', label: 'Achievements', icon: Trophy },
    { href: '/integrations', label: 'Integrations', icon: Zap },
    { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  ]

  const adminLinks = [
    { href: '/billing', label: 'Billing', icon: CreditCard },
    { href: '/team-management', label: 'Team Management', icon: Users },
    { href: '/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(href)
  }

  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-40"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 z-50 lg:z-0 ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}
      >
        <div className="h-screen flex flex-col">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-5 border-b border-gray-200">
            <Link href="/" className="flex items-center">
              <WrenFullLogo width={110} />
            </Link>
            <button
              onClick={onToggle}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {mainLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => open && onToggle()}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  isActive(href)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive(href) ? 'text-indigo-600' : 'text-gray-400'}`} />
                <span className="truncate">{label}</span>
              </Link>
            ))}

            {/* Admin Section */}
            {isAdmin && (
              <>
                <div className="pt-4 mt-4 border-t border-gray-200">
                  <p className="px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Administration
                  </p>
                  {adminLinks.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => open && onToggle()}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                        isActive(href)
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive(href) ? 'text-indigo-600' : 'text-gray-400'}`} />
                      <span className="truncate">{label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </nav>

          {/* Help Button at bottom */}
          <div className="px-3 py-4 border-t border-gray-200 flex-shrink-0">
            <button
              onClick={onHelpClick}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition font-medium text-[13px]"
            >
              <HelpCircle className="w-4 h-4 text-gray-400" />
              <span className="truncate">Help & Tips</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
