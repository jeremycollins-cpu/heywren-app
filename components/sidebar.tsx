'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Menu, X, BarChart3, CheckCircle2, Zap, Settings, Users, Brain,
  Calendar, FileText, Edit, Briefcase, Hand, Trophy
} from 'lucide-react'

interface SidebarProps {
  open: boolean
  onToggle: () => void
}

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname()

  const links = [
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
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname.startsWith(href)
  }

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
            {links.map(({ href, label, icon: Icon }) => (
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
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-200 p-4">
            <button className="flex items-center gap-3 w-full px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-all">
              <Settings className="w-5 h-5" />
              Settings
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
