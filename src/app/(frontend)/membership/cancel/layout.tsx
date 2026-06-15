import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The cancel page is a client component (it can't export metadata itself), so the
// title lives here and also covers the nested /membership/cancel/confirm page.
export const metadata: Metadata = { title: 'Cancel Membership' }

export default function CancelLayout({ children }: { children: ReactNode }) {
  return children
}
