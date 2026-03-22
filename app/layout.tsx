import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'HeyWren - AI-Powered Follow-Through',
  description: 'Monitor Slack for commitments and get nudged to follow through',
  keywords: ['productivity', 'slack', 'ai', 'follow-through', 'commitments'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  )
}
