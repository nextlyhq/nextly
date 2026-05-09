CREATE INDEX "dynamic_collections_created_by_idx" ON "dynamic_collections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "dynamic_collections_created_at_idx" ON "dynamic_collections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dynamic_collections_updated_at_idx" ON "dynamic_collections" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "permissions_action_idx" ON "permissions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "role_inherits_parent_idx" ON "role_inherits" USING btree ("parent_role_id");--> statement-breakpoint
CREATE INDEX "roles_level_idx" ON "roles" USING btree ("level");--> statement-breakpoint
CREATE INDEX "roles_is_system_idx" ON "roles" USING btree ("is_system");--> statement-breakpoint
CREATE INDEX "user_roles_expires_at_idx" ON "user_roles" USING btree ("expires_at");