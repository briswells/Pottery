import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "bookings" ADD COLUMN "tax_cents" numeric DEFAULT 0;
  ALTER TABLE "payments" ADD COLUMN "tax_cents" numeric DEFAULT 0;
  ALTER TABLE "firing_requests" ADD COLUMN "tax_cents" numeric DEFAULT 0;
  ALTER TABLE "site_settings" ADD COLUMN "sales_tax_percent" numeric DEFAULT 8.9;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "bookings" DROP COLUMN IF EXISTS "tax_cents";
  ALTER TABLE "payments" DROP COLUMN IF EXISTS "tax_cents";
  ALTER TABLE "firing_requests" DROP COLUMN IF EXISTS "tax_cents";
  ALTER TABLE "site_settings" DROP COLUMN IF EXISTS "sales_tax_percent";`)
}
