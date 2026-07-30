import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { ScheduleSeriesForm } from './ScheduleSeriesForm'

export default async function ScheduleSeries({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  const staff = user && user.collection === 'users' && user.roles?.some((r) => r === 'admin' || r === 'editor')
  if (!staff) redirect('/admin')

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
        <h1 style={{ marginBottom: 8 }}>Schedule a series</h1>
        <p style={{ color: 'var(--theme-elevation-500)', marginBottom: 20, maxWidth: 640 }}>
          Create a batch of single-day classes from a repeating pattern. Preview the exact dates, uncheck any you
          don&apos;t want, and the rest are published immediately as normal class instances.
        </p>
        <ScheduleSeriesForm />
      </Gutter>
    </DefaultTemplate>
  )
}
