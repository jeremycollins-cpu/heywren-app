'use client'

import { useState } from 'react'
import { Hand, Calendar, CheckCircle2, AlertCircle } from 'lucide-react'

interface Handoff {
  id: string
  person: string
  dates: string
  commitments: number
  status: 'pending' | 'completed'
}

const mockHandoffs: Handoff[] = [
  {
    id: '1',
    person: 'Sarah Chen',
    dates: 'Mar 24 - Mar 31',
    commitments: 12,
    status: 'completed',
  },
  {
    id: '2',
    person: 'Michael Rodriguez',
    dates: 'Apr 14 - Apr 21',
    commitments: 8,
    status: 'pending',
  },
  {
    id: '3',
    person: 'Emma Thompson',
    dates: 'May 5 - May 19',
    commitments: 15,
    status: 'pending',
  },
]

export default function HandoffPage() {
  const [expandedHandoff, setExpandedHandoff] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">PTO Handoff Protocol</h1>
        <p className="text-gray-600 mt-1">
          When someone goes OOO, HeyWren surfaces every open commitment and ensures clean transfers
        </p>
      </div>

      {/* Handoff Items */}
      <div className="space-y-3">
        {mockHandoffs.map((handoff) => (
          <div
            key={handoff.id}
            onClick={() => setExpandedHandoff(expandedHandoff === handoff.id ? null : handoff.id)}
            className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="text-indigo-600 font-bold text-sm">
                      {handoff.person.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{handoff.person}</h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mt-0.5">
                      <Calendar className="w-4 h-4" />
                      {handoff.dates}
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-right ml-4">
                <div className="flex items-center gap-1 justify-end">
                  {handoff.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-yellow-600" />
                  )}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {handoff.commitments} commitments
                </div>
              </div>
            </div>

            {expandedHandoff === handoff.id && (
              <>
                <hr className="my-4 border-gray-100" />
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Open Commitments to Handoff</h4>
                    <div className="space-y-2">
                      <div className="flex items-start gap-3 text-sm">
                        <input type="checkbox" defaultChecked className="mt-1" />
                        <div>
                          <p className="font-medium text-gray-900">Q2 Revenue Report</p>
                          <p className="text-gray-600 text-xs mt-0.5">Due: Mar 28 - Assign to Michael Rodriguez</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-1" />
                        <div>
                          <p className="font-medium text-gray-900">Board Meeting Prep</p>
                          <p className="text-gray-600 text-xs mt-0.5">Due: Mar 26 - Assign to James Park (CEO)</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 text-sm">
                        <input type="checkbox" defaultChecked className="mt-1" />
                        <div>
                          <p className="font-medium text-gray-900">Customer Success Reviews</p>
                          <p className="text-gray-600 text-xs mt-0.5">Due: Mar 29 - Assign to Emma Thompson</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-900 mb-2">Handoff Checklist</h4>
                    <div className="space-y-2 text-sm text-blue-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" defaultChecked disabled />
                        <span>All commitments documented</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" defaultChecked disabled />
                        <span>Backup assigned for each item</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" disabled />
                        <span>Handoff meeting completed</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" disabled />
                        <span>Backup confirmed understanding</span>
                      </label>
                    </div>
                  </div>

                  <button className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
                    Complete Handoff
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h3 className="font-semibold text-green-900 mb-2">PTO Protocol Benefits</h3>
        <p className="text-sm text-green-800 mb-3">
          Ensure zero commitments slip through the cracks when team members take time off.
        </p>
        <ul className="text-sm text-green-800 space-y-1">
          <li>✓ Automatic backup assignment</li>
          <li>✓ Commitment handoff tracking</li>
          <li>✓ Stakeholder notifications</li>
          <li>✓ Post-PTO sync reminders</li>
        </ul>
      </div>
    </div>
  )
}
