import { Fraunces, Inter } from 'next/font/google'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { mediaUrl } from '../../lib/media'
import '../../styles/globals.css'

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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
          hours={settings.hours}
          socials={settings.socials}
        />
        <main className="pp-container">{children}</main>
        <Footer
          studioName={settings.studioName ?? 'Portside Pottery'}
          logoUrl={logoUrl}
          phone={settings.phone}
          email={settings.email}
          addressLine={settings.addressLine}
          hours={settings.hours}
          socials={settings.socials}
        />
      </body>
    </html>
  )
}
