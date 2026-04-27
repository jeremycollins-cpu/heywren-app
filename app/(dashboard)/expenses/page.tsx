'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Receipt, RefreshCw, Download, ChevronDown, ChevronUp, ExternalLink,
  CheckCircle2, X, Loader2, FileText, Building2, DollarSign, Calendar,
  Paperclip, Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface ExpenseRow {
  id: string
  message_id: string
  outlook_message_id: string | null
  from_name: string | null
  from_email: string
  subject: string | null
  body_preview: string | null
  received_at: string
  web_link: string | null
  vendor: string
  vendor_domain: string
  amount: number | null
  currency: string | null
  receipt_date: string | null
  category: 'receipt' | 'invoice' | 'order_confirmation' | 'subscription' | 'other'
  confidence: number
  status: 'pending' | 'reviewed' | 'exported' | 'dismissed'
  has_attachments: boolean
  attachment_count: number
}

interface VendorGroup {
  vendor: string
  vendorDomain: string
  totalAmount: number
  currency: string | null
  count: number
  latestReceiptAt: string
  expenses: ExpenseRow[]
}

interface Attachment {
  id: string
  name: string
  contentType: string
  size: number
}

const categoryLabels: Record<string, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  order_confirmation: 'Order',
  subscription: 'Subscription',
  other: 'Other',
}

