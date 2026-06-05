import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_firing_requests_status" AS ENUM('submitted', 'approved', 'invoiced', 'invoice_failed', 'paid', 'completed', 'cancelled');
  ALTER TYPE "public"."enum_payments_type" ADD VALUE 'firing';
  CREATE TABLE "firing_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"description" varchar NOT NULL,
  	"height_in" numeric,
  	"width_in" numeric,
  	"depth_in" numeric,
  	"quantity" numeric DEFAULT 1,
  	"photo_id" integer,
  	"notes" varchar,
  	"status" "enum_firing_requests_status" DEFAULT 'submitted' NOT NULL,
  	"quoted_price_cents" numeric,
  	"admin_notes" varchar,
  	"square_customer_id" varchar,
  	"square_invoice_id" varchar,
  	"square_invoice_url" varchar,
  	"invoiced_at" timestamp(3) with time zone,
  	"paid_at" timestamp(3) with time zone,
  	"last_invoice_error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "firings_page_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"step" varchar NOT NULL
  );
  
  CREATE TABLE "firings_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"headline" varchar DEFAULT 'Custom Cone 10 Firings' NOT NULL,
  	"intro" varchar DEFAULT 'Bring us your work and we’ll fire it to Cone 10. Tell us about your piece below and we’ll quote a price based on its size.',
  	"pricing_note" varchar DEFAULT 'Price is quoted by size after we see your piece — you’re never charged up front.',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payments" ADD COLUMN "firing_request_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "firing_requests_id" integer;
  ALTER TABLE "firing_requests" ADD CONSTRAINT "firing_requests_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "firings_page_steps" ADD CONSTRAINT "firings_page_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."firings_page"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "firing_requests_photo_idx" ON "firing_requests" USING btree ("photo_id");
  CREATE INDEX "firing_requests_square_invoice_id_idx" ON "firing_requests" USING btree ("square_invoice_id");
  CREATE INDEX "firing_requests_updated_at_idx" ON "firing_requests" USING btree ("updated_at");
  CREATE INDEX "firing_requests_created_at_idx" ON "firing_requests" USING btree ("created_at");
  CREATE INDEX "firings_page_steps_order_idx" ON "firings_page_steps" USING btree ("_order");
  CREATE INDEX "firings_page_steps_parent_id_idx" ON "firings_page_steps" USING btree ("_parent_id");
  ALTER TABLE "payments" ADD CONSTRAINT "payments_firing_request_id_firing_requests_id_fk" FOREIGN KEY ("firing_request_id") REFERENCES "public"."firing_requests"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_firing_requests_fk" FOREIGN KEY ("firing_requests_id") REFERENCES "public"."firing_requests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payments_firing_request_idx" ON "payments" USING btree ("firing_request_id");
  CREATE INDEX "payload_locked_documents_rels_firing_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("firing_requests_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "firing_requests" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "firings_page_steps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "firings_page" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "firing_requests" CASCADE;
  DROP TABLE "firings_page_steps" CASCADE;
  DROP TABLE "firings_page" CASCADE;
  ALTER TABLE "payments" DROP CONSTRAINT "payments_firing_request_id_firing_requests_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_firing_requests_fk";
  
  ALTER TABLE "payments" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_payments_type";
  CREATE TYPE "public"."enum_payments_type" AS ENUM('booking', 'membership');
  ALTER TABLE "payments" ALTER COLUMN "type" SET DATA TYPE "public"."enum_payments_type" USING "type"::"public"."enum_payments_type";
  DROP INDEX "payments_firing_request_idx";
  DROP INDEX "payload_locked_documents_rels_firing_requests_id_idx";
  ALTER TABLE "payments" DROP COLUMN "firing_request_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "firing_requests_id";
  DROP TYPE "public"."enum_firing_requests_status";`)
}
