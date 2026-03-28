// app/(dashboard)/relationships/page.tsx
// Relationship Health v5 — Actionable cards with commitment context and follow-up actions

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Mail, ArrowRight, AlertTriangle, TrendingUp, TrendingDown, Minus, MessageSquare, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface CommitmentSummary {
  open: number
  completed: number
  total: number
  toThem: number
  fromThem: number
  stalledCount: number
}

interface Contact {
  name: string
  email: string
  interactions: number
  interactionsThisWeek: number
  lastActive: string
  daysSinceContact: number
  healthScore: number
  prevHealthScore: number
  trend: 'up' | 'down' | 'stable'
  trendDelta: number
  role: string
  sentiment: string
  commitments: CommitmentSummary
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function calculateHealthScore(interactions: number, daysSinceLastContact: number, commitmentData: CommitmentSummary): number {
  let score = 50
  if (interactions >= 20) score += 25
  else if (interactions >= 10) score += 15
  else if (interactions >= 5) score += 8
  if (daysSinceLastContact > 14) score -= 30
  else if (daysSinceLastContact > 7) score -= 15
  else if (daysSinceLastContact > 3) score -= 5
  else score += 10
  // Commitment context affects health
  if (commitmentData.open > 0 && daysSinceLastContact > 7) score -= 10 // open commitments + no contact = bad
  if (commitmentData.completed > 0) score += 5 // completed commitments = good relationship signal
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

function inferRole(email: string, _name: string, interactions: number, userDomain: string): string {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  if (userDomain && domain === userDomain) return interactions > 15 ? 'Direct Report' : 'Team Member'
  if (interactions > 10) return 'Key Stakeholder'
  if (interactions > 5) return 'Collaborator'
  return 'Contact'
}

// Filter out automated/service/company accounts — only keep real people
function isRealPerson(email: string, name: string): boolean {
  const emailLower = email.toLowerCase()
  const nameLower = name.toLowerCase()
  const localPart = emailLower.split('@')[0] || ''
  const domain = emailLower.split('@')[1] || ''

  // Generic/automated prefixes
  const automatedPrefixes = [
    'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
    'notification', 'notifications', 'alert', 'alerts',
    'mailer-daemon', 'postmaster', 'bounce', 'bounces',
    'info', 'support', 'help', 'helpdesk', 'service', 'services',
    'billing', 'invoice', 'invoices', 'receipts', 'receipt',
    'sales', 'marketing', 'team', 'hello', 'contact', 'feedback',
    'admin', 'administrator', 'system', 'automated', 'auto',
    'updates', 'update', 'news', 'newsletter', 'digest',
    'security', 'verify', 'confirm', 'confirmation',
    'accounts', 'account', 'orders', 'order',
    'calendar', 'events', 'rsvp', 'invite', 'invites',
  ]
  if (automatedPrefixes.some(p => localPart === p || localPart.startsWith(p + '+') || localPart.startsWith(p + '.'))) return false

  // Known SaaS/service domains that send as "people" but aren't
  const serviceDomains = [
    'ramp.com', 'userramp.com',
    'jira.com', 'atlassian.com', 'atlassian.net',
    'github.com', 'gitlab.com', 'bitbucket.org',
    'slack.com', 'slackbot.com',
    'linear.app', 'notion.so', 'asana.com', 'monday.com', 'clickup.com',
    'figma.com', 'canva.com',
    'stripe.com', 'paypal.com', 'brex.com', 'bill.com', 'expensify.com',
    'zoom.us', 'zoom.com', 'calendly.com', 'loom.com',
    'hubspot.com', 'salesforce.com', 'intercom.io', 'zendesk.com', 'freshdesk.com',
    'mailchimp.com', 'sendgrid.net', 'sendgrid.com', 'mailgun.org', 'postmarkapp.com',
    'amazonaws.com', 'google.com', 'googlemail.com', 'docs.google.com',
    'dropbox.com', 'box.com', 'onedrive.com', 'sharepoint.com',
    'docusign.net', 'docusign.com', 'hellosign.com',
    'workday.com', 'adp.com', 'gusto.com', 'rippling.com', 'bamboohr.com',
    'lever.co', 'greenhouse.io', 'ashbyhq.com',
    'sentry.io', 'datadog.com', 'pagerduty.com', 'opsgenie.com',
    'vercel.com', 'netlify.com', 'heroku.com', 'render.com',
    'twilio.com', 'plaid.com', 'segment.com', 'amplitude.com', 'mixpanel.com',
    'snyk.io', 'grammarly.com', 'notion.so',
    'trello.com', 'basecamp.com', 'wrike.com',
    'shopify.com', 'squarespace.com', 'wordpress.com',
    'samsara.com',
    // Consumer/delivery/food services
    'uber.com', 'ubereats.com',
    'doordash.com', 'grubhub.com', 'postmates.com', 'seamless.com',
    'instacart.com', 'gopuff.com', 'caviar.com',
    'lyft.com', 'bird.co', 'lime.bike',
    // E-commerce / consumer
    'amazon.com', 'amazon.co.uk', 'amazon.ca',
    'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
    'ebay.com', 'etsy.com', 'wayfair.com',
    // Travel / airlines / hotels
    'delta.com', 'united.com', 'aa.com', 'southwest.com',
    'hilton.com', 'marriott.com', 'airbnb.com', 'booking.com', 'expedia.com',
    // Financial / banking / insurance
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
    'capitalone.com', 'amex.com', 'americanexpress.com',
    'geico.com', 'statefarm.com', 'progressive.com',
    'venmo.com', 'cashapp.com', 'zelle.com',
    'robinhood.com', 'fidelity.com', 'schwab.com', 'vanguard.com',
    // Utilities / telecom
    'comcast.com', 'xfinity.com', 'verizon.com', 'att.com', 'tmobile.com',
    // Social media
    'facebook.com', 'facebookmail.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'snapchat.com',
    // Productivity / cloud
    'apple.com', 'icloud.com', 'microsoft.com',
    'airtable.com', 'miro.com', 'coda.io',
    // CI/CD / dev tools
    'circleci.com', 'travis-ci.com', 'buildkite.com', 'codecov.io',
    'npm.com', 'npmjs.com', 'crates.io',
  ]
  if (serviceDomains.some(d => domain === d || domain.endsWith('.' + d))) return false

  // Known brand/company names (multi-word included) — case-insensitive match
  const serviceNames = [
    'ramp', 'jira', 'slack', 'github', 'notion', 'linear', 'figma',
    'asana', 'trello', 'zoom', 'loom', 'calendly', 'hubspot',
    'salesforce', 'stripe', 'paypal', 'docusign', 'dropbox',
    'samsara', 'workday', 'gusto', 'rippling', 'grammarly',
    'sentry', 'datadog', 'pagerduty', 'vercel', 'heroku',
    'bamboohr', 'greenhouse', 'lever', 'ashby',
    'zendesk', 'intercom', 'freshdesk', 'mailchimp',
    'confluence', 'bitbucket', 'gitlab',
    // Consumer brands that commonly send email
    'uber eats', 'uber', 'doordash', 'grubhub', 'instacart', 'postmates',
    'lyft', 'airbnb', 'amazon', 'walmart', 'target', 'costco',
    'delta air lines', 'delta airlines', 'united airlines', 'southwest airlines',
    'american express', 'amex', 'chase', 'bank of america', 'wells fargo',
    'capital one', 'venmo', 'cash app', 'robinhood',
    'comcast', 'xfinity', 'verizon', 'at&t', 't-mobile',
    'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'pinterest',
    'apple', 'microsoft', 'google', 'netflix', 'spotify', 'hulu', 'disney+',
    'shopify', 'squarespace', 'wordpress',
    'airtable', 'miro', 'coda',
  ]
  if (serviceNames.includes(nameLower)) return false

  // Names that are just a single word with no space (likely a service/brand)
  // but allow common single first-names by checking length
  if (!name.includes(' ') && name.length > 1) {
    // If the "name" matches the domain name (minus TLD), it's a service
    const domainName = domain.split('.')[0]
    if (nameLower === domainName) return false
  }

  // Heuristic: if a multi-word name has ALL words capitalized AND matches a known
  // pattern of "CompanyName + ServiceType" (e.g. "Uber Eats", "Capital One"), check
  // if the first word matches a known brand
  const knownBrandPrefixes = [
    'uber', 'door', 'grub', 'hello', 'capital', 'bank', 'delta',
    'united', 'american', 'wells', 'state', 'td', 'chase',
  ]
  if (name.includes(' ')) {
    const firstWord = name.split(' ')[0].toLowerCase()
    if (knownBrandPrefixes.includes(firstWord) && !name.includes('.')) return false
  }

  // Email-like names (name is just the email address)
  if (nameLower.includes('@')) return false

  return true
}

export default function RelationshipsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'healthy'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'interactions' | 'recent'>('score')

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      const teamId = profile?.current_team_id
      if (!teamId) { setLoading(false); return }

      const userEmail = userData.user.email?.toLowerCase() || ''
      const userDomain = userEmail.includes('@') ? userEmail.split('@')[1] : ''

      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

        // Fetch emails (including to_recipients for directionality) and commitments in parallel
        const [emailResult, sentEmailResult, commitmentResult] = await Promise.all([
          supabase
            .from('outlook_messages')
            .select('from_email, from_name, received_at, to_recipients')
            .eq('team_id', teamId)
            .neq('from_email', userEmail || '')
            .ilike('to_recipients', `%${userEmail}%`)
            .order('received_at', { ascending: false })
            .limit(1000),
          // Also get messages the user SENT (from_email = userEmail) to track "to them" direction
          supabase
            .from('outlook_messages')
            .select('from_email, to_recipients, received_at')
            .eq('team_id', teamId)
            .eq('from_email', userEmail || '')
            .order('received_at', { ascending: false })
            .limit(500),
          supabase
            .from('commitments')
            .select('title, status, metadata, created_at')
            .eq('team_id', teamId)
            .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`),
        ])

        // Filter received emails to only those addressed to this user
        const emailData = (emailResult.data || []).filter((msg: any) => {
          const recipients = JSON.stringify(msg.to_recipients || '').toLowerCase()
          return recipients.includes(userEmail)
        })
        const sentData = sentEmailResult.data || []
        const commitmentData = commitmentResult.data || []

        // Build stakeholder commitment map with directionality
        const stakeholderCommitments: Record<string, CommitmentSummary> = {}
        commitmentData.forEach((c: any) => {
          const stakeholders = c.metadata?.stakeholders || []
          const isStalled = c.status === 'open' && daysSince(c.created_at) > 7
          stakeholders.forEach((s: any) => {
            const key = s.name?.toLowerCase() || ''
            if (!stakeholderCommitments[key]) {
              stakeholderCommitments[key] = { open: 0, completed: 0, total: 0, toThem: 0, fromThem: 0, stalledCount: 0 }
            }
            stakeholderCommitments[key].total++
            if (c.status === 'completed') stakeholderCommitments[key].completed++
            else {
              stakeholderCommitments[key].open++
              if (isStalled) stakeholderCommitments[key].stalledCount++
            }
            // Track directionality: owner = from them, assignee = to them
            if (s.role === 'owner' || s.role === 'stakeholder') stakeholderCommitments[key].fromThem++
            if (s.role === 'assignee') stakeholderCommitments[key].toThem++
          })
        })

        // Build contact map from received emails (from them)
        const contactMap: Record<string, { name: string; email: string; countFromThem: number; countToThem: number; countThisWeek: number; lastDate: string; tones: string[] }> = {}

        emailData.forEach((msg: any) => {
          const email = (msg.from_email || '').toLowerCase()
          if (!email) return

          const senderName = msg.from_name || email.split('@')[0]
          if (!isRealPerson(email, senderName)) return

          const receivedAt = msg.received_at || new Date().toISOString()

          if (!contactMap[email]) {
            contactMap[email] = { name: senderName, email, countFromThem: 0, countToThem: 0, countThisWeek: 0, lastDate: receivedAt, tones: [] }
          }
          contactMap[email].countFromThem++
          if (receivedAt >= sevenDaysAgo) contactMap[email].countThisWeek++
          if (receivedAt > contactMap[email].lastDate) {
            contactMap[email].lastDate = receivedAt
          }
        })

        // Add sent email data (to them)
        sentData.forEach((msg: any) => {
          const toRecipients = (msg.to_recipients || '').toLowerCase()
          const receivedAt = msg.received_at || new Date().toISOString()

          // Check each known contact against to_recipients
          for (const email of Object.keys(contactMap)) {
            if (toRecipients.includes(email) || toRecipients.includes(email.split('@')[0])) {
              contactMap[email].countToThem++
              if (receivedAt >= sevenDaysAgo) contactMap[email].countThisWeek++
            }
          }
        })

        const sorted = Object.values(contactMap)
          .sort((a, b) => (b.countFromThem + b.countToThem) - (a.countFromThem + a.countToThem))
          .slice(0, 20)
          .map(c => {
            const totalInteractions = c.countFromThem + c.countToThem
            const dsc = daysSince(c.lastDate)
            const nameKey = c.name.toLowerCase()
            const commitments = stakeholderCommitments[nameKey] || { open: 0, completed: 0, total: 0, toThem: 0, fromThem: 0, stalledCount: 0 }

            // Calculate current and "previous" score for trend delta
            const score = calculateHealthScore(totalInteractions, dsc, commitments)
            // Estimate previous score by simulating 7-day-ago state
            const prevInteractions = Math.max(0, totalInteractions - c.countThisWeek)
            const prevDsc = Math.max(0, dsc - 7)
            const prevScore = calculateHealthScore(prevInteractions, prevDsc === 0 ? dsc : prevDsc, commitments)
            const trendDelta = score - prevScore
            const trend = trendDelta > 3 ? 'up' as const : trendDelta < -3 ? 'down' as const : 'stable' as const

            // Infer sentiment from commitment context and interaction patterns
            let sentiment = 'Neutral'
            if (commitments.stalledCount >= 2) sentiment = 'Tense — ' + commitments.stalledCount + ' stalled items'
            else if (dsc > 10 && commitments.open > 0) sentiment = 'At risk — going quiet'
            else if (c.countThisWeek >= 5 && commitments.open === 0) sentiment = 'Mostly positive'
            else if (c.countThisWeek >= 3) sentiment = 'Positive'
            else if (totalInteractions >= 10 && dsc <= 3) sentiment = 'Professional, direct'
            else if (totalInteractions >= 5) sentiment = 'Professional'
            else if (dsc > 14) sentiment = 'Cold — no recent contact'

            return {
              name: c.name,
              email: c.email,
              interactions: totalInteractions,
              interactionsThisWeek: c.countThisWeek,
              lastActive: c.lastDate,
              daysSinceContact: dsc,
              healthScore: score,
              prevHealthScore: prevScore,
              trend,
              trendDelta,
              role: inferRole(c.email, c.name, totalInteractions, userDomain),
              sentiment,
              commitments,
            }
          })

        setContacts(sorted)
      } catch (err) {
        console.error('Error fetching relationship data:', err)
        toast.error('Failed to load relationship data')
      }
      setLoading(false)
    }
    load()
  }, [])

  const filteredContacts = contacts
    .filter(c => {
      if (filter === 'needs_attention') return c.healthScore < 50 || (c.commitments.open > 0 && c.daysSinceContact > 7)
      if (filter === 'healthy') return c.healthScore >= 70
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'interactions') return b.interactions - a.interactions
      if (sortBy === 'recent') return a.daysSinceContact - b.daysSinceContact
      return b.healthScore - a.healthScore
    })

  const needsAttention = contacts.filter(c => c.healthScore < 50 && c.interactions >= 5)
  const avgScore = contacts.length > 0 ? Math.round(contacts.reduce((s, c) => s + c.healthScore, 0) / contacts.length) : 0
  const totalWithOpenCommitments = contacts.filter(c => c.commitments.open > 0).length

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  if (contacts.length === 0) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Relationship Health</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">How strong are your key relationships — based on interaction patterns and follow-through</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
          <div className="text-4xl mb-4" aria-hidden="true">&#x1F465;</div>
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

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Header with stats */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Relationship Health</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Interaction patterns, follow-through, and commitment context</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{avgScore}</p>
            <p className="text-xs text-gray-500">avg score</p>
          </div>
          <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-600">{needsAttention.length}</p>
            <p className="text-xs text-gray-500">need attention</p>
          </div>
          {totalWithOpenCommitments > 0 && (
            <>
              <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
              <div className="text-right">
                <p className="text-2xl font-bold text-indigo-600">{totalWithOpenCommitments}</p>
                <p className="text-xs text-gray-500">have open items</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filters + Sort */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark rounded-lg p-0.5">
          {([
            { key: 'all' as const, label: 'All' },
            { key: 'needs_attention' as const, label: 'Needs Attention' },
            { key: 'healthy' as const, label: 'Healthy' },
          ]).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                filter === f.key
                  ? 'bg-white dark:bg-surface-dark-secondary text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="ml-auto px-3 py-1.5 text-xs border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark-secondary dark:text-white focus:outline-none"
        >
          <option value="score">Sort by health score</option>
          <option value="interactions">Sort by interactions</option>
          <option value="recent">Sort by most recent</option>
        </select>
      </div>

      {/* Alert banner */}
      {needsAttention.length > 0 && filter === 'all' && (
        <div role="alert" className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {needsAttention.length} relationship{needsAttention.length > 1 ? 's' : ''} need attention
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              {needsAttention.slice(0, 3).map(c => c.name).join(', ')}
              {needsAttention.length > 3 ? ` and ${needsAttention.length - 3} more` : ''}
              {' — '} interaction frequency dropping
            </p>
          </div>
          <button
            onClick={() => setFilter('needs_attention')}
            className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline flex-shrink-0"
          >
            Show all
          </button>
        </div>
      )}

      {/* Relationship Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredContacts.map(contact => {
          const scoreColor = getScoreColor(contact.healthScore)
          const initials = contact.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
          const colors = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500']
          const bgColor = colors[contact.name.charCodeAt(0) % colors.length]
          const lastContactDate = new Date(contact.lastActive)
          const lastContactFormatted = lastContactDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          const lastContactRelative = contact.daysSinceContact === 0 ? 'today' : contact.daysSinceContact === 1 ? '1 day ago' : `${contact.daysSinceContact} days ago`

          // Build open items text with directionality
          const openToThem = contact.commitments.toThem
          const openFromThem = contact.commitments.fromThem
          const openItemsText = contact.commitments.open > 0
            ? `${openToThem} to them${openFromThem > 0 ? ` \u00B7 ${openFromThem} from them` : ''}`
            : 'None'

          return (
            <div key={contact.email} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 transition hover:shadow-md">
              {/* Top row: avatar + name + score ring */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 ${bgColor} rounded-full flex items-center justify-center text-white text-sm font-bold`}>
                    {initials}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{contact.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{contact.role}</div>
                  </div>
                </div>

                {/* Health Score Ring with trend delta */}
                <div className="flex flex-col items-center">
                  <div className="relative w-14 h-14">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" role="img" aria-label={`Health score: ${contact.healthScore}`}>
                      <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-200 dark:text-gray-700" />
                      <circle cx="28" cy="28" r="24" fill="none" stroke={scoreColor.ring} strokeWidth="3"
                        strokeDasharray={`${(contact.healthScore / 100) * 150.8} 150.8`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-base font-bold ${scoreColor.text}`}>{contact.healthScore}</span>
                    </div>
                  </div>
                  {contact.trendDelta !== 0 && (
                    <div className={`text-xs font-semibold mt-0.5 flex items-center gap-0.5 ${
                      contact.trendDelta > 0 ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {contact.trendDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {contact.trendDelta > 0 ? '+' : ''}{contact.trendDelta}
                    </div>
                  )}
                  {contact.trendDelta === 0 && (
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-0.5">
                      <Minus className="w-3 h-3" /> 0
                    </div>
                  )}
                </div>
              </div>

              {/* Stats grid — 2x2 matching prototype */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Last 1:1</div>
                  <div className={`text-sm font-semibold ${contact.daysSinceContact > 10 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                    {lastContactFormatted} ({lastContactRelative})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">This week</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {contact.interactionsThisWeek} interaction{contact.interactionsThisWeek !== 1 ? 's' : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Sentiment</div>
                  <div className={`text-sm font-semibold ${
                    contact.sentiment.startsWith('Tense') || contact.sentiment.startsWith('Cold') || contact.sentiment.startsWith('At risk')
                      ? 'text-red-600 dark:text-red-400'
                      : contact.sentiment.startsWith('Mostly positive') || contact.sentiment === 'Positive'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}>
                    {contact.sentiment}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Open items</div>
                  <div className={`text-sm font-semibold ${contact.commitments.open > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                    {openItemsText}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {contacts.length > filteredContacts.length && (
        <p className="text-center text-sm text-gray-400">
          Showing {filteredContacts.length} of {contacts.length} relationships
        </p>
      )}
    </div>
  )
}