const categoryColors: Record<string, string> = {
  receipt: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  invoice: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  order_confirmation: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  subscription: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

function formatMoney(amount: number, currency: string | null): string {
  if (!currency) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ExpensesPage() {
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  const [expandedExpense, setExpandedExpense] = useState<string | null>(null)
  const [attachmentsByExpense, setAttachmentsByExpense] = useState<Record<string, Attachment[] | 'loading' | 'error'>>({})
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [downloadingAtt, setDownloadingAtt] = useState<string | null>(null)

  const loadExpenses = useCallback(async () => {
    try {
      const res = await fetch('/api/expenses')
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setGroups(data.groups || [])
        setTotalCount(data.totalCount || 0)
        setLastRefreshedAt(data.lastRefreshedAt || null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  async function loadAttachments(expenseId: string) {
    if (attachmentsByExpense[expenseId] && attachmentsByExpense[expenseId] !== 'error') return
    setAttachmentsByExpense(prev => ({ ...prev, [expenseId]: 'loading' }))
    try {
      const res = await fetch(`/api/expenses/${expenseId}/attachments`)
      const data = await res.json()
      if (!res.ok) {
        setAttachmentsByExpense(prev => ({ ...prev, [expenseId]: 'error' }))
        toast.error(data.error || 'Failed to load attachments')
        return
      }
      setAttachmentsByExpense(prev => ({ ...prev, [expenseId]: data.attachments || [] }))
    } catch {
      setAttachmentsByExpense(prev => ({ ...prev, [expenseId]: 'error' }))
      toast.error('Failed to load attachments')
    }
  }

  async function downloadAttachment(expenseId: string, attachment: Attachment) {
    setDownloadingAtt(`${expenseId}:${attachment.id}`)
    try {
      const res = await fetch(`/api/expenses/${expenseId}/attachments/${encodeURIComponent(attachment.id)}`)
      if (!res.ok) {
        const text = await res.text()
        toast.error(text || 'Download failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = attachment.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    } finally {
      setDownloadingAtt(null)
    }
  }

  async function triggerScan() {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/expenses', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to trigger scan')
      }
      toast.success('Scan started — new receipts will appear in a minute or two')
      setTimeout(() => loadExpenses(), 30000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scan'
      setError(message)
      toast.error(message)
    } finally {
      setScanning(false)
    }
  }

  async function updateStatus(expense: ExpenseRow, status: 'reviewed' | 'exported' | 'dismissed') {
    setActioningId(expense.id)
    try {
      const res = await fetch('/api/expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expense.id, status }),
      })
      if (!res.ok) {
        toast.error('Failed to update')
        return
      }
      // Optimistic: remove dismissed/exported from view
      if (status === 'dismissed' || status === 'exported') {
        setGroups(prev => prev
          .map(g => ({ ...g, expenses: g.expenses.filter(e => e.id !== expense.id), count: g.expenses.filter(e => e.id !== expense.id).length }))
          .filter(g => g.expenses.length > 0)
        )
        toast.success(status === 'exported' ? 'Marked as exported' : 'Dismissed')
      } else {
        // Re-fetch to update local copy with new status
        loadExpenses()
        toast.success('Marked as reviewed')
      }
    } finally {
      setActioningId(null)
    }
  }

  const totalAcrossVendors = groups.reduce((sum, g) => sum + g.totalAmount, 0)
  const primaryCurrency = groups.find(g => g.currency)?.currency || 'USD'

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Expenses</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Receipts, invoices, and order confirmations from your inbox — grouped by vendor and ready to download for expense reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {groups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Total tracked</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatMoney(totalAcrossVendors, primaryCurrency)}
            </p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-indigo-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Vendors</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{groups.length}</p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-violet-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Receipts</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalCount}</p>
          </div>
        </div>
      )}

      {lastRefreshedAt && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Last scanned {new Date(lastRefreshedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at{' '}
          {new Date(lastRefreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>
      )}

      {/* Vendor groups */}
      <div className="space-y-3">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
              <Receipt className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No receipts found yet
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              HeyWren scans your inbox a few times a day for receipts, invoices, and order
              confirmations. They&apos;ll appear here grouped by vendor — ready to download
              for your next expense report.
            </p>
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              Scan now
            </button>
          </div>
        ) : (
          groups.map(group => {
            const isExpanded = expandedVendor === group.vendorDomain
            return (
              <div
                key={group.vendorDomain}
                className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden transition hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => setExpandedVendor(isExpanded ? null : group.vendorDomain)}
                  aria-expanded={isExpanded}
                  className="w-full text-left p-5 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 dark:text-white text-base truncate">
                            {group.vendor}
                          </h3>
                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                            {group.vendorDomain}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          {group.count} receipt{group.count !== 1 ? 's' : ''}
                          {' · '}
                          most recent {new Date(group.latestReceiptAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {group.totalAmount > 0
                            ? formatMoney(group.totalAmount, group.currency || 'USD')
                            : '—'}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {group.expenses.map(expense => {
                        const expenseExpanded = expandedExpense === expense.id
                        const attData = attachmentsByExpense[expense.id]
                        return (
                          <li key={expense.id} className="p-4 sm:p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${categoryColors[expense.category]}`}>
                                    {categoryLabels[expense.category]}
                                  </span>
                                  {expense.status === 'reviewed' && (
                                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                      Reviewed
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                    <Calendar className="w-3 h-3" />
                                    {expense.receipt_date
                                      ? new Date(expense.receipt_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                      : new Date(expense.received_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {expense.subject || '(no subject)'}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                  From: {expense.from_name || expense.from_email}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <p className="text-base font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                  {expense.amount != null
                                    ? formatMoney(Number(expense.amount), expense.currency)
                                    : '—'}
                                </p>
                              </div>
                            </div>

                            {/* Action row */}
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => {
                                  if (expenseExpanded) {
                                    setExpandedExpense(null)
                                  } else {
                                    setExpandedExpense(expense.id)
                                    loadAttachments(expense.id)
                                  }
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-border-dark rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 transition"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                                {expenseExpanded ? 'Hide attachments' : 'Show attachments'}
                              </button>
                              <button
                                onClick={() => updateStatus(expense, 'exported')}
                                disabled={actioningId === expense.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Mark Exported
                              </button>
                              {expense.status === 'pending' && (
                                <button
                                  onClick={() => updateStatus(expense, 'reviewed')}
                                  disabled={actioningId === expense.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition disabled:opacity-50"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Mark Reviewed
                                </button>
                              )}
                              <button
                                onClick={() => updateStatus(expense, 'dismissed')}
                                disabled={actioningId === expense.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-border-dark text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" />
                                Not a receipt
                              </button>
                              {expense.web_link && (
                                <a
                                  href={expense.web_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition ml-auto"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Open in Outlook
                                </a>
                              )}
                            </div>

                            {/* Attachments panel */}
                            {expenseExpanded && (
                              <div className="mt-3 bg-gray-50 dark:bg-surface-dark rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                                {attData === 'loading' && (
                                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading attachments...
                                  </div>
                                )}
                                {attData === 'error' && (
                                  <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Couldn&apos;t load attachments. The email may have been deleted in Outlook, or your connection needs to be refreshed.
                                  </p>
                                )}
                                {Array.isArray(attData) && attData.length === 0 && (
                                  <p className="text-sm text-gray-500 dark:text-gray-400">
                                    No file attachments on this email. Open it in Outlook to view the receipt body.
                                  </p>
                                )}
                                {Array.isArray(attData) && attData.length > 0 && (
                                  <ul className="space-y-2">
                                    {attData.map(att => {
                                      const downloadKey = `${expense.id}:${att.id}`
                                      return (
                                        <li
                                          key={att.id}
                                          className="flex items-center gap-3 bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-md px-3 py-2"
                                        >
                                          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                              {att.name}
                                            </p>
                                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                              {formatBytes(att.size)} · {att.contentType}
                                            </p>
                                          </div>
                                          <button
                                            onClick={() => downloadAttachment(expense.id, att)}
                                            disabled={downloadingAtt === downloadKey}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 flex-shrink-0"
                                          >
                                            {downloadingAtt === downloadKey ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <Download className="w-3.5 h-3.5" />
                                            )}
                                            Download
                                          </button>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 sm:p-6">
        <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 mb-2">How Expenses works</h3>
        <p className="text-sm text-indigo-800 dark:text-indigo-300 mb-3">
          HeyWren uses AI to scan your inbox for receipts, invoices, order confirmations,
          and subscription bills. They&apos;re grouped here by vendor so you don&apos;t have to
          dig through your inbox at expense-report time.
        </p>
        <ul className="text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <li>&#10003; Identifies receipts from Stripe, Amazon, AWS, Uber, and hundreds of other vendors</li>
          <li>&#10003; Extracts the vendor, amount, currency, and transaction date</li>
          <li>&#10003; Lets you download receipt PDFs/images directly without opening Outlook</li>
          <li>&#10003; Groups everything by vendor so you can see your total spend at a glance</li>
          <li>&#10003; Scans 4 times a day automatically — or hit Refresh to scan now</li>
        </ul>
      </div>
    </div>
  )
}
