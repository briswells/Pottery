import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firings_page" ADD COLUMN "image_id" integer;
  ALTER TABLE "firings_page" ADD CONSTRAINT "firings_page_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "firings_page_image_idx" ON "firings_page" USING btree ("image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firings_page" DROP CONSTRAINT IF EXISTS "firings_page_image_id_media_id_fk";

  DROP INDEX IF EXISTS "firings_page_image_idx";
  ALTER TABLE "firings_page" DROP COLUMN IF EXISTS "image_id";`)
}
