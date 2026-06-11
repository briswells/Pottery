import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Members } from './collections/Members'
import { MembershipPlans } from './collections/MembershipPlans'
import { Media } from './collections/Media'
import { Classes } from './collections/Classes'
import { Bookings } from './collections/Bookings'
import { Payments } from './collections/Payments'
import { FiringRequests } from './collections/FiringRequests'
import { SiteSettings } from './globals/SiteSettings'
import { HomePage } from './globals/HomePage'
import { MembershipPage } from './globals/MembershipPage'
import { FiringsPage } from './globals/FiringsPage'
import { syncSquarePlans } from './services/sync-square-plans'
import { squareMembershipGateway } from './lib/membership-gateway'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  onInit: async (payload) => {
    // Keep the Plans list seeded/fresh on boot. Skipped in tests (never hit Square
    // in CI) and when Square isn't configured. Never blocks/breaks boot.
    if (process.env.NODE_ENV === 'test' || !process.env.SQUARE_ACCESS_TOKEN) return
    try {
      await syncSquarePlans({ payload, gateway: squareMembershipGateway })
    } catch (e) {
      payload.logger.error(`Startup plan sync failed: ${e instanceof Error ? e.message : e}`)
    }
  },
  collections: [Users, Members, MembershipPlans, Media, Classes, Bookings, Payments, FiringRequests],
  globals: [SiteSettings, HomePage, MembershipPage, FiringsPage],
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
