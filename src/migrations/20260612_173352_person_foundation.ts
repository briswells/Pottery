import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // DATA-PRESERVING migration. The generated scaffold dropped & recreated
  // "members"/"members_sessions" (which would destroy all member rows and the
  // payments->member FK). Instead we RENAME the tables, columns, indexes,
  // constraints and the status enum so existing rows are preserved while the
  // resulting schema matches Payload's expected end state exactly.
  await db.execute(sql`
  -- 1. Rename the core tables (rows preserved; the serial sequence is renamed
  --    automatically with the table).
  ALTER TABLE "members" RENAME TO "people";
  ALTER TABLE "members_sessions" RENAME TO "people_sessions";

  -- 2. Rename the relationship columns Payload addresses as "<slug>_id"
  --    (preserves any existing admin lock / preference references).
  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "members_id" TO "people_id";
  ALTER TABLE "payload_preferences_rels" RENAME COLUMN "members_id" TO "people_id";

  -- 3. Recreate the membership-status enum with the new 'none' value, make the
  --    column nullable, and set DEFAULT 'none'. Swap via text because ENUM
  --    values can't be reordered in place. Existing values all exist in the new
  --    type, so current members keep their status.
  ALTER TABLE "people" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "people" ALTER COLUMN "status" DROP NOT NULL;
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE text;
  DROP TYPE "public"."enum_members_status";
  CREATE TYPE "public"."enum_people_status" AS ENUM('none', 'active', 'past_due', 'paused', 'cancelled');
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE "public"."enum_people_status" USING "status"::"public"."enum_people_status";
  ALTER TABLE "people" ALTER COLUMN "status" SET DEFAULT 'none';

  -- 4. Rename the FK constraints so their names match Payload's model. A table
  --    RENAME leaves named constraints with their old names, so we rename them
  --    explicitly. The payments->member FK survives the rename automatically and
  --    keeps its ON DELETE behaviour; we only relabel it.
  ALTER TABLE "people_sessions" RENAME CONSTRAINT "members_sessions_parent_id_fk" TO "people_sessions_parent_id_fk";
  ALTER TABLE "people" RENAME CONSTRAINT "members_plan_id_membership_plans_id_fk" TO "people_plan_id_membership_plans_id_fk";
  ALTER TABLE "payments" RENAME CONSTRAINT "payments_member_id_members_id_fk" TO "payments_member_id_people_id_fk";
  ALTER TABLE "payload_locked_documents_rels" RENAME CONSTRAINT "payload_locked_documents_rels_members_fk" TO "payload_locked_documents_rels_people_fk";
  ALTER TABLE "payload_preferences_rels" RENAME CONSTRAINT "payload_preferences_rels_members_fk" TO "payload_preferences_rels_people_fk";

  -- 5. Rename the indexes that a table RENAME left with their old names.
  ALTER INDEX "members_sessions_order_idx" RENAME TO "people_sessions_order_idx";
  ALTER INDEX "members_sessions_parent_id_idx" RENAME TO "people_sessions_parent_id_idx";
  ALTER INDEX "members_plan_idx" RENAME TO "people_plan_idx";
  ALTER INDEX "members_square_customer_id_idx" RENAME TO "people_square_customer_id_idx";
  ALTER INDEX "members_square_subscription_id_idx" RENAME TO "people_square_subscription_id_idx";
  ALTER INDEX "members_updated_at_idx" RENAME TO "people_updated_at_idx";
  ALTER INDEX "members_created_at_idx" RENAME TO "people_created_at_idx";
  ALTER INDEX "members_email_idx" RENAME TO "people_email_idx";
  ALTER INDEX "payload_locked_documents_rels_members_id_idx" RENAME TO "payload_locked_documents_rels_people_id_idx";
  ALTER INDEX "payload_preferences_rels_members_id_idx" RENAME TO "payload_preferences_rels_people_id_idx";

  -- 6. Add the person link to bookings and firing-requests (genuinely additive).
  ALTER TABLE "bookings" ADD COLUMN "person_id" integer;
  ALTER TABLE "firing_requests" ADD COLUMN "person_id" integer;
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "firing_requests" ADD CONSTRAINT "firing_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "bookings_person_idx" ON "bookings" USING btree ("person_id");
  CREATE INDEX "firing_requests_person_idx" ON "firing_requests" USING btree ("person_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Reverse of up(), best-effort and data-preserving. Any rows with the new
  // 'none' status are remapped to 'active' before casting back to the old enum
  // (which has no 'none' value).
  await db.execute(sql`
  -- 6. Drop the person link from bookings and firing-requests.
  DROP INDEX "bookings_person_idx";
  DROP INDEX "firing_requests_person_idx";
  ALTER TABLE "bookings" DROP CONSTRAINT "bookings_person_id_people_id_fk";
  ALTER TABLE "firing_requests" DROP CONSTRAINT "firing_requests_person_id_people_id_fk";
  ALTER TABLE "bookings" DROP COLUMN "person_id";
  ALTER TABLE "firing_requests" DROP COLUMN "person_id";

  -- 5. Restore the original index names.
  ALTER INDEX "people_sessions_order_idx" RENAME TO "members_sessions_order_idx";
  ALTER INDEX "people_sessions_parent_id_idx" RENAME TO "members_sessions_parent_id_idx";
  ALTER INDEX "people_plan_idx" RENAME TO "members_plan_idx";
  ALTER INDEX "people_square_customer_id_idx" RENAME TO "members_square_customer_id_idx";
  ALTER INDEX "people_square_subscription_id_idx" RENAME TO "members_square_subscription_id_idx";
  ALTER INDEX "people_updated_at_idx" RENAME TO "members_updated_at_idx";
  ALTER INDEX "people_created_at_idx" RENAME TO "members_created_at_idx";
  ALTER INDEX "people_email_idx" RENAME TO "members_email_idx";
  ALTER INDEX "payload_locked_documents_rels_people_id_idx" RENAME TO "payload_locked_documents_rels_members_id_idx";
  ALTER INDEX "payload_preferences_rels_people_id_idx" RENAME TO "payload_preferences_rels_members_id_idx";

  -- 4. Restore the original FK constraint names.
  ALTER TABLE "people_sessions" RENAME CONSTRAINT "people_sessions_parent_id_fk" TO "members_sessions_parent_id_fk";
  ALTER TABLE "people" RENAME CONSTRAINT "people_plan_id_membership_plans_id_fk" TO "members_plan_id_membership_plans_id_fk";
  ALTER TABLE "payments" RENAME CONSTRAINT "payments_member_id_people_id_fk" TO "payments_member_id_members_id_fk";
  ALTER TABLE "payload_locked_documents_rels" RENAME CONSTRAINT "payload_locked_documents_rels_people_fk" TO "payload_locked_documents_rels_members_fk";
  ALTER TABLE "payload_preferences_rels" RENAME CONSTRAINT "payload_preferences_rels_people_fk" TO "payload_preferences_rels_members_fk";

  -- 3. Restore the original status enum (no 'none'), NOT NULL, DEFAULT 'active'.
  ALTER TABLE "people" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE text;
  UPDATE "people" SET "status" = 'active' WHERE "status" = 'none';
  UPDATE "people" SET "status" = 'active' WHERE "status" IS NULL;
  DROP TYPE "public"."enum_people_status";
  CREATE TYPE "public"."enum_members_status" AS ENUM('active', 'past_due', 'paused', 'cancelled');
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE "public"."enum_members_status" USING "status"::"public"."enum_members_status";
  ALTER TABLE "people" ALTER COLUMN "status" SET DEFAULT 'active';
  ALTER TABLE "people" ALTER COLUMN "status" SET NOT NULL;

  -- 2. Restore the relationship column names.
  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "people_id" TO "members_id";
  ALTER TABLE "payload_preferences_rels" RENAME COLUMN "people_id" TO "members_id";

  -- 1. Restore the original table names.
  ALTER TABLE "people_sessions" RENAME TO "members_sessions";
  ALTER TABLE "people" RENAME TO "members";`)
}
