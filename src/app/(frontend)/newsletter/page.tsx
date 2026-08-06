import { getPayload } from 'payload'
import config from '@payload-config'
import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { getLatestSentNewsletter } from '../../../services/newsletter'
import { NewsletterSignup } from '../components/NewsletterSignup'

export const metadata = {
  title: 'Newsletter',
  description: 'News from the studio — new classes, kiln openings, and what the community is making.',
}

export const dynamic = 'force-dynamic'

export default async function NewsletterPage() {
  const payload = await getPayload({ config: await config })
  const issue = await getLatestSentNewsletter(payload)

  const sentLabel = issue?.sentAt
    ? new Date(issue.sentAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const bodyHtml = issue ? convertLexicalToHTML({ data: issue.body as unknown as SerializedEditorState }) : null

  return (
    <div style={{ padding: '40px 0 56px', maxWidth: 680 }}>
      <div className="pp-kicker">From the studio</div>
      {issue ? (
        <>
          <h1 style={{ marginTop: 8 }}>{issue.subject}</h1>
          {sentLabel && <p style={{ color: 'var(--pp-muted)', marginTop: 4 }}>{sentLabel}</p>}
          {/* Trusted content: admin-authored rich text through Payload's escaping converter. */}
          <div className="pp-prose" dangerouslySetInnerHTML={{ __html: bodyHtml! }} />
        </>
      ) : (
        <>
          <h1 style={{ marginTop: 8 }}>Newsletter</h1>
          <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7 }}>
            Our first issue is in the works — sign up and it&apos;ll land in your inbox.
          </p>
        </>
      )}

      <h2 style={{ fontSize: 20, marginTop: 40, marginBottom: 4 }}>Get the next one in your inbox</h2>
      <div style={{ maxWidth: 420 }}>
        {/* Server clock, captured fresh per request (page is force-dynamic). */}
        {/* eslint-disable-next-line react-hooks/purity */}
        <NewsletterSignup startedAt={Date.now()} />
      </div>
    </div>
  )
}
