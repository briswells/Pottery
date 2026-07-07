import { getPayload } from 'payload'
import config from '@payload-config'
import { resolveNotifyEmail } from '../../../lib/notify-email'
import { ContactForm } from './ContactForm'

export const metadata = {
  title: 'Contact',
  description: 'Get in touch with Portside Pottery — questions, classes, visits.',
}

export const dynamic = 'force-dynamic'

export default async function ContactPage() {
  const payload = await getPayload({ config: await config })
  const settings = await payload.findGlobal({ slug: 'site-settings' })
  const email = resolveNotifyEmail(settings.email)

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>Contact us</h1>
      <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>
        Questions about classes, membership, or visiting the studio? Send us a note and
        we&apos;ll get back to you{email ? <> — or email us directly at <a href={`mailto:${email}`}>{email}</a></> : null}.
      </p>
      {/* Server clock, captured fresh per request (page is force-dynamic) so it matches the server-side comparison. */}
      {/* eslint-disable-next-line react-hooks/purity */}
      <ContactForm startedAt={Date.now()} />
    </div>
  )
}
