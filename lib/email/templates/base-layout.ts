// lib/email/templates/base-layout.ts
// Shared HTML email wrapper used by all HeyWren transactional emails.
// Provides consistent branding, responsive layout, and unsubscribe footer.

export interface BaseLayoutOptions {
  preheader?: string
  body: string
  footerNote?: string
  unsubscribeUrl?: string
}

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
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#f4f4f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.02em;">HeyWren</h1>
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
            <td style="padding:20px 40px 24px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              ${footerNote ? `<p style="margin:0 0 12px;color:#6b7280;font-size:13px;line-height:1.5;text-align:center;">${footerNote}</p>` : ''}
              ${unsubscribeUrl ? `<p style="margin:0 0 8px;text-align:center;"><a href="${unsubscribeUrl}" style="color:#9ca3af;font-size:12px;text-decoration:underline;">Unsubscribe from these emails</a></p>` : ''}
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                &copy; ${year} HeyWren &middot; AI-Powered Follow-Through
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

/** Renders a primary CTA button (centered, gradient background). */
export function ctaButton(text: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td align="center">
      <a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:-0.01em;">
        ${text}
      </a>
    </td>
  </tr>
</table>`
}

/** Renders a secondary (outline) button. */
export function secondaryButton(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;padding:10px 24px;border:2px solid #4f46e5;color:#4f46e5;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>`
}

/** Renders a stat card row (used in recaps/briefings). */
export function statRow(stats: { label: string; value: string; change?: string }[]): string {
  const cells = stats.map(s => {
    const changeHtml = s.change
      ? `<span style="font-size:12px;color:${s.change.startsWith('+') || s.change.startsWith('↑') ? '#16a34a' : s.change.startsWith('-') || s.change.startsWith('↓') ? '#dc2626' : '#6b7280'};">${s.change}</span>`
      : ''
    return `<td style="padding:12px 16px;text-align:center;width:${Math.floor(100 / stats.length)}%;">
      <div style="font-size:24px;font-weight:700;color:#1a1a2e;">${s.value}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">${s.label}</div>
      ${changeHtml}
    </td>`
  }).join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin:16px 0;">
  <tr>${cells}</tr>
</table>`
}

/** Renders a section heading inside the email body. */
export function sectionHeading(text: string): string {
  return `<h2 style="margin:24px 0 8px;color:#1a1a2e;font-size:18px;font-weight:600;">${text}</h2>`
}

/** Renders body paragraph text. */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;color:#4a4a68;font-size:15px;line-height:1.6;">${text}</p>`
}

/** Renders a highlighted insight/callout box. */
export function insightBox(text: string): string {
  return `<div style="background-color:#f0f0ff;border-left:4px solid #4f46e5;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0;">
  <p style="margin:0;color:#3730a3;font-size:14px;line-height:1.5;">${text}</p>
</div>`
}
