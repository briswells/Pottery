import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firing_requests" ADD COLUMN "completed_at" timestamp(3) with time zone;`)

  // Backfill already-completed requests so the 2-week photo-expiry policy also
  // applies to existing data. We don't know the true completion time, so use the
  // last-updated time as the best available approximation.
  await db.execute(sql`
    UPDATE "firing_requests" SET "completed_at" = "updated_at"
    WHERE "status" = 'completed' AND "completed_at" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firing_requests" DROP COLUMN "completed_at";`)
}
