'use client'

import Link from 'next/link'
import type { Commitment } from '@/lib/stores/dashboard-store'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildWhyNow(c: Commitment): { urgencyContext: string; whyNow: string; quote?: string; quoteAttribution?: string } | null {
  const age = daysSince(c.created_at)
  const meta = (c.metadata && typeof c.metadata === 'object') ? c.metadata : {} as Record<string, any>
  const urgency = meta.urgency as string | undefined
  const tone = meta.tone as string | undefined
  const stakeholders = (meta.stakeholders || []) as Array<{ name: string; role: string }>
  const originalQuote = meta.originalQuote as string | undefined
  const commitmentType = meta.commitmentType as string | undefined
  const channelName = meta.channelName as string | undefined

  // Build urgency context line
  let urgencyContext = ''
  if (urgency === 'critical') urgencyContext = 'ASAP'
  else if (age > 14) urgencyContext = `Overdue — ${formatDate(c.created_at)} commitment`
  else if (age > 7) urgencyContext = `${age} days with no resolution`
  else if (urgency === 'high') urgencyContext = 'High priority'
  else if (age > 3) urgencyContext = `${age} days open`
  else return null // too fresh, not worth a "why now"

  // Build why now narrative
  const ownerNames = stakeholders.filter(s => s.role === 'stakeholder' || s.role === 'assignee').map(s => s.name)
  const sourceBadge = c.source === 'slack' ? 'Slack' : c.source === 'outlook' || c.source === 'email' ? 'Email' : 'Manual'

  let whyNow = ''
  if (age > 14 && originalQuote) {
    whyNow = `${age} days have passed with no visible resolution.`
    if (ownerNames.length > 0) {
      whyNow += ` ${ownerNames[0]} may be waiting on this.`
    }
  } else if (age > 7 && tone === 'demanding') {
    whyNow = `This was flagged as ${tone} ${age} days ago. No follow-up detected since.`
  } else if (age > 7) {
    whyNow = `Created ${age} days ago via ${sourceBadge}.`
    if (ownerNames.length > 0) {
      whyNow += ` Involves ${ownerNames.join(', ')}.`
    }
    whyNow += ' No completion signal yet.'
  } else if (urgency === 'critical') {
    whyNow = `Marked as urgent${channelName ? ' in #' + channelName : ''}.`
    if (ownerNames.length > 0) whyNow += ` ${ownerNames.join(' and ')} are waiting.`
  } else {
    whyNow = `Open for ${age} days.`
  }

  // Quote attribution
  let quoteAttribution: string | undefined
  if (originalQuote && stakeholders.length > 0) {
    const names = stakeholders.map(s => s.name).join(' + ')
    quoteAttribution = `${names} (${sourceBadge}, ${formatDate(c.created_at)})`
  }

  return {
    urgencyContext,
    whyNow,
    quote: originalQuote,
    quoteAttribution,
  }
}

interface NudgeCardProps {
  commitment: Commitment
  onDone: (id: string) => void
  onSnooze: (id: string) => void
  onDismiss: (id: string) => void
}

export function NudgeCard({ commitment: c, onDone, onSnooze, onDismiss }: NudgeCardProps) {
  const age = daysSince(c.created_at)
  const urgency = age > 7 ? 'URGENT' : age > 5 ? 'GENTLE' : 'DIGEST'
  const score = Math.max(100 - age * 5, 30)
  const meta = (c.metadata && typeof c.metadata === 'object') ? c.metadata : {} as Record<string, any>
  const metaUrgency = meta.urgency as string | undefined
  if (metaUrgency === 'critical' && urgency !== 'URGENT') {
    // Promote to urgent if metadata says critical
  }
  const borderColor = urgency === 'URGENT' ? 'border-l-red-500' : urgency === 'GENTLE' ? 'border-l-indigo-500' : 'border-l-gray-400'
  const badgeColor = urgency === 'URGENT' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : urgency === 'GENTLE' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  const sourceBadge = c.source === 'slack' ? 'SLACK' : c.source === 'outlook' || c.source === 'email' ? 'OUTLOOK' : 'MANUAL'
  const sourceBadgeColor = c.source === 'slack' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' : c.source === 'outlook' || c.source === 'email' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

  const whyNow = buildWhyNow(c)

  return (
    <article className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${borderColor} rounded-brand p-5`}>
      {/* Badge row */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${badgeColor}`}>{urgency}</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">Score: {score}</span>
        {metaUrgency === 'critical' && urgency !== 'URGENT' && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">OVERDUE</span>
        )}
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceBadgeColor}`}>{sourceBadge}</span>
        {meta.channelName && (
          <span className="text-xs text-gray-400">#{meta.channelName}</span>
        )}
      </div>

      {/* Title */}
      <div className="font-bold text-gray-900 dark:text-white mb-1">{c.title}</div>

      {/* Why Now section */}
      {whyNow && (
        <div className="mb-3">
          <div className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">
            {whyNow.urgencyContext}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            <span className="font-semibold">Why now?</span> {whyNow.whyNow}
          </p>

          {/* Evidence quote */}
          {whyNow.quote && (
            <div className="mt-2 border-l-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded-r-lg px-3 py-2">
              <p className="text-xs text-gray-600 dark:text-gray-300 italic leading-relaxed">
                &ldquo;{whyNow.quote}&rdquo;
              </p>
              {whyNow.quoteAttribution && (
                <p className="text-[10px] text-gray-400 mt-0.5">— {whyNow.quoteAttribution}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Description fallback if no whyNow */}
      {!whyNow && c.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{c.description}</p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button onClick={() => onDone(c.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">Done</button>
        <button onClick={() => onSnooze(c.id)} className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 transition-colors">Snooze</button>
        <button onClick={() => onDismiss(c.id)} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Dismiss</button>
        {c.source_url ? (
          <a
            href={c.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Open Source
          </a>
        ) : (
          <Link
            href="/commitments"
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            View Trace
          </Link>
        )}
      </div>
    </article>
  )
}
