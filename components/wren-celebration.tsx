'use client'

import { useCelebration } from '@/lib/contexts/celebration-context'

/**
 * Renders a wren bird flying across the screen with trailing sparkles, leaves,
 * and musical notes when the user completes a task.  Inspired by Asana's
 * unicorn celebration but themed around the HeyWren brand.
 *
 * Like Asana, the animation only fires randomly (~1 in 7 completions) so it
 * stays surprising and delightful.  Each trigger picks a random vertical
 * position and flight direction for variety.
 */
export default function WrenCelebration() {
  const { celebrating, variant } = useCelebration()

  if (!celebrating || !variant) return null

  const isRtl = variant.direction === 'rtl'

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden"
    >
      {/* ── Flying Wren ─────────────────────────────────────────────── */}
      <div
        className={`absolute ${isRtl ? 'wren-fly-across-rtl' : 'wren-fly-across'}`}
        style={{ top: `${variant.topPercent}%` }}
      >
        <svg
          width="80"
          height="80"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="wren-bob drop-shadow-lg"
          style={isRtl ? { transform: 'scaleX(-1)' } : undefined}
        >
          {/* Body */}
          <ellipse cx="60" cy="62" rx="24" ry="18" fill="#8B6914" />
          {/* Belly – lighter */}
          <ellipse cx="60" cy="68" rx="16" ry="11" fill="#D4A83C" />
          {/* Head */}
          <circle cx="82" cy="48" r="14" fill="#8B6914" />
          {/* Eye */}
          <circle cx="88" cy="45" r="3" fill="#1a1a1a" />
          <circle cx="89.2" cy="44" r="1" fill="#fff" />
          {/* Beak */}
          <polygon points="96,47 108,44 96,42" fill="#E8973A" />
          {/* Tail – characteristic upright wren tail */}
          <path
            d="M36 56 C24 38, 20 32, 26 22 C30 28, 34 36, 38 52"
            fill="#6B4F10"
          />
          <path
            d="M38 58 C28 42, 26 36, 32 28 C34 34, 36 40, 40 54"
            fill="#7A5C14"
          />
          {/* Wing */}
          <path
            d="M52 52 C44 36, 36 28, 30 38 C38 40, 46 46, 56 56"
            fill="#6B4F10"
            className="wren-wing"
          />
          {/* Legs */}
          <line x1="54" y1="78" x2="50" y2="92" stroke="#9A7420" strokeWidth="2" strokeLinecap="round" />
          <line x1="66" y1="78" x2="70" y2="92" stroke="#9A7420" strokeWidth="2" strokeLinecap="round" />
          {/* Feet */}
          <path d="M46 92 L50 92 L54 92" stroke="#9A7420" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M66 92 L70 92 L74 92" stroke="#9A7420" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {/* Crown stripe (wrens have a subtle stripe) */}
          <path
            d="M74 40 C78 36, 86 36, 90 40"
            stroke="#D4A83C"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ── Trail particles ──────────────────────────────────────── */}
      {/* Sparkles */}
      {[...Array(8)].map((_, i) => (
        <div
          key={`sparkle-${i}`}
          className={`absolute ${isRtl ? 'wren-trail-particle-rtl' : 'wren-trail-particle'}`}
          style={{
            top: `${variant.topPercent - 4 + Math.random() * 14}%`,
            animationDelay: `${0.15 + i * 0.18}s`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10L12 2Z"
              fill={i % 2 === 0 ? '#7c3aed' : '#facc15'}
              opacity="0.85"
            />
          </svg>
        </div>
      ))}

      {/* Musical notes */}
      {[...Array(5)].map((_, i) => (
        <div
          key={`note-${i}`}
          className={`absolute ${isRtl ? 'wren-trail-particle-rtl' : 'wren-trail-particle'} wren-note-float`}
          style={{
            top: `${variant.topPercent - 8 + Math.random() * 20}%`,
            animationDelay: `${0.3 + i * 0.28}s`,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 18V6l12-3v12"
              stroke={i % 2 === 0 ? '#4f46e5' : '#8b5cf6'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="6" cy="18" r="3" fill={i % 2 === 0 ? '#4f46e5' : '#8b5cf6'} />
            <circle cx="18" cy="15" r="3" fill={i % 2 === 0 ? '#4f46e5' : '#8b5cf6'} />
          </svg>
        </div>
      ))}

      {/* Leaves */}
      {[...Array(6)].map((_, i) => (
        <div
          key={`leaf-${i}`}
          className={`absolute ${isRtl ? 'wren-trail-particle-rtl' : 'wren-trail-particle'} wren-leaf-spin`}
          style={{
            top: `${variant.topPercent - 6 + Math.random() * 18}%`,
            animationDelay: `${0.2 + i * 0.22}s`,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22L6.66 19.7C7.14 19.87 7.64 20 8.16 20C12.67 20 17.06 14.37 17 8Z"
              fill={['#22c55e', '#16a34a', '#4ade80'][i % 3]}
              opacity="0.8"
            />
          </svg>
        </div>
      ))}
    </div>
  )
}
