import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { sendDMToSlackUser } from '@/lib/slack/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

/**
 * POST /api/send-nudge
 * Sends a nudge message to a team member via Slack, Email, or both.
 * Body:
 *   - targetUserId: string
 *   - message: string
 *   - channels: ('slack' | 'email')[]
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const body = await request.json()
    const { targetUserId, message, channels } = body as {
      targetUserId: string
      message: string
      channels: ('slack' | 'email')[]
    }

    if (!targetUserId || !message?.trim() || !channels?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (message.trim().length > 1000) {
      return NextResponse.json({ error: 'Message too long (max 1000 chars)' }, { status: 400 })
    }

    // Verify caller is a manager in the same org
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Only managers can send nudges' }, { status: 403 })
    }

    // Verify target is in same org
    const { data: targetMembership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', targetUserId)
      .eq('organization_id', callerMembership.organization_id)
      .limit(1)
      .single()

    if (!targetMembership) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 404 })
    }

    // Get profiles for both caller and target
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, display_name, slack_user_id')
      .in('id', [callerId, targetUserId])

    const callerProfile = profiles?.find((p: { id: string }) => p.id === callerId)
    const targetProfile = profiles?.find((p: { id: string }) => p.id === targetUserId)

    if (!targetProfile) {
      return NextResponse.json({ error: 'Target user profile not found' }, { status: 404 })
    }

    const callerName = callerProfile?.display_name || callerProfile?.email?.split('@')[0] || 'Your manager'
    const results: { channel: string; success: boolean; error?: string }[] = []

    // Send via Slack
    if (channels.includes('slack')) {
      if (targetProfile.slack_user_id) {
        const slackMessage = `*Message from ${callerName}:*\n${message.trim()}`
        const result = await sendDMToSlackUser(targetProfile.slack_user_id, slackMessage)
        results.push({
          channel: 'slack',
          success: !!result,
          error: result ? undefined : 'Failed to send Slack DM',
        })
      } else {
        results.push({
          channel: 'slack',
          success: false,
          error: 'User has no linked Slack account',
        })
      }
    }

    // Send via Email
    if (channels.includes('email')) {
      if (targetProfile.email) {
        const targetName = targetProfile.display_name || targetProfile.email.split('@')[0]
        const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
        const emailResult = await sendEmail({
          to: targetProfile.email,
          subject: `Message from ${callerName}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px;">
              <p style="color: #374151;">Hi ${esc(targetName)},</p>
              <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="color: #111827; margin: 0; white-space: pre-wrap;">${esc(message.trim())}</p>
              </div>
              <p style="color: #6b7280; font-size: 14px;">— ${esc(callerName)} via HeyWren</p>
            </div>
          `,
          emailType: 'nudge',
          userId: targetUserId,
          idempotencyKey: `nudge:${callerId}:${targetUserId}:${Date.now()}`,
        })
        results.push({
          channel: 'email',
          success: emailResult.success,
          error: emailResult.error,
        })
      } else {
        results.push({
          channel: 'email',
          success: false,
          error: 'User has no email address',
        })
      }
    }

    const anySuccess = results.some(r => r.success)
    return NextResponse.json({
      success: anySuccess,
      results,
    }, { status: anySuccess ? 200 : 500 })
  } catch (err) {
    console.error('Send nudge error:', err)
    return NextResponse.json({ error: 'Failed to send nudge' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
