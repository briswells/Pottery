import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "members" ADD COLUMN "cancel_token_hash" varchar;
  ALTER TABLE "members" ADD COLUMN "cancel_token_expires_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "members" DROP COLUMN "cancel_token_hash";
  ALTER TABLE "members" DROP COLUMN "cancel_token_expires_at";`)
}
