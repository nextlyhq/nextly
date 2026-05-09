CREATE TABLE "user_permission_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource" varchar(100) NOT NULL,
	"has_permission" boolean NOT NULL,
	"role_ids" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_permission_cache" ADD CONSTRAINT "user_permission_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upc_user_id_idx" ON "user_permission_cache" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upc_expires_at_idx" ON "user_permission_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "upc_user_action_resource_idx" ON "user_permission_cache" USING btree ("user_id","action","resource");--> statement-breakpoint
CREATE INDEX "upc_role_ids_gin_idx" ON "user_permission_cache" USING gin ("role_ids");