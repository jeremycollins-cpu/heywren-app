// lib/email/send-invite.ts
// Send invitation emails via the Resend API

interface SendInviteParams {
  email: string
  inviterName: string
  organizationName: string
  role: string
  inviteToken: string
}

interface SendInviteResult {
  success: boolean
  error?: string
}

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organization Admin',
  dept_manager: 'Department Manager',
  team_lead: 'Team Lead',
  member: 'Member',
}

function buildEmailHtml({
  inviterName,
  organizationName,
  role,
  inviteUrl,
}: {
  inviterName: string
  organizationName: string
  role: string
  inviteUrl: string
}): string {
  const roleLabel = ROLE_LABELS[role] || role

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're Invited to HeyWren</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.02em;">HeyWren</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">AI-Powered Follow-Through</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:20px;font-weight:600;">You've been invited!</h2>
              <p style="margin:0 0 24px;color:#4a4a68;font-size:15px;line-height:1.6;">
                <strong>${inviterName}</strong> has invited you to join
                <strong>${organizationName}</strong> on HeyWren as a <strong>${roleLabel}</strong>.
              </p>

              <p style="margin:0 0 32px;color:#4a4a68;font-size:15px;line-height:1.6;">
                HeyWren monitors your team's conversations and helps ensure nothing falls through the cracks.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}"
                       style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:-0.01em;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <p style="margin:32px 0 0;color:#9ca3af;font-size:13px;text-align:center;line-height:1.5;">
                This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} HeyWren. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendInviteEmail(params: SendInviteParams): Promise<SendInviteResult> {
  const { email, inviterName, organizationName, role, inviteToken } = params

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[send-invite] RESEND_API_KEY is not configured')
    return { success: false, error: 'Email service not configured' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'
  const inviteUrl = `${appUrl}/invite/${inviteToken}`

  const html = buildEmailHtml({ inviterName, organizationName, role, inviteUrl })

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'HeyWren <notifications@heywren.com>',
        to: email,
        subject: `${inviterName} invited you to join ${organizationName} on HeyWren`,
        html,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('[send-invite] Resend API error:', response.status, errorBody)
      return { success: false, error: `Email delivery failed (${response.status})` }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[send-invite] Failed to send invite email:', message)
    return { success: false, error: message }
  }
}
