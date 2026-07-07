import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { mediaUrl } from '../../lib/media'
import { resolveNotifyEmail } from '../../lib/notify-email'
import '../../styles/globals.css'

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

// Header/footer come from CMS site-settings; render per-request so the build
// never needs a database connection and staff edits show without a rebuild.
export const dynamic = 'force-dynamic'

// Title and favicon come from CMS site-settings so staff can change them without a
// rebuild. The title template wraps each page's own title, e.g. "Classes — Portside
// Pottery"; pages with no title fall back to the studio name alone.
export async function generateMetadata(): Promise<Metadata> {
  const payload = await getPayload({ config: await config })
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 2 })
  const studioName = settings.studioName ?? 'Portside Pottery'

  const metadata: Metadata = {
    title: { default: studioName, template: `%s — ${studioName}` },
  }

  const faviconUrl = mediaUrl(settings.favicon)
  if (faviconUrl) {
    const type =
      settings.favicon && typeof settings.favicon === 'object'
        ? settings.favicon.mimeType ?? undefined
        : undefined
    metadata.icons = { icon: [{ url: faviconUrl, type }] }
  }

  return metadata
}

export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  const payload = await getPayload({ config: await config })
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 2 })
  const logoUrl = mediaUrl(settings.logo)
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <Header
          studioName={settings.studioName ?? 'Portside Pottery'}
          logoUrl={logoUrl}
          phone={settings.phone}
          email={resolveNotifyEmail(settings.email)}
          hours={settings.hours}
          socials={settings.socials}
        />
        <main className="pp-container">{children}</main>
        <Footer
          studioName={settings.studioName ?? 'Portside Pottery'}
          logoUrl={logoUrl}
          phone={settings.phone}
          email={resolveNotifyEmail(settings.email)}
          addressLine={settings.addressLine}
          hours={settings.hours}
          socials={settings.socials}
        />
      </body>
    </html>
  )
}
