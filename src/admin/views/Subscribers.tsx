import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, Link } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { kitEnabled, listKitSubscribers, type KitSubscriberPage } from '../../lib/kit'
import { SubscribersToolbar, UnsubscribeButton } from './SubscribersClient'

const cell: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
  fontSize: 14,
}

function param(searchParams: AdminViewServerProps['searchParams'], key: string): string | undefined {
  const v = searchParams?.[key]
  return typeof v === 'string' && v ? v : undefined
}

export default async function Subscribers({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  const staff =
    user && user.collection === 'users' && user.roles?.some((r) => r === 'admin' || r === 'editor')
  if (!staff) redirect('/admin')

  const q = param(searchParams, 'q')
  const after = param(searchParams, 'after')
  const before = param(searchParams, 'before')

  let content: React.ReactNode
  if (!kitEnabled()) {
    content = (
      <p style={{ color: 'var(--theme-elevation-500)' }}>
        The mailing list isn&apos;t configured yet — set <code>KIT_API_KEY</code> in the server environment.
      </p>
    )
  } else {
    let page: KitSubscriberPage | null = null
    try {
      page = await listKitSubscribers({ after, before, emailSearch: q })
    } catch {
      content = <p style={{ color: 'var(--theme-error-500)' }}>Couldn&apos;t reach Kit — try again in a minute.</p>
    }
    if (page) {
      const qs = q ? `&q=${encodeURIComponent(q)}` : ''
      content = (
        <>
          {typeof page.totalCount === 'number' && (
            <p style={{ color: 'var(--theme-elevation-500)', marginBottom: 8 }}>
              {page.totalCount} subscriber{page.totalCount === 1 ? '' : 's'}
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={cell}>Email</th>
                <th style={cell}>Name</th>
                <th style={cell}>Status</th>
                <th style={cell}>Joined</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {page.subscribers.map((s) => (
                <tr key={s.id}>
                  <td style={cell}>{s.email_address}</td>
                  <td style={cell}>{s.first_name ?? '—'}</td>
                  <td style={cell}>{s.state}</td>
                  <td style={cell}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                  <td style={cell}>
                    {s.state === 'active' ? <UnsubscribeButton id={s.id} email={s.email_address} /> : null}
                  </td>
                </tr>
              ))}
              {page.subscribers.length === 0 && (
                <tr>
                  <td style={cell} colSpan={5}>
                    {q ? `No subscribers match “${q}”.` : 'No subscribers yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            {page.hasPrevPage && page.startCursor && (
              <Link href={`/admin/newsletter-subscribers?before=${encodeURIComponent(page.startCursor)}${qs}`} prefetch={false}>
                ← Previous
              </Link>
            )}
            {page.hasNextPage && page.endCursor && (
              <Link href={`/admin/newsletter-subscribers?after=${encodeURIComponent(page.endCursor)}${qs}`} prefetch={false}>
                Next →
              </Link>
            )}
          </div>
        </>
      )
    }
  }

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <h1 style={{ marginBottom: 'var(--base)' }}>Newsletter subscribers</h1>
        {kitEnabled() && <SubscribersToolbar initialSearch={q} />}
        {content}
      </Gutter>
    </DefaultTemplate>
  )
}
