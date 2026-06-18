import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "shelf_tags" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "shelves" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"tag_id" integer,
  	"assigned_member_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "people" ADD COLUMN "shelf_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "shelf_tags_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "shelves_id" integer;
  ALTER TABLE "shelves" ADD CONSTRAINT "shelves_tag_id_shelf_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."shelf_tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "shelves" ADD CONSTRAINT "shelves_assigned_member_id_people_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "shelf_tags_name_idx" ON "shelf_tags" USING btree ("name");
  CREATE INDEX "shelf_tags_updated_at_idx" ON "shelf_tags" USING btree ("updated_at");
  CREATE INDEX "shelf_tags_created_at_idx" ON "shelf_tags" USING btree ("created_at");
  CREATE UNIQUE INDEX "shelves_name_idx" ON "shelves" USING btree ("name");
  CREATE INDEX "shelves_tag_idx" ON "shelves" USING btree ("tag_id");
  CREATE INDEX "shelves_assigned_member_idx" ON "shelves" USING btree ("assigned_member_id");
  CREATE INDEX "shelves_updated_at_idx" ON "shelves" USING btree ("updated_at");
  CREATE INDEX "shelves_created_at_idx" ON "shelves" USING btree ("created_at");
  ALTER TABLE "people" ADD CONSTRAINT "people_shelf_id_shelves_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelves"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_shelf_tags_fk" FOREIGN KEY ("shelf_tags_id") REFERENCES "public"."shelf_tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_shelves_fk" FOREIGN KEY ("shelves_id") REFERENCES "public"."shelves"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "people_shelf_idx" ON "people" USING btree ("shelf_id");
  CREATE INDEX "payload_locked_documents_rels_shelf_tags_id_idx" ON "payload_locked_documents_rels" USING btree ("shelf_tags_id");
  CREATE INDEX "payload_locked_documents_rels_shelves_id_idx" ON "payload_locked_documents_rels" USING btree ("shelves_id");
  ALTER TABLE "people" DROP COLUMN "shelf_label";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "shelf_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "shelves" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "shelf_tags" CASCADE;
  DROP TABLE "shelves" CASCADE;
  ALTER TABLE "people" DROP CONSTRAINT "people_shelf_id_shelves_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_shelf_tags_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_shelves_fk";
  
  DROP INDEX "people_shelf_idx";
  DROP INDEX "payload_locked_documents_rels_shelf_tags_id_idx";
  DROP INDEX "payload_locked_documents_rels_shelves_id_idx";
  ALTER TABLE "people" ADD COLUMN "shelf_label" varchar;
  ALTER TABLE "people" DROP COLUMN "shelf_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "shelf_tags_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "shelves_id";`)
}
