'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, MessageCircle, TrendingUp, Search, Mail, Hash } from 'lucide-react'

interface Relationship {
  name: string
  email: string
  source: string
  commitmentCount: number
  lastInteraction: string
}

export default function RelationshipsPage() {
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  const supabase = createClient()

  useEffect(() => {
    const fetchRelationships = async () => {
      try {
        // Get relationships from Outlook messages (senders)
        const { data: outlookMsgs } = await supabase
          .from('outlook_messages')
          .select('from_name, from_email, received_at')
          .order('received_at', { ascending: false })

        // Get commitments for source counts
        const { data: commitments } = await supabase
          .from('commitments')
          .select('id, source, created_at')

        // Aggregate by sender
        const peopleMap = new Map<string, Relationship>()

        for (const msg of (outlookMsgs || [])) {
          const key = (msg.from_email || '').toLowerCase()
          if (!key || key.includes('noreply') || key.includes('no-reply') || key.includes('mailer-daemon') || key.includes('notifications')) continue

          const existing = peopleMap.get(key)
          if (existing) {
            existing.commitmentCount++
            // Keep the most recent interaction
            if (msg.received_at > existing.lastInteraction) {
              existing.lastInteraction = msg.received_at
            }
          } else {
            peopleMap.set(key, {
              name: msg.from_name || key,
              email: key,
              source: 'outlook',
              commitmentCount: 1,
              lastInteraction: msg.received_at || new Date().toISOString(),
            })
          }
        }

        // Sort by interaction count (most interactions first)
        const sorted = Array.from(peopleMap.values())
          .sort((a, b) => b.commitmentCount - a.commitmentCount)
          .slice(0, 50) // Top 50 relationships

        setRelationships(sorted)
      } catch (err) {
        console.error('Error fetching relationships:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchRelationships()
  }, [supabase])

  const filtered = relationships.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getInteractionRecency = (date: string) => {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) return { label: 'Today', color: 'text-green-600' }
    if (days === 1) return { label: 'Yesterday', color: 'text-green-600' }
    if (days <= 7) return { label: days + ' days ago', color: 'text-blue-600' }
    if (days <= 30) return { label: Math.floor(days / 7) + ' weeks ago', color: 'text-yellow-600' }
    return { label: Math.floor(days / 30) + ' months ago', color: 'text-red-600' }
  }

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading relationships...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Relationships</h1>
        <p className="text-gray-600 mt-1">
          People you interact with most, derived from your email and Slack activity
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Contacts</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{relationships.length}</p>
            </div>
            <Users className="w-10 h-10 text-indigo-100" />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active This Week</p>
              <p className="text-3xl font-bold text-green-600 mt-2">
                {relationships.filter(r => {
                  const days = Math.floor((Date.now() - new Date(r.lastInteraction).getTime()) / (1000 * 60 * 60 * 24))
                  return days <= 7
                }).length}
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-green-100" />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Interactions</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">
                {relationships.reduce((sum, r) => sum + r.commitmentCount, 0)}
              </p>
            </div>
            <MessageCircle className="w-10 h-10 text-blue-100" />
          </div>
        </div>
      </div>

      {/* Relationships List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {searchTerm ? 'No matching contacts' : 'No relationships tracked yet'}
            </h3>
            <p className="text-gray-500 max-w-md mb-6">
              {searchTerm
                ? 'Try a different search term.'
                : 'Connect Slack or Outlook and sync your messages to start tracking relationships.'}
            </p>
            {!searchTerm && (
              <a href="/integrations" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                Connect an Integration
              </a>
            )}
          </div>
        ) : (
          filtered.map((relationship, idx) => {
            const recency = getInteractionRecency(relationship.lastInteraction)
            return (
              <div key={relationship.email + idx} className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-indigo-600 font-bold text-sm">
                        {getInitials(relationship.name)}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{relationship.name}</h3>
                      <p className="text-sm text-gray-500">{relationship.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <p className="text-xs text-gray-500">Interactions</p>
                      <p className="text-lg font-bold text-gray-900">{relationship.commitmentCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Last Active</p>
                      <p className={`text-sm font-medium ${recency.color}`}>{recency.label}</p>
                    </div>
                    <div className="flex items-center">
                      {relationship.source === 'outlook' ? (
                        <Mail className="w-5 h-5 text-blue-400" />
                      ) : (
                        <Hash className="w-5 h-5 text-purple-400" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
