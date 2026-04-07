// lib/email/templates/base-layout.ts
// Shared HTML email wrapper used by all HeyWren transactional emails.
// Includes inline SVG wren bird logo, branded header, and consistent footer.

export interface BaseLayoutOptions {
  preheader?: string
  body: string
  footerNote?: string
  unsubscribeUrl?: string
}

/** Inline SVG of the wren bird icon (white, for gradient backgrounds). */
const WREN_BIRD_SVG = `<svg width="36" height="36" viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0, 4)">
    <ellipse cx="38" cy="42" rx="18" ry="14" stroke="white" stroke-width="3" fill="none"/>
    <circle cx="50" cy="30" r="9" stroke="white" stroke-width="3" fill="none"/>
    <circle cx="53" cy="28" r="2.5" fill="white"/>
    <path d="M 58 29 L 66 26 L 59 33" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="white" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </g>
</svg>`

/** Small wren bird icon for footer (brand color). */
const WREN_BIRD_FOOTER = `<svg width="20" height="20" viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0, 4)">
    <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#4f46e5" stroke-width="3.5" fill="none"/>
    <circle cx="50" cy="30" r="9" stroke="#4f46e5" stroke-width="3.5" fill="none"/>
    <circle cx="53" cy="28" r="2.5" fill="#4f46e5"/>
    <path d="M 58 29 L 66 26 L 59 33" stroke="#4f46e5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#4f46e5" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#4f46e5" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#4f46e5" stroke-width="3" stroke-linecap="round" fill="none"/>
  </g>
</svg>`

/**
 * Wraps email body content in the standard HeyWren branded layout.
 * All colors, fonts, and spacing are inlined for maximum email client compat.
 */
export function baseLayout({ preheader, body, footerNote, unsubscribeUrl }: BaseLayoutOptions): string {
  const year = new Date().getFullYear()

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
</head>
<body style="margin:0;padding:0;background-color:#f3f0ff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#f3f0ff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f0ff;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- Logo above card -->
          <tr>
            <td align="center" style="padding:0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    ${WREN_BIRD_FOOTER}
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:20px;font-weight:700;color:#1a1a2e;letter-spacing:-0.02em;">heyWren</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(79,70,229,0.08);">

                <!-- Branded header bar -->
                <tr>
                  <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#a855f7 100%);padding:32px 40px;text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="vertical-align:middle;padding-right:14px;">
                          ${WREN_BIRD_SVG}
                        </td>
                        <td style="vertical-align:middle;">
                          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.02em;">heyWren</h1>
                          <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;font-weight:500;letter-spacing:0.02em;">AI-Powered Follow-Through</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:36px 40px 28px;">
                    ${body}
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:24px 40px 28px;background-color:#fafbfc;border-top:1px solid #e5e7eb;">
                    ${footerNote ? `<p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.5;text-align:center;">${footerNote}</p>` : ''}
                    ${unsubscribeUrl ? `<p style="margin:0 0 10px;text-align:center;"><a href="${unsubscribeUrl}" style="color:#9ca3af;font-size:12px;text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="vertical-align:middle;padding-right:6px;">
                          <svg width="14" height="14" viewBox="0 0 76 76" fill="none"><g transform="translate(0,4)"><ellipse cx="38" cy="42" rx="18" ry="14" stroke="#9ca3af" stroke-width="4" fill="none"/><circle cx="50" cy="30" r="9" stroke="#9ca3af" stroke-width="4" fill="none"/><circle cx="53" cy="28" r="2.5" fill="#9ca3af"/></g></svg>
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
      <a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:-0.01em;box-shadow:0 4px 14px rgba(79,70,229,0.3);">
        ${text}
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
      <div style="font-size:26px;font-weight:800;color:#1a1a2e;letter-spacing:-0.02em;">${s.value}</div>
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="background:linear-gradient(135deg,#f0f0ff 0%,#ede9fe 100%);border-left:4px solid #7c3aed;padding:16px 18px;border-radius:0 12px 12px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;padding-right:12px;">
            <svg width="18" height="18" viewBox="0 0 76 76" fill="none"><g transform="translate(0,4)"><ellipse cx="38" cy="42" rx="18" ry="14" stroke="#7c3aed" stroke-width="4" fill="none"/><circle cx="50" cy="30" r="9" stroke="#7c3aed" stroke-width="4" fill="none"/><circle cx="53" cy="28" r="2.5" fill="#7c3aed"/></g></svg>
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
    <td style="height:1px;background:linear-gradient(to right,transparent,#e9e5ff,transparent);"></td>
  </tr>
</table>`
}
