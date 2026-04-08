// Inbound email webhook — receives emails BCC'd to wren@heywren.ai
// Compatible with SendGrid Inbound Parse (multipart/form-data)
// Docs: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
//
// Setup:
// 1. Configure MX records for heywren.ai to point to mx.sendgrid.net
// 2. Set up Inbound Parse in SendGrid to POST to https://app.heywren.ai/api/integrations/email/inbound
// 3. Set SENDGRID_INBOUND_WEBHOOK_SECRET in environment variables

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  try {
    // SendGrid sends multipart/form-data
    const formData = await request.formData()

    const from = (formData.get('from') as string) || ''
    const to = (formData.get('to') as string) || ''
    const subject = (formData.get('subject') as string) || '(no subject)'
    const text = (formData.get('text') as string) || ''
    const html = (formData.get('html') as string) || ''
    const envelope = (formData.get('envelope') as string) || '{}'

    // Extract sender email from the "from" field (e.g., "John Doe <john@example.com>")
    const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/)
    const senderEmail = emailMatch ? emailMatch[1].toLowerCase() : from.toLowerCase()
    const senderName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || senderEmail

    if (!senderEmail) {
      console.warn('Inbound email: no sender email found')
      return NextResponse.json({ error: 'No sender email' }, { status: 400 })
    }

    console.log(`Inbound BCC email from ${senderEmail}: "${subject}"`)

    const admin = getAdminClient()

    // Look up the sender in our user profiles to link this to the correct user/team
    const { data: profile } = await admin
      .from('profiles')
      .select('id, current_team_id, full_name, display_name')
      .ilike('email', senderEmail)
      .single()

    if (!profile || !profile.current_team_id) {
      // Sender isn't a HeyWren user — log and ignore
      console.warn(`Inbound BCC email from unknown user: ${senderEmail}`)
      return NextResponse.json({ status: 'ignored', reason: 'sender not a registered user' })
    }

    // Use plain text body, falling back to stripping HTML tags
    const bodyText = text || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const snippet = bodyText.slice(0, 300)

    // Send to Inngest for async processing (commitment detection + mention tracking)
    await inngest.send({
      name: 'email/bcc.received',
      data: {
        userId: profile.id,
        teamId: profile.current_team_id,
        senderEmail,
        senderName: profile.full_name || profile.display_name || senderName,
        subject,
        bodyText: bodyText.slice(0, 5000), // cap to control token cost
        snippet,
        receivedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ status: 'accepted' })
  } catch (err: any) {
    console.error('Inbound email processing error:', err?.message || err)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

// SendGrid may also send a GET for verification
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
