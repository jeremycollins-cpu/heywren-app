import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 40,
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 76 76"
          fill="none"
        >
          <g transform="translate(0, 4)">
            <ellipse cx="38" cy="42" rx="18" ry="14" stroke="white" strokeWidth="2.5" fill="none" />
            <circle cx="50" cy="30" r="9" stroke="white" strokeWidth="2.5" fill="none" />
            <circle cx="53" cy="28" r="2" fill="white" />
            <path d="M 58 29 L 66 26 L 59 33" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
          </g>
        </svg>
      </div>
    ),
    { ...size }
  )
}
