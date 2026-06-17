import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" ALTER COLUMN "alt" DROP NOT NULL;
  ALTER TABLE "media" ADD COLUMN "include_in_gallery" boolean DEFAULT false;`)

  // Backfill: the gallery moved from the Home Page "gallery" list onto a
  // per-image checkbox. Carry over whatever was already in that list so the
  // existing gallery doesn't disappear.
  await db.execute(sql`
    UPDATE "media" SET "include_in_gallery" = true
    WHERE "id" IN (
      SELECT "media_id" FROM "home_page_rels"
      WHERE "path" = 'gallery' AND "media_id" IS NOT NULL
    );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "media" SET "alt" = '' WHERE "alt" IS NULL;
  ALTER TABLE "media" ALTER COLUMN "alt" SET NOT NULL;
  ALTER TABLE "media" DROP COLUMN "include_in_gallery";`)
}
