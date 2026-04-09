import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getOutlookIntegration, graphFetch, markMessageAsRead } from '@/lib/outlook/graph-client'
import { resolveTeamId } from '@/lib/team/resolve-team'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// Smart category detection based on sender domain/email patterns
function categorizeEmail(fromEmail: string, fromName: string, subject: string): string {
  const domain = fromEmail.split('@')[1]?.toLowerCase() || ''
  const email = fromEmail.toLowerCase()
  const subj = subject.toLowerCase()

  // Notifications - developer/work tools
  if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(domain)) return 'Dev Tools'
  if (['jira.atlassian.com', 'atlassian.com', 'atlassian.net'].includes(domain)) return 'Dev Tools'
  if (['linear.app', 'notion.so', 'asana.com', 'monday.com', 'trello.com', 'clickup.com'].includes(domain)) return 'Project Tools'
  if (['slack.com', 'teams.microsoft.com'].includes(domain)) return 'Chat Notifications'
  if (['figma.com', 'canva.com', 'miro.com'].includes(domain)) return 'Design Tools'

  // Cloud / Infrastructure
  if (['amazonaws.com', 'google.com', 'cloud.google.com', 'azure.com', 'microsoft.com'].some(d => domain.endsWith(d))) return 'Cloud & Infrastructure'
  if (['vercel.com', 'netlify.com', 'heroku.com', 'fly.io', 'railway.app'].includes(domain)) return 'Cloud & Infrastructure'
  if (['sentry.io', 'datadog.com', 'pagerduty.com', 'opsgenie.com'].includes(domain)) return 'Monitoring & Alerts'

  // Social media
  if (['linkedin.com', 'linkedinmail.com'].some(d => domain.includes(d))) return 'LinkedIn'
  if (['twitter.com', 'x.com', 'facebookmail.com', 'facebook.com', 'instagram.com'].some(d => domain.includes(d))) return 'Social Media'

  // E-commerce / Transactions
  if (['amazon.com', 'paypal.com', 'stripe.com', 'square.com', 'shopify.com', 'ebay.com'].some(d => domain.includes(d))) return 'Shopping & Transactions'
  if (subj.includes('receipt') || subj.includes('invoice') || subj.includes('payment') || subj.includes('order confirmation')) return 'Shopping & Transactions'

  // Newsletters / Marketing
  if (email.includes('newsletter') || email.includes('noreply') || email.includes('no-reply') || email.includes('marketing') || email.includes('digest') || email.includes('updates@') || email.includes('news@') || email.includes('info@')) return 'Newsletters & Updates'
  if (subj.includes('unsubscribe') || subj.includes('newsletter') || subj.includes('weekly digest') || subj.includes('monthly update')) return 'Newsletters & Updates'
  if (['substack.com', 'mailchimp.com', 'campaign-archive.com', 'convertkit.com', 'beehiiv.com', 'buttondown.email'].some(d => domain.includes(d))) return 'Newsletters & Updates'
  if (['medium.com', 'quora.com'].some(d => domain.includes(d))) return 'Newsletters & Updates'

  // SaaS / Subscriptions
  if (['zoom.us', 'calendly.com', 'docusign.com', 'dropbox.com', 'box.com'].some(d => domain.includes(d))) return 'SaaS & Subscriptions'
  if (['hubspot.com', 'salesforce.com', 'zendesk.com', 'intercom.io', 'freshdesk.com'].some(d => domain.includes(d))) return 'CRM & Support'

  // Calendar
  if (subj.includes('invitation') || subj.includes('accepted:') || subj.includes('declined:') || subj.includes('tentative:') || subj.includes('canceled:') || subj.includes('updated invitation')) return 'Calendar'

  // Security
  if (subj.includes('security') || subj.includes('sign-in') || subj.includes('login') || subj.includes('verification') || subj.includes('password') || subj.includes('2fa') || subj.includes('mfa')) return 'Security & Auth'

  // HR / Corporate
  if (['workday.com', 'bamboohr.com', 'gusto.com', 'adp.com', 'rippling.com'].some(d => domain.includes(d))) return 'HR & Benefits'

  // If the "from" name looks like an automated sender
  if (email.includes('notifications@') || email.includes('alerts@') || email.includes('system@') || email.includes('mailer-daemon') || email.includes('postmaster')) return 'System Notifications'

  // Default: group by domain
  return domain
}

