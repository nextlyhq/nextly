CREATE TABLE "field_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"collection_slug" varchar(100) NOT NULL,
	"field_path" varchar(255) NOT NULL,
	"action" varchar(10) NOT NULL,
	"condition" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "upc_created_at_idx";--> statement-breakpoint
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_permissions_role_collection_field_unique" ON "field_permissions" USING btree ("role_id","collection_slug","field_path");--> statement-breakpoint
CREATE INDEX "field_permissions_role_id_idx" ON "field_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "field_permissions_collection_idx" ON "field_permissions" USING btree ("collection_slug");--> statement-breakpoint
CREATE INDEX "field_permissions_lookup_idx" ON "field_permissions" USING btree ("role_id","collection_slug","field_path");