PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE nextly_schema_lock (id integer PRIMARY KEY, owner text, command text, acquired_at integer, expires_at integer);
CREATE TABLE nextly_field_group_lock (id integer PRIMARY KEY, owner text, expires_at integer);
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`actor_type` text,
	`user_name` text,
	`user_email` text,
	`action` text NOT NULL,
	`collection` text NOT NULL,
	`entry_id` text,
	`entry_title` text,
	`locale` text,
	`subject_kind` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`identity_erased_at` integer
);
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`token_type` text NOT NULL,
	`role_id` text,
	`user_id` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_api_keys_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`ip_address` text,
	`user_agent` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`identity_erased_at` integer,
	`actor_kind` text,
	`actor_principal_kind` text,
	`actor_principal_id` text,
	`target_principal_kind` text,
	`target_principal_id` text
);
CREATE TABLE `dynamic_collections` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`labels` text NOT NULL,
	`table_name` text NOT NULL UNIQUE,
	`description` text,
	`fields` text NOT NULL,
	`timestamps` integer DEFAULT true NOT NULL,
	`status` integer DEFAULT false NOT NULL,
	`localized` integer DEFAULT false NOT NULL,
	`versions` text,
	`revalidate` text,
	`webhooks` text,
	`admin` text,
	`hooks` text,
	`source` text DEFAULT 'ui' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`config_path` text,
	`schema_hash` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`migration_status` text DEFAULT 'pending' NOT NULL,
	`last_migration_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_dynamic_collections_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
CREATE TABLE `dynamic_components` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`label` text NOT NULL,
	`table_name` text NOT NULL UNIQUE,
	`description` text,
	`fields` text NOT NULL,
	`admin` text,
	`source` text DEFAULT 'ui' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`localized` integer DEFAULT false NOT NULL,
	`config_path` text,
	`schema_hash` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`migration_status` text DEFAULT 'pending' NOT NULL,
	`last_migration_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `dynamic_singles` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`label` text NOT NULL,
	`table_name` text NOT NULL UNIQUE,
	`description` text,
	`fields` text NOT NULL,
	`admin` text,
	`source` text DEFAULT 'ui' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`status` integer DEFAULT false NOT NULL,
	`localized` integer DEFAULT false NOT NULL,
	`versions` text,
	`revalidate` text,
	`webhooks` text,
	`config_path` text,
	`schema_hash` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`migration_status` text DEFAULT 'pending' NOT NULL,
	`last_migration_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY,
	`provider_id` text,
	`provider_type` text NOT NULL,
	`template_slug` text,
	`recipient_hash` text NOT NULL,
	`recipient_kind` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`next_attempt_at` integer,
	`error` text,
	`message_id` text,
	`retention_class` text NOT NULL,
	`principal_kind` text,
	`principal_id` text,
	`key_digest` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_email_deliveries_provider_id_email_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `email_providers`(`id`) ON DELETE SET NULL
);
CREATE TABLE `email_providers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`configuration` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `email_queue` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`job_id` text,
	`message` text,
	`principal_kind` text,
	`principal_id` text,
	`failure` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer
);
CREATE TABLE `email_queue_recipients` (
	`queued_id` text NOT NULL,
	`recipient_hash` text NOT NULL,
	`recipient_kind` text NOT NULL,
	CONSTRAINT `email_queue_recipients_pk` PRIMARY KEY(`queued_id`, `recipient_hash`)
);
CREATE TABLE `email_send_claims` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`key_digest` text,
	`message_digest` text,
	`state` text NOT NULL,
	`holder` text NOT NULL,
	`result` text,
	`claimed_at` integer NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`settled_at` integer
);
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`subject` text NOT NULL,
	`html_content` text NOT NULL,
	`plain_text_content` text,
	`preheader` text,
	`kind` text DEFAULT 'template',
	`layout_id` text,
	`variables` text,
	`use_layout` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`provider_id` text,
	`from_override` text,
	`reply_to` text,
	`cc` text,
	`bcc` text,
	`attachments` text,
	`owner_kind` text,
	`owner_name` text,
	`overridden` integer,
	`base_digest` text,
	`base_version` text,
	`carries_secret` integer,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `email_verification_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`identifier` text NOT NULL,
	`user_id` text,
	`token_hash` text NOT NULL,
	`expires` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_email_verification_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `media` (
	`id` text PRIMARY KEY,
	`filename` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`focal_x` integer,
	`focal_y` integer,
	`alt_text` text,
	`caption` text,
	`tags` text,
	`folder_id` text,
	`uploaded_by` text,
	`uploaded_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_media_folder_id_media_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_media_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `media_folders` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`parent_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_media_folders_parent_id_media_folders_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `media_folders`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_media_folders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_cache_tag_expiries` (
	`id` text PRIMARY KEY,
	`tag` text NOT NULL,
	`expired_at` integer NOT NULL
);
CREATE TABLE `nextly_content_event_parts` (
	`event_id` text NOT NULL,
	`part` text NOT NULL,
	CONSTRAINT `nextly_content_event_parts_pk` PRIMARY KEY(`event_id`, `part`)
);
CREATE TABLE `nextly_content_events` (
	`id` text PRIMARY KEY,
	`subject_kind` text NOT NULL,
	`subject_slug` text,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`ends_subject` integer DEFAULT false NOT NULL,
	`ended_by` text,
	`actor_kind` text NOT NULL,
	`actor_id` text,
	`actor_principal_kind` text,
	`actor_name` text,
	`occurred_at` integer NOT NULL,
	`from_state` text,
	`to_state` text,
	`note` text,
	`version_no` integer,
	`payload` text,
	`definition_hash` text
);
CREATE TABLE `nextly_dashboard_pins` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`pinned_at` integer NOT NULL,
	CONSTRAINT `fk_nextly_dashboard_pins_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_dashboard_preferences` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`preference_key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_nextly_dashboard_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_deleted_principals` (
	`digest` text PRIMARY KEY,
	`deleted_at` integer NOT NULL
);
CREATE TABLE `nextly_document_lock` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`claim_token` text NOT NULL,
	`owner_label` text,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`waiting_until` integer
);
CREATE TABLE `email_brand` (
	`id` text PRIMARY KEY,
	`logo_url` text,
	`logo_width` integer,
	`accent_color` text,
	`background_color` text,
	`content_color` text,
	`font_family` text,
	`footer_text` text,
	`footer_links` text,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_events` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_collection` text,
	`resource_id` text,
	`payload` text NOT NULL,
	`actor_type` text,
	`actor_id` text,
	`created_at` integer NOT NULL,
	`fanned_out_at` integer,
	`outcome` text DEFAULT 'success' NOT NULL,
	`retention_class` text DEFAULT 'webhook' NOT NULL
);
CREATE TABLE `nextly_i18n_archive` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`collection` text NOT NULL,
	`entity_kind` text DEFAULT 'unknown' NOT NULL,
	`entry_id` text NOT NULL,
	`locale` text NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`archived_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE TABLE `nextly_jobs` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`input` text,
	`state` text NOT NULL,
	`run_at` integer,
	`run_as_user_id` text,
	`dedupe_key` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`locked_by` text,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_languages` (
	`code` text PRIMARY KEY,
	`label` text NOT NULL,
	`direction` text DEFAULT 'ltr' NOT NULL,
	`fallback` text DEFAULT '[]' NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_limit_store` (
	`id` text PRIMARY KEY,
	`value` text,
	`expires_at` integer NOT NULL,
	`generation` text NOT NULL
);
CREATE TABLE `nextly_media_usage` (
	`id` text PRIMARY KEY,
	`media_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_slug` text NOT NULL,
	`document_id` text NOT NULL,
	`field_path` text NOT NULL,
	`locale` text NOT NULL,
	`address` text,
	CONSTRAINT `fk_nextly_media_usage_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_meta` (
	`key` text PRIMARY KEY,
	`value` text,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_notices` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`occurrence` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	CONSTRAINT `fk_nextly_notices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_one_time_secrets` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`purpose` text NOT NULL,
	`subject` text NOT NULL,
	`subject_key` text NOT NULL,
	`kind` text NOT NULL,
	`secret_hash` text NOT NULL,
	`live_key` text,
	`issue_seq` integer,
	`data` text,
	`expires_at` integer NOT NULL,
	`spent_at` integer,
	`voided_at` integer,
	`wrong_tries` integer DEFAULT 0 NOT NULL,
	`max_wrong_tries` integer,
	`created_at` integer NOT NULL
);
CREATE TABLE `nextly_plugin_event_deliveries` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`subscriber` text NOT NULL,
	`subscriber_key` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`locked_by` text,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