interface OutlookMessage {
  id: string
  subject: string | null
  from: {
    emailAddress: {
      name: string
      address: string
    }
  }
  receivedDateTime: string
  bodyPreview: string
  isRead: boolean
  webLink: string
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const integration = await getOutlookIntegration(teamId, user.id)
    if (!integration) {
      return NextResponse.json({ error: 'Outlook not connected. Please connect your Outlook account in Integrations.' }, { status: 400 })
    }

    const ctx = {
      supabase: createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      ),
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    // Fetch unread emails from Outlook inbox - paginate to get all
    const allMessages: OutlookMessage[] = []
    let nextUrl: string | null = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$filter=isRead eq false&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink&$orderby=receivedDateTime desc&$top=100`
    let token = integration.access_token
    let pageCount = 0
    const MAX_PAGES = 10 // Safety limit: 1000 emails max

    while (nextUrl && pageCount < MAX_PAGES) {
      const { data, token: newToken } = await graphFetch(nextUrl, { token }, ctx)
      token = newToken

      if (data.error) {
        console.error('[inbox-zero] Graph API error:', data.error)
        return NextResponse.json({ error: 'Failed to fetch emails from Outlook' }, { status: 500 })
      }

      const messages: OutlookMessage[] = data.value || []
      allMessages.push(...messages)
      nextUrl = data['@odata.nextLink'] || null
      pageCount++
    }

    // Group by category
    const categoryMap = new Map<string, {
      category: string
      emails: Array<{
        id: string
        subject: string
        from_name: string
        from_email: string
        received_at: string
        body_preview: string
        web_link: string
      }>
      senders: Set<string>
    }>()

    for (const msg of allMessages) {
      const fromEmail = msg.from?.emailAddress?.address || ''
      const fromName = msg.from?.emailAddress?.name || fromEmail
      const subject = msg.subject || '(no subject)'

      const category = categorizeEmail(fromEmail, fromName, subject)

      if (!categoryMap.has(category)) {
        categoryMap.set(category, { category, emails: [], senders: new Set() })
      }

      const group = categoryMap.get(category)!
      group.emails.push({
        id: msg.id,
        subject,
        from_name: fromName,
        from_email: fromEmail,
        received_at: msg.receivedDateTime,
        body_preview: msg.bodyPreview || '',
        web_link: msg.webLink || '',
      })
      group.senders.add(fromEmail.toLowerCase())
    }

    // Convert to array and sort by email count (biggest groups first for maximum impact)
    const categories = Array.from(categoryMap.values())
      .map(g => ({
        category: g.category,
        emailCount: g.emails.length,
        senderCount: g.senders.size,
        emails: g.emails,
      }))
      .sort((a, b) => b.emailCount - a.emailCount)

    return NextResponse.json({
      totalUnread: allMessages.length,
      categories,
    })
  } catch (err) {
    console.error('GET /api/inbox-zero error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('current_team_id')
      .eq('id', user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(supabase, user.id)
    if (!teamId) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const integration = await getOutlookIntegration(teamId, user.id)
    if (!integration) {
      return NextResponse.json({ error: 'Outlook not connected' }, { status: 400 })
    }

    const ctx = {
      supabase: createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      ),
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    const body = await req.json()
    const { messageIds } = body

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: 'Missing messageIds array' }, { status: 400 })
    }

    // Mark all as read in Outlook — sequential to avoid token race conditions
    // (parallel requests + expired token = all try to refresh simultaneously,
    // but Microsoft rotates refresh tokens, so only the first succeeds)
    let token = integration.access_token
    let successCount = 0
    let failCount = 0

    for (const msgId of messageIds) {
      try {
        const result = await markMessageAsRead(msgId, token, ctx)
        token = result.token
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (err) {
        console.error('[inbox-zero] markAsRead failed for', msgId, err)
        failCount++
      }
    }

    return NextResponse.json({
      success: true,
      marked: successCount,
      failed: failCount,
    })
  } catch (err) {
    console.error('POST /api/inbox-zero error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
