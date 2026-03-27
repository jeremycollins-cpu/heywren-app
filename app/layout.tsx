import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'HeyWren - AI-Powered Follow-Through',
  description: 'Nothing falls through the cracks. HeyWren monitors Slack for commitments and nudges you to follow through.',
  keywords: ['productivity', 'slack', 'ai', 'follow-through', 'commitments', 'team accountability'],
  metadataBase: new URL('https://heywren.com'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'HeyWren - AI-Powered Follow-Through',
    description: 'Nothing falls through the cracks. HeyWren monitors Slack for commitments and nudges you to follow through.',
    type: 'website',
    siteName: 'HeyWren',
    url: '/',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HeyWren - AI-Powered Follow-Through',
    description: 'Nothing falls through the cracks. HeyWren monitors Slack for commitments and nudges you to follow through.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased bg-surface-secondary text-gray-900 dark:bg-surface-dark dark:text-white">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:text-sm focus:font-medium">
          Skip to main content
        </a>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
              fontSize: '14px',
              borderRadius: '12px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.08)',
            },
            success: {
              iconTheme: {
                primary: '#4f46e5',
                secondary: '#ffffff',
              },
            },
          }}
        />
      </body>
    </html>
  )
}
