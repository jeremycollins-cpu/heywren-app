'use client'

import type { SlackMention } from '@/lib/stores/dashboard-store'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function isThisWeek(dateStr: string): boolean {
  return daysSince(dateStr) <= 7
}

interface MentionsSectionProps {
  mentions: SlackMention[]
}

export function MentionsSection({ mentions }: MentionsSectionProps) {
  const recentMentions = mentions
    .filter(m => m.message_text?.includes('<@') || m.commitments_found > 0)
    .slice(0, 3)

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-brand p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-green-600 text-white rounded text-xs font-bold">@HeyWren</span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Recent Mentions</h2>
        </div>
        <span className="text-sm text-gray-400 dark:text-gray-500">
          {mentions.filter(m => isThisWeek(m.created_at)).length} this week
        </span>
      </div>

      {recentMentions.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Tag <span className="font-semibold text-green-600">@HeyWren</span> in any Slack conversation to capture commitments. Try it now!
        </p>
      ) : (
        <div className="space-y-4">
          {recentMentions.map((m, i) => (
            <div key={m.id || i} className="flex items-start gap-3">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center text-sm" aria-hidden="true">
                💬
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 dark:text-white">
                  <span className="font-semibold text-green-600">@HeyWren</span>{' '}
                  {m.message_text?.replace(/<@[A-Z0-9]+>/g, '').trim().slice(0, 100)}
                  {(m.message_text?.length || 0) > 100 ? '...' : ''}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 dark:text-gray-500">
                  <span>Slack</span>
                  <span aria-hidden="true">·</span>
                  <span>{daysSince(m.created_at) === 0 ? 'Today' : daysSince(m.created_at) === 1 ? 'Yesterday' : `${daysSince(m.created_at)} days ago`}</span>
                  <span aria-hidden="true">·</span>
                  <span className={m.commitments_found > 0 ? 'text-green-600 font-medium' : 'text-yellow-600 font-medium'}>
                    {m.commitments_found > 0 ? 'Captured → Commitment Trace' : 'Pending review'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
