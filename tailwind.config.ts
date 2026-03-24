import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand colors from heywren.ai
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4f46e5',
        },
        // Semantic aliases
        primary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4f46e5',
        },
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#fafbfc',
          tertiary: '#f3f0ff',
          dark: '#0f0d2e',
          'dark-secondary': '#1a1744',
        },
        border: {
          DEFAULT: '#e4e4e7',
          dark: '#2d2a5e',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        'hero': ['3.5rem', { lineHeight: '1.1', fontWeight: '800', letterSpacing: '-0.025em' }],
        'section': ['2.75rem', { lineHeight: '1.1', fontWeight: '800', letterSpacing: '-0.025em' }],
        'heading': ['1.5rem', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.025em' }],
        'subheading': ['1.125rem', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.015em' }],
      },
      boxShadow: {
        'brand-sm': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'brand': '0 12px 32px rgba(0, 0, 0, 0.08)',
        'brand-lg': '0 20px 60px rgba(0, 0, 0, 0.12)',
        'brand-glow': '0 8px 20px rgba(79, 70, 229, 0.3)',
        'brand-glow-lg': '0 12px 32px rgba(79, 70, 229, 0.4)',
        'card-hover': '0 12px 24px -4px rgba(0, 0, 0, 0.1)',
        'dark-sm': '0 4px 12px rgba(0, 0, 0, 0.3)',
        'dark': '0 12px 32px rgba(0, 0, 0, 0.4)',
      },
      borderRadius: {
        'brand': '12px',
        'brand-lg': '16px',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        'brand-gradient-hover': 'linear-gradient(135deg, #4338ca 0%, #6d28d9 100%)',
        'surface-gradient': 'linear-gradient(135deg, #fafbfc 0%, #f3f0ff 100%)',
        'dark-gradient': 'linear-gradient(135deg, #0f0d2e 0%, #1a1744 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite linear',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      transitionDuration: {
        'brand': '300ms',
      },
      transitionTimingFunction: {
        'brand': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
export default config
