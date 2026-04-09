'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import type { Commitment } from '@/lib/stores/dashboard-store'
import {
  ArrowRight, AlertTriangle, Clock, CheckCircle2, Zap,
  Mail, MessageSquare, Hourglass, ListChecks,
} from 'lucide-react'
import { useTodo } from '@/lib/contexts/todo-context'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

// Unified item type that represents anything needing attention
interface FocusItem {
  id: string
  title: string
  subtitle: string
  age: number // days
  urgency: 'critical' | 'high' | 'medium' | 'low'
  source: 'commitment' | 'missed_email' | 'missed_chat' | 'waiting_room'
  sourceLabel: string
  sourceIcon: typeof Mail
  actionLabel: { text: string; icon: typeof AlertTriangle; color: string; bgColor: string }
  href: string // deep link to the feature page
  todoTitle: string // pre-filled title for the to-do button
  onDone?: () => void // optional quick-done action
}

const urgencyWeight = { critical: 4, high: 3, medium: 2, low: 1 }

interface TodaysFocusProps {
  commitments: Commitment[]
  integrationCount: number
  onMarkDone: (id: string) => void
}

export function TodaysFocus({ commitments, integrationCount, onMarkDone }: TodaysFocusProps) {
  const { addTodoFromPage } = useTodo()
  const [missedEmails, setMissedEmails] = useState<any[]>([])
  const [missedChats, setMissedChats] = useState<any[]>([])
  const [waitingItems, setWaitingItems] = useState<any[]>([])

  // Fetch missed emails, chats, and waiting room items
  useEffect(() => {
    async function fetchAll() {
      try {
        const [emailRes, chatRes, waitRes] = await Promise.all([
          fetch('/api/missed-emails').then(r => r.ok ? r.json() : null),
          fetch('/api/missed-chats').then(r => r.ok ? r.json() : null),
          fetch('/api/awaiting-replies').then(r => r.ok ? r.json() : null),
        ])
        setMissedEmails((emailRes?.missedEmails || []).filter((e: any) => e.status === 'pending'))
        setMissedChats((chatRes?.missedChats || []).filter((c: any) => c.status === 'pending'))
        setWaitingItems((waitRes?.items || waitRes?.awaitingReplies || []).filter((w: any) => w.status === 'waiting'))
      } catch { /* ignore — commitments still work */ }
    }
    fetchAll()
  }, [])

  // Build unified focus items
  const focusItems: FocusItem[] = []

  // Commitments
  const open = commitments.filter(c => c.status === 'open')
  const overdue = commitments.filter(c => c.status === 'overdue')

  for (const c of [...overdue, ...open]) {
    const age = daysSince(c.created_at)
    let urgency: FocusItem['urgency'] = 'low'
    let actionLabel: FocusItem['actionLabel']

    if (c.status === 'overdue') {
      urgency = 'critical'
      actionLabel = { text: 'Overdue', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' }
    } else if (age > 7) {
      urgency = 'high'
      actionLabel = { text: 'At risk', icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' }
    } else if (age > 3) {
      urgency = 'medium'
      actionLabel = { text: 'Stalling', icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' }
    } else {
      actionLabel = { text: 'New', icon: Zap, color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-50 dark:bg-indigo-900/20' }
    }

    focusItems.push({
      id: `commitment-${c.id}`,
      title: c.title,
      subtitle: `${age}d ago${c.source ? ` · ${c.source === 'slack' ? 'Slack' : c.source === 'outlook' || c.source === 'email' ? 'Email' : c.source}` : ''}`,
      age,
      urgency,
      source: 'commitment',
      sourceLabel: 'Commitment',
      sourceIcon: CheckCircle2,
      actionLabel,
      href: '/commitments',
      todoTitle: c.title,
      onDone: () => onMarkDone(c.id),
    })
  }

  // Missed emails (critical/high urgency only for focus)
  for (const e of missedEmails.filter((e: any) => e.urgency === 'critical' || e.urgency === 'high').slice(0, 3)) {
    const age = daysSince(e.received_at || e.created_at)
    focusItems.push({
      id: `email-${e.id}`,
      title: `Reply to: ${e.subject || '(no subject)'}`,
      subtitle: `From ${e.from_name || e.from_email || 'Unknown'} · ${age}d ago`,
      age,
      urgency: e.urgency === 'critical' ? 'critical' : 'high',
      source: 'missed_email',
      sourceLabel: 'Missed Email',
      sourceIcon: Mail,
      actionLabel: e.urgency === 'critical'
        ? { text: 'Urgent', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' }
        : { text: 'Needs reply', icon: Mail, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
      href: '/missed-emails',
      todoTitle: `Reply to: ${e.subject || '(no subject)'}`,
    })
  }

  // Missed chats (critical/high urgency only)
  for (const c of missedChats.filter((c: any) => c.urgency === 'critical' || c.urgency === 'high').slice(0, 3)) {
    const age = daysSince(c.created_at)
    focusItems.push({
      id: `chat-${c.id}`,
      title: `Reply to ${c.sender_name || 'Slack message'}`,
      subtitle: `${c.question_summary || c.reason || 'Needs response'} · ${age}d ago`,
      age,
      urgency: c.urgency === 'critical' ? 'critical' : 'high',
      source: 'missed_chat',
      sourceLabel: 'Missed Chat',
      sourceIcon: MessageSquare,
      actionLabel: c.urgency === 'critical'
        ? { text: 'Urgent', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' }
        : { text: 'Needs reply', icon: MessageSquare, color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-900/20' },
      href: '/missed-chats',
      todoTitle: `Reply to ${c.sender_name || 'Slack message'}: ${c.question_summary || 'Follow up'}`,
    })
  }

  // Waiting room items (3+ days waiting)
  for (const w of waitingItems.filter((w: any) => daysSince(w.created_at) >= 3).slice(0, 3)) {
    const age = daysSince(w.created_at)
    focusItems.push({
      id: `waiting-${w.id}`,
      title: `Follow up: ${w.subject || w.wait_reason || 'Awaiting reply'}`,
      subtitle: `To ${w.to_recipients || 'Unknown'} · Waiting ${age}d`,
      age,
      urgency: age > 7 ? 'high' : 'medium',
      source: 'waiting_room',
      sourceLabel: 'Waiting',
      sourceIcon: Hourglass,
      actionLabel: age > 7
        ? { text: `${age}d waiting`, icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' }
        : { text: `${age}d waiting`, icon: Hourglass, color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-900/20' },
      href: '/waiting-room',
      todoTitle: `Follow up with ${w.to_recipients || 'recipient'}: ${w.subject || w.wait_reason || 'Awaiting reply'}`,
    })
  }

  // Sort by urgency (critical first), then by age (oldest first)
  focusItems.sort((a, b) => {
    const urgDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency]
    if (urgDiff !== 0) return urgDiff
    return b.age - a.age
  })

  const topItems = focusItems.slice(0, 5)

  if (commitments.length === 0 && missedEmails.length === 0 && missedChats.length === 0 && waitingItems.length === 0) return null

  // Count items by source for the summary
  const sourceCountMap = topItems.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Today&apos;s Focus</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {topItems.length > 0
              ? `${focusItems.length} item${focusItems.length !== 1 ? 's' : ''} need${focusItems.length === 1 ? 's' : ''} your attention`
              : 'You\'re in great shape'}
          </p>
        </div>
        {topItems.length > 0 && (
          <div className="flex items-center gap-2">
            {sourceCountMap.commitment && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" />{sourceCountMap.commitment}</span>
            )}
            {sourceCountMap.missed_email && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{sourceCountMap.missed_email}</span>
            )}
            {sourceCountMap.missed_chat && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><MessageSquare className="w-2.5 h-2.5" />{sourceCountMap.missed_chat}</span>
            )}
            {sourceCountMap.waiting_room && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Hourglass className="w-2.5 h-2.5" />{sourceCountMap.waiting_room}</span>
            )}
          </div>
        )}
      </div>

      {topItems.length === 0 ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">All clear!</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">No urgent items need your attention</p>
        </div>
      ) : (
        <div className="space-y-2">
          {topItems.map(item => {
            const ActionIcon = item.actionLabel.icon
            const SourceIcon = item.sourceIcon
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition group">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold ${item.actionLabel.bgColor} ${item.actionLabel.color} flex-shrink-0`}>
                  <ActionIcon className="w-3 h-3" />
                  {item.actionLabel.text}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <SourceIcon className="w-2.5 h-2.5" />
                    {item.subtitle}
                  </p>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 transition">
                  <button
                    onClick={() => addTodoFromPage(item.todoTitle)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition"
                    title="Add to To-Dos"
                  >
                    <ListChecks className="w-3 h-3" />
                  </button>
                  {item.onDone && (
                    <button
                      onClick={item.onDone}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-md hover:bg-green-100 dark:hover:bg-green-900/50 transition"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Done
                    </button>
                  )}
                  <Link
                    href={item.href}
                    className="flex items-center px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )
          })}

          {focusItems.length > 5 && (
            <p className="text-xs text-center text-gray-400 dark:text-gray-500 pt-1">
              +{focusItems.length - 5} more items across your queues
            </p>
          )}
        </div>
      )}
    </section>
  )
}
