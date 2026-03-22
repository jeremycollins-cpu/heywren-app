interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'icon' | 'wordmark'
  className?: string
}

// Wren bird icon only (for sidebar collapsed, favicon, etc.)
function WrenIcon({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      className={className}
    >
      <g transform="translate(0, 4)">
        <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="50" cy="30" r="9" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="53" cy="28" r="2" fill="#4f46e5" />
        <path d="M 58 29 L 66 26 L 59 33" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  )
}

// Full logo with bird + speech bubble + "heyWren" text
function WrenFullLogo({ width = 120, className = '' }: { width?: number; className?: string }) {
  const height = Math.round((width / 120) * 26)
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 370 80"
      fill="none"
      className={className}
    >
      <g transform="translate(0, 4)">
        <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="50" cy="30" r="9" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="53" cy="28" r="2" fill="#4f46e5" />
        <path d="M 58 29 L 66 26 L 59 33" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <path d="M 90 8 Q 76 8, 76 22 L 76 30 L 66 37 L 76 44 L 76 56 Q 76 70, 90 70 L 342 70 Q 356 70, 356 56 L 356 22 Q 356 8, 342 8 Z" stroke="#4f46e5" strokeWidth="1.6" fill="none" />
      <g stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 94 22 L 95 56" />
        <path d="M 114 22 L 113 56" />
        <path d="M 95 39 C 100 37, 108 37, 113 39" />
        <path d="M 128 42 C 128 36, 133 31, 140 31 C 147 31, 151 36, 151 42 L 128 42 C 128 50, 134 55, 142 55 C 147 55, 150 53, 152 50" />
        <path d="M 162 32 L 171 56" />
        <path d="M 181 32 L 168 62 C 165 68, 161 70, 157 67" />
      </g>
      <g stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 200 22 L 209 56 L 221 30 L 233 56 L 242 22" />
        <path d="M 254 32 L 254 56" />
        <path d="M 254 40 C 258 32, 266 30, 271 33" />
        <path d="M 281 42 C 281 36, 286 31, 293 31 C 300 31, 304 36, 304 42 L 281 42 C 281 50, 287 55, 295 55 C 300 55, 303 53, 305 50" />
        <path d="M 316 32 L 316 56" />
        <path d="M 316 40 C 320 32, 328 30, 334 33 C 338 35, 339 40, 339 44 L 339 56" />
      </g>
    </svg>
  )
}

// White variant of the full logo (for dark backgrounds)
function WrenFullLogoWhite({ width = 120, className = '' }: { width?: number; className?: string }) {
  const height = Math.round((width / 120) * 26)
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 370 80"
      fill="none"
      className={className}
    >
      <g transform="translate(0, 4)">
        <ellipse cx="38" cy="42" rx="18" ry="14" stroke="white" strokeWidth="2.2" fill="none" />
        <circle cx="50" cy="30" r="9" stroke="white" strokeWidth="2.2" fill="none" />
        <circle cx="53" cy="28" r="2" fill="white" />
        <path d="M 58 29 L 66 26 L 59 33" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <path d="M 90 8 Q 76 8, 76 22 L 76 30 L 66 37 L 76 44 L 76 56 Q 76 70, 90 70 L 342 70 Q 356 70, 356 56 L 356 22 Q 356 8, 342 8 Z" stroke="rgba(255,255,255,0.6)" strokeWidth="1.6" fill="none" />
      <g stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 94 22 L 95 56" />
        <path d="M 114 22 L 113 56" />
        <path d="M 95 39 C 100 37, 108 37, 113 39" />
        <path d="M 128 42 C 128 36, 133 31, 140 31 C 147 31, 151 36, 151 42 L 128 42 C 128 50, 134 55, 142 55 C 147 55, 150 53, 152 50" />
        <path d="M 162 32 L 171 56" />
        <path d="M 181 32 L 168 62 C 165 68, 161 70, 157 67" />
      </g>
      <g stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 200 22 L 209 56 L 221 30 L 233 56 L 242 22" />
        <path d="M 254 32 L 254 56" />
        <path d="M 254 40 C 258 32, 266 30, 271 33" />
        <path d="M 281 42 C 281 36, 286 31, 293 31 C 300 31, 304 36, 304 42 L 281 42 C 281 50, 287 55, 295 55 C 300 55, 303 53, 305 50" />
        <path d="M 316 32 L 316 56" />
        <path d="M 316 40 C 320 32, 328 30, 334 33 C 338 35, 339 40, 339 44 L 339 56" />
      </g>
    </svg>
  )
}

export default function Logo({ size = 'md', variant = 'full', className = '' }: LogoProps) {
  const sizes = {
    sm: { full: 100, icon: 20 },
    md: { full: 120, icon: 28 },
    lg: { full: 160, icon: 36 },
    xl: { full: 220, icon: 48 },
  }

  if (variant === 'icon') {
    return <WrenIcon size={sizes[size].icon} className={className} />
  }

  return <WrenFullLogo width={sizes[size].full} className={className} />
}

export { WrenIcon, WrenFullLogo, WrenFullLogoWhite }
