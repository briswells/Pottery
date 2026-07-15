import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

// Keep sharp's (off-heap, libvips) memory footprint small on low-RAM hosts:
// process one image at a time and don't retain decoded buffers between uploads.
sharp.concurrency(1)
sharp.cache(false)

import { Users } from './collections/Users'
import { People } from './collections/People'
import { MembershipPlans } from './collections/MembershipPlans'
import { Media } from './collections/Media'
import { Classes } from './collections/Classes'
import { ClassInstances } from './collections/ClassInstances'
import { Bookings } from './collections/Bookings'
import { Payments } from './collections/Payments'
import { FiringRequests } from './collections/FiringRequests'
import { ShelfTags } from './collections/ShelfTags'
import { Shelves } from './collections/Shelves'
import { Coupons } from './collections/Coupons'
import { Newsletters } from './collections/Newsletters'
import { SiteSettings } from './globals/SiteSettings'
import { HomePage } from './globals/HomePage'
import { MembershipPage } from './globals/MembershipPage'
import { FiringsPage } from './globals/FiringsPage'
import { syncSquarePlans, ensureFreePlan, ensureInvoicedPlan } from './services/sync-square-plans'
import { reconcileSquareMembers } from './services/reconcile-square-members'
import { reconcileInvoiceMembers } from './services/reconcile-invoice-members'
import { expireFiringRequestMedia } from './services/expire-firing-media'
import { completePastInstances } from './services/complete-past-instances'
import { squareMembershipGateway } from './lib/membership-gateway'
import { resendEmailAdapter, parseFromAddress } from './lib/payload-email-adapter'
import { newsletterSubscriberEndpoints } from './endpoints/newsletter-subscribers'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  // Public origin used to build links in transactional emails (e.g. the admin
  // forgot-password reset URL) and elsewhere.
  serverURL: process.env.PUBLIC_BASE_URL,
  // Route Payload's built-in transactional emails (admin forgot-password, etc.)
  // through the app's shared Resend integration. `from` defaults from EMAIL_FROM.
  email: resendEmailAdapter(parseFromAddress(process.env.EMAIL_FROM)),
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      beforeNavLinks: ['/admin/MembersNavLink#default', '/admin/MyClassesNavLink#default', '/admin/NewsletterNavLink#default'],
      views: {
        myClasses: {
          Component: '/admin/views/MyClasses#default',
          path: '/my-classes',
          exact: true,
        },
        myClassRoster: {
          Component: '/admin/views/MyClassRoster#default',
          path: '/my-classes/:id',
        },
        newsletterSubscribers: {
          Component: '/admin/views/Subscribers#default',
          path: '/newsletter-subscribers',
          exact: true,
        },
      },
    },
  },
  onInit: async (payload) => {
    // Skipped in tests (they manage their own data and must never hit Square).
    if (process.env.NODE_ENV === 'test') return
    // Ensure the platform Free plan exists (no Square needed). Self-healing on boot.
    try {
      await ensureFreePlan(payload)
    } catch (e) {
      payload.logger.error(`Ensuring Free plan failed: ${e instanceof Error ? e.message : e}`)
    }

    // Expire firing-request photos two weeks after completion. Runs on boot and
    // daily; independent of Square. Non-blocking so it never delays serving.
    const expireMedia = () =>
      expireFiringRequestMedia(payload)
        .then((r) => {
          if (r.deleted || r.failed)
            payload.logger.info(`Firing media expiry: deleted ${r.deleted}, failed ${r.failed}.`)
        })
        .catch((e) => payload.logger.error(`Firing media expiry failed: ${e instanceof Error ? e.message : e}`))
    void expireMedia()
    const firingTimer = setInterval(() => void expireMedia(), 24 * 60 * 60 * 1000)
    firingTimer.unref?.()

    // Mark published class instances completed once their last session day has
    // passed — keeps the admin list and public pages truthful without manual
    // status flips. Runs on boot and daily; independent of Square.
    const completeInstances = () =>
      completePastInstances(payload)
        .then((n) => {
          if (n) payload.logger.info(`Class instances auto-completed: ${n}.`)
        })
        .catch((e) => payload.logger.error(`Completing past instances failed: ${e instanceof Error ? e.message : e}`))
    void completeInstances()
    const completeTimer = setInterval(() => void completeInstances(), 24 * 60 * 60 * 1000)
    completeTimer.unref?.()

    // Keep the Square plans fresh on boot. Needs Square creds; never breaks boot.
    if (!process.env.SQUARE_ACCESS_TOKEN) return
    try {
      await syncSquarePlans({ payload, gateway: squareMembershipGateway })
    } catch (e) {
      payload.logger.error(`Startup plan sync failed: ${e instanceof Error ? e.message : e}`)
    }

    // Ensure the invoiced membership plan exists. Self-healing on boot.
    try {
      await ensureInvoicedPlan(payload)
    } catch (e) {
      payload.logger.error(`Ensuring invoiced plan failed: ${e instanceof Error ? e.message : e}`)
    }

    // Reconcile members from Square. This runs on every boot (initial sync +
    // recovery for anything missed while the app was down) and on a timer (so
    // missed webhooks are caught even without a restart). It is intentionally
    // NOT awaited: a slow or unreachable Square API must never block the app
    // from booting and serving — we just retry on the next run. Idempotent.
    const reconcileMembers = (syncPlans: boolean) =>
      reconcileSquareMembers({ payload, gateway: squareMembershipGateway, syncPlans })
        .then((r) =>
          payload.logger.info(
            `Square member reconcile: processed ${r.processed}, skipped ${r.skipped}, failed ${r.failed} across ${r.pages} page(s).`,
          ),
        )
        .catch((e) =>
          payload.logger.error(`Square member reconcile failed: ${e instanceof Error ? e.message : e}`),
        )

    // Reconcile invoice members after subscription members — so a subscription
    // member's Person row exists before invoice grouping runs (skip rule depends on it).
    const reconcileInvoiced = () =>
      reconcileInvoiceMembers({ payload, gateway: squareMembershipGateway })
        .then((r) =>
          payload.logger.info(
            `Invoice member reconcile: ${r.processed} processed (${r.active} active, ${r.pastDue} past due, ${r.cancelled} cancelled), ${r.skipped} skipped, ${r.failed} failed.`,
          ),
        )
        .catch((e) => payload.logger.error(`Invoice member reconcile failed: ${e instanceof Error ? e.message : e}`))

    // Initial sync now (plans were just synced above, so skip the redundant pass).
    // Subscriptions first, then invoice members — so a subscription member's
    // Person row exists before invoice grouping runs (skip rule depends on it).
    // Still non-blocking as a whole.
    void reconcileMembers(false).then(() => reconcileInvoiced())

    // Periodic safety net. Default 6h; set SQUARE_MEMBER_SYNC_INTERVAL_MINUTES=0 to disable.
    const intervalMinutes = Number(process.env.SQUARE_MEMBER_SYNC_INTERVAL_MINUTES ?? 360)
    if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
      const timer = setInterval(() => void reconcileMembers(true).then(() => reconcileInvoiced()), intervalMinutes * 60_000)
      // Don't let the timer keep short-lived CLI processes (migrate/seed) alive.
      timer.unref?.()
    }
  },
  // Reject very large uploads before sharp ever decodes them — this is the hard
  // cap that bounds the worst-case image-processing memory spike. 15MB is well
  // above a normal phone photo (2–8MB).
  upload: {
    limits: { fileSize: 15_000_000 },
  },
  collections: [Users, People, MembershipPlans, Media, Classes, ClassInstances, Bookings, Payments, FiringRequests, ShelfTags, Shelves, Coupons, Newsletters],
  globals: [SiteSettings, HomePage, MembershipPage, FiringsPage],
  endpoints: [...newsletterSubscriberEndpoints],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    push: process.env.NODE_ENV !== 'production',
  }),
  sharp,
  plugins:
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? [
          s3Storage({
            collections: { media: true },
            bucket: process.env.S3_BUCKET,
            config: {
              region: process.env.S3_REGION,
              endpoint: process.env.S3_ENDPOINT,
              forcePathStyle: true,
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              },
            },
          }),
        ]
      : [],
})
