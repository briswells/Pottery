import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { validateCancelToken } from '../../../../../services/membership-cancel'
import { ConfirmCancelButton } from '../ConfirmCancelButton'

export const dynamic = 'force-dynamic'

export default async function CancelConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const payload = await getPayload({ config: await config })
  const result = await validateCancelToken({ payload }, token ?? '')

  return (
    <div style={{ padding: '40px 0', maxWidth: 480 }}>
      <h1>Cancel your membership</h1>
      {result.ok ? (
        <>
          <p>
            Hi {result.member?.name}, click below to cancel your Portside Pottery membership. This takes effect at the
            end of your current billing period.
          </p>
          <ConfirmCancelButton token={token ?? ''} />
        </>
      ) : (
        <p style={{ marginTop: 8 }}>
          This cancellation link is invalid or has expired. You can{' '}
          <Link href="/membership/cancel">request a new one</Link>.
        </p>
      )}
    </div>
  )
}
