// app/(dashboard)/relationships/page.tsx
// Relationship Health v4 — SECURITY FIX: All queries filtered by team_id
// Card grid with health scores, trend arrows, alerts

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface Contact {
  name: string
  email: string
  interactions: number
  lastActive: string
  daysSinceContact: number
  healthScore: number
  trend: 'up' | 'down' | 'stable'
  role: string
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function calculateHealthScore(interactions: number, daysSinceLastContact: number): number {
  let score = 50
  // Interaction frequency boost
  if (interactions >= 20) score += 25
  else if (interactions >= 10) score += 15
  else if (interactions >= 5) score += 8
  // Recency penalty
  if (daysSinceLastContact > 14) score -= 30
  else if (daysSinceLastContact > 7) score -= 15
  else if (daysSinceLastContact > 3) score -= 5
  else score += 10
  return Math.max(10, Math.min(99, score))
}

function getScoreColor(score: number): { ring: string; text: string; bg: string } {
  if (score >= 75) return { ring: '#22c55e', text: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' }
  if (score >= 50) return { ring: '#6366f1', text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' }
  if (score >= 35) return { ring: '#f59e0b', text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' }
  return { ring: '#ef4444', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' }
}

function getTrend(daysSinceLastContact: number, interactions: number): 'up' | 'down' | 'stable' {
  if (daysSinceLastContact <= 2 && interactions >= 10) return 'up'
  if (daysSinceLastContact > 7) return 'down'
  return 'stable'
}

function inferRole(email: string, name: string, interactions: number): string {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  if (domain.includes('routeware')) return interactions > 15 ? 'Direct Report' : 'Team Member'
  if (interactions > 10) return 'Key Stakeholder'
  if (interactions > 5) return 'Collaborator'
  return 'Contact'
}

export default function RelationshipsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      // ── SECURITY: Get user's team_id first ──
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) {
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      const teamId = profile?.current_team_id
      if (!teamId) {
        setLoading(false)
        return
      }

      // Get the current user's email to exclude from relationships
      const userEmail = userData.user.email?.toLowerCase() || ''

      try {
        let query = supabase
          .from('outlook_messages')
          .select('from_email, from_name, received_at')
          .eq('team_id', teamId)
          .order('received_at', { ascending: false })
          .limit(1000)

        if (userEmail) {
          query = query.neq('from_email', userEmail)
        }

        const { data: emailData } = await query

        if (emailData) {
          const contactMap: Record<string, { name: string; email: string; count: number; lastDate: string; dates: string[] }> = {}

          emailData.forEach((msg: any) => {
            const email = (msg.from_email || '').toLowerCase()
            if (!email || email.includes('noreply') || email.includes('notification') || email.includes('mailer-daemon') || email.includes('postmaster') || email.includes('no-reply')) return

            const receivedAt = msg.received_at || new Date().toISOString()

            if (!contactMap[email]) {
              contactMap[email] = {
                name: msg.from_name || email.split('@')[0],
                email,
                count: 0,
                lastDate: receivedAt,
                dates: []
              }
            }
            contactMap[email].count++
            if (receivedAt) {
              contactMap[email].dates.push(receivedAt)
              if (receivedAt > contactMap[email].lastDate) {
                contactMap[email].lastDate = receivedAt
              }
            }
          })

          const sorted = Object.values(contactMap)
            .sort((a, b) => b.count - a.count)
            .slice(0, 20)
            .map(c => {
              const dsc = daysSince(c.lastDate)
              const score = calculateHealthScore(c.count, dsc)
              return {
                name: c.name,
                email: c.email,
                interactions: c.count,
                lastActive: c.lastDate,
                daysSinceContact: dsc,
                healthScore: score,
                trend: getTrend(dsc, c.count),
                role: inferRole(c.email, c.name, c.count),
              }
            })

          setContacts(sorted)
        }
      } catch (err) {
        console.error('Error fetching relationship data:', err)
        toast.error('Failed to load relationship data')
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading relationships">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-40 bg-gray-100 dark:bg-gray-800 rounded"></div>)}
          </div>
        </div>
      </div>
    )
  }

  if (contacts.length === 0) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Relationship Health</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">How strong are your key relationships — based on interaction patterns and follow-through</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">👥</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No relationship data yet</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm max-w-md mx-auto mb-6">
            Connect your Outlook account and sync your email history. Wren will analyze your interaction patterns to show relationship health scores.
          </p>
          <a href="/integrations" className="inline-flex px-5 py-2.5 text-white font-semibold rounded-lg text-sm transition" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
            Connect Outlook
          </a>
        </div>
      </div>
    )
  }

  const needsAttention = contacts.filter(c => c.healthScore < 50 && c.interactions >= 5)
  const totalInteractions = contacts.reduce((sum, c) => sum + c.interactions, 0)

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Relationship Health</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">How strong are your key relationships — based on interaction patterns and follow-through</p>
      </div>

      {/* Alert banner */}
      {needsAttention.length > 0 && (
        <div role="alert" className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 flex items-start gap-3">
          <span className="text-yellow-600 text-lg" aria-hidden="true">⚠</span>
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <span className="font-semibold">{needsAttention.length} relationship{needsAttention.length > 1 ? 's' : ''} need{needsAttention.length === 1 ? 's' : ''} attention:</span>{' '}
            {needsAttention.slice(0, 2).map(c => c.name).join(', ')}
            {needsAttention.length > 2 ? ` and ${needsAttention.length - 2} more` : ''}
            {' — '} interaction frequency dropping
          </div>
        </div>
      )}

      {/* Relationship Cards — 2 column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {contacts.slice(0, 10).map(contact => {
          const scoreColor = getScoreColor(contact.healthScore)
          const initials = contact.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
          const colors = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500']
          const bgColor = colors[contact.name.charCodeAt(0) % colors.length]
          const lastContactText = contact.daysSinceContact === 0 ? 'Today' : contact.daysSinceContact === 1 ? '1 day ago' : `${contact.daysSinceContact} days ago`

          return (
            <div key={contact.email} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 ${bgColor} rounded-full flex items-center justify-center text-white text-sm font-bold`}>
                    {initials}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{contact.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{contact.role}</div>
                  </div>
                </div>

                {/* Health Score Ring */}
                <div className="relative w-12 h-12">
                  <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48" role="img" aria-label={`Health score: ${contact.healthScore}`}>
                    <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-200 dark:text-gray-700" />
                    <circle
                      cx="24" cy="24" r="20" fill="none"
                      stroke={scoreColor.ring}
                      strokeWidth="3"
                      strokeDasharray={`${(contact.healthScore / 100) * 125.6} 125.6`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-sm font-bold ${scoreColor.text}`}>{contact.healthScore}</span>
                  </div>
                  {/* Trend arrow */}
                  <div className={`absolute -bottom-1 -right-1 text-xs ${
                    contact.trend === 'up' ? 'text-green-500' : contact.trend === 'down' ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {contact.trend === 'up' ? '▲' : contact.trend === 'down' ? '▼' : '→'}
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <div className="text-xs text-gray-400">Last 1:1</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{lastContactText}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">This week</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{contact.interactions} interactions</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {contacts.length > 10 && (
        <p className="text-center text-sm text-gray-400">
          Showing top 10 of {contacts.length} relationships · {totalInteractions} total interactions
        </p>
      )}
    </div>
  )
}