CREATE TABLE `nextly_plugin_events` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`fanned_out_at` integer,
	`finished_at` integer
);
CREATE TABLE `nextly_plugin_settings` (
	`owner` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	CONSTRAINT `nextly_plugin_settings_pk` PRIMARY KEY(`owner`, `key`)
);
CREATE TABLE `nextly_preview_links` (
	`id` text PRIMARY KEY,
	`document_kind` text NOT NULL,
	`document_slug` text NOT NULL,
	`entry_id` text,
	`locale` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`generation` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`last_opened_at` integer,
	CONSTRAINT `fk_nextly_preview_links_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_nextly_preview_links_revoked_by_users_id_fk` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
CREATE TABLE `nextly_rbac_epoch` (
	`id` text PRIMARY KEY,
	`revision` integer NOT NULL,
	`generation` text NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_received_webhooks` (
	`delivery_key` text PRIMARY KEY,
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`delivery_id` text,
	`freshness` text NOT NULL,
	`status` text NOT NULL,
	`claim_token` text NOT NULL,
	`lease_until` integer,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`prune_at` integer NOT NULL
);
CREATE TABLE `nextly_release_members` (
	`id` text PRIMARY KEY,
	`release_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`locale` text,
	`action` text NOT NULL,
	`member_key` text NOT NULL,
	`single_slot` integer,
	`applied_revision` integer,
	`created_by` text,
	`created_at` integer NOT NULL
);
CREATE TABLE `nextly_releases` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`description` text,
	`scheduled_at` integer,
	`timezone` text,
	`state` text NOT NULL,
	`kind` text DEFAULT 'release' NOT NULL,
	`published_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
CREATE TABLE `nextly_review_states` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`part` text,
	`part_key` text NOT NULL,
	`stage` text NOT NULL,
	`entered_at` integer NOT NULL,
	`entered_by` text,
	`assignee_kind` text,
	`assignee_id` text,
	`due_at` integer,
	`approved_version_no` integer,
	`approved_digest` text,
	`approved_by` text,
	`approved_at` integer,
	`definition_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_schedule_windows` (
	`schedule_key` text NOT NULL,
	`window_at` integer NOT NULL,
	`job_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `nextly_schedule_windows_pk` PRIMARY KEY(`schedule_key`, `window_at`)
);
CREATE TABLE `nextly_schema_events` (
	`id` text PRIMARY KEY,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`filename` text,
	`sha256` text,
	`scope_kind` text,
	`scope_slug` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer,
	`applied_by` text,
	`note` text,
	`statements_planned` integer,
	`statements_executed` integer,
	`renames_applied` integer,
	`error_code` text,
	`error_message` text,
	`error_json` text,
	`superseded_event_ids` text,
	`superseded_at` integer,
	`superseded_by` text
);
CREATE TABLE `nextly_schema_owners` (
	`table_name` text,
	`element_kind` text DEFAULT 'table' NOT NULL,
	`element_name` text DEFAULT '' NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`migrated_by` text NOT NULL,
	`owner_version` text,
	`schema_version` integer,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `nextly_schema_owners_pk` PRIMARY KEY(`table_name`, `element_kind`, `element_name`)
);
CREATE TABLE `nextly_spent_challenges` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
CREATE TABLE `nextly_version_pins` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`holder` text NOT NULL,
	`slot` text NOT NULL,
	`version_no` integer NOT NULL,
	`pin_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_version_views` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`part` text,
	`view_key` text NOT NULL,
	`version_no` integer NOT NULL,
	`previous_version_no` integer,
	`viewed_at` integer NOT NULL,
	`visit_started_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
CREATE TABLE `nextly_versions` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`version_no` integer,
	`status` text NOT NULL,
	`is_autosave` integer DEFAULT false NOT NULL,
	`snapshot` text NOT NULL,
	`label` text,
	`locale` text,
	`source_version_no` integer,
	`draft_key` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`base_version_no` integer,
	`base_draft_revision` integer
);
CREATE TABLE `nextly_webhook_deliveries` (
	`id` text PRIMARY KEY,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`locked_by` text,
	`locked_until` integer,
	`last_status_code` integer,
	`last_latency_ms` integer,
	`last_error` text,
	`last_response_snippet` text,
	`attempts` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_nextly_webhook_deliveries_webhook_id_nextly_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `nextly_webhooks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_nextly_webhook_deliveries_event_id_nextly_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `nextly_events`(`id`) ON DELETE CASCADE
);
CREATE TABLE `nextly_webhooks` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`event_types` text NOT NULL,
	`filter` text,
	`headers` text,
	`secret_hash` text NOT NULL,
	`secret_prefix` text NOT NULL,
	`field_allowlist` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_nextly_webhooks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
