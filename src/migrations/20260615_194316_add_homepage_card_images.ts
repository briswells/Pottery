import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "home_page" ADD COLUMN "visit_card_image_id" integer;
  ALTER TABLE "home_page" ADD COLUMN "class_card_image_id" integer;
  ALTER TABLE "home_page" ADD COLUMN "member_card_image_id" integer;
  ALTER TABLE "home_page" ADD CONSTRAINT "home_page_visit_card_image_id_media_id_fk" FOREIGN KEY ("visit_card_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "home_page" ADD CONSTRAINT "home_page_class_card_image_id_media_id_fk" FOREIGN KEY ("class_card_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "home_page" ADD CONSTRAINT "home_page_member_card_image_id_media_id_fk" FOREIGN KEY ("member_card_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "home_page_visit_card_image_idx" ON "home_page" USING btree ("visit_card_image_id");
  CREATE INDEX "home_page_class_card_image_idx" ON "home_page" USING btree ("class_card_image_id");
  CREATE INDEX "home_page_member_card_image_idx" ON "home_page" USING btree ("member_card_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "home_page" DROP CONSTRAINT "home_page_visit_card_image_id_media_id_fk";
  
  ALTER TABLE "home_page" DROP CONSTRAINT "home_page_class_card_image_id_media_id_fk";
  
  ALTER TABLE "home_page" DROP CONSTRAINT "home_page_member_card_image_id_media_id_fk";
  
  DROP INDEX "home_page_visit_card_image_idx";
  DROP INDEX "home_page_class_card_image_idx";
  DROP INDEX "home_page_member_card_image_idx";
  ALTER TABLE "home_page" DROP COLUMN "visit_card_image_id";
  ALTER TABLE "home_page" DROP COLUMN "class_card_image_id";
  ALTER TABLE "home_page" DROP COLUMN "member_card_image_id";`)
}
