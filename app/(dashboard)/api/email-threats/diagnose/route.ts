// app/(dashboard)/api/email-threats/diagnose/route.ts
// Run threat detection against a single email synchronously and return the
// raw analysis (Tier 1 signals + Tier 2 AI verdict). Used to debug why an
// email did or did not produce an alert — does NOT write to email_threat_alerts.
//
// POST body: { messageId?: string, subjectContains?: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import {
  tier1Analysis,
  tier2Analysis,
  type EmailForThreatAnalysis,
} from '@/lib/ai/detect-email-threats'
import { graphFetch as graphFetchWithRefresh } from '@/lib/outlook/graph-client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { messageId, subjectContains } = await request.json()
    if (!messageId && !subjectContains) {
      return NextResponse.json(
        { error: 'Provide messageId or subjectContains' },
        { status: 400 }
      )
    }

    const admin = getAdminClient()

    // Find the Outlook integration for this user (for token refresh)
    const { data: integration } = await admin
      .from('integrations')
      .select('id, team_id, access_token, refresh_token')
      .eq('provider', 'outlook')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single()

    if (!integration) {
      return NextResponse.json(
        { error: 'No Outlook integration connected' },
        { status: 400 }
      )
    }

    // Find the email in the cached table
    let query = admin
      .from('outlook_messages')
      .select('message_id, from_name, from_email, subject, body_preview, received_at, to_recipients, cc_recipients')
      .eq('team_id', integration.team_id)
      .eq('user_id', userData.user.id)

    if (messageId) {
      query = query.eq('message_id', messageId).limit(1)
    } else {
      query = query.ilike('subject', `%${subjectContains}%`)
        .order('received_at', { ascending: false })
        .limit(1)
    }

    const { data: rows, error } = await query
    if (error || !rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Email not found in cached Outlook messages' },
        { status: 404 }
      )
    }

    const email = rows[0]

    const emailInput: EmailForThreatAnalysis = {
      messageId: email.message_id,
      fromEmail: email.from_email,
      fromName: email.from_name || '',
      subject: email.subject || '',
      bodyPreview: email.body_preview || '',
      receivedAt: email.received_at,
      toRecipients: email.to_recipients,
      ccRecipients: email.cc_recipients,
    }

    // Fetch authentication headers from Graph API
    let headersLoaded = false
    let headerFetchError: string | null = null
    try {
      const { data: headerData } = await graphFetchWithRefresh(
        `https://graph.microsoft.com/v1.0/me/messages/${email.message_id}?$select=internetMessageHeaders,replyTo,sender,hasAttachments`,
        { token: integration.access_token },
        {
          supabase: admin,
          integrationId: integration.id,
          refreshToken: integration.refresh_token,
        }
      )

      if (headerData && !headerData.error) {
        headersLoaded = true
        emailInput.headers = headerData.internetMessageHeaders || []
        emailInput.hasAttachments = headerData.hasAttachments || false
        if (headerData.replyTo?.length > 0) {
          emailInput.replyTo = headerData.replyTo[0]?.emailAddress?.address
        }
        if (headerData.sender?.emailAddress?.address) {
          emailInput.sender = headerData.sender.emailAddress.address
        }
      }
    } catch (err) {
      headerFetchError = (err as Error).message
    }

    const tier1 = tier1Analysis(emailInput)

    let tier2: Awaited<ReturnType<typeof tier2Analysis>> | { skipped: true } = { skipped: true }
    if (!tier1.skipTier2 || !headersLoaded) {
      tier2 = await tier2Analysis(emailInput, tier1.signals)
    }

    return NextResponse.json({
      email: {
        messageId: email.message_id,
        fromEmail: email.from_email,
        fromName: email.from_name,
        subject: email.subject,
        receivedAt: email.received_at,
        toRecipients: email.to_recipients,
      },
      headersLoaded,
      headerFetchError,
      tier1,
      tier2,
      wouldAlert:
        tier2 && 'isThreat' in (tier2 as object) && (tier2 as any).isThreat &&
        (tier2 as any).confidence >= 0.75,
    })
  } catch (err) {
    console.error('Threat diagnose error:', err)
    return NextResponse.json(
      { error: 'Internal error', detail: (err as Error).message },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
