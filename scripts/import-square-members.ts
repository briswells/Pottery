import { getPayload } from 'payload'
import config from '@payload-config'
import { squareMembershipGateway } from '../src/lib/membership-gateway'
import { reconcileSquareMembers } from '../src/services/reconcile-square-members'

// Manual/one-off member import. The same reconciliation now also runs
// automatically on boot and on a timer (see payload.config.ts onInit), so this
// is mainly for local use or to force an immediate full sync.
async function run() {
  const payload = await getPayload({ config: await config })
  const r = await reconcileSquareMembers({ payload, gateway: squareMembershipGateway })
  console.log(
    `Import complete. Processed ${r.processed}, skipped ${r.skipped}, failed ${r.failed} across ${r.pages} page(s).`,
  )
  process.exit(r.failed > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
