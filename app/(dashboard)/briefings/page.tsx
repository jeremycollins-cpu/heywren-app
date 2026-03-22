'use client'

import { useState } from 'react'
import { Briefcase, Clock, Users, FileText } from 'lucide-react'

interface Briefing {
  id: string
  meeting: string
  time: string
  attendees: number
  openCommitments: number
  keyTopics: string[]
}

const mockBriefings: Briefing[] = []

export default function BriefingsPage() {
  const [expandedBriefing, setExpandedBriefing] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Pre-Meeting Briefings</h1>
        <p className="text-gray-600 mt-1">
          HeyWren prepares context cards for every meeting — open commitments, relationships, and talking points
        </p>
      </div>

      {/* Upcoming Briefings */}
      <div className="space-y-3">
        {mockBriefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <Briefcase className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No upcoming meetings</h3>
            <p className="text-gray-500 max-w-md mb-6">
              Connect your calendar to Slack or Outlook to automatically generate context briefings for your upcoming meetings. HeyWren will surface relevant commitments and relationships for each meeting.
            </p>
            <a href="/dashboard/integrations" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Connect Calendar
            </a>
          </div>
        ) : (
          mockBriefings.map((briefing) => (
          <div
            key={briefing.id}
            onClick={() => setExpandedBriefing(expandedBriefing === briefing.id ? null : briefing.id)}
            className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition cursor-pointer"
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Briefcase className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-semibold text-gray-900">{briefing.meeting}</h3>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {briefing.time}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {briefing.attendees} attendees
                    </div>
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className="text-xs text-gray-600 mb-1">Open Commitments</div>
                  <div className="text-2xl font-bold text-red-600">{briefing.openCommitments}</div>
                </div>
              </div>

              {expandedBriefing === briefing.id && (
                <>
                  <hr className="my-4 border-gray-100" />
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Key Topics
                      </h4>
                      <div className="space-y-2">
                        {briefing.keyTopics.map((topic, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                            <span className="w-2 h-2 bg-indigo-600 rounded-full" />
                            {topic}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-yellow-900 mb-2">Open Items to Address</h4>
                      <div className="space-y-2 text-sm text-yellow-800">
                        <div className="flex gap-2">
                          <span className="text-yellow-600">→</span> Confirm Q2 product launch timeline
                        </div>
                        <div className="flex gap-2">
                          <span className="text-yellow-600">→</span> Resolve infrastructure scaling concerns
                        </div>
                        <div className="flex gap-2">
                          <span className="text-yellow-600">→</span> Finalize pricing strategy
                        </div>
                      </div>
                    </div>

                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-indigo-900 mb-2">Related Relationships</h4>
                      <div className="space-y-2">
                        {['James Park (CEO)', 'Sarah Chen (VP Product)', 'Michael Rodriguez (VP Sales)'].map((person, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-indigo-800">
                            <div className="w-6 h-6 bg-indigo-200 rounded-full" />
                            {person}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          ))
        )}
      </div>

      {/* Briefing Features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
          <h3 className="font-semibold text-indigo-900 mb-2">What's Included</h3>
          <ul className="text-sm text-indigo-800 space-y-2">
            <li>✓ Open commitments relevant to this meeting</li>
            <li>✓ Recent interactions with attendees</li>
            <li>✓ Relationship health scores</li>
            <li>✓ Previous action items</li>
          </ul>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <h3 className="font-semibold text-purple-900 mb-2">Smart Scheduling</h3>
          <ul className="text-sm text-purple-800 space-y-2">
            <li>✓ Auto-sync with your calendar</li>
            <li>✓ Alert 30 min before meeting starts</li>
            <li>✓ Export briefing as document</li>
            <li>✓ Share with meeting attendees</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
