'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Menu, X, BarChart3, CheckCircle2, Zap, Settings, Users, Brain,
  Calendar, FileText, Edit, Briefcase, Hand, Trophy, CreditCard
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onToggle: () => void
}

export default function Sidebar({ open, onToggle }: SidebarProps) {
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
    { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
    { href: '/dashboard/commitments', label: 'Commitments', icon: CheckCircle2 },
    { href: '/dashboard/relationships', label: 'Relationships', icon: Users },
    { href: '/dashboard/coach', label: 'Coach', icon: Brain },
    { href: '/dashboard/weekly', label: 'Weekly', icon: Calendar },
    { href: '/dashboard/playbooks', label: 'Playbooks', icon: FileText },
    { href: '/dashboard/draft-queue', label: 'Draft Queue', icon: Edit },
    { href: '/dashboard/briefings', label: 'Briefings', icon: Briefcase },
    { href: '/dashboard/handoff', label: 'Handoff', icon: Hand },
    { href: '/dashboard/achievements', label: 'Achievements', icon: Trophy },
    { href: '/dashboard/integrations', label: 'Integrations', icon: Zap },
  ]

  const adminLinks = [
    { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
    { href: '/dashboard/team-management', label: 'Team Management', icon: Users },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
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
      >
        <div className="h-screen flex flex-col">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">HW</span>
              </div>
              <span className="font-bold text-gray-900">HeyWren</span>
            </Link>
            <button
              onClick={onToggle}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {mainLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => open && onToggle()}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive(href)
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            ))}

            {/* Admin Section */}
            {isAdmin && (
              <>
                <div className="pt-4 mt-4 border-t border-gray-200">
                  <p className="px-4 text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Administration
                  </p>
                  {adminLinks.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => open && onToggle()}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        isActive(href)
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </nav>
        </div>
      </aside>
    </>
  )
}
