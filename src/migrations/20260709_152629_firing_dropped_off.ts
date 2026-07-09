import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_firing_requests_status" ADD VALUE 'dropped_off' BEFORE 'completed';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  UPDATE "firing_requests" SET "status" = 'paid' WHERE "status" = 'dropped_off';
  DROP TYPE "public"."enum_firing_requests_status";
  CREATE TYPE "public"."enum_firing_requests_status" AS ENUM('pending', 'paid', 'completed', 'cancelled', 'refunded');
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_firing_requests_status";
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE "public"."enum_firing_requests_status" USING "status"::"public"."enum_firing_requests_status";`)
}
