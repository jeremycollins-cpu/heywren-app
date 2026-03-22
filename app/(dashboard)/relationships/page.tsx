'use client'

import { useState } from 'react'
import { Users, MessageCircle, TrendingUp, Search } from 'lucide-react'

interface Relationship {
  id: string
  name: string
  title: string
  lastInteraction: string
  sentiment: 'positive' | 'neutral' | 'negative'
  commitments: number
  health: number
}

const mockRelationships: Relationship[] = []

export default function RelationshipsPage() {
  const [searchTerm, setSearchTerm] = useState('')

  const filtered = mockRelationships.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getHealthColor = (health: number) => {
    if (health >= 80) return 'text-green-600'
    if (health >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getSentimentBg = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return 'bg-green-50 text-green-700'
      case 'negative':
        return 'bg-red-50 text-red-700'
      default:
        return 'bg-gray-50 text-gray-700'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Relationships</h1>
        <p className="text-gray-600 mt-1">
          Track relationship health across your stakeholders based on interaction patterns and follow-through
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search relationships..."
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
              <p className="text-sm text-gray-600">Total Relationships</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{mockRelationships.length}</p>
            </div>
            <Users className="w-10 h-10 text-indigo-100" />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Healthy Relations</p>
              <p className="text-3xl font-bold text-green-600 mt-2">
                {mockRelationships.filter(r => r.health >= 80).length}
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-green-100" />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Open Commitments</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">
                {mockRelationships.reduce((sum, r) => sum + r.commitments, 0)}
              </p>
            </div>
            <MessageCircle className="w-10 h-10 text-blue-100" />
          </div>
        </div>
      </div>

      {/* Relationships List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No relationships tracked yet</h3>
            <p className="text-gray-500 max-w-md mb-6">
              Connect Slack or Outlook to start automatically tracking relationship health based on your interactions and follow-through on commitments.
            </p>
            <a href="/integrations" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Connect an Integration
            </a>
          </div>
        ) : (
          filtered.map((relationship) => (
          <div key={relationship.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="text-indigo-600 font-bold">
                      {relationship.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{relationship.name}</h3>
                    <p className="text-sm text-gray-600">{relationship.title}</p>
                  </div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getSentimentBg(relationship.sentiment)}`}>
                {relationship.sentiment.charAt(0).toUpperCase() + relationship.sentiment.slice(1)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-600 mb-1">Health Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full bg-indigo-600 transition-all`}
                      style={{ width: `${relationship.health}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold ${getHealthColor(relationship.health)}`}>
                    {relationship.health}%
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Open Commitments</p>
                <p className="text-lg font-bold text-gray-900">{relationship.commitments}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Last Interaction</p>
                <p className="text-sm font-medium text-gray-900">{relationship.lastInteraction}</p>
              </div>
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  )
}
