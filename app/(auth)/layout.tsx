import { WrenFullLogoWhite } from '@/components/logo'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #312e81 0%, #4338ca 35%, #5b21b6 100%)' }}>
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.07]" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-[0.05]" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }} />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-5">
            <WrenFullLogoWhite width={180} />
          </div>
          <p className="text-indigo-200 text-sm font-medium" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
            AI-powered follow-through for your team
          </p>
        </div>

        {/* Card */}
        <div className="flex justify-center">
          <div className="bg-white rounded-2xl p-8 w-full" style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1)' }}>
            {children}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-indigo-300 text-xs mt-8" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
          &copy; 2026 HeyWren, Inc. All rights reserved.
        </p>
      </div>
    </div>
  )
}
