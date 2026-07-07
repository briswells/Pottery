import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_coupons_discount_type" AS ENUM('percent', 'fixed');
  CREATE TYPE "public"."enum_coupons_applies_to" AS ENUM('all', 'class');
  CREATE TABLE "coupons" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"discount_type" "enum_coupons_discount_type" DEFAULT 'percent' NOT NULL,
  	"percent_off" numeric,
  	"amount_off_cents" numeric,
  	"applies_to" "enum_coupons_applies_to" DEFAULT 'all',
  	"class_id" integer,
  	"active" boolean DEFAULT true,
  	"expires_at" timestamp(3) with time zone,
  	"max_redemptions" numeric,
  	"one_per_customer" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payments" ALTER COLUMN "square_id" DROP NOT NULL;
  ALTER TABLE "bookings" ADD COLUMN "discount_cents" numeric;
  ALTER TABLE "bookings" ADD COLUMN "coupon_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "coupons_id" integer;
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");
  CREATE INDEX "coupons_class_idx" ON "coupons" USING btree ("class_id");
  CREATE INDEX "coupons_updated_at_idx" ON "coupons" USING btree ("updated_at");
  CREATE INDEX "coupons_created_at_idx" ON "coupons" USING btree ("created_at");
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_coupons_fk" FOREIGN KEY ("coupons_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "bookings_coupon_idx" ON "bookings" USING btree ("coupon_id");
  CREATE INDEX "payload_locked_documents_rels_coupons_id_idx" ON "payload_locked_documents_rels" USING btree ("coupons_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "coupons" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "coupons" CASCADE;
  ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_coupon_id_coupons_id_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_coupons_fk";

  DROP INDEX IF EXISTS "bookings_coupon_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_coupons_id_idx";
  UPDATE "payments" SET "square_id" = 'free-' || "id" WHERE "square_id" IS NULL;
  ALTER TABLE "payments" ALTER COLUMN "square_id" SET NOT NULL;
  ALTER TABLE "bookings" DROP COLUMN "discount_cents";
  ALTER TABLE "bookings" DROP COLUMN "coupon_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "coupons_id";
  DROP TYPE "public"."enum_coupons_discount_type";
  DROP TYPE "public"."enum_coupons_applies_to";`)
}
