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
INSERT INTO "nextly_meta" VALUES('registry_record','{"point":null,"baseline":{"collections":{},"singles":{},"fieldGroups":{},"permissions":[]}}',1794584639);
INSERT INTO "nextly_meta" VALUES('schema_version','{"migration":"20261113_154356_102_create_localization_seo","seq":1}',1794584639);
INSERT INTO "nextly_meta" VALUES('preset_grants_release','{"release":"0.0.2-alpha.75"}',1794584639);
INSERT INTO "nextly_rbac_epoch" VALUES('global',6,'74720470-e16a-4932-9a10-217c48ecc563',1794584639);
INSERT INTO "nextly_schema_events" VALUES('e46e1ee3-15fa-4404-af75-6f7e54ef4a5c','core_apply','applied','cli-migrate',NULL,NULL,'core',NULL,1794584639478,1794584639479,NULL,NULL,NULL,NULL,231,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('59b86fcf-493f-4140-8095-a6e6e27082e1','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping','5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac',NULL,NULL,1794584639500,1794584639503,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('9625328e-368b-49d2-b80b-5788c9a869ee','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals','b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231',NULL,NULL,1794584639510,1794584639511,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('b07ebc7d-7d9d-4b99-943d-32e129ec5339','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs','55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337',NULL,NULL,1794584639516,1794584639518,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('c8588acb-98f4-448b-931b-3c1d41ac8fe9','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options','b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897',NULL,NULL,1794584639523,1794584639524,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('2b057b32-77eb-47c4-bf17-1b27783f2882','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals','c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8',NULL,NULL,1794584639529,1794584639530,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('947738b2-fe8e-4549-992b-e918784e4ac0','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments','2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c',NULL,NULL,1794584639536,1794584639537,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('e2849848-b5de-4543-80dc-3227b63870a9','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables','261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b',NULL,NULL,1794584639543,1794584639545,NULL,NULL,NULL,NULL,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('41701089-f0ae-4bf1-9017-f827e87173da','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes','bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e',NULL,NULL,1794584639552,1794584639554,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('ab595724-6c9b-4809-abde-88c8044ef5cf','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table','677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6',NULL,NULL,1794584639561,1794584639562,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('4cf2280f-ab0d-4bee-8a1d-a2557d6bcc71','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables','ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05',NULL,NULL,1794584639581,1794584639584,NULL,NULL,NULL,NULL,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('a3a460fa-9b54-4705-9a62-3b33ec14cb5a','file_apply','applied','cli-migrate','20261113_154356_098_baseline.sql','0a830f79e75d5ac63c626e969b87ac700ea19db815572f38d69a978085ab4a05',NULL,NULL,1794584639632,1794584639633,NULL,NULL,NULL,NULL,121,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('ce9a3e32-be70-45cd-9c0e-c16bebe44b40','file_apply','applied','cli-migrate','20261113_154356_099_create_localization_authors.sql','fed70140687b7576a6a0599efbc1d537e692c9312504d370c7016201dbd0e5b6',NULL,NULL,1794584639640,1794584639641,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('133dfc8a-a26e-46e8-989e-0a7adc7eb782','file_apply','applied','cli-migrate','20261113_154356_100_create_localization_site-settings.sql','ffbbfdf1b96f691965becb356f0df1388a1e2fc6a08722c0459d07ed212dfabd',NULL,NULL,1794584639642,1794584639643,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('78353dc5-5de3-4c6e-b0e7-b3c55f26b72f','file_apply','applied','cli-migrate','20261113_154356_101_create_localization_announcement.sql','e4e6e40b88b352aecf80fc35b1e760b3df5903e7c9415cca3dd881f3a2aed7c4',NULL,NULL,1794584639644,1794584639645,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" VALUES('80d33da4-e61c-4825-b852-b7d3b1a8c765','file_apply','applied','cli-migrate','20261113_154356_102_create_localization_seo.sql','c62168d7174eee397aabc81bfe422cda725794a62e13655789dc5661d39c798d',NULL,NULL,1794584639646,1794584639646,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__usage_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__usage_progress','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__layout_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_deletions','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_deletion_hosts','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__site_options','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__breakpoint_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__breakpoint_removal_fragments','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__class_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__component_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__token_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__binding_issues','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "nextly_schema_owners" VALUES('page_builder__binding_report_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.75',10,'active',1794584639,1794584639);
INSERT INTO "permissions" VALUES('1b7d352a-65f8-4d20-afc0-469d2672c9c9','Create Users','create-users','create','users','Permission to create users',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('7d48d042-8ea0-4120-a5bc-46e2ed0aa68f','Read Users','read-users','read','users','Permission to read users',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('f0de7fb1-86ed-41c0-b716-3c68729c85d0','Update Users','update-users','update','users','Permission to update users',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('550f5f81-4666-42a6-8fe3-228a1ec0bd8d','Delete Users','delete-users','delete','users','Permission to delete users',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('abe3e90f-b67f-4658-95d5-e22ae24a1d00','Create Roles','create-roles','create','roles','Permission to create roles',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('afd20900-6b12-41b0-affd-07e0848da941','Read Roles','read-roles','read','roles','Permission to read roles',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('19a19b5f-e5b5-473c-9039-f2b7a8bc1708','Update Roles','update-roles','update','roles','Permission to update roles',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('00bf491c-3821-4cb4-9ca5-2f8e693012ab','Delete Roles','delete-roles','delete','roles','Permission to delete roles',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('d4114646-357f-44f3-9807-473ce6df2671','Create Media','create-media','create','media','Permission to upload media files',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('0175fda0-9cc3-4ec3-b6b8-2a6ec0d7bc9f','Read Media','read-media','read','media','Permission to view media files',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('bf79edc7-0f87-471f-9e0a-37f480007b25','Update Media','update-media','update','media','Permission to edit media metadata and move files',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('e1e5eadf-de14-483a-86ba-c62528e75c0a','Delete Media','delete-media','delete','media','Permission to delete media files',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('ae85be91-d919-4897-b63f-23dfbb25a86e','Read Settings','read-settings','read','settings','Permission to read system settings',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('98dd62fe-1687-4bc2-adb2-10c58483d17d','Create Settings','create-settings','create','settings','Permission to add settings such as user fields and field groups',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('80ca220c-8092-4dfe-a859-167334cc72a0','Update Settings','update-settings','update','settings','Permission to change system settings',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('2f158e0f-8b20-4382-a775-f33b192fca08','Delete Settings','delete-settings','delete','settings','Permission to remove settings such as user fields and field groups',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('a62d67ee-7017-433b-8983-b37f4c843323','Create Email Providers','create-email-providers','create','email-providers','Permission to create email providers',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('234e2c3d-e052-490b-922e-fab1d399c9eb','Read Email Providers','read-email-providers','read','email-providers','Permission to read email providers',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('65b7231b-b6e4-48f5-9f03-fdb02e2e7806','Update Email Providers','update-email-providers','update','email-providers','Permission to change email providers',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('07f32774-9426-49e8-b0ec-a26efe7d4438','Delete Email Providers','delete-email-providers','delete','email-providers','Permission to delete email providers',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('547c3565-cefd-4115-9ce4-05694c5143da','Create Email Templates','create-email-templates','create','email-templates','Permission to create email templates',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('d5632ed5-95ef-4d28-9644-f73efa1338d4','Read Email Templates','read-email-templates','read','email-templates','Permission to read email templates',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('d2bb89ff-6e7e-4f12-83f6-979c8647e34b','Update Email Templates','update-email-templates','update','email-templates','Permission to change email templates',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('24bba534-1613-40bc-a1fd-4adc4a052fe6','Delete Email Templates','delete-email-templates','delete','email-templates','Permission to delete email templates',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('3a0c2dd3-adcf-4a0a-973d-a1d0f236848b','Update API Keys','update-api-keys','update','api-keys','Permission to update API keys',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('6d3c9c92-100b-4ef7-9a34-4ba680d3bd1b','Create API Keys','create-api-keys','create','api-keys','Permission to create API keys',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('b063fe54-c5b3-4683-9383-3b759f8234c7','Read API Keys','read-api-keys','read','api-keys','Permission to read API keys',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('c3d24d4b-beb9-49b4-8918-d1fe225acc2e','Delete API Keys','delete-api-keys','delete','api-keys','Permission to delete API keys',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('917555b3-543c-49f3-999e-1a16c6781b78','Update Webhooks','update-webhooks','update','webhooks','Permission to update webhook endpoints',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('dcb85906-d76e-4212-bec3-b1a2b13f9557','Create Webhooks','create-webhooks','create','webhooks','Permission to register webhook endpoints',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('44a9bf9f-fce2-43de-8662-bf0172522e79','Read Webhooks','read-webhooks','read','webhooks','Permission to view webhook endpoints',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('f1dc074e-7e16-4238-8f0a-893be4326813','Delete Webhooks','delete-webhooks','delete','webhooks','Permission to delete webhook endpoints',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('25e45801-b55e-48bc-a8e2-eb4ca88ec836','Read Releases','read-content-releases','read','content-releases','Permission to view content releases and their members',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('d3d07af6-1ed8-48f5-8675-2afe38922332','Create Releases','create-content-releases','create','content-releases','Permission to create a content release and choose its members',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('49a7fecf-b7f7-4cec-8efb-dcf24a82835b','Publish Releases','publish-content-releases','publish','content-releases','Permission to schedule or cancel a content release, which is what makes its content go live',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('3116e97e-5670-4724-8dc9-c1d7f4c3e698','Update Releases','update-content-releases','update','content-releases','Permission to rename a content release and change its description',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('23ee7cd3-2db7-4632-a9ca-725e52b60754','Delete Releases','delete-content-releases','delete','content-releases','Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('fc61e80a-db6e-4e37-8eb0-732b134b8c9f','Manage Background Jobs','manage-background-jobs','manage','background-jobs','Permission to run the background job queue by hand, outside its schedule',NULL,NULL,NULL,0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('0f0482da-5398-45ce-b206-7f96062e31d4','Manage page builder site settings','manage-page-builder-site','manage','page-builder-site','Change the site''s breakpoints, and choose its default Layout.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('e8c26472-3e49-4c86-b263-f83241dccdce','Lock shared styles','lock-page-builder-shared-styles','lock','page-builder-shared-styles','Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('5ded3b2b-8993-4339-a329-df347a290985','Manage template routing','manage-template-routing','manage','template-routing','Set or change the address a collection''s entries are served at. A change moves every entry''s live address.','@nextlyhq/plugin-page-builder',NULL,'General',0,1794584639,1794584639);
INSERT INTO "permissions" VALUES('ce157e60-07c0-492a-9c1a-edd1256fdd30','Export Submissions','export-submissions','export','submissions','Export form submissions as CSV/JSON','@nextlyhq/plugin-form-builder',NULL,'General',1,1794584639,1794584639);
INSERT INTO "role_permissions" VALUES('14c8f868-a330-48e2-8473-8a92460bedc8','d144e328-409e-48c6-b4ab-6f735fc9863e','3a0c2dd3-adcf-4a0a-973d-a1d0f236848b',1794584639);
INSERT INTO "role_permissions" VALUES('36f97ec1-3d5f-4f86-8896-fa950660a3c5','d144e328-409e-48c6-b4ab-6f735fc9863e','6d3c9c92-100b-4ef7-9a34-4ba680d3bd1b',1794584639);
INSERT INTO "role_permissions" VALUES('5201b630-d810-4462-b498-3e62d07db555','d144e328-409e-48c6-b4ab-6f735fc9863e','b063fe54-c5b3-4683-9383-3b759f8234c7',1794584639);
INSERT INTO "role_permissions" VALUES('c4f71b1a-fa66-4ee8-b4ce-e539723ab2e2','d144e328-409e-48c6-b4ab-6f735fc9863e','c3d24d4b-beb9-49b4-8918-d1fe225acc2e',1794584639);
INSERT INTO "role_permissions" VALUES('bd5a8b5a-3baf-45d1-8239-e03d29e00c15','d144e328-409e-48c6-b4ab-6f735fc9863e','fc61e80a-db6e-4e37-8eb0-732b134b8c9f',1794584639);
INSERT INTO "role_permissions" VALUES('3f99bb2a-4d87-4611-b7f9-21a9405d3020','d144e328-409e-48c6-b4ab-6f735fc9863e','23ee7cd3-2db7-4632-a9ca-725e52b60754',1794584639);
INSERT INTO "role_permissions" VALUES('c0b226fd-613a-40f0-922e-1505fe979a60','d144e328-409e-48c6-b4ab-6f735fc9863e','25e45801-b55e-48bc-a8e2-eb4ca88ec836',1794584639);
INSERT INTO "role_permissions" VALUES('34a2e537-80b2-44d0-b0bd-9263db9c2984','d144e328-409e-48c6-b4ab-6f735fc9863e','3116e97e-5670-4724-8dc9-c1d7f4c3e698',1794584639);
INSERT INTO "role_permissions" VALUES('dab7d7ce-a453-4813-a6c9-483844fdfee9','d144e328-409e-48c6-b4ab-6f735fc9863e','49a7fecf-b7f7-4cec-8efb-dcf24a82835b',1794584639);
INSERT INTO "role_permissions" VALUES('4013ef7c-a64a-471b-8472-0311066f4889','d144e328-409e-48c6-b4ab-6f735fc9863e','d3d07af6-1ed8-48f5-8675-2afe38922332',1794584639);
INSERT INTO "role_permissions" VALUES('a180342c-e353-4d07-bd66-e5c8d624efa6','d144e328-409e-48c6-b4ab-6f735fc9863e','07f32774-9426-49e8-b0ec-a26efe7d4438',1794584639);
INSERT INTO "role_permissions" VALUES('9da5511f-971f-4de2-aa60-064df62b23d1','d144e328-409e-48c6-b4ab-6f735fc9863e','234e2c3d-e052-490b-922e-fab1d399c9eb',1794584639);
INSERT INTO "role_permissions" VALUES('331f04e4-07b5-48d8-921a-b89d188becd5','d144e328-409e-48c6-b4ab-6f735fc9863e','65b7231b-b6e4-48f5-9f03-fdb02e2e7806',1794584639);
INSERT INTO "role_permissions" VALUES('d7e4f026-6fce-42ae-a127-6a7a15df9b30','d144e328-409e-48c6-b4ab-6f735fc9863e','a62d67ee-7017-433b-8983-b37f4c843323',1794584639);
INSERT INTO "role_permissions" VALUES('a99071c4-8b58-4c93-ad6b-78b3c3f5e212','d144e328-409e-48c6-b4ab-6f735fc9863e','24bba534-1613-40bc-a1fd-4adc4a052fe6',1794584639);
INSERT INTO "role_permissions" VALUES('a4c6d208-6be5-4ba7-ad19-aba357af618f','d144e328-409e-48c6-b4ab-6f735fc9863e','547c3565-cefd-4115-9ce4-05694c5143da',1794584639);
INSERT INTO "role_permissions" VALUES('21cc3f49-11ca-4090-bbe5-cefc0b7d055c','d144e328-409e-48c6-b4ab-6f735fc9863e','d2bb89ff-6e7e-4f12-83f6-979c8647e34b',1794584639);
INSERT INTO "role_permissions" VALUES('7a1d3026-491f-45dd-b51e-5fe889fd66e7','d144e328-409e-48c6-b4ab-6f735fc9863e','d5632ed5-95ef-4d28-9644-f73efa1338d4',1794584639);
INSERT INTO "role_permissions" VALUES('f4fc042a-d65d-4eed-990b-d4c29c61baa6','d144e328-409e-48c6-b4ab-6f735fc9863e','0175fda0-9cc3-4ec3-b6b8-2a6ec0d7bc9f',1794584639);
INSERT INTO "role_permissions" VALUES('6b1539db-63b9-48e9-9504-035d3de03bf7','d144e328-409e-48c6-b4ab-6f735fc9863e','bf79edc7-0f87-471f-9e0a-37f480007b25',1794584639);
INSERT INTO "role_permissions" VALUES('c9b4f9a3-421c-48ce-a514-698c3de6988c','d144e328-409e-48c6-b4ab-6f735fc9863e','d4114646-357f-44f3-9807-473ce6df2671',1794584639);
INSERT INTO "role_permissions" VALUES('a976e9bd-9795-4a99-9098-4b2db2706421','d144e328-409e-48c6-b4ab-6f735fc9863e','e1e5eadf-de14-483a-86ba-c62528e75c0a',1794584639);
INSERT INTO "role_permissions" VALUES('d1ed74d2-fc1f-4c71-a17a-1fb8ac3fc6dd','d144e328-409e-48c6-b4ab-6f735fc9863e','e8c26472-3e49-4c86-b263-f83241dccdce',1794584639);
INSERT INTO "role_permissions" VALUES('99e41542-4b5a-4568-b491-bfd3e133b72c','d144e328-409e-48c6-b4ab-6f735fc9863e','0f0482da-5398-45ce-b206-7f96062e31d4',1794584639);
INSERT INTO "role_permissions" VALUES('27d93bc2-5313-4673-b777-c9e1810bc4b9','d144e328-409e-48c6-b4ab-6f735fc9863e','afd20900-6b12-41b0-affd-07e0848da941',1794584639);
INSERT INTO "role_permissions" VALUES('a0678cc6-9164-4881-98f6-07794ec94762','d144e328-409e-48c6-b4ab-6f735fc9863e','2f158e0f-8b20-4382-a775-f33b192fca08',1794584639);
INSERT INTO "role_permissions" VALUES('a08d8049-41d0-4306-a435-bd0ac832bae3','d144e328-409e-48c6-b4ab-6f735fc9863e','80ca220c-8092-4dfe-a859-167334cc72a0',1794584639);
INSERT INTO "role_permissions" VALUES('1637d083-26ec-408d-af65-28241a855d76','d144e328-409e-48c6-b4ab-6f735fc9863e','98dd62fe-1687-4bc2-adb2-10c58483d17d',1794584639);
INSERT INTO "role_permissions" VALUES('df891c5a-3418-4dc6-8ba5-0be077cd51b0','d144e328-409e-48c6-b4ab-6f735fc9863e','ae85be91-d919-4897-b63f-23dfbb25a86e',1794584639);
INSERT INTO "role_permissions" VALUES('0ad2a673-0eb0-429f-9c35-d6922334994e','d144e328-409e-48c6-b4ab-6f735fc9863e','ce157e60-07c0-492a-9c1a-edd1256fdd30',1794584639);
INSERT INTO "role_permissions" VALUES('a8736a26-279f-473e-bb16-67eca16d7baa','d144e328-409e-48c6-b4ab-6f735fc9863e','5ded3b2b-8993-4339-a329-df347a290985',1794584639);
INSERT INTO "role_permissions" VALUES('98a442e6-ba1a-4bab-b1c7-70930278a10e','d144e328-409e-48c6-b4ab-6f735fc9863e','7d48d042-8ea0-4120-a5bc-46e2ed0aa68f',1794584639);
INSERT INTO "role_permissions" VALUES('2b277bbb-5d75-4ebf-a4cd-0b6cf9ec2f84','d144e328-409e-48c6-b4ab-6f735fc9863e','44a9bf9f-fce2-43de-8662-bf0172522e79',1794584639);
INSERT INTO "role_permissions" VALUES('9a3c350e-f26d-4495-ade1-7cfcf2468450','d144e328-409e-48c6-b4ab-6f735fc9863e','917555b3-543c-49f3-999e-1a16c6781b78',1794584639);
INSERT INTO "role_permissions" VALUES('6d656dcb-9171-4519-a10b-9f306d5598ff','d144e328-409e-48c6-b4ab-6f735fc9863e','dcb85906-d76e-4212-bec3-b1a2b13f9557',1794584639);
INSERT INTO "role_permissions" VALUES('250a1d32-9928-4faa-b794-dc27d9c385b3','d144e328-409e-48c6-b4ab-6f735fc9863e','f1dc074e-7e16-4238-8f0a-893be4326813',1794584639);
INSERT INTO "role_permissions" VALUES('85a97187-f0d8-4ba5-bbc2-9af604cba366','a134c02e-a3b3-4983-825e-9a3f06fbaf64','0175fda0-9cc3-4ec3-b6b8-2a6ec0d7bc9f',1794584639);
INSERT INTO "role_permissions" VALUES('c6e00fec-1ca2-4165-851c-16df8a3392a4','a134c02e-a3b3-4983-825e-9a3f06fbaf64','bf79edc7-0f87-471f-9e0a-37f480007b25',1794584639);
INSERT INTO "role_permissions" VALUES('858bf770-05da-4560-9e63-28218cffaa5d','a134c02e-a3b3-4983-825e-9a3f06fbaf64','d4114646-357f-44f3-9807-473ce6df2671',1794584639);
INSERT INTO "role_permissions" VALUES('14a8fa02-b887-4725-a3a4-6406a38bb156','a134c02e-a3b3-4983-825e-9a3f06fbaf64','e1e5eadf-de14-483a-86ba-c62528e75c0a',1794584639);
INSERT INTO "role_permissions" VALUES('190faa59-6a3f-4c34-93e3-bd8b07e280b7','87bc2c90-68d0-491b-9d12-518f52d079e2','0175fda0-9cc3-4ec3-b6b8-2a6ec0d7bc9f',1794584639);
INSERT INTO "role_permissions" VALUES('f8509b29-d6f2-4db7-a6f7-b4ec6830ad36','87bc2c90-68d0-491b-9d12-518f52d079e2','bf79edc7-0f87-471f-9e0a-37f480007b25',1794584639);
INSERT INTO "role_permissions" VALUES('69d72232-3b02-4d0a-941b-b0d9f6294c70','87bc2c90-68d0-491b-9d12-518f52d079e2','d4114646-357f-44f3-9807-473ce6df2671',1794584639);
INSERT INTO "role_permissions" VALUES('0e8210fe-5de3-4098-ac24-49dedebc84ba','b6f0b821-ef34-42a0-a908-b81837574b91','b063fe54-c5b3-4683-9383-3b759f8234c7',1794584639);
INSERT INTO "role_permissions" VALUES('6d88db9a-d861-4d60-945c-81d2864bec46','b6f0b821-ef34-42a0-a908-b81837574b91','25e45801-b55e-48bc-a8e2-eb4ca88ec836',1794584639);
INSERT INTO "role_permissions" VALUES('6e91620f-f67b-4a99-9579-549db2992a92','b6f0b821-ef34-42a0-a908-b81837574b91','234e2c3d-e052-490b-922e-fab1d399c9eb',1794584639);
INSERT INTO "role_permissions" VALUES('51d4e762-fbda-484a-84c6-c3930e582262','b6f0b821-ef34-42a0-a908-b81837574b91','d5632ed5-95ef-4d28-9644-f73efa1338d4',1794584639);
INSERT INTO "role_permissions" VALUES('3dfbc3ab-d883-47d7-9eb0-f925fa9cbdfa','b6f0b821-ef34-42a0-a908-b81837574b91','0175fda0-9cc3-4ec3-b6b8-2a6ec0d7bc9f',1794584639);
INSERT INTO "role_permissions" VALUES('b5ac03cb-539e-4f85-bf78-9ad91fa89901','b6f0b821-ef34-42a0-a908-b81837574b91','afd20900-6b12-41b0-affd-07e0848da941',1794584639);
INSERT INTO "role_permissions" VALUES('7be96212-15cc-47fc-9db9-632456594923','b6f0b821-ef34-42a0-a908-b81837574b91','ae85be91-d919-4897-b63f-23dfbb25a86e',1794584639);
INSERT INTO "role_permissions" VALUES('3c2f3d78-2a8b-4b8e-bd18-f3eab9351bbb','b6f0b821-ef34-42a0-a908-b81837574b91','7d48d042-8ea0-4120-a5bc-46e2ed0aa68f',1794584639);
INSERT INTO "role_permissions" VALUES('1afade25-bd61-4a5c-b104-0d1f938abcd0','b6f0b821-ef34-42a0-a908-b81837574b91','44a9bf9f-fce2-43de-8662-bf0172522e79',1794584639);
INSERT INTO "roles" VALUES('d144e328-409e-48c6-b4ab-6f735fc9863e','Admin','admin','Everything except granting access to others',90,1,1794584639,1794584639);
INSERT INTO "roles" VALUES('a134c02e-a3b3-4983-825e-9a3f06fbaf64','Editor','editor','Full control of content and media, including publishing',50,1,1794584639,1794584639);
INSERT INTO "roles" VALUES('87bc2c90-68d0-491b-9d12-518f52d079e2','Author','author','Write content, but not publish or delete it',30,1,1794584639,1794584639);
INSERT INTO "roles" VALUES('b6f0b821-ef34-42a0-a908-b81837574b91','Viewer','viewer','Read everything, change nothing',10,1,1794584639,1794584639);
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