CREATE TABLE `nextly_widget_layout` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`layout` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `nextly_workflow_settings` (
	`id` text PRIMARY KEY,
	`workflow` text NOT NULL,
	`settings` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`identifier` text NOT NULL,
	`user_id` text,
	`token_hash` text NOT NULL,
	`expires` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY,
	`name` text(100) NOT NULL,
	`slug` text(100) NOT NULL,
	`action` text(50) NOT NULL,
	`resource` text(50) NOT NULL,
	`description` text(255),
	`owner` text(191),
	`orphaned_at` integer,
	`permission_group` text(191),
	`danger` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `role_inherits` (
	`id` text PRIMARY KEY,
	`parent_role_id` text NOT NULL,
	`child_role_id` text NOT NULL,
	CONSTRAINT `fk_role_inherits_parent_role_id_roles_id_fk` FOREIGN KEY (`parent_role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_role_inherits_child_role_id_roles_id_fk` FOREIGN KEY (`child_role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE
);
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY,
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_role_permissions_permission_id_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
);
CREATE TABLE `roles` (
	`id` text PRIMARY KEY,
	`name` text(50) NOT NULL,
	`slug` text(50) NOT NULL,
	`description` text(255),
	`level` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `site_settings` (
	`id` text PRIMARY KEY,
	`application_name` text,
	`site_url` text,
	`admin_email` text,
	`timezone` text,
	`date_format` text,
	`time_format` text,
	`logo_url` text,
	`logo_url_dark` text,
	`custom_sidebar_groups` text,
	`plugin_placements` text,
	`preview_token_generation` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `user_field_definitions` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`default_value` text,
	`options` text,
	`plugin_options` text,
	`has_many` integer,
	`min_length` integer,
	`max_length` integer,
	`min_value` real,
	`max_value` real,
	`placeholder` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'ui' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE `user_invite_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_user_invite_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE TABLE `user_roles` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	CONSTRAINT `fk_user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE
);
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`name` text,
	`email` text NOT NULL,
	`email_verified` integer,
	`email_verified_via` text,
	`password_updated_at` integer,
	`image` text,
	`interface_language` text,
	`password_hash` text,
	`is_active` integer DEFAULT false NOT NULL,
	`deactivated_at` integer,
	`must_change_password` integer,
	`session_epoch` integer,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE TABLE "page_builder__usage_progress" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "scope_key" text NOT NULL,
  "cursor" text,
  "done" integer NOT NULL DEFAULT false
);
CREATE TABLE "page_builder__usage_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "generation" text NOT NULL,
  "token" text NOT NULL,
  "dirty" integer NOT NULL DEFAULT false
);
CREATE TABLE "page_builder__layout_removals" (
  "id" text PRIMARY KEY NOT NULL,
  "layout_id" text NOT NULL,
  "action" text NOT NULL,
  "step" text NOT NULL,
  "token" text NOT NULL,
  "started_by" text,
  "pages_left" integer,
  "copy" text,
  "copy_version" text,
  "settled_at" integer,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "page_builder__component_deletion_hosts" (
  "id" text PRIMARY KEY NOT NULL,
  "deletion_id" text NOT NULL,
  "host_key" text NOT NULL,
  "state" text NOT NULL,
  "reason" text
);
CREATE TABLE "page_builder__component_deletions" (
  "id" text PRIMARY KEY NOT NULL,
  "component_id" text NOT NULL,
  "purpose" text NOT NULL,
  "started_by" text NOT NULL,
  "phase" text NOT NULL DEFAULT 'converting',
  "cursor" text
);
CREATE TABLE "page_builder__site_options" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "value" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "page_builder__breakpoint_removals" (
  "id" text PRIMARY KEY NOT NULL,
  "removed_ids" text NOT NULL,
  "before" text NOT NULL,
  "started_by" text NOT NULL,
  "phase" text NOT NULL DEFAULT 'converting',
  "cursor" text,
  "open_key" text
, "undoes" text);
CREATE TABLE "page_builder__breakpoint_removal_fragments" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "document_key" text NOT NULL,
  "host" text,
  "form" text NOT NULL,
  "fragment" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "page_builder__class_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "entity" text NOT NULL,
  "entity_key" text NOT NULL,
  "field" text NOT NULL,
  "locale" text NOT NULL,
  "variant" text NOT NULL,
  "class_id" text NOT NULL
);
CREATE TABLE "page_builder__component_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "entity" text NOT NULL,
  "entity_key" text NOT NULL,
  "field" text NOT NULL,
  "locale" text NOT NULL,
  "variant" text NOT NULL,
  "kind" text NOT NULL,
  "component_id" text NOT NULL
);
CREATE TABLE "page_builder__token_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "entity" text NOT NULL,
  "entity_key" text NOT NULL,
  "field" text NOT NULL,
  "locale" text NOT NULL,
  "variant" text NOT NULL,
  "token_id" text NOT NULL
);
CREATE TABLE "page_builder__binding_issues" (
  "id" text PRIMARY KEY NOT NULL,
  "document_key" text NOT NULL,
  "kind" text NOT NULL,
  "slug" text NOT NULL,
  "document_id" text,
  "place" text NOT NULL,
  "issues" text NOT NULL,
  "dirty" text,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "page_builder__binding_report_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "checked" text,
  "checking" text,
  "cursor" text,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "comp_seo" (
  "id" text PRIMARY KEY NOT NULL,
  "_parent_id" text NOT NULL,
  "_parent_table" text NOT NULL,
  "_parent_field" text NOT NULL,
  "_order" integer DEFAULT 0,
  "_component_type" text,
  "og_image" text,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "dc_authors" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "article_count" integer,
  "avatar" text
);
CREATE TABLE "dc_block_pages" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "content" text
);
CREATE TABLE "dc_categories" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "icon" text
);
CREATE TABLE "dc_components" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "category" text,
  "area" text,
  "content" text
);
CREATE TABLE "dc_form_submissions" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "form" text,
  "data" text NOT NULL,
  "status" text NOT NULL,
  "spam_reason" text,
  "notes" text,
  "ip_address" text,
  "user_agent" text,
  "submitted_at" integer NOT NULL,
  "edited_at" integer,
  "edited_by" text,
  "response_key" text
);
CREATE TABLE "dc_forms" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "fields" text NOT NULL,
  "settings" text,
  "notifications" text,
  "status" text NOT NULL,
  "went_live_at" integer,
  "closed_message" text
);
CREATE TABLE "dc_layouts" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "areas" text
);
CREATE TABLE "dc_nx_pb_address_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "claim_key" text NOT NULL,
  "kind" text NOT NULL,
  "locale" text,
  "path" text,
  "holder_collection" text,
  "holder_id" text,
  "space" text,
  "blocked_by" text
);
CREATE TABLE "dc_nx_pb_class_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "scope" text,
  "entity" text,
  "entity_key" text,
  "field" text,
  "locale" text,
  "variant" text,
  "class_id" text
);
CREATE TABLE "dc_nx_pb_component_retired" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "identity" text NOT NULL,
  "component_id" text NOT NULL,
  "kind" text NOT NULL,
  "exposure_id" text NOT NULL
);
CREATE TABLE "dc_nx_pb_component_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "scope" text,
  "entity" text,
  "entity_key" text,
  "field" text,
  "locale" text,
  "variant" text,
  "kind" text,
  "component_id" text
);
CREATE TABLE "dc_nx_pb_usage_backfill" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "scope_key" text,
  "generation" text
);
CREATE TABLE "dc_pages" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "content" text,
  "layout" text,
  "no_header_footer" integer
);
CREATE TABLE "dc_patterns" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "category" text,
  "keywords" text,
  "granularity" text NOT NULL,
  "content" text
);
CREATE TABLE "dc_posts" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "excerpt" text,
  "meta_title" text,
  "meta_description" text,
  "editor_mode" text,
  "content" text,
  "custom_script" text,
  "settings" text,
  "sections" text,
  "categories" text,
  "tags" text,
  "featured_image" text,
  "published_at" integer
);
CREATE TABLE "dc_tags" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "description" text
);
CREATE TABLE "dc_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "collection" text,
  "entry" text,
  "entry_collection" text,
  "entry_id" text,
  "forked_from" text,
  "address" text,
  "content" text
);
CREATE TABLE "single_announcement" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "campaign" text
);
CREATE TABLE "single_homepage" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "slug" text NOT NULL,
  "title" text,
  "layout" text
);
CREATE TABLE "single_landing_page" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "status" text NOT NULL DEFAULT 'draft',
  "first_published_at" integer,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "slug" text NOT NULL,
  "title" text,
  "hero" text
);
CREATE TABLE "single_page_builder_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "default_layout" text,
  "seeded_layout" text,
  "default_layout_changed_by" text
);
CREATE TABLE "single_page_builder_site_code" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "head_source" text,
  "body_source" text,
  "head" text,
  "body" text,
  "changed_by" text
);
CREATE TABLE "single_site_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "site_name" text NOT NULL
);
CREATE TABLE "single_site_style" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "tokens" text,
  "fonts" text,
  "classes" text,
  "breakpoints" text
);
CREATE TABLE "dc_authors_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "bio" TEXT,
  "job_title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_authors" ("id") ON DELETE CASCADE
);
CREATE TABLE "single_site_settings_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "tagline" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_site_settings" ("id") ON DELETE CASCADE
);
CREATE TABLE "single_announcement_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "headline" TEXT,
  "body" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_announcement" ("id") ON DELETE CASCADE
);
CREATE TABLE "comp_seo_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "meta_title" TEXT,
  "meta_description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "comp_seo" ("id") ON DELETE CASCADE
);
INSERT INTO "nextly_schema_lock" VALUES(1,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_field_group_lock" VALUES(1,NULL,NULL);
INSERT INTO "nextly_meta" VALUES('registry_record','{"point":null,"baseline":{"collections":{},"singles":{},"fieldGroups":{},"permissions":[]}}',1794581621);
INSERT INTO "nextly_meta" VALUES('schema_version','{"migration":"20261113_145338_941_create_localization_seo","seq":1}',1794581621);
INSERT INTO "nextly_meta" VALUES('preset_grants_release','{"release":"0.0.2-alpha.75"}',1794581621);
INSERT INTO "nextly_rbac_epoch" VALUES('global',6,'b40ec886-3843-4529-a1f5-d8848739315d',1794581621);
INSERT INTO "nextly_schema_events" VALUES('5fe1106c-3838-4496-97e5-59f1b9e840b8','core_apply','applied','cli-migrate',NULL,NULL,'core',NULL,1794581621537,1794581621538,NULL,NULL,NULL,NULL,231,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('f16614cd-c8af-4143-8af2-e27515a12051','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping','5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac',NULL,NULL,1794581621559,1794581621561,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('4b12afc7-1e76-4fbb-9f79-5a7289df0b3f','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals','b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231',NULL,NULL,1794581621566,1794581621566,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('fd2ee619-a864-498b-8190-2d88adcbaa92','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs','55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337',NULL,NULL,1794581621571,1794581621572,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('1ab51826-f526-47da-9191-23203862bec7','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options','b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897',NULL,NULL,1794581621576,1794581621577,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('7836face-abd0-4782-bb42-6d5af5b9dda9','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals','c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8',NULL,NULL,1794581621581,1794581621582,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('31e49943-3b63-405b-bd6e-c89963ec0447','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments','2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c',NULL,NULL,1794581621586,1794581621587,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('2cf5f19d-c8ee-4915-a08d-6673a07752cc','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables','261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b',NULL,NULL,1794581621592,1794581621593,NULL,NULL,NULL,NULL,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('50678109-e668-4fd6-96ac-89f1e909124d','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes','bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e',NULL,NULL,1794581621599,1794581621601,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('7304256b-d99c-4c26-83c3-1c89261195dd','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table','677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6',NULL,NULL,1794581621607,1794581621608,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('0f8c046b-38f4-4910-b1b1-de6fed84d8ab','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables','ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05',NULL,NULL,1794581621624,1794581621627,NULL,NULL,NULL,NULL,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('c3bbe7ca-4856-4ab2-b3c7-fd62c106629c','file_apply','applied','cli-migrate','20261113_145338_937_baseline.sql','0648fd8327417cb605bdec32e5951e0cf71d75290920d7cec5c2d57503a0ba5f',NULL,NULL,1794581621664,1794581621664,NULL,NULL,NULL,NULL,121,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('6b880d60-dc1c-4ebf-86b0-1be23dceeb79','file_apply','applied','cli-migrate','20261113_145338_938_create_localization_authors.sql','b5bd0b4b92154b8fbf185e1f5446bd098d61b98f599e7964dc737d1ca28eef61',NULL,NULL,1794581621670,1794581621671,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('0613b7f9-188b-48de-81a4-c5a798aebe71','file_apply','applied','cli-migrate','20261113_145338_939_create_localization_site-settings.sql','8fdab74254c66c36a16507b2384f54171d99748fc0eef6f12f1a486144d42bb1',NULL,NULL,1794581621672,1794581621672,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('5cae1e77-bd7b-4e8e-bf64-0bc8778b0943','file_apply','applied','cli-migrate','20261113_145338_940_create_localization_announcement.sql','ba712dec4d556de1424d5981445f1acab8eed275fa4d6638ed954783ed0bc142',NULL,NULL,1794581621674,1794581621674,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('44420a90-0084-4acf-b3f4-75a3f19a0789','file_apply','applied','cli-migrate','20261113_145338_941_create_localization_seo.sql','e5db150a6a4c8d93b9faa2adcef51b530628d9eb24f07c6c1e42873f0c61212d',NULL,NULL,1794581621675,1794581621675,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__usage_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__usage_progress','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__layout_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_deletions','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_deletion_hosts','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__site_options','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__breakpoint_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__breakpoint_removal_fragments','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__class_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__token_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__binding_issues','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__binding_report_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794581621,1794581621);
INSERT INTO "permissions" VALUES('16dc546e-0200-4d3d-a674-0ff5251b9285','Create Users','create-users','create','users','Permission to create users',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('a0146d92-a5ff-464a-a783-0a899a43c669','Read Users','read-users','read','users','Permission to read users',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('1c89f303-dbb7-4f3b-9f75-fd99a88289e6','Update Users','update-users','update','users','Permission to update users',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('ab7afb61-908d-44b9-842e-ef037d95d998','Delete Users','delete-users','delete','users','Permission to delete users',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('e21ee77d-cbb9-4277-a923-c962d0af3785','Create Roles','create-roles','create','roles','Permission to create roles',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('f2013a54-0bc4-4b9b-96b9-21c8e29ddf39','Read Roles','read-roles','read','roles','Permission to read roles',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('acd4ddfb-5323-4111-851d-00acbad0a228','Update Roles','update-roles','update','roles','Permission to update roles',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('115ec597-9b9a-4bbb-a5f2-f3c65fdc7275','Delete Roles','delete-roles','delete','roles','Permission to delete roles',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('efe538b6-8a4f-4fcd-befb-463a793fcf95','Create Media','create-media','create','media','Permission to upload media files',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('0b5fcff2-afda-42e0-8c8a-4d11673651fc','Read Media','read-media','read','media','Permission to view media files',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('b086b623-fd1a-4deb-9d55-e919ed1dd1b5','Update Media','update-media','update','media','Permission to edit media metadata and move files',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('111c84d7-baa8-460c-8a9a-b59fa5e17bac','Delete Media','delete-media','delete','media','Permission to delete media files',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('84ddfa1b-5168-4be8-bd6a-3bdc00d156a3','Read Settings','read-settings','read','settings','Permission to read system settings',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('69c5fcf7-f58c-4dd8-bdfc-017a8615fa55','Create Settings','create-settings','create','settings','Permission to add settings such as user fields and field groups',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('06b67821-feb1-426e-a94c-db2518c40121','Update Settings','update-settings','update','settings','Permission to change system settings',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('b3ea7391-5e8c-494c-bd4c-021ad0f81228','Delete Settings','delete-settings','delete','settings','Permission to remove settings such as user fields and field groups',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('71a728aa-dea4-4487-805c-e6eb49303b6b','Create Email Providers','create-email-providers','create','email-providers','Permission to create email providers',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('86fd0353-31b1-48ca-b67e-1e097725ece3','Read Email Providers','read-email-providers','read','email-providers','Permission to read email providers',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('136518d4-30c3-4375-a1da-7bf18564c5b8','Update Email Providers','update-email-providers','update','email-providers','Permission to change email providers',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('d4e20583-713d-45b8-9cb5-aa6e545a0ef3','Delete Email Providers','delete-email-providers','delete','email-providers','Permission to delete email providers',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('5d2d76b1-84e4-4b8b-9068-0cbb1ba3f6f3','Create Email Templates','create-email-templates','create','email-templates','Permission to create email templates',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('88ddad42-2f74-44b3-8e41-4f4f3eb3fead','Read Email Templates','read-email-templates','read','email-templates','Permission to read email templates',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('13fc4664-6ed7-4a2b-97b8-649541f223ec','Update Email Templates','update-email-templates','update','email-templates','Permission to change email templates',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('5e6cfb9f-dca4-4483-b67e-26ef5224cc82','Delete Email Templates','delete-email-templates','delete','email-templates','Permission to delete email templates',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('24b4f524-e19d-486d-ab0b-30a98185e361','Update API Keys','update-api-keys','update','api-keys','Permission to update API keys',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('59c99cef-a9e2-43af-b4ab-26bfde83bc96','Create API Keys','create-api-keys','create','api-keys','Permission to create API keys',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('a93057d7-b737-48e5-83e3-7e2152e315aa','Read API Keys','read-api-keys','read','api-keys','Permission to read API keys',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('681e17ff-330e-40bf-9359-c41db9eb92b8','Delete API Keys','delete-api-keys','delete','api-keys','Permission to delete API keys',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('f1e65dd6-41dc-4f3d-8b3c-3c935471a8b5','Update Webhooks','update-webhooks','update','webhooks','Permission to update webhook endpoints',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('b9797f83-c3a6-485e-9c2b-8f202ecd07bb','Create Webhooks','create-webhooks','create','webhooks','Permission to register webhook endpoints',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('4ab54cc4-20d0-4f67-8c0c-9f7277f2e3cc','Read Webhooks','read-webhooks','read','webhooks','Permission to view webhook endpoints',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('bdf692b0-5518-4ca7-bc9f-ef5ee826b265','Delete Webhooks','delete-webhooks','delete','webhooks','Permission to delete webhook endpoints',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('04abb9f2-3a5a-4e2f-907d-bde6b53b0690','Read Releases','read-content-releases','read','content-releases','Permission to view content releases and their members',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('51bcc96c-a8a8-43e2-88f1-44473c969a46','Create Releases','create-content-releases','create','content-releases','Permission to create a content release and choose its members',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('0bc0a918-d3a8-44b6-b80f-32f93a5c36c4','Publish Releases','publish-content-releases','publish','content-releases','Permission to schedule or cancel a content release, which is what makes its content go live',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('c32c29c4-72fe-4d7a-9036-a6380879db4a','Update Releases','update-content-releases','update','content-releases','Permission to rename a content release and change its description',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('b80a5781-7d96-46dc-88d0-57486b35576d','Delete Releases','delete-content-releases','delete','content-releases','Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('d0763d14-6e03-42fb-9d5f-8073bda46d09','Manage Background Jobs','manage-background-jobs','manage','background-jobs','Permission to run the background job queue by hand, outside its schedule',NULL,NULL,NULL,0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('66e0fa5c-5d1a-496c-8587-d72200079639','Manage page builder site settings','manage-page-builder-site','manage','page-builder-site','Change the site''s breakpoints, and choose its default Layout.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('06625b5c-3f78-494f-8e4c-7c87c2f65838','Lock shared styles','lock-page-builder-shared-styles','lock','page-builder-shared-styles','Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('b4aae12b-1dc8-47c1-9954-97c86e471252','Manage template routing','manage-template-routing','manage','template-routing','Set or change the address a collection''s entries are served at. A change moves every entry''s live address.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794581621,1794581621);
INSERT INTO "permissions" VALUES('6738efe5-b14a-40a9-83bc-82bce0966dc6','Export Submissions','export-submissions','export','submissions','Export form submissions as CSV/JSON','@nextlyhq/plugin-form-builder',NULL,'General',1,1794581621,1794581621);
INSERT INTO "role_permissions" VALUES('de3762f9-0b5d-43cb-bace-5e5786270f95','8f8773ab-3203-4529-8d6d-aff9c4628b94','24b4f524-e19d-486d-ab0b-30a98185e361',1794581621);
INSERT INTO "role_permissions" VALUES('a7853e8f-a486-4b0b-bc54-d1478d5b0f58','8f8773ab-3203-4529-8d6d-aff9c4628b94','59c99cef-a9e2-43af-b4ab-26bfde83bc96',1794581621);
INSERT INTO "role_permissions" VALUES('f0a262b4-8cad-4938-afe5-2109c687d223','8f8773ab-3203-4529-8d6d-aff9c4628b94','681e17ff-330e-40bf-9359-c41db9eb92b8',1794581621);
INSERT INTO "role_permissions" VALUES('46c26745-0737-428d-ba1f-06cca500eeea','8f8773ab-3203-4529-8d6d-aff9c4628b94','a93057d7-b737-48e5-83e3-7e2152e315aa',1794581621);
INSERT INTO "role_permissions" VALUES('6ff22b0f-e515-4393-a602-37af37e73c03','8f8773ab-3203-4529-8d6d-aff9c4628b94','d0763d14-6e03-42fb-9d5f-8073bda46d09',1794581621);
INSERT INTO "role_permissions" VALUES('867f8c20-1ec5-4a7c-89f0-d6732e59b719','8f8773ab-3203-4529-8d6d-aff9c4628b94','04abb9f2-3a5a-4e2f-907d-bde6b53b0690',1794581621);
INSERT INTO "role_permissions" VALUES('63ff12b0-bea1-40d6-a900-50c0555d5873','8f8773ab-3203-4529-8d6d-aff9c4628b94','0bc0a918-d3a8-44b6-b80f-32f93a5c36c4',1794581621);
INSERT INTO "role_permissions" VALUES('5d750530-c326-4041-9de4-dce22567ea46','8f8773ab-3203-4529-8d6d-aff9c4628b94','51bcc96c-a8a8-43e2-88f1-44473c969a46',1794581621);
INSERT INTO "role_permissions" VALUES('52db20a5-ad86-47d1-be81-c9a8b430aff7','8f8773ab-3203-4529-8d6d-aff9c4628b94','b80a5781-7d96-46dc-88d0-57486b35576d',1794581621);
INSERT INTO "role_permissions" VALUES('6c02b65e-1c57-4104-812e-46193bae98a0','8f8773ab-3203-4529-8d6d-aff9c4628b94','c32c29c4-72fe-4d7a-9036-a6380879db4a',1794581621);
INSERT INTO "role_permissions" VALUES('701db37f-4b75-463a-be8a-000cf7e46da0','8f8773ab-3203-4529-8d6d-aff9c4628b94','136518d4-30c3-4375-a1da-7bf18564c5b8',1794581621);
INSERT INTO "role_permissions" VALUES('ad2f546e-e4ed-46a1-8282-6afb0ab33d8f','8f8773ab-3203-4529-8d6d-aff9c4628b94','71a728aa-dea4-4487-805c-e6eb49303b6b',1794581621);
INSERT INTO "role_permissions" VALUES('4e5ece76-451f-4427-9aef-96259dbb00c2','8f8773ab-3203-4529-8d6d-aff9c4628b94','86fd0353-31b1-48ca-b67e-1e097725ece3',1794581621);
INSERT INTO "role_permissions" VALUES('56e8daf8-4e76-410a-9c1d-467bbf71c09d','8f8773ab-3203-4529-8d6d-aff9c4628b94','d4e20583-713d-45b8-9cb5-aa6e545a0ef3',1794581621);
INSERT INTO "role_permissions" VALUES('3a993059-efe9-41cf-9fab-9860dd79a36d','8f8773ab-3203-4529-8d6d-aff9c4628b94','13fc4664-6ed7-4a2b-97b8-649541f223ec',1794581621);
INSERT INTO "role_permissions" VALUES('487376ed-3b96-409f-aea7-8d1640ff325a','8f8773ab-3203-4529-8d6d-aff9c4628b94','5d2d76b1-84e4-4b8b-9068-0cbb1ba3f6f3',1794581621);
INSERT INTO "role_permissions" VALUES('349ddac5-ad2e-4a85-9196-cfb741759a46','8f8773ab-3203-4529-8d6d-aff9c4628b94','5e6cfb9f-dca4-4483-b67e-26ef5224cc82',1794581621);
INSERT INTO "role_permissions" VALUES('22b889a9-e364-4b63-8b48-9997f3e14bab','8f8773ab-3203-4529-8d6d-aff9c4628b94','88ddad42-2f74-44b3-8e41-4f4f3eb3fead',1794581621);
INSERT INTO "role_permissions" VALUES('85cd9830-5330-4a64-aa49-6edea365e7a4','8f8773ab-3203-4529-8d6d-aff9c4628b94','0b5fcff2-afda-42e0-8c8a-4d11673651fc',1794581621);
INSERT INTO "role_permissions" VALUES('bf3ae94c-0c4b-4d94-8a95-ae685fa1e094','8f8773ab-3203-4529-8d6d-aff9c4628b94','111c84d7-baa8-460c-8a9a-b59fa5e17bac',1794581621);
INSERT INTO "role_permissions" VALUES('8e43aea5-0f66-4def-84b0-249a42041d5b','8f8773ab-3203-4529-8d6d-aff9c4628b94','b086b623-fd1a-4deb-9d55-e919ed1dd1b5',1794581621);
INSERT INTO "role_permissions" VALUES('7e2b60a4-dc2a-4e8d-8073-12468a4e43f9','8f8773ab-3203-4529-8d6d-aff9c4628b94','efe538b6-8a4f-4fcd-befb-463a793fcf95',1794581621);
INSERT INTO "role_permissions" VALUES('7cb68a61-c90a-4057-9f32-ef3a48b88211','8f8773ab-3203-4529-8d6d-aff9c4628b94','06625b5c-3f78-494f-8e4c-7c87c2f65838',1794581621);
INSERT INTO "role_permissions" VALUES('f227be98-8f34-4108-982f-4d1e9fc46a5b','8f8773ab-3203-4529-8d6d-aff9c4628b94','66e0fa5c-5d1a-496c-8587-d72200079639',1794581621);
INSERT INTO "role_permissions" VALUES('835ecdd4-0a04-426b-bd67-dc9b2c13ce3e','8f8773ab-3203-4529-8d6d-aff9c4628b94','f2013a54-0bc4-4b9b-96b9-21c8e29ddf39',1794581621);
INSERT INTO "role_permissions" VALUES('1b046ff1-cb85-45b6-98bf-5fef35acb660','8f8773ab-3203-4529-8d6d-aff9c4628b94','06b67821-feb1-426e-a94c-db2518c40121',1794581621);
INSERT INTO "role_permissions" VALUES('d00ce951-09f2-403e-a948-9d0d3b8094fa','8f8773ab-3203-4529-8d6d-aff9c4628b94','69c5fcf7-f58c-4dd8-bdfc-017a8615fa55',1794581621);
INSERT INTO "role_permissions" VALUES('34b47c2a-f675-4d74-926b-8aa725b309ea','8f8773ab-3203-4529-8d6d-aff9c4628b94','84ddfa1b-5168-4be8-bd6a-3bdc00d156a3',1794581621);
INSERT INTO "role_permissions" VALUES('17cb4c57-8aa3-4696-941c-baf8a4350f6d','8f8773ab-3203-4529-8d6d-aff9c4628b94','b3ea7391-5e8c-494c-bd4c-021ad0f81228',1794581621);
INSERT INTO "role_permissions" VALUES('63262675-2027-490d-9a2c-59c2ea01e14b','8f8773ab-3203-4529-8d6d-aff9c4628b94','6738efe5-b14a-40a9-83bc-82bce0966dc6',1794581621);
INSERT INTO "role_permissions" VALUES('562d37e4-61de-41bc-ac9f-e07de30954df','8f8773ab-3203-4529-8d6d-aff9c4628b94','b4aae12b-1dc8-47c1-9954-97c86e471252',1794581621);
INSERT INTO "role_permissions" VALUES('afed0b7b-21ac-4325-a9fb-08b670f6ff7f','8f8773ab-3203-4529-8d6d-aff9c4628b94','a0146d92-a5ff-464a-a783-0a899a43c669',1794581621);
INSERT INTO "role_permissions" VALUES('e0c8c840-6ab7-4282-8ba2-fa75fc5e1e12','8f8773ab-3203-4529-8d6d-aff9c4628b94','4ab54cc4-20d0-4f67-8c0c-9f7277f2e3cc',1794581621);
INSERT INTO "role_permissions" VALUES('43dff476-7dd8-498f-916d-954cf3b16236','8f8773ab-3203-4529-8d6d-aff9c4628b94','b9797f83-c3a6-485e-9c2b-8f202ecd07bb',1794581621);
INSERT INTO "role_permissions" VALUES('0ce2728b-48d3-419d-8fb9-66adcd654121','8f8773ab-3203-4529-8d6d-aff9c4628b94','bdf692b0-5518-4ca7-bc9f-ef5ee826b265',1794581621);
INSERT INTO "role_permissions" VALUES('a85121af-dbee-4949-ba95-3e7e59b45f9c','8f8773ab-3203-4529-8d6d-aff9c4628b94','f1e65dd6-41dc-4f3d-8b3c-3c935471a8b5',1794581621);
INSERT INTO "role_permissions" VALUES('b47946d4-ab76-402d-8b2f-d7553f99a515','c2f7a2fd-7f08-48cf-96e0-764957cf19d2','0b5fcff2-afda-42e0-8c8a-4d11673651fc',1794581621);
INSERT INTO "role_permissions" VALUES('a999ef93-cd2f-482b-8818-4c1038e39db0','c2f7a2fd-7f08-48cf-96e0-764957cf19d2','111c84d7-baa8-460c-8a9a-b59fa5e17bac',1794581621);
INSERT INTO "role_permissions" VALUES('bcac3361-aa32-43e3-a2a9-5a7fd6bf3b2f','c2f7a2fd-7f08-48cf-96e0-764957cf19d2','b086b623-fd1a-4deb-9d55-e919ed1dd1b5',1794581621);
INSERT INTO "role_permissions" VALUES('91ac3022-f2b3-4b04-ba6d-2dcb7daaddc8','c2f7a2fd-7f08-48cf-96e0-764957cf19d2','efe538b6-8a4f-4fcd-befb-463a793fcf95',1794581621);
INSERT INTO "role_permissions" VALUES('ae6ff67b-343c-4758-8481-6481fc63a417','c192521d-ab46-440c-8e58-5fe355354524','0b5fcff2-afda-42e0-8c8a-4d11673651fc',1794581621);
INSERT INTO "role_permissions" VALUES('27b323a7-34a2-46c8-b2c1-2336d032d997','c192521d-ab46-440c-8e58-5fe355354524','b086b623-fd1a-4deb-9d55-e919ed1dd1b5',1794581621);
INSERT INTO "role_permissions" VALUES('ed7667fa-9db6-46ec-8832-461fa3ccb2e8','c192521d-ab46-440c-8e58-5fe355354524','efe538b6-8a4f-4fcd-befb-463a793fcf95',1794581621);
INSERT INTO "role_permissions" VALUES('3f16e445-845b-4a7c-b796-b99171935d8a','e0e3b533-fe87-451b-9fe0-2477080cd09c','a93057d7-b737-48e5-83e3-7e2152e315aa',1794581621);
INSERT INTO "role_permissions" VALUES('99523d8b-d70c-4dae-b717-b412d45c7277','e0e3b533-fe87-451b-9fe0-2477080cd09c','04abb9f2-3a5a-4e2f-907d-bde6b53b0690',1794581621);
INSERT INTO "role_permissions" VALUES('6f022054-b87c-473e-82df-cce5caaa65b8','e0e3b533-fe87-451b-9fe0-2477080cd09c','86fd0353-31b1-48ca-b67e-1e097725ece3',1794581621);
INSERT INTO "role_permissions" VALUES('1f6e30bf-a768-4afd-8afb-833ca5c90a44','e0e3b533-fe87-451b-9fe0-2477080cd09c','88ddad42-2f74-44b3-8e41-4f4f3eb3fead',1794581621);
INSERT INTO "role_permissions" VALUES('1520e3cd-4b29-428b-bb6c-16e826092440','e0e3b533-fe87-451b-9fe0-2477080cd09c','0b5fcff2-afda-42e0-8c8a-4d11673651fc',1794581621);
INSERT INTO "role_permissions" VALUES('a2a8e169-57b2-4089-999b-a616ebd460a5','e0e3b533-fe87-451b-9fe0-2477080cd09c','f2013a54-0bc4-4b9b-96b9-21c8e29ddf39',1794581621);
INSERT INTO "role_permissions" VALUES('82360276-f591-4959-82f1-c76f9746e455','e0e3b533-fe87-451b-9fe0-2477080cd09c','84ddfa1b-5168-4be8-bd6a-3bdc00d156a3',1794581621);
INSERT INTO "role_permissions" VALUES('b108070b-9272-4e6f-b9a1-4a5ed5f913a1','e0e3b533-fe87-451b-9fe0-2477080cd09c','a0146d92-a5ff-464a-a783-0a899a43c669',1794581621);
INSERT INTO "role_permissions" VALUES('f3a56649-18e4-429c-8500-a8ec5253e657','e0e3b533-fe87-451b-9fe0-2477080cd09c','4ab54cc4-20d0-4f67-8c0c-9f7277f2e3cc',1794581621);
INSERT INTO "roles" VALUES('8f8773ab-3203-4529-8d6d-aff9c4628b94','Admin','admin','Everything except granting access to others',90,1,1794581621,1794581621);
INSERT INTO "roles" VALUES('c2f7a2fd-7f08-48cf-96e0-764957cf19d2','Editor','editor','Full control of content and media, including publishing',50,1,1794581621,1794581621);
INSERT INTO "roles" VALUES('c192521d-ab46-440c-8e58-5fe355354524','Author','author','Write content, but not publish or delete it',30,1,1794581621,1794581621);
INSERT INTO "roles" VALUES('e0e3b533-fe87-451b-9fe0-2477080cd09c','Viewer','viewer','Read everything, change nothing',10,1,1794581621,1794581621);
CREATE INDEX `idx_activity_log_created_at` ON `activity_log` (`created_at`);
CREATE INDEX `idx_activity_log_collection` ON `activity_log` (`collection`,`created_at`);
CREATE INDEX `idx_activity_log_user_id` ON `activity_log` (`user_id`,`created_at`);
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);
CREATE INDEX `api_keys_role_id_idx` ON `api_keys` (`role_id`);
CREATE INDEX `api_keys_is_active_expires_at_idx` ON `api_keys` (`is_active`,`expires_at`);
CREATE INDEX `audit_log_kind_idx` ON `audit_log` (`kind`);
CREATE INDEX `audit_log_actor_user_id_idx` ON `audit_log` (`actor_user_id`);
CREATE INDEX `audit_log_target_user_id_idx` ON `audit_log` (`target_user_id`);
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);
CREATE INDEX `audit_log_actor_principal_idx` ON `audit_log` (`actor_principal_kind`,`actor_principal_id`);
CREATE INDEX `audit_log_target_principal_idx` ON `audit_log` (`target_principal_kind`,`target_principal_id`);
CREATE INDEX `dynamic_collections_source_idx` ON `dynamic_collections` (`source`);
CREATE INDEX `dynamic_collections_migration_status_idx` ON `dynamic_collections` (`migration_status`);
CREATE INDEX `dynamic_collections_created_by_idx` ON `dynamic_collections` (`created_by`);
CREATE INDEX `dynamic_collections_created_at_idx` ON `dynamic_collections` (`created_at`);
CREATE INDEX `dynamic_collections_updated_at_idx` ON `dynamic_collections` (`updated_at`);
CREATE INDEX `dynamic_components_source_idx` ON `dynamic_components` (`source`);
CREATE INDEX `dynamic_components_migration_status_idx` ON `dynamic_components` (`migration_status`);
CREATE INDEX `dynamic_components_created_by_idx` ON `dynamic_components` (`created_by`);
CREATE INDEX `dynamic_components_created_at_idx` ON `dynamic_components` (`created_at`);
CREATE INDEX `dynamic_components_updated_at_idx` ON `dynamic_components` (`updated_at`);
CREATE INDEX `dynamic_singles_source_idx` ON `dynamic_singles` (`source`);
CREATE INDEX `dynamic_singles_migration_status_idx` ON `dynamic_singles` (`migration_status`);
CREATE INDEX `dynamic_singles_created_by_idx` ON `dynamic_singles` (`created_by`);
CREATE INDEX `dynamic_singles_created_at_idx` ON `dynamic_singles` (`created_at`);
CREATE INDEX `dynamic_singles_updated_at_idx` ON `dynamic_singles` (`updated_at`);
CREATE INDEX `email_deliveries_created_idx` ON `email_deliveries` (`created_at`);
CREATE INDEX `email_deliveries_recipient_idx` ON `email_deliveries` (`recipient_hash`,`created_at`);
CREATE INDEX `email_deliveries_status_created_idx` ON `email_deliveries` (`status`,`created_at`);
CREATE INDEX `email_deliveries_provider_idx` ON `email_deliveries` (`provider_id`,`created_at`);
CREATE INDEX `email_deliveries_retention_idx` ON `email_deliveries` (`retention_class`,`created_at`);
CREATE INDEX `email_deliveries_principal_idx` ON `email_deliveries` (`principal_kind`,`principal_id`);
CREATE INDEX `email_deliveries_key_idx` ON `email_deliveries` (`key_digest`);
CREATE INDEX `email_providers_type_idx` ON `email_providers` (`type`);
CREATE INDEX `email_providers_is_default_idx` ON `email_providers` (`is_default`);
CREATE INDEX `email_providers_is_active_idx` ON `email_providers` (`is_active`);
CREATE INDEX `email_providers_created_at_idx` ON `email_providers` (`created_at`);
CREATE INDEX `email_queue_state_idx` ON `email_queue` (`state`,`settled_at`);
CREATE INDEX `email_queue_principal_idx` ON `email_queue` (`principal_kind`,`principal_id`);
CREATE INDEX `email_queue_recipients_hash_idx` ON `email_queue_recipients` (`recipient_hash`);
CREATE UNIQUE INDEX `email_send_claims_key_idx` ON `email_send_claims` (`key_digest`);
CREATE INDEX `email_send_claims_state_idx` ON `email_send_claims` (`state`,`settled_at`);
CREATE INDEX `email_send_claims_lease_idx` ON `email_send_claims` (`lease_expires_at`);
CREATE INDEX `email_templates_is_active_idx` ON `email_templates` (`is_active`);
CREATE INDEX `email_templates_provider_id_idx` ON `email_templates` (`provider_id`);
CREATE INDEX `email_templates_kind_idx` ON `email_templates` (`kind`);
CREATE INDEX `email_templates_layout_id_idx` ON `email_templates` (`layout_id`);
CREATE INDEX `email_templates_created_at_idx` ON `email_templates` (`created_at`);
CREATE UNIQUE INDEX `evt_identifier_token_hash_unique` ON `email_verification_tokens` (`identifier`,`token_hash`);
CREATE INDEX `evt_user_id_idx` ON `email_verification_tokens` (`user_id`);
CREATE INDEX `evt_expires_idx` ON `email_verification_tokens` (`expires`);
CREATE INDEX `evt_token_hash_idx` ON `email_verification_tokens` (`token_hash`);
CREATE INDEX `media_uploaded_by_idx` ON `media` (`uploaded_by`);
CREATE INDEX `media_mime_type_idx` ON `media` (`mime_type`);
CREATE INDEX `media_uploaded_at_idx` ON `media` (`uploaded_at`);
CREATE INDEX `media_folder_id_idx` ON `media` (`folder_id`);
CREATE INDEX `media_folders_parent_id_idx` ON `media_folders` (`parent_id`);
CREATE INDEX `media_folders_created_by_idx` ON `media_folders` (`created_by`);
CREATE INDEX `media_folders_created_at_idx` ON `media_folders` (`created_at`);
CREATE INDEX `ncte_expired_at_idx` ON `nextly_cache_tag_expiries` (`expired_at`);
CREATE INDEX `nextly_content_events_subject_idx` ON `nextly_content_events` (`subject_kind`,`subject_slug`,`subject_id`,`id`);
CREATE INDEX `nextly_content_events_ends_idx` ON `nextly_content_events` (`ends_subject`,`occurred_at`);
CREATE INDEX `nextly_content_events_ended_by_idx` ON `nextly_content_events` (`ended_by`);
CREATE UNIQUE INDEX `nextly_dashboard_pins_target_uidx` ON `nextly_dashboard_pins` (`user_id`,`target_type`,`target_slug`,`entry_id`);
CREATE INDEX `nextly_dashboard_pins_user_idx` ON `nextly_dashboard_pins` (`user_id`,`pinned_at`);
CREATE INDEX `nextly_dashboard_pins_entry_idx` ON `nextly_dashboard_pins` (`target_type`,`target_slug`,`entry_id`);
CREATE UNIQUE INDEX `nextly_dashboard_preferences_key_uidx` ON `nextly_dashboard_preferences` (`user_id`,`preference_key`);
CREATE INDEX `ndl_expires_at_idx` ON `nextly_document_lock` (`expires_at`);
CREATE INDEX `ndl_scope_idx` ON `nextly_document_lock` (`scope_kind`,`slug`);
CREATE INDEX `nextly_events_type_created_at_idx` ON `nextly_events` (`type`,`created_at`);
CREATE INDEX `nextly_events_fanned_out_at_idx` ON `nextly_events` (`fanned_out_at`,`created_at`);
CREATE INDEX `nextly_events_retention_idx` ON `nextly_events` (`retention_class`,`created_at`);
CREATE INDEX `nextly_i18n_archive_lookup_idx` ON `nextly_i18n_archive` (`collection`,`entry_id`,`locale`);
CREATE INDEX `nextly_jobs_due_idx` ON `nextly_jobs` (`state`,`run_at`);
CREATE INDEX `nextly_jobs_recent_idx` ON `nextly_jobs` (`updated_at`);
CREATE UNIQUE INDEX `nextly_jobs_dedupe_idx` ON `nextly_jobs` (`dedupe_key`);
CREATE INDEX `nls_expires_at_idx` ON `nextly_limit_store` (`expires_at`);
CREATE INDEX `nls_generation_idx` ON `nextly_limit_store` (`generation`);
CREATE UNIQUE INDEX `nextly_media_usage_uidx` ON `nextly_media_usage` (`subject_kind`,`subject_slug`,`document_id`,`field_path`,`locale`,`media_id`);
CREATE INDEX `nextly_media_usage_media_idx` ON `nextly_media_usage` (`media_id`);
CREATE INDEX `nextly_meta_updated_at_idx` ON `nextly_meta` (`updated_at`);
CREATE UNIQUE INDEX `nextly_notices_dedupe_uidx` ON `nextly_notices` (`dedupe_key`);
CREATE INDEX `nextly_notices_user_idx` ON `nextly_notices` (`user_id`,`read_at`,`created_at`,`id`);
CREATE INDEX `nextly_notices_inbox_idx` ON `nextly_notices` (`user_id`,`created_at`,`id`);
CREATE INDEX `nextly_notices_subject_idx` ON `nextly_notices` (`subject_type`,`subject_id`);
CREATE INDEX `nextly_notices_created_idx` ON `nextly_notices` (`created_at`);
CREATE UNIQUE INDEX `nextly_one_time_secrets_live_key_unique` ON `nextly_one_time_secrets` (`live_key`);
CREATE UNIQUE INDEX `nextly_one_time_secrets_issue_unique` ON `nextly_one_time_secrets` (`subject_key`,`purpose`,`kind`,`issue_seq`);
CREATE INDEX `nextly_one_time_secrets_hash_idx` ON `nextly_one_time_secrets` (`secret_hash`);
CREATE INDEX `nextly_one_time_secrets_subject_key_idx` ON `nextly_one_time_secrets` (`subject_key`);
CREATE INDEX `nextly_one_time_secrets_expires_idx` ON `nextly_one_time_secrets` (`expires_at`);
CREATE UNIQUE INDEX `nextly_plugin_event_deliveries_event_subscriber_unique` ON `nextly_plugin_event_deliveries` (`event_id`,`subscriber_key`);
CREATE INDEX `nextly_plugin_event_deliveries_due_idx` ON `nextly_plugin_event_deliveries` (`status`,`next_attempt_at`);
CREATE INDEX `nextly_plugin_events_fan_out_idx` ON `nextly_plugin_events` (`fanned_out_at`,`created_at`);
CREATE INDEX `nextly_plugin_events_finished_idx` ON `nextly_plugin_events` (`finished_at`);
CREATE INDEX `nextly_preview_links_document_idx` ON `nextly_preview_links` (`document_kind`,`document_slug`,`entry_id`);
CREATE INDEX `nextly_preview_links_expires_idx` ON `nextly_preview_links` (`expires_at`);
CREATE INDEX `nextly_preview_links_created_by_idx` ON `nextly_preview_links` (`created_by`);
CREATE INDEX `nextly_preview_links_revoked_by_idx` ON `nextly_preview_links` (`revoked_by`);
CREATE INDEX `nextly_preview_links_revoked_idx` ON `nextly_preview_links` (`revoked_at`);
CREATE INDEX `nextly_received_webhooks_prune_idx` ON `nextly_received_webhooks` (`prune_at`);
CREATE UNIQUE INDEX `nextly_release_members_key_uidx` ON `nextly_release_members` (`member_key`);
CREATE UNIQUE INDEX `nextly_release_members_single_uidx` ON `nextly_release_members` (`release_id`,`single_slot`);
CREATE INDEX `nextly_release_members_doc_idx` ON `nextly_release_members` (`scope_kind`,`scope_slug`,`entry_id`,`locale`);
CREATE INDEX `nextly_release_members_release_idx` ON `nextly_release_members` (`release_id`);
CREATE INDEX `nextly_releases_due_idx` ON `nextly_releases` (`state`,`scheduled_at`);
CREATE INDEX `nextly_releases_scheduled_idx` ON `nextly_releases` (`scheduled_at`);
CREATE INDEX `nextly_releases_published_idx` ON `nextly_releases` (`published_at`);
CREATE UNIQUE INDEX `nextly_review_states_key_uidx` ON `nextly_review_states` (`part_key`);
CREATE INDEX `nextly_review_states_doc_idx` ON `nextly_review_states` (`scope_kind`,`scope_slug`,`entry_id`);
CREATE INDEX `nextly_review_states_stage_idx` ON `nextly_review_states` (`scope_kind`,`scope_slug`,`stage`);
CREATE INDEX `nextly_review_states_assignee_idx` ON `nextly_review_states` (`assignee_kind`,`assignee_id`);
CREATE INDEX `nextly_schedule_windows_window_idx` ON `nextly_schedule_windows` (`window_at`);
CREATE INDEX `nextly_schema_events_started_at_idx` ON `nextly_schema_events` (`started_at`);
CREATE INDEX `nextly_schema_events_scope_idx` ON `nextly_schema_events` (`scope_kind`,`scope_slug`);
CREATE INDEX `nsc_expires_at_idx` ON `nextly_spent_challenges` (`expires_at`);
CREATE UNIQUE INDEX `nextly_version_pins_key_uidx` ON `nextly_version_pins` (`pin_key`);
CREATE INDEX `nextly_version_pins_doc_idx` ON `nextly_version_pins` (`scope_kind`,`scope_slug`,`entry_id`);
CREATE UNIQUE INDEX `nextly_version_views_key_uidx` ON `nextly_version_views` (`view_key`);
CREATE INDEX `nextly_version_views_doc_idx` ON `nextly_version_views` (`scope_kind`,`scope_slug`,`entry_id`);
CREATE INDEX `nextly_version_views_user_idx` ON `nextly_version_views` (`user_id`);
CREATE UNIQUE INDEX `nextly_versions_seq_uidx` ON `nextly_versions` (`scope_kind`,`scope_slug`,`entry_id`,`version_no`);
CREATE UNIQUE INDEX `nextly_versions_working_draft_uidx` ON `nextly_versions` (`draft_key`);
CREATE INDEX `nextly_versions_doc_recent_idx` ON `nextly_versions` (`scope_kind`,`scope_slug`,`entry_id`,`created_at`);
CREATE INDEX `nextly_versions_pending_edits_idx` ON `nextly_versions` (`is_autosave`,`status`,`version_no`,`scope_slug`,`updated_at`,`id`);
CREATE INDEX `nextly_webhook_deliveries_status_next_idx` ON `nextly_webhook_deliveries` (`status`,`next_attempt_at`);
CREATE UNIQUE INDEX `nextly_webhook_deliveries_webhook_event_unique` ON `nextly_webhook_deliveries` (`webhook_id`,`event_id`);
CREATE INDEX `nextly_webhook_deliveries_event_idx` ON `nextly_webhook_deliveries` (`event_id`);
CREATE INDEX `nextly_webhook_deliveries_retention_idx` ON `nextly_webhook_deliveries` (`status`,`updated_at`);
CREATE INDEX `nextly_webhook_deliveries_webhook_created_idx` ON `nextly_webhook_deliveries` (`webhook_id`,`created_at`,`id`);
CREATE INDEX `nextly_webhooks_enabled_idx` ON `nextly_webhooks` (`enabled`);
CREATE UNIQUE INDEX `nextly_workflow_settings_workflow_uidx` ON `nextly_workflow_settings` (`workflow`);
CREATE UNIQUE INDEX `prt_identifier_token_hash_unique` ON `password_reset_tokens` (`identifier`,`token_hash`);
CREATE INDEX `prt_user_id_idx` ON `password_reset_tokens` (`user_id`);
CREATE INDEX `prt_expires_idx` ON `password_reset_tokens` (`expires`);
CREATE INDEX `prt_token_hash_idx` ON `password_reset_tokens` (`token_hash`);
CREATE INDEX `prt_used_at_idx` ON `password_reset_tokens` (`used_at`);
CREATE UNIQUE INDEX `permissions_action_resource_unique` ON `permissions` (`action`,`resource`);
CREATE UNIQUE INDEX `permissions_slug_unique` ON `permissions` (`slug`);
CREATE INDEX `permissions_resource_idx` ON `permissions` (`resource`);
CREATE INDEX `permissions_action_idx` ON `permissions` (`action`);
CREATE INDEX `refresh_tokens_token_hash_idx` ON `refresh_tokens` (`token_hash`);
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);
CREATE INDEX `refresh_tokens_expires_at_idx` ON `refresh_tokens` (`expires_at`);
CREATE UNIQUE INDEX `role_inherits_parent_child_unique` ON `role_inherits` (`parent_role_id`,`child_role_id`);
CREATE INDEX `role_inherits_child_idx` ON `role_inherits` (`child_role_id`);
CREATE INDEX `role_inherits_parent_idx` ON `role_inherits` (`parent_role_id`);
CREATE UNIQUE INDEX `role_permissions_role_permission_unique` ON `role_permissions` (`role_id`,`permission_id`);
CREATE INDEX `role_permissions_role_id_idx` ON `role_permissions` (`role_id`);
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);
CREATE UNIQUE INDEX `roles_slug_unique` ON `roles` (`slug`);
CREATE INDEX `roles_level_idx` ON `roles` (`level`);
CREATE INDEX `roles_is_system_idx` ON `roles` (`is_system`);
CREATE UNIQUE INDEX `user_field_defs_name_unique_idx` ON `user_field_definitions` (`name`);
CREATE INDEX `user_field_defs_source_idx` ON `user_field_definitions` (`source`);
CREATE INDEX `user_field_defs_is_active_idx` ON `user_field_definitions` (`is_active`);
CREATE INDEX `user_field_defs_sort_order_idx` ON `user_field_definitions` (`sort_order`);
CREATE INDEX `user_field_defs_created_at_idx` ON `user_field_definitions` (`created_at`);
CREATE UNIQUE INDEX `uit_user_id_unique` ON `user_invite_tokens` (`user_id`);
CREATE INDEX `uit_token_hash_idx` ON `user_invite_tokens` (`token_hash`);
CREATE INDEX `uit_expires_idx` ON `user_invite_tokens` (`expires`);
CREATE UNIQUE INDEX `user_roles_user_role_unique` ON `user_roles` (`user_id`,`role_id`);
CREATE INDEX `user_roles_user_id_idx` ON `user_roles` (`user_id`);
CREATE INDEX `user_roles_expires_at_idx` ON `user_roles` (`expires_at`);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
CREATE INDEX `users_created_at_idx` ON `users` (`created_at`);
CREATE UNIQUE INDEX "uq_page_builder__usage_progress_token_scope_key_0ujeq6m" ON "page_builder__usage_progress" ("token", "scope_key");
CREATE UNIQUE INDEX "uq_page_builder__usage_runs_name" ON "page_builder__usage_runs" ("name");
CREATE UNIQUE INDEX "uq_page_builder__layout_removals_layout_id" ON "page_builder__layout_removals" ("layout_id");
CREATE UNIQUE INDEX "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01" ON "page_builder__component_deletion_hosts" ("deletion_id", "host_key");
CREATE UNIQUE INDEX "uq_page_builder__component_deletions_component_id_purpo_1mlwby6" ON "page_builder__component_deletions" ("component_id", "purpose");
CREATE UNIQUE INDEX "uq_page_builder__site_options_name" ON "page_builder__site_options" ("name");
CREATE UNIQUE INDEX "uq_page_builder__breakpoint_removals_open_key" ON "page_builder__breakpoint_removals" ("open_key");
CREATE INDEX "idx_page_builder__breakpoint_removal_fragments_run_id" ON "page_builder__breakpoint_removal_fragments" ("run_id");
CREATE INDEX "idx_page_builder__breakpoint_removal_fragments_created_at" ON "page_builder__breakpoint_removal_fragments" ("created_at");
CREATE INDEX "idx_page_builder__class_usage_entity_entity_key_178r965" ON "page_builder__class_usage" ("entity", "entity_key");
CREATE INDEX "idx_page_builder__class_usage_class_id" ON "page_builder__class_usage" ("class_id");
CREATE INDEX "idx_page_builder__component_usage_entity_entity_key_178r965" ON "page_builder__component_usage" ("entity", "entity_key");
CREATE INDEX "idx_page_builder__component_usage_component_id" ON "page_builder__component_usage" ("component_id");
CREATE INDEX "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv" ON "page_builder__breakpoint_removal_fragments" ("run_id", "document_key");
CREATE INDEX "idx_page_builder__token_usage_entity_entity_key_178r965" ON "page_builder__token_usage" ("entity", "entity_key");
CREATE INDEX "idx_page_builder__token_usage_token_id" ON "page_builder__token_usage" ("token_id");
CREATE UNIQUE INDEX "uq_page_builder__binding_issues_document_key" ON "page_builder__binding_issues" ("document_key");
CREATE INDEX "idx_page_builder__binding_issues_dirty" ON "page_builder__binding_issues" ("dirty");
CREATE UNIQUE INDEX "uq_page_builder__binding_report_runs_name" ON "page_builder__binding_report_runs" ("name");
CREATE INDEX "idx_comp_seo_parent" ON "comp_seo" ("_parent_id", "_parent_table", "_parent_field");
CREATE INDEX "idx_comp_seo_created_at" ON "comp_seo" ("created_at");
CREATE INDEX "idx_comp_seo_og_image" ON "comp_seo" ("og_image");
CREATE UNIQUE INDEX "idx_dc_authors_slug" ON "dc_authors" ("slug");
CREATE INDEX "idx_dc_authors_created_by" ON "dc_authors" ("created_by");
CREATE INDEX "idx_dc_authors_created_at" ON "dc_authors" ("created_at");
CREATE INDEX "idx_dc_authors_avatar" ON "dc_authors" ("avatar");
CREATE UNIQUE INDEX "idx_dc_block_pages_slug" ON "dc_block_pages" ("slug");
CREATE INDEX "idx_dc_block_pages_created_by" ON "dc_block_pages" ("created_by");
CREATE INDEX "idx_dc_block_pages_created_at" ON "dc_block_pages" ("created_at");
CREATE UNIQUE INDEX "idx_dc_categories_slug" ON "dc_categories" ("slug");
CREATE INDEX "idx_dc_categories_created_by" ON "dc_categories" ("created_by");
CREATE INDEX "idx_dc_categories_created_at" ON "dc_categories" ("created_at");
CREATE UNIQUE INDEX "idx_dc_components_slug" ON "dc_components" ("slug");
CREATE INDEX "idx_dc_components_created_by" ON "dc_components" ("created_by");
CREATE INDEX "idx_dc_components_created_at" ON "dc_components" ("created_at");
CREATE UNIQUE INDEX "idx_dc_form_submissions_slug" ON "dc_form_submissions" ("slug");
CREATE INDEX "idx_dc_form_submissions_created_by" ON "dc_form_submissions" ("created_by");
CREATE INDEX "idx_dc_form_submissions_created_at" ON "dc_form_submissions" ("created_at");
CREATE INDEX "idx_dc_form_submissions_form" ON "dc_form_submissions" ("form");
CREATE INDEX "idx_dc_form_submissions_status" ON "dc_form_submissions" ("status");
CREATE INDEX "idx_dc_form_submissions_submitted_at" ON "dc_form_submissions" ("submitted_at");
CREATE UNIQUE INDEX "uq_dc_form_submissions_form_response_key_1ak966i" ON "dc_form_submissions" ("form", "response_key");
CREATE UNIQUE INDEX "idx_dc_forms_slug" ON "dc_forms" ("slug");
CREATE INDEX "idx_dc_forms_created_by" ON "dc_forms" ("created_by");
CREATE INDEX "idx_dc_forms_created_at" ON "dc_forms" ("created_at");
CREATE UNIQUE INDEX "idx_dc_layouts_slug" ON "dc_layouts" ("slug");
CREATE INDEX "idx_dc_layouts_created_by" ON "dc_layouts" ("created_by");
CREATE INDEX "idx_dc_layouts_created_at" ON "dc_layouts" ("created_at");
CREATE UNIQUE INDEX "idx_dc_nx_pb_address_claims_slug" ON "dc_nx_pb_address_claims" ("slug");
CREATE INDEX "idx_dc_nx_pb_address_claims_created_by" ON "dc_nx_pb_address_claims" ("created_by");
CREATE INDEX "idx_dc_nx_pb_address_claims_created_at" ON "dc_nx_pb_address_claims" ("created_at");
CREATE UNIQUE INDEX "uq_dc_nx_pb_address_claims_claim_key" ON "dc_nx_pb_address_claims" ("claim_key");
CREATE INDEX "idx_dc_nx_pb_address_claims_kind" ON "dc_nx_pb_address_claims" ("kind");
CREATE INDEX "idx_dc_nx_pb_address_claims_holder_collection" ON "dc_nx_pb_address_claims" ("holder_collection");
CREATE INDEX "idx_dc_nx_pb_address_claims_holder_id" ON "dc_nx_pb_address_claims" ("holder_id");
CREATE INDEX "idx_dc_nx_pb_address_claims_space" ON "dc_nx_pb_address_claims" ("space");
CREATE INDEX "idx_dc_nx_pb_address_claims_blocked_by" ON "dc_nx_pb_address_claims" ("blocked_by");
CREATE UNIQUE INDEX "idx_dc_nx_pb_class_usage_slug" ON "dc_nx_pb_class_usage" ("slug");
CREATE INDEX "idx_dc_nx_pb_class_usage_created_by" ON "dc_nx_pb_class_usage" ("created_by");
CREATE INDEX "idx_dc_nx_pb_class_usage_created_at" ON "dc_nx_pb_class_usage" ("created_at");
CREATE INDEX "idx_dc_nx_pb_class_usage_entity_key" ON "dc_nx_pb_class_usage" ("entity_key");
CREATE INDEX "idx_dc_nx_pb_class_usage_class_id" ON "dc_nx_pb_class_usage" ("class_id");
CREATE UNIQUE INDEX "idx_dc_nx_pb_component_retired_slug" ON "dc_nx_pb_component_retired" ("slug");
CREATE INDEX "idx_dc_nx_pb_component_retired_created_by" ON "dc_nx_pb_component_retired" ("created_by");
CREATE INDEX "idx_dc_nx_pb_component_retired_created_at" ON "dc_nx_pb_component_retired" ("created_at");
CREATE UNIQUE INDEX "uq_dc_nx_pb_component_retired_identity" ON "dc_nx_pb_component_retired" ("identity");
CREATE INDEX "idx_dc_nx_pb_component_retired_component_id" ON "dc_nx_pb_component_retired" ("component_id");
CREATE UNIQUE INDEX "idx_dc_nx_pb_component_usage_slug" ON "dc_nx_pb_component_usage" ("slug");
CREATE INDEX "idx_dc_nx_pb_component_usage_created_by" ON "dc_nx_pb_component_usage" ("created_by");
CREATE INDEX "idx_dc_nx_pb_component_usage_created_at" ON "dc_nx_pb_component_usage" ("created_at");
CREATE INDEX "idx_dc_nx_pb_component_usage_entity_key" ON "dc_nx_pb_component_usage" ("entity_key");
CREATE INDEX "idx_dc_nx_pb_component_usage_component_id" ON "dc_nx_pb_component_usage" ("component_id");
CREATE UNIQUE INDEX "idx_dc_nx_pb_usage_backfill_slug" ON "dc_nx_pb_usage_backfill" ("slug");
CREATE INDEX "idx_dc_nx_pb_usage_backfill_created_by" ON "dc_nx_pb_usage_backfill" ("created_by");
CREATE INDEX "idx_dc_nx_pb_usage_backfill_created_at" ON "dc_nx_pb_usage_backfill" ("created_at");
CREATE INDEX "idx_dc_nx_pb_usage_backfill_scope_key" ON "dc_nx_pb_usage_backfill" ("scope_key");
CREATE INDEX "idx_dc_nx_pb_usage_backfill_generation" ON "dc_nx_pb_usage_backfill" ("generation");
CREATE UNIQUE INDEX "idx_dc_pages_slug" ON "dc_pages" ("slug");
CREATE INDEX "idx_dc_pages_created_by" ON "dc_pages" ("created_by");
CREATE INDEX "idx_dc_pages_created_at" ON "dc_pages" ("created_at");
CREATE INDEX "idx_dc_pages_layout" ON "dc_pages" ("layout");
CREATE UNIQUE INDEX "idx_dc_patterns_slug" ON "dc_patterns" ("slug");
CREATE INDEX "idx_dc_patterns_created_by" ON "dc_patterns" ("created_by");
CREATE INDEX "idx_dc_patterns_created_at" ON "dc_patterns" ("created_at");
CREATE UNIQUE INDEX "idx_dc_posts_slug" ON "dc_posts" ("slug");
CREATE INDEX "idx_dc_posts_created_by" ON "dc_posts" ("created_by");
CREATE INDEX "idx_dc_posts_created_at" ON "dc_posts" ("created_at");
CREATE INDEX "idx_dc_posts_featured_image" ON "dc_posts" ("featured_image");
CREATE UNIQUE INDEX "idx_dc_tags_slug" ON "dc_tags" ("slug");
CREATE INDEX "idx_dc_tags_created_by" ON "dc_tags" ("created_by");
CREATE INDEX "idx_dc_tags_created_at" ON "dc_tags" ("created_at");
CREATE UNIQUE INDEX "idx_dc_templates_slug" ON "dc_templates" ("slug");
CREATE INDEX "idx_dc_templates_created_by" ON "dc_templates" ("created_by");
CREATE INDEX "idx_dc_templates_created_at" ON "dc_templates" ("created_at");
CREATE UNIQUE INDEX "uq_dc_templates_collection" ON "dc_templates" ("collection");
CREATE UNIQUE INDEX "uq_dc_templates_entry" ON "dc_templates" ("entry");
CREATE INDEX "idx_dc_templates_entry_collection" ON "dc_templates" ("entry_collection");
CREATE INDEX "idx_dc_templates_forked_from" ON "dc_templates" ("forked_from");
CREATE UNIQUE INDEX "uq_dc_templates_address" ON "dc_templates" ("address");
CREATE UNIQUE INDEX "idx_single_announcement_slug" ON "single_announcement" ("slug");
CREATE INDEX "idx_single_announcement_created_at" ON "single_announcement" ("created_at");
CREATE UNIQUE INDEX "idx_single_homepage_slug" ON "single_homepage" ("slug");
CREATE INDEX "idx_single_homepage_created_at" ON "single_homepage" ("created_at");
CREATE UNIQUE INDEX "idx_single_landing_page_slug" ON "single_landing_page" ("slug");
CREATE INDEX "idx_single_landing_page_created_at" ON "single_landing_page" ("created_at");
CREATE UNIQUE INDEX "idx_single_page_builder_settings_slug" ON "single_page_builder_settings" ("slug");
CREATE INDEX "idx_single_page_builder_settings_created_at" ON "single_page_builder_settings" ("created_at");
CREATE INDEX "idx_single_page_builder_settings_default_layout" ON "single_page_builder_settings" ("default_layout");
CREATE INDEX "idx_single_page_builder_settings_seeded_layout" ON "single_page_builder_settings" ("seeded_layout");
CREATE UNIQUE INDEX "idx_single_page_builder_site_code_slug" ON "single_page_builder_site_code" ("slug");
CREATE INDEX "idx_single_page_builder_site_code_created_at" ON "single_page_builder_site_code" ("created_at");
CREATE UNIQUE INDEX "idx_single_site_settings_slug" ON "single_site_settings" ("slug");
CREATE INDEX "idx_single_site_settings_created_at" ON "single_site_settings" ("created_at");
CREATE UNIQUE INDEX "idx_single_site_style_slug" ON "single_site_style" ("slug");
CREATE INDEX "idx_single_site_style_created_at" ON "single_site_style" ("created_at");
COMMIT;
