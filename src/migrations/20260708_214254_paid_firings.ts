import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_coupons_applies_to" ADD VALUE 'firing';
  CREATE TABLE "firing_requests_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer
  );
  
  ALTER TABLE "firing_requests" DROP CONSTRAINT "firing_requests_photo_id_media_id_fk";
  
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  UPDATE "firing_requests" SET "status" = 'cancelled' WHERE "status" IN ('submitted','approved','invoiced','invoice_failed');
  DROP TYPE "public"."enum_firing_requests_status";
  CREATE TYPE "public"."enum_firing_requests_status" AS ENUM('pending', 'paid', 'completed', 'cancelled', 'refunded');
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_firing_requests_status";
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE "public"."enum_firing_requests_status" USING "status"::"public"."enum_firing_requests_status";
  DROP INDEX "firing_requests_photo_idx";
  DROP INDEX "firing_requests_square_invoice_id_idx";
  ALTER TABLE "firing_requests" ALTER COLUMN "status" DROP NOT NULL;
  ALTER TABLE "firing_requests" ADD COLUMN "half_shelves" numeric DEFAULT 1 NOT NULL;
  ALTER TABLE "firing_requests" ADD COLUMN "amount_cents" numeric DEFAULT 0 NOT NULL;
  ALTER TABLE "firing_requests" ALTER COLUMN "half_shelves" DROP DEFAULT;
  ALTER TABLE "firing_requests" ALTER COLUMN "amount_cents" DROP DEFAULT;
  ALTER TABLE "firing_requests" ADD COLUMN "discount_cents" numeric;
  ALTER TABLE "firing_requests" ADD COLUMN "coupon_id" integer;
  ALTER TABLE "firing_requests" ADD COLUMN "square_payment_id" varchar;
  ALTER TABLE "firing_requests" ADD COLUMN "stoneware_confirmed" boolean DEFAULT false NOT NULL;
  ALTER TABLE "firing_requests_rels" ADD CONSTRAINT "firing_requests_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."firing_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "firing_requests_rels" ADD CONSTRAINT "firing_requests_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "firing_requests_rels_order_idx" ON "firing_requests_rels" USING btree ("order");
  CREATE INDEX "firing_requests_rels_parent_idx" ON "firing_requests_rels" USING btree ("parent_id");
  CREATE INDEX "firing_requests_rels_path_idx" ON "firing_requests_rels" USING btree ("path");
  CREATE INDEX "firing_requests_rels_media_id_idx" ON "firing_requests_rels" USING btree ("media_id");
  ALTER TABLE "firing_requests" ADD CONSTRAINT "firing_requests_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "firing_requests_coupon_idx" ON "firing_requests" USING btree ("coupon_id");
  CREATE INDEX "firing_requests_square_payment_id_idx" ON "firing_requests" USING btree ("square_payment_id");
  ALTER TABLE "firing_requests" DROP COLUMN "height_in";
  ALTER TABLE "firing_requests" DROP COLUMN "width_in";
  ALTER TABLE "firing_requests" DROP COLUMN "depth_in";
  ALTER TABLE "firing_requests" DROP COLUMN "quantity";
  ALTER TABLE "firing_requests" DROP COLUMN "photo_id";
  ALTER TABLE "firing_requests" DROP COLUMN "quoted_price_cents";
  ALTER TABLE "firing_requests" DROP COLUMN "admin_notes";
  ALTER TABLE "firing_requests" DROP COLUMN "square_customer_id";
  ALTER TABLE "firing_requests" DROP COLUMN "square_invoice_id";
  ALTER TABLE "firing_requests" DROP COLUMN "square_invoice_url";
  ALTER TABLE "firing_requests" DROP COLUMN "invoiced_at";
  ALTER TABLE "firing_requests" DROP COLUMN "last_invoice_error";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firing_requests_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "firing_requests_rels" CASCADE;
  ALTER TABLE "firing_requests" DROP CONSTRAINT IF EXISTS "firing_requests_coupon_id_coupons_id_fk";

  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE text;
  UPDATE "firing_requests" SET "status" = 'submitted' WHERE "status" IS NULL OR "status" = 'pending';
  UPDATE "firing_requests" SET "status" = 'cancelled' WHERE "status" = 'refunded';
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'submitted'::text;
  DROP TYPE "public"."enum_firing_requests_status";
  CREATE TYPE "public"."enum_firing_requests_status" AS ENUM('submitted', 'approved', 'invoiced', 'invoice_failed', 'paid', 'completed', 'cancelled');
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DEFAULT 'submitted'::"public"."enum_firing_requests_status";
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET DATA TYPE "public"."enum_firing_requests_status" USING "status"::"public"."enum_firing_requests_status";
  ALTER TABLE "coupons" ALTER COLUMN "applies_to" SET DATA TYPE text;
  UPDATE "coupons" SET "applies_to" = 'all' WHERE "applies_to" = 'firing';
  ALTER TABLE "coupons" ALTER COLUMN "applies_to" SET DEFAULT 'all'::text;
  DROP TYPE "public"."enum_coupons_applies_to";
  CREATE TYPE "public"."enum_coupons_applies_to" AS ENUM('all', 'class');
  ALTER TABLE "coupons" ALTER COLUMN "applies_to" SET DEFAULT 'all'::"public"."enum_coupons_applies_to";
  ALTER TABLE "coupons" ALTER COLUMN "applies_to" SET DATA TYPE "public"."enum_coupons_applies_to" USING "applies_to"::"public"."enum_coupons_applies_to";
  DROP INDEX IF EXISTS "firing_requests_coupon_idx";
  DROP INDEX IF EXISTS "firing_requests_square_payment_id_idx";
  ALTER TABLE "firing_requests" ALTER COLUMN "status" SET NOT NULL;
  ALTER TABLE "firing_requests" ADD COLUMN "height_in" numeric;
  ALTER TABLE "firing_requests" ADD COLUMN "width_in" numeric;
  ALTER TABLE "firing_requests" ADD COLUMN "depth_in" numeric;
  ALTER TABLE "firing_requests" ADD COLUMN "quantity" numeric DEFAULT 1;
  ALTER TABLE "firing_requests" ADD COLUMN "photo_id" integer;
  ALTER TABLE "firing_requests" ADD COLUMN "quoted_price_cents" numeric;
  ALTER TABLE "firing_requests" ADD COLUMN "admin_notes" varchar;
  ALTER TABLE "firing_requests" ADD COLUMN "square_customer_id" varchar;
  ALTER TABLE "firing_requests" ADD COLUMN "square_invoice_id" varchar;
  ALTER TABLE "firing_requests" ADD COLUMN "square_invoice_url" varchar;
  ALTER TABLE "firing_requests" ADD COLUMN "invoiced_at" timestamp(3) with time zone;
  ALTER TABLE "firing_requests" ADD COLUMN "last_invoice_error" varchar;
  ALTER TABLE "firing_requests" ADD CONSTRAINT "firing_requests_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "firing_requests_photo_idx" ON "firing_requests" USING btree ("photo_id");
  CREATE INDEX "firing_requests_square_invoice_id_idx" ON "firing_requests" USING btree ("square_invoice_id");
  ALTER TABLE "firing_requests" DROP COLUMN "half_shelves";
  ALTER TABLE "firing_requests" DROP COLUMN "amount_cents";
  ALTER TABLE "firing_requests" DROP COLUMN "discount_cents";
  ALTER TABLE "firing_requests" DROP COLUMN "coupon_id";
  ALTER TABLE "firing_requests" DROP COLUMN "square_payment_id";
  ALTER TABLE "firing_requests" DROP COLUMN "stoneware_confirmed";`)
}
