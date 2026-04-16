/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_PUBLIC_* env vars are automatically available in Next.js — no explicit
  // mapping needed. The previous `env` block existed only to inject hardcoded
  // production fallbacks, which was a security issue (see PR #226).
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
