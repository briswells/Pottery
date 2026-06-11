/**
 * Lists every Square subscription plan + plan variation (with its catalog object
 * ID) in whatever Square environment the current credentials point at.
 *
 * Use it to find the value for SQUARE_MEMBERSHIP_PLAN_VARIATION_ID:
 *   - sandbox: set SQUARE_ENVIRONMENT=sandbox (+ sandbox token) in .env, run it.
 *   - production: point the env at production, run it.
 *
 * Run:  pnpm exec tsx scripts/list-membership-plans.ts
 *
 * This is read-only — it never creates or modifies anything in Square. If no
 * plans exist (e.g. a fresh sandbox), create one in the Square Dashboard
 * (Items & Services → Subscriptions), then re-run to grab the variation ID.
 */
import 'dotenv/config'
import { getSquareClient } from '../src/lib/square'

type CatalogObj = {
  id: string
  type: string
  subscriptionPlanData?: { name?: string }
  subscriptionPlanVariationData?: {
    name?: string
    subscriptionPlanId?: string
    phases?: Array<{
      cadence?: string
      pricing?: { type?: string; priceMoney?: { amount?: bigint | number; currency?: string } }
      pricingPhaseMoney?: { amount?: bigint | number; currency?: string }
    }>
  }
}

async function collectCatalog(): Promise<CatalogObj[]> {
  const client = getSquareClient()
  const res: any = await client.catalog.list({ types: 'SUBSCRIPTION_PLAN,SUBSCRIPTION_PLAN_VARIATION' })
  const items: CatalogObj[] = []
  if (res && typeof res[Symbol.asyncIterator] === 'function') {
    for await (const obj of res) items.push(obj as CatalogObj)
  } else if (Array.isArray(res?.data)) {
    items.push(...(res.data as CatalogObj[]))
  } else if (Array.isArray(res?.objects)) {
    items.push(...(res.objects as CatalogObj[]))
  }
  return items
}

function formatPrice(v: CatalogObj): string {
  const phase = v.subscriptionPlanVariationData?.phases?.[0]
  const money = phase?.pricing?.priceMoney ?? phase?.pricingPhaseMoney
  const amount = money?.amount != null ? Number(money.amount) : undefined
  const cadence = phase?.cadence ? ` / ${phase.cadence.toLowerCase()}` : ''
  return amount != null ? `$${(amount / 100).toFixed(2)}${cadence}` : '(price n/a)'
}

async function run() {
  const env = process.env.SQUARE_ENVIRONMENT ?? 'sandbox'
  console.log(`\nSquare environment: ${env}\n`)

  const objects = await collectCatalog()
  const plans = objects.filter((o) => o.type === 'SUBSCRIPTION_PLAN')
  const variations = objects.filter((o) => o.type === 'SUBSCRIPTION_PLAN_VARIATION')

  if (variations.length === 0) {
    console.log('No subscription plan variations found in this environment.')
    console.log('Create a subscription plan in the Square Dashboard (Items & Services →')
    console.log('Subscriptions), then re-run this to get its variation ID.\n')
    return
  }

  const planName = (id?: string) =>
    plans.find((p) => p.id === id)?.subscriptionPlanData?.name ?? '(unknown plan)'

  console.log('Set SQUARE_MEMBERSHIP_PLAN_VARIATION_ID to the variation ID you want:\n')
  for (const v of variations) {
    const d = v.subscriptionPlanVariationData
    console.log(`  plan:      ${planName(d?.subscriptionPlanId)}`)
    console.log(`  variation: ${d?.name ?? '(unnamed)'}  —  ${formatPrice(v)}`)
    console.log(`  ID:        ${v.id}`)
    console.log('')
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed to list subscription plans:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
