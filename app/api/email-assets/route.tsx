// app/api/email-assets/route.ts
// Generates PNG images for email templates.
// Usage: /api/email-assets?type=header-logo|footer-logo|icon
// These are referenced by <img> tags in emails for maximum client compatibility.

import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// Wren bird SVG paths (shared across all variants)
const wrenBird = (color: string, strokeWidth = 3) => (
  <svg width="40" height="40" viewBox="0 0 76 76" fill="none">
    <g transform="translate(0, 4)">
      <ellipse cx="38" cy="42" rx="18" ry="14" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <circle cx="50" cy="30" r="9" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <circle cx="53" cy="28" r="2.5" fill={color} />
      <path d="M 58 29 L 66 26 L 59 33" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M 28 39 C 34 33, 44 31, 50 35" stroke={color} strokeWidth={strokeWidth - 0.5} strokeLinecap="round" fill="none" />
      <path d="M 20 38 C 14 32, 12 22, 15 15" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke={color} strokeWidth={strokeWidth - 0.5} strokeLinecap="round" fill="none" />
    </g>
  </svg>
)

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') || 'header-logo'

  // Header logo: white bird + "heyWren" text on gradient — used in email header
  if (type === 'header-logo') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 220,
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'transparent',
          }}
        >
          {wrenBird('white', 3.5)}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: 'white', letterSpacing: -0.5 }}>
              heyWren
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.5 }}>
              AI-Powered Follow-Through
            </span>
          </div>
        </div>
      ),
      { width: 220, height: 60 },
    )
  }

  // Top logo: bird + "heyWren" in brand color on transparent — above the card
  if (type === 'top-logo') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 180,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: 'transparent',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 76 76" fill="none">
            <g transform="translate(0, 4)">
              <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#4f46e5" strokeWidth="3.5" fill="none" />
              <circle cx="50" cy="30" r="9" stroke="#4f46e5" strokeWidth="3.5" fill="none" />
              <circle cx="53" cy="28" r="2.5" fill="#4f46e5" />
              <path d="M 58 29 L 66 26 L 59 33" stroke="#4f46e5" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#4f46e5" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" fill="none" />
            </g>
          </svg>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e', letterSpacing: -0.5 }}>
            heyWren
          </span>
        </div>
      ),
      { width: 180, height: 48 },
    )
  }

  // Footer icon: small bird in gray
  if (type === 'footer-icon') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 76 76" fill="none">
            <g transform="translate(0, 4)">
              <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#9ca3af" strokeWidth="4" fill="none" />
              <circle cx="50" cy="30" r="9" stroke="#9ca3af" strokeWidth="4" fill="none" />
              <circle cx="53" cy="28" r="2.5" fill="#9ca3af" />
              <path d="M 58 29 L 66 26 L 59 33" stroke="#9ca3af" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#9ca3af" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#9ca3af" strokeWidth="4" strokeLinecap="round" fill="none" />
              <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#9ca3af" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            </g>
          </svg>
        </div>
      ),
      { width: 20, height: 20 },
    )
  }

  // Insight icon: small wren in purple
  if (type === 'insight-icon') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 76 76" fill="none">
            <g transform="translate(0, 4)">
              <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#7c3aed" strokeWidth="4" fill="none" />
              <circle cx="50" cy="30" r="9" stroke="#7c3aed" strokeWidth="4" fill="none" />
              <circle cx="53" cy="28" r="2.5" fill="#7c3aed" />
              <path d="M 58 29 L 66 26 L 59 33" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round" fill="none" />
              <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#7c3aed" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            </g>
          </svg>
        </div>
      ),
      { width: 22, height: 22 },
    )
  }

  return new Response('Unknown type. Use: header-logo, top-logo, footer-icon, insight-icon', { status: 400 })
}
