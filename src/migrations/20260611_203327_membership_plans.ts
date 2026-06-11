import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_membership_plans_kind" AS ENUM('square', 'free');
  CREATE TABLE "membership_plans" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"kind" "enum_membership_plans_kind" DEFAULT 'square' NOT NULL,
  	"square_plan_variation_id" varchar,
  	"price_cents" numeric,
  	"cadence" varchar,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "members" ADD COLUMN "plan_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "membership_plans_id" integer;
  CREATE INDEX "membership_plans_square_plan_variation_id_idx" ON "membership_plans" USING btree ("square_plan_variation_id");
  CREATE INDEX "membership_plans_updated_at_idx" ON "membership_plans" USING btree ("updated_at");
  CREATE INDEX "membership_plans_created_at_idx" ON "membership_plans" USING btree ("created_at");
  ALTER TABLE "members" ADD CONSTRAINT "members_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_membership_plans_fk" FOREIGN KEY ("membership_plans_id") REFERENCES "public"."membership_plans"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "members_plan_idx" ON "members" USING btree ("plan_id");
  CREATE INDEX "payload_locked_documents_rels_membership_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("membership_plans_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "membership_plans" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "membership_plans" CASCADE;
  ALTER TABLE "members" DROP CONSTRAINT "members_plan_id_membership_plans_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_membership_plans_fk";
  
  DROP INDEX "members_plan_idx";
  DROP INDEX "payload_locked_documents_rels_membership_plans_id_idx";
  ALTER TABLE "members" DROP COLUMN "plan_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "membership_plans_id";
  DROP TYPE "public"."enum_membership_plans_kind";`)
}
