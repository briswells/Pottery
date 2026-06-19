import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "shelves" ADD COLUMN "sort_key" varchar;
  CREATE INDEX "shelves_sort_key_idx" ON "shelves" USING btree ("sort_key");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "shelves_sort_key_idx";
  ALTER TABLE "shelves" DROP COLUMN "sort_key";`)
}
