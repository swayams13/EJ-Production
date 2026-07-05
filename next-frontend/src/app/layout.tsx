import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EJ Production Tracker',
  description: 'Manage expansion joint production and capacities',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  )
}
