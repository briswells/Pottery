import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "class_instances" ADD COLUMN "number_of_classes" numeric;
  ALTER TABLE "classes" DROP COLUMN "category";
  DROP TYPE "public"."enum_classes_category";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_classes_category" AS ENUM('wheel-series', 'day-camp', 'raku', 'daytime-multiweek');
  ALTER TABLE "classes" ADD COLUMN "category" "enum_classes_category" NOT NULL;
  ALTER TABLE "class_instances" DROP COLUMN "number_of_classes";`)
}
