import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'HeyWren - AI-Powered Follow-Through',
  description: 'Nothing falls through the cracks. HeyWren monitors Slack for commitments and nudges you to follow through.',
  keywords: ['productivity', 'slack', 'ai', 'follow-through', 'commitments', 'team accountability'],
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
