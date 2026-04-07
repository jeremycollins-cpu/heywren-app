// lib/email/templates/base-layout.ts
// Shared HTML email wrapper used by all HeyWren transactional emails.
// Uses hosted PNG images from /api/email-assets for maximum email client compatibility.

export interface BaseLayoutOptions {
  preheader?: string
  body: string
  footerNote?: string
  unsubscribeUrl?: string
}

/** Returns the base URL for email asset images. */
function getAssetUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'
  return `${base}/api/email-assets`
}

/**
 * Wraps email body content in the standard HeyWren branded layout.
 * Uses hosted PNG images via /api/email-assets for the logo.
 * All colors, fonts, and spacing are inlined for maximum email client compat.
 */
export function baseLayout({ preheader, body, footerNote, unsubscribeUrl }: BaseLayoutOptions): string {
  const year = new Date().getFullYear()
  const assetUrl = getAssetUrl()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>HeyWren</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; padding: 16px 12px !important; }
      .email-card { border-radius: 12px !important; }
      .email-header { padding: 24px 24px !important; }
      .email-body { padding: 28px 24px 20px !important; }
      .email-footer { padding: 20px 24px !important; }
      .stat-value { font-size: 22px !important; }
      .cta-btn { padding: 14px 28px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f0ff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#f3f0ff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f0ff;">
    <tr>
      <td align="center" class="email-container" style="padding:32px 16px;">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- Logo above card -->
          <tr>
            <td align="center" style="padding:0 0 20px;">
              <a href="https://heywren.ai" style="text-decoration:none;">
                <img src="${assetUrl}?type=top-logo" width="180" height="48" alt="heyWren" style="display:block;border:0;outline:none;" />
              </a>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-card" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(79,70,229,0.08),0 0 0 1px rgba(79,70,229,0.04);">

                <!-- Branded header bar -->
                <tr>
                  <td class="email-header" style="background:linear-gradient(135deg,#4f46e5 0%,#6d3bef 50%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
                    <a href="https://heywren.ai" style="text-decoration:none;">
                      <img src="${assetUrl}?type=header-logo" width="220" height="60" alt="heyWren — AI-Powered Follow-Through" style="display:inline-block;border:0;outline:none;" />
                    </a>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td class="email-body" style="padding:36px 40px 28px;">
                    ${body}
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td class="email-footer" style="padding:24px 40px 28px;background-color:#fafbfc;border-top:1px solid #e5e7eb;">
                    ${footerNote ? `<p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.5;text-align:center;">${footerNote}</p>` : ''}
                    ${unsubscribeUrl ? `<p style="margin:0 0 12px;text-align:center;"><a href="${unsubscribeUrl}" style="color:#9ca3af;font-size:12px;text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="vertical-align:middle;padding-right:6px;">
                          <img src="${assetUrl}?type=footer-icon" width="20" height="20" alt="" style="display:block;border:0;" />
                        </td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0;color:#9ca3af;font-size:12px;">
                            &copy; ${year} HeyWren &middot; Nothing falls through the cracks
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Sub-footer links -->
          <tr>
            <td align="center" style="padding:20px 0 0;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                <a href="https://heywren.ai" style="color:#7c3aed;text-decoration:none;font-weight:500;">Website</a>
                <span style="color:#d1d5db;padding:0 8px;">&middot;</span>
                <a href="mailto:wren@heywren.ai" style="color:#7c3aed;text-decoration:none;font-weight:500;">Contact</a>
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

/** Renders a primary CTA button (centered, gradient background with subtle shadow). */
export function ctaButton(text: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td align="center">
      <a href="${url}" class="cta-btn" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:-0.01em;box-shadow:0 4px 14px rgba(79,70,229,0.25);mso-padding-alt:0;">
        <!--[if mso]><i style="mso-font-width:200%;mso-text-raise:20pt;">&nbsp;</i><![endif]-->
        <span style="mso-text-raise:10pt;">${text}</span>
        <!--[if mso]><i style="mso-font-width:200%;">&nbsp;</i><![endif]-->
      </a>
    </td>
  </tr>
</table>`
}

/** Renders a secondary (outline) button. */
export function secondaryButton(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;padding:10px 24px;border:2px solid #7c3aed;color:#7c3aed;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">${text}</a>`
}

/** Renders a stat card row (used in recaps/briefings). */
export function statRow(stats: { label: string; value: string; change?: string }[]): string {
  const cells = stats.map(s => {
    const changeHtml = s.change
      ? `<div style="font-size:12px;margin-top:2px;color:${s.change.startsWith('+') || s.change.startsWith('↑') ? '#16a34a' : s.change.startsWith('-') || s.change.startsWith('↓') ? '#dc2626' : '#6b7280'};">${s.change}</div>`
      : ''
    return `<td style="padding:14px 12px;text-align:center;width:${Math.floor(100 / stats.length)}%;">
      <div class="stat-value" style="font-size:26px;font-weight:800;color:#1a1a2e;letter-spacing:-0.02em;">${s.value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${s.label}</div>
      ${changeHtml}
    </td>`
  }).join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8f7ff 0%,#f3f0ff 100%);border-radius:12px;margin:16px 0;border:1px solid #e9e5ff;">
  <tr>${cells}</tr>
</table>`
}

/** Renders a section heading inside the email body. */
export function sectionHeading(text: string): string {
  return `<h2 style="margin:28px 0 10px;color:#1a1a2e;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${text}</h2>`
}

/** Renders body paragraph text. */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;color:#4a4a68;font-size:15px;line-height:1.7;">${text}</p>`
}

/** Renders a highlighted insight/callout box with wren icon. */
export function insightBox(text: string): string {
  const assetUrl = getAssetUrl()
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="background:linear-gradient(135deg,#f0f0ff 0%,#ede9fe 100%);border-left:4px solid #7c3aed;padding:16px 18px;border-radius:0 12px 12px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;padding-right:12px;">
            <img src="${assetUrl}?type=insight-icon" width="22" height="22" alt="" style="display:block;border:0;" />
          </td>
          <td>
            <p style="margin:0;color:#3730a3;font-size:14px;line-height:1.6;font-weight:500;">${text}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/** Renders a greeting with the wren personality. */
export function wrenGreeting(userName: string, message: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr>
    <td>
      <p style="margin:0 0 4px;color:#1a1a2e;font-size:17px;font-weight:600;">Hi ${userName},</p>
      <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">${message}</p>
    </td>
  </tr>
</table>`
}

/** Renders a divider line with subtle brand color. */
export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="height:1px;background:linear-gradient(to right,transparent,#e9e5ff,transparent);font-size:1px;line-height:1px;">&nbsp;</td>
  </tr>
</table>`
}
