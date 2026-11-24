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
	`queued_id` text,
	`template_owner` text,
	`template_overridden` integer,
	`template_digest` text,
	`failure_kind` text,
	`failure_status` integer,
	`provider_origin` text,
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
	`template_slug` text,
	`message_kind` text,
	`recipient_kinds` text,
	`provider_type` text,
	`provider_id` text,
	`provider_origin` text,
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
	`format` text,
	`blocks` text,
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
CREATE TABLE `nextly_external_identities` (
	`id` text PRIMARY KEY,
	`provider_key` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`key_digest` text NOT NULL,
	`address` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_nextly_external_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
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
CREATE TABLE `nextly_translation_provenance` (
	`id` text PRIMARY KEY,
	`scope_kind` text NOT NULL,
	`scope_slug` text NOT NULL,
	`entry_id` text NOT NULL,
	`locale` text NOT NULL,
	`part_state` text NOT NULL,
	`field_path` text NOT NULL,
	`value_fingerprint` text NOT NULL,
	`origin` text NOT NULL,
	`engine` text,
	`actor_kind` text,
	`actor_id` text,
	`actor_principal_kind` text,
	`source_locale` text,
	`source_fingerprint` text,
	`origin_row_id` text,
	`written_at` integer NOT NULL
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
	`base_draft_revision` integer,
	`field_sources` text,
	`changed_locales` text,
	`shared_changed` integer
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
, "blocks" integer);
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
CREATE TABLE "page_builder__binding_uses" (
  "id" text PRIMARY KEY NOT NULL,
  "document_key" text NOT NULL,
  "kind" text NOT NULL,
  "slug" text NOT NULL,
  "document_id" text,
  "place" text NOT NULL,
  "version" text NOT NULL,
  "locale" text,
  "blocks_field" text NOT NULL,
  "node_id" text NOT NULL,
  "block_type" text NOT NULL,
  "block_name" text,
  "prop" text NOT NULL,
  "path" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_key" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE "reading__lists" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  CONSTRAINT "fk_reading__lists_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE "reading__list_items" (
  "id" text PRIMARY KEY NOT NULL,
  "list_id" text NOT NULL,
  "post_id" text NOT NULL,
  "created_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" integer NOT NULL DEFAULT (strftime('%s', 'now')),
  CONSTRAINT "fk_reading__list_items_list_id" FOREIGN KEY ("list_id") REFERENCES "reading__lists" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
  "slug" text NOT NULL,
  "area" text,
  "content" text
);
CREATE TABLE "dc_form_submission_resends" (
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
  "submission" text NOT NULL,
  "ticked" text,
  "exclude" text,
  "retire" text,
  "settled" text
);
CREATE TABLE "dc_form_submission_sends" (
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
  "submission" text NOT NULL,
  "queued_id" text NOT NULL,
  "form" text,
  "notification" text,
  "attempts" integer,
  "retries" integer,
  "changed_at" integer,
  "cancel" text,
  "cancel_requested" text,
  "configured" text,
  "recipients" text
);
CREATE TABLE "dc_form_submissions" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "created_at" integer DEFAULT (strftime('%s', 'now')),
  "updated_at" integer DEFAULT (strftime('%s', 'now')),
  "created_by" text,
  "_revision" integer NOT NULL DEFAULT 1,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "form" text NOT NULL,
  "data" text NOT NULL,
  "status" text NOT NULL,
  "submitted_at" integer NOT NULL,
  "edited_at" integer,
  "response_key" text,
  "asked" text
);
CREATE TABLE "dc_form_uploads" (
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
  "media" text NOT NULL,
  "form" text NOT NULL,
  "submission" text,
  "released_at" integer
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
  "slug" text NOT NULL,
  "fields" text NOT NULL,
  "settings" text,
  "notifications" text,
  "status" text NOT NULL,
  "went_live_at" integer
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
  "slug" text NOT NULL,
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
  "slug" text NOT NULL,
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
  "editor_mode" text,
  "settings" text,
  "sections" text,
  "categories" text,
  "tags" text,
  "featured_image" text,
  "published_at" integer,
  "last_saved_at" integer
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
  "_changed_at" integer
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
CREATE TABLE "dc_posts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  "excerpt" TEXT,
  "meta_title" TEXT,
  "meta_description" TEXT,
  "content" TEXT,
  "custom_script" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_posts" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_categories_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_categories" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_tags_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_tags" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_block_pages_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_block_pages" ("id") ON DELETE CASCADE
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
CREATE TABLE "dc_pages_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_pages" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_patterns_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "description" TEXT,
  "category" TEXT,
  "keywords" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_patterns" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_components_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "description" TEXT,
  "category" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_components" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_layouts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_layouts" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_templates_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_templates" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_forms_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "name" TEXT,
  "description" TEXT,
  "closed_message" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_forms" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_form_submissions_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "spam_reason" TEXT,
  "notes" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "page" TEXT,
  "edited_by" TEXT,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submissions" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_form_submission_sends_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "send_key" TEXT,
  "notification_name" TEXT,
  "state" TEXT,
  "retired_by" TEXT,
  "requested_by" TEXT,
  "resend" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submission_sends" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_form_uploads_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "field" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_uploads" ("id") ON DELETE CASCADE
);
CREATE TABLE "dc_form_submission_resends_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "notification" TEXT,
  "requested_by" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_form_submission_resends" ("id") ON DELETE CASCADE
);
CREATE TABLE "single_homepage_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_homepage" ("id") ON DELETE CASCADE
);
CREATE TABLE "single_landing_page_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_landing_page" ("id") ON DELETE CASCADE
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
INSERT INTO "nextly_schema_lock" ("id", "owner", "command", "acquired_at", "expires_at") VALUES(1,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_field_group_lock" ("id", "owner", "expires_at") VALUES(1,NULL,NULL);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('7df583b3-c65c-48bd-9dd6-fa293ed8eaa1','authors','{"singular":"Author","plural":"Authors"}','dc_authors',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Biography","name":"bio","type":"textarea"},{"label":"Role / Title","name":"jobTitle","type":"text"},{"label":"Article Count","name":"articleCount","type":"number"},{"label":"Avatar","name":"avatar","relationTo":"media","type":"upload"}]',1,1,1,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"useAsTitle":"title","pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'code',1,NULL,'9574b54dab8dab53d40130bff603d766e1004126b673d9873a4e7a0b3a54a69f',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('b51fbb8e-1c09-40d0-9726-badc36252b54','block-pages','{"singular":"Block Page","plural":"Block Pages"}','dc_block_pages',NULL,'[{"name":"title","required":true,"type":"text"},{"name":"slug","required":true,"type":"text","unique":true},{"admin":{"description":"A @nextlyhq/blocks-engine BlockDocument. Rendered by blocks-react, not by the page builder."},"label":"Block document","name":"content","type":"json"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'code',1,NULL,'e8ac65cbc2e6c69a97ea4503fe8df15c2aee64487d1190bbdc790e76b0a0e7bb',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('46aa9806-b9aa-473d-b808-1e1cff2bef5e','categories','{"singular":"Category","plural":"Categories"}','dc_categories',NULL,'[{"name":"title","required":true,"type":"text"},{"name":"slug","required":true,"type":"text","unique":true},{"name":"description","type":"textarea"},{"label":"Icon","name":"icon","type":"icon"}]',1,0,0,NULL,NULL,NULL,'{"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'code',1,NULL,'bb9fa3378bdb739e5cf91fff9efd293e17cd805975945c94a715a97d7bd62dc5',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('1bdf90d9-707d-44f3-b0f9-5fce6282625c','components','{"singular":"Component","plural":"Components"}','dc_components',NULL,'[{"name":"title","required":true,"type":"text"},{"localized":false,"name":"slug","required":true,"type":"text","unique":true},{"name":"description","type":"textarea"},{"name":"category","type":"text"},{"admin":{"isClearable":true,"placeholder":"Anywhere"},"label":"Use as","name":"area","options":[{"label":"Header","value":"header"},{"label":"Footer","value":"footer"}],"type":"select"},{"blocks":{"kinds":["component"]},"label":"Component","name":"content","type":"blocks"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"hidden":true,"useAsTitle":"title","disableDelete":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]},"components":{"BeforeListTable":"@nextlyhq/plugin-page-builder/admin#ComponentListTools"}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'3c59abcd739fcfbb2753cb953d44828e41893c1c2ed432af503ae662d375a301',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('59becec9-038e-451b-8344-21c0d89bc54e','form-submission-resends','{"singular":"Submission resend","plural":"Submission resends"}','dc_form_submission_resends',NULL,'[{"localized":false,"name":"submission","required":true,"type":"text"},{"name":"notification","required":true,"type":"text"},{"name":"requestedBy","type":"text"},{"name":"ticked","type":"json"},{"name":"exclude","type":"json"},{"name":"retire","type":"json"},{"name":"settled","type":"json"}]',1,0,0,NULL,NULL,'{"record":false}',NULL,NULL,'plugin:@nextlyhq/plugin-form-builder',1,NULL,'302306984b5fc1c8832cca99fec3a8cb3b47b90579e17cae99f94cdcf96f04f8',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('03287f31-bdcf-40bb-84a1-9af33b9d614b','form-submission-sends','{"singular":"Submission send","plural":"Submission sends"}','dc_form_submission_sends',NULL,'[{"localized":false,"name":"submission","required":true,"type":"text"},{"localized":false,"name":"queuedId","required":true,"type":"text"},{"name":"sendKey","required":true,"type":"text"},{"localized":false,"name":"form","type":"text"},{"localized":false,"name":"notification","type":"text"},{"name":"notificationName","type":"text"},{"name":"state","type":"text"},{"name":"attempts","type":"number"},{"name":"retries","type":"number"},{"name":"changedAt","type":"date"},{"name":"cancel","type":"json"},{"name":"cancelRequested","type":"json"},{"name":"retiredBy","type":"text"},{"name":"configured","type":"json"},{"name":"recipients","type":"json"},{"name":"requestedBy","type":"text"},{"name":"resend","type":"text"}]',1,0,0,NULL,NULL,'{"record":false}',NULL,NULL,'plugin:@nextlyhq/plugin-form-builder',1,NULL,'0779c8813feb5a919d2c2e40ed279cc893a7a9ea856e779e4c3c9adfb0416640',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('4888ab7c-aeb4-4589-bda1-d0ca4090b587','form-submissions','{"singular":"Submission","plural":"Submissions"}','dc_form_submissions','View and manage form submissions','[{"admin":{"description":"The form this submission belongs to","readOnly":true},"label":"Form","name":"form","relationTo":"forms","required":true,"type":"relationship"},{"admin":{"description":"The submitted form data as JSON","readOnly":true},"label":"Submission Data","name":"data","required":true,"type":"json"},{"admin":{"description":"Track whether this submission has been reviewed"},"defaultValue":"new","index":true,"label":"Status","name":"status","options":[{"label":"New","value":"new"},{"label":"Read","value":"read"},{"label":"Archived","value":"archived"},{"label":"Spam","value":"spam"}],"required":true,"type":"select"},{"admin":{"description":"Which spam check flagged this submission (empty for clean submissions)","readOnly":true},"label":"Spam Reason","name":"spamReason","type":"text"},{"admin":{"description":"Notes visible only to admins (not shown to submitter)"},"label":"Internal Notes","name":"notes","type":"textarea"},{"admin":{"description":"IP address of the submitter","readOnly":true},"label":"IP Address","name":"ipAddress","type":"text"},{"admin":{"description":"Browser/device information of the submitter","readOnly":true},"label":"User Agent","name":"userAgent","type":"text"},{"admin":{"hidden":true},"label":"Page","name":"page","type":"textarea"},{"admin":{"description":"When the form was submitted","readOnly":true},"index":true,"label":"Submitted At","name":"submittedAt","required":true,"type":"date"},{"admin":{"description":"When an admin last edited the submitted data","readOnly":true},"label":"Edited At","name":"editedAt","type":"date"},{"admin":{"description":"ID of the admin who last edited the submitted data","readOnly":true},"label":"Edited By","name":"editedBy","type":"text"},{"admin":{"hidden":true},"label":"One-response key","localized":false,"name":"responseKey","type":"text"},{"admin":{"hidden":true},"label":"Fields asked","name":"asked","type":"json"},{"admin":{"hidden":true},"label":"Sender","name":"title","type":"text"}]',1,0,0,NULL,NULL,'{"record":false}','{"group":"Forms","useAsTitle":"title","isPlugin":true,"disableCreate":true,"order":51,"components":{"views":{"Edit":{"Component":"@nextlyhq/plugin-form-builder/admin#SubmissionPage"},"List":{"Component":"@nextlyhq/plugin-form-builder/admin#SubmissionsView"}}}}',NULL,'plugin:@nextlyhq/plugin-form-builder',1,NULL,'6335712e6584ae42de074501c22a31e8b4bde2543c7e512003708f3efc9593f0',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('ff163d62-61db-4de8-800b-e47add150511','form-uploads','{"singular":"Form upload","plural":"Form uploads"}','dc_form_uploads',NULL,'[{"localized":false,"name":"media","required":true,"type":"text"},{"localized":false,"name":"form","required":true,"type":"text"},{"name":"field","required":true,"type":"text"},{"localized":false,"name":"submission","type":"text"},{"name":"releasedAt","type":"date"}]',1,0,0,NULL,NULL,'{"record":false}',NULL,NULL,'plugin:@nextlyhq/plugin-form-builder',1,NULL,'ac95228adc18eecf6702f32e049e2887f3113374eed27648f58581a338325e3f',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('d800e2ce-2662-4ab6-b959-c3c35d5bb9f3','forms','{"singular":"Form","plural":"Forms"}','dc_forms','Create and manage your form templates using the visual form builder. Create and manage forms for collecting user submissions','[{"admin":{"description":"Internal name for this form (not shown to users)"},"label":"Form Name","name":"name","required":true,"type":"text"},{"admin":{"description":"URL-friendly identifier. Used in API: /api/forms/{slug}"},"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"admin":{"description":"Internal notes about this form''s purpose"},"label":"Description","name":"description","type":"textarea"},{"admin":{"description":"Form field configuration. Managed by the Form Builder UI."},"defaultValue":[],"label":"Form Fields","name":"fields","required":true,"type":"json"},{"fields":[{"admin":{"description":"Text displayed on the form submit button"},"defaultValue":"Submit","label":"Submit Button Text","name":"submitButtonText","type":"text"},{"admin":{"description":"What happens after a successful form submission"},"defaultValue":"message","label":"After Submission","name":"confirmationType","options":[{"label":"Show Message","value":"message"},{"label":"Redirect to URL","value":"redirect"},{"label":"Redirect to Page","value":"relationship"}],"type":"select"},{"admin":{"condition":{"equals":"message","field":"settings.confirmationType"},"description":"Message shown after successful submission"},"defaultValue":"Thank you for your submission!","label":"Success Message","name":"successMessage","type":"textarea"},{"admin":{"condition":{"equals":"redirect","field":"settings.confirmationType"},"description":"URL to redirect to after submission"},"label":"Redirect URL","name":"redirectUrl","type":"text"},{"admin":{"condition":{"equals":"relationship","field":"settings.confirmationType"},"description":"Select a page to redirect to after submission"},"label":"Redirect Page","name":"redirectPage","relationTo":["pages"],"type":"relationship"},{"admin":{"hidden":true},"label":"Allow Multiple Submissions","name":"allowMultipleSubmissions","type":"checkbox"},{"label":"One response per person","name":"oneResponse","options":[{"label":"Allow several responses","value":"off"},{"label":"One per email address","value":"email"},{"label":"One per browser","value":"browser"},{"label":"One per network (IP address)","value":"ip"}],"type":"select"},{"label":"Email field for one response per person","name":"oneResponseField","type":"text"},{"admin":{"hidden":true},"defaultValue":0,"label":"One-response version","name":"oneResponseVersion","type":"number"},{"admin":{"hidden":true},"label":"One-response keys made for version","name":"oneResponseKeyedVersion","type":"number"},{"admin":{"description":"Per-form honeypot override; unset inherits the plugin default"},"label":"Honeypot","name":"honeypotEnabled","type":"checkbox"},{"admin":{"hidden":true},"label":"Enable reCAPTCHA","name":"captchaEnabled","type":"checkbox"},{"label":"Bot check","name":"botCheck","options":[{"label":"Site default","value":"default"},{"label":"Off","value":"off"},{"label":"reCAPTCHA","value":"recaptcha"},{"label":"Turnstile","value":"turnstile"}],"type":"select"},{"label":"Closes at","name":"closesAt","type":"date"},{"label":"Submission limit","min":1,"name":"submissionLimit","type":"number"},{"defaultValue":true,"label":"Store IP address and browser","name":"storeIpAndBrowser","type":"checkbox"},{"label":"Keep submissions for (days)","min":1,"name":"keepDays","type":"number"},{"label":"Internal note","name":"internalNote","type":"textarea"},{"admin":{"condition":{"equals":true,"field":"settings.captchaEnabled"},"description":"Override the default reCAPTCHA site key for this form"},"label":"reCAPTCHA Site Key","name":"captchaSiteKey","type":"text"}],"label":"Form Settings","name":"settings","type":"group"},{"admin":{"description":"Email notification rules. Managed by the Form Builder UI."},"defaultValue":[],"label":"Notifications","name":"notifications","type":"json"},{"admin":{"description":"Only published forms can receive submissions. Closed forms display a message instead."},"defaultValue":"draft","label":"Status","name":"status","options":[{"label":"Draft","value":"draft"},{"label":"Published","value":"published"},{"label":"Closed","value":"closed"}],"required":true,"type":"select"},{"admin":{"description":"When this form first went live. Written once and never changed.","readOnly":true},"label":"First Published","name":"wentLiveAt","type":"date"},{"admin":{"condition":{"equals":"closed","field":"status"},"description":"Message shown when form status is ''closed''"},"defaultValue":"This form is no longer accepting submissions.","label":"Closed Form Message","name":"closedMessage","type":"textarea"}]',1,0,0,NULL,NULL,NULL,'{"group":"Forms","useAsTitle":"name","isPlugin":true,"order":50,"components":{"views":{"Edit":{"Component":"@nextlyhq/plugin-form-builder/admin#FormBuilderView"}}}}',NULL,'plugin:@nextlyhq/plugin-form-builder',1,NULL,'5a578f2b745016e46ea3657b3d54e09ff12bc8755351484ace308b1e510d63ff',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('d37a2241-7311-406d-b86b-08a2e8727e8f','layouts','{"singular":"Header & footer set","plural":"Header & footer"}','dc_layouts',NULL,'[{"name":"title","required":true,"type":"text"},{"localized":false,"name":"slug","required":true,"type":"text","unique":true},{"name":"description","type":"textarea"},{"fields":[{"name":"area","options":[{"label":"Header","value":"header"},{"label":"Footer","value":"footer"}],"required":true,"type":"select"},{"name":"component","relationTo":"components","required":true,"type":"relationship"}],"name":"areas","type":"repeater"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"hidden":true,"useAsTitle":"title","pagination":{"defaultLimit":10,"limits":[10,25,50,100]},"components":{"BeforeListTable":"@nextlyhq/plugin-page-builder/admin#LayoutListTools"}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'9f54922cbb0eaf858d0392bd216d06a7c478bc8114cd5ab799231e9c8b75620b',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('9e64d651-6dcf-4b6f-866d-04a799399fa8','nx_pb_address_claims','{"singular":"Address claim","plural":"Address claims"}','dc_nx_pb_address_claims','Which document holds each served address. Maintained automatically.','[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Claim key","localized":false,"name":"claimKey","required":true,"type":"text","unique":true},{"index":true,"label":"Kind","localized":false,"name":"kind","required":true,"type":"text"},{"label":"Locale","localized":false,"name":"locale","type":"text"},{"label":"Path","localized":false,"name":"path","type":"textarea"},{"index":true,"label":"Holder collection","localized":false,"name":"holderCollection","type":"text"},{"index":true,"label":"Holder id","localized":false,"name":"holderId","type":"text"},{"index":true,"label":"Space","localized":false,"name":"space","type":"text"},{"index":true,"label":"Blocked by","localized":false,"name":"blockedBy","type":"text"}]',0,0,0,NULL,NULL,'{"record":false}','{"hidden":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'8de6f4426cda5d37ee85d440bf70cf74258b36994c39f96b0a6aa26bdf98a1f2',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('b624fda9-1cbb-40df-abe0-286a5b31b197','nx_pb_class_usage','{"singular":"Class usage","plural":"Class usage"}','dc_nx_pb_class_usage','No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.','[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Scope","localized":false,"name":"scope","type":"text"},{"label":"Entity","localized":false,"name":"entity","type":"text"},{"index":true,"label":"Entity key","localized":false,"name":"entityKey","type":"text"},{"label":"Field","localized":false,"name":"field","type":"text"},{"label":"Locale","localized":false,"name":"locale","type":"text"},{"label":"Variant","localized":false,"name":"variant","type":"text"},{"index":true,"label":"Class id","localized":false,"name":"classId","type":"text"}]',0,0,0,NULL,NULL,'{"record":false}','{"hidden":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'097355078d3cdff17284a917aba3f65a628cf18532561d57270fac46d554b261',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('a9985015-15b4-4a58-9ee9-f0771006c3d7','nx_pb_component_retired','{"singular":"Retired component field","plural":"Retired component fields"}','dc_nx_pb_component_retired','Fields removed from components. Maintained automatically when a component is published.','[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"localized":false,"name":"identity","required":true,"type":"text","unique":true},{"index":true,"localized":false,"name":"componentId","required":true,"type":"text"},{"localized":false,"name":"kind","required":true,"type":"text"},{"localized":false,"name":"exposureId","required":true,"type":"textarea"}]',0,0,0,NULL,NULL,'{"record":false}','{"hidden":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'acaf1e1f5553f49a23e1e868045655032f62f7782ee899b2a1b3ac74d783a71e',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('b7d58f65-687b-4236-badf-52e1d925dadb','nx_pb_component_usage','{"singular":"Component usage","plural":"Component usage"}','dc_nx_pb_component_usage','No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.','[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Scope","localized":false,"name":"scope","type":"text"},{"label":"Entity","localized":false,"name":"entity","type":"text"},{"index":true,"label":"Entity key","localized":false,"name":"entityKey","type":"text"},{"label":"Field","localized":false,"name":"field","type":"text"},{"label":"Locale","localized":false,"name":"locale","type":"text"},{"label":"Variant","localized":false,"name":"variant","type":"text"},{"label":"Kind","localized":false,"name":"kind","type":"text"},{"index":true,"label":"Component id","localized":false,"name":"componentId","type":"text"}]',0,0,0,NULL,NULL,'{"record":false}','{"hidden":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'36ce808b133ef5c9e6ec6cdf729238823fcee558f3e423400d6365d9d69c066b',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('a30547cf-6f86-4dd8-b774-3c984a93c03b','nx_pb_usage_backfill','{"singular":"Usage backfill","plural":"Usage backfill"}','dc_nx_pb_usage_backfill','No longer used. The page builder keeps its usage index progress elsewhere, and nothing reads these rows.','[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"index":true,"label":"Scope key","localized":false,"name":"scopeKey","type":"text"},{"index":true,"label":"Generation","localized":false,"name":"generation","type":"text"}]',0,0,0,NULL,NULL,'{"record":false}','{"hidden":true,"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'52cb3df6ca6a996ae81c74e0dc2964785a89000a9e98046978224f4a30057909',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('496e2681-1f77-4b14-b3a8-6f0bb7bc4517','pages','{"singular":"Page","plural":"Pages"}','dc_pages',NULL,'[{"name":"title","required":true,"type":"text"},{"name":"slug","required":true,"type":"text","unique":true},{"label":"Page Builder","name":"content","type":"blocks"},{"admin":{"description":"Leave empty to use the site''s default header & footer set.","hidden":true},"label":"Header & footer","name":"layout","relationTo":"layouts","type":"relationship"},{"admin":{"hidden":true},"defaultValue":false,"label":"No header or footer","name":"noHeaderFooter","type":"checkbox"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"useAsTitle":"title","pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'8c4db2ea8a7cc335c49460cd47a2e4bcc6f9d18551265ad8c10aa455dfdfe79a',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('de745a22-51c7-48cd-8b04-465a5b036d95','patterns','{"singular":"Saved section","plural":"Saved sections"}','dc_patterns',NULL,'[{"name":"title","required":true,"type":"text"},{"localized":false,"name":"slug","required":true,"type":"text","unique":true},{"name":"description","type":"textarea"},{"name":"category","type":"text"},{"name":"keywords","type":"text"},{"name":"granularity","options":[{"label":"element","value":"element"},{"label":"group","value":"group"},{"label":"section","value":"section"},{"label":"page","value":"page"}],"required":true,"type":"select"},{"blocks":{"kinds":["pattern"]},"label":"Saved section","name":"content","type":"blocks"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"hidden":true,"useAsTitle":"title","pagination":{"defaultLimit":10,"limits":[10,25,50,100]},"components":{"BeforeListTable":"@nextlyhq/plugin-page-builder/admin#TransferImport"}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'e9c577d0f3fc82d2caa8342275a071942f4b92e6ff3ed6dcd9a138a0b195a313',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('96f77dec-c228-409c-90fd-36db9fc43e38','posts','{"singular":"Post","plural":"Posts"}','dc_posts',NULL,'[{"name":"title","required":true,"type":"text"},{"name":"slug","required":true,"type":"text","unique":true},{"name":"excerpt","type":"textarea"},{"name":"metaTitle","type":"text"},{"name":"metaDescription","type":"text"},{"admin":{"description":"Choose how to build this post''s body."},"defaultValue":"standard","label":"Editor","name":"editorMode","options":[{"label":"Standard editor","value":"standard"},{"label":"Page Builder","value":"page-builder"}],"type":"select"},{"admin":{"condition":{"equals":"standard","field":"editorMode"}},"name":"content","type":"richText"},{"admin":{"description":"Runs when this post is rendered.","language":"typescript"},"name":"customScript","type":"code"},{"admin":{"description":"Arbitrary per-post configuration."},"name":"settings","type":"json"},{"admin":{"condition":{"equals":"page-builder","field":"editorMode"}},"blocks":{"allow":["core/*"]},"name":"sections","type":"blocks"},{"hasMany":true,"name":"categories","relationTo":"categories","type":"relationship"},{"hasMany":true,"name":"tags","relationTo":"tags","type":"relationship"},{"name":"featuredImage","relationTo":"media","type":"upload"},{"name":"publishedAt","type":"date"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"useAsTitle":"title","pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'code',1,NULL,'58ad88c3c41de147d5158ee231bc1fedf1e412ab634ccebd3f1c96b70a81aa2b',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('65d0d5e5-08bc-44c3-b6ef-0c56a6b2f63a','tags','{"singular":"Tag","plural":"Tags"}','dc_tags',NULL,'[{"name":"title","required":true,"type":"text"},{"name":"slug","required":true,"type":"text","unique":true},{"name":"description","type":"textarea"}]',1,0,0,NULL,NULL,NULL,'{"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'code',1,NULL,'200bd33fa25e12a7c3744ab96cd121402cd32bb6af4a0413911a737bab950a94',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_collections" ("id", "slug", "labels", "table_name", "description", "fields", "timestamps", "status", "localized", "versions", "revalidate", "webhooks", "admin", "hooks", "source", "locked", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('ac43d90a-f400-42d7-9283-447d25548a1c','templates','{"singular":"Collection template","plural":"Collection templates"}','dc_templates',NULL,'[{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"maxLength":255,"name":"title","required":true,"type":"text"},{"admin":{"component":"@nextlyhq/plugin-page-builder/admin#TemplateCollectionField","condition":{"equals":"","field":"entry"},"description":"The collection whose entries this template draws. A collection has one template, and it cannot be changed once the template exists."},"label":"Collection","localized":false,"name":"collection","type":"text","unique":true},{"admin":{"description":"The entry this design serves, when it is an entry''s own design rather than its collection''s template. Set when it is made, and never changed.","hidden":true},"label":"Entry","localized":false,"name":"entry","type":"text","unique":true},{"admin":{"hidden":true},"index":true,"label":"Entry''s collection","localized":false,"name":"entryCollection","type":"text"},{"admin":{"hidden":true},"label":"Entry id","localized":false,"name":"entryId","type":"text"},{"admin":{"hidden":true},"index":true,"label":"Copied from","localized":false,"name":"forkedFrom","type":"text"},{"admin":{"component":"@nextlyhq/plugin-page-builder/admin#TemplateAddressField","condition":{"equals":"","field":"entry"},"description":"Where this collection''s entries are served: with /blog, the entry hello is served at /blog/hello once the template is published. Changing it moves every entry to the new address and frees the old ones.","placeholder":"/blog"},"label":"Address","localized":false,"maxLength":255,"name":"address","type":"text","unique":true},{"blocks":{"kinds":["template"]},"label":"Collection template","name":"content","type":"blocks"}]',1,1,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,'{"hidden":true,"useAsTitle":"title","defaultColumns":["title","collection","address","status"],"pagination":{"defaultLimit":10,"limits":[10,25,50,100]}}',NULL,'plugin:@nextlyhq/plugin-page-builder',1,NULL,'3949d5829f15fbc49a505c57c53cce5543a11a81c81c7bb1408c871f7883be2b',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_components" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "localized", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('2f34ba1e-cb3f-4824-a331-10eec4d37ba7','seo','SEO Metadata','comp_seo',NULL,'[{"label":"Meta Title","name":"metaTitle","type":"text"},{"label":"Meta Description","name":"metaDescription","type":"textarea"},{"label":"OG Image","name":"ogImage","relationTo":"media","type":"upload"}]','{"category":"Shared","description":"Search-engine and social-share metadata."}','code',1,1,'components/seo.ts','b42685ed7e2e672728c80c48271817c2d4b8b958d789f6355536f4bba02d13f7',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('4f4f6e2a-9711-4bcb-b29c-b6cea677d5b9','announcement','Announcement','single_announcement',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Campaign","localized":false,"name":"campaign","type":"text"},{"label":"Headline","name":"headline","type":"text"},{"label":"Body","name":"body","type":"textarea"}]','{}','code',1,1,1,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'383af6a2a438d655a05f247e3505a7a49158601211a53fa2fd63bba4bf99cc77',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('31a376b9-418b-4ea9-9c61-98c10df8ca83','homepage','Homepage','single_homepage',NULL,'[{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"name":"title","type":"text"},{"blocks":{"allow":["core/*"]},"label":"Layout","name":"layout","type":"blocks"}]','{}','code',1,0,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'5d793e3ec0ba01cd60314dedc10e877554cde735e7218d69a2cc207229abaf24',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('868af150-a568-40cb-8a06-de60b6c365b1','landing-page','Landing Page','single_landing_page',NULL,'[{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"name":"title","type":"text"},{"blocks":{"allow":["core/*"]},"label":"Hero section","name":"hero","type":"blocks"}]','{}','code',1,1,0,'{"enabled":true,"drafts":{"enabled":false,"autosave":{"enabled":false,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'0f6e230b923e46a497101a43d5535df61d034f9f992d09efb5e598af25777309',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('f60ff239-fb11-42e9-b416-3302c719aa75','page-builder-settings','Page Builder Settings','single_page_builder_settings',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"admin":{"readOnly":true},"label":"Default header & footer set","name":"defaultLayout","relationTo":"layouts","type":"relationship"},{"admin":{"hidden":true,"readOnly":true},"label":"Seeded header & footer set","name":"seededLayout","relationTo":"layouts","type":"relationship"},{"admin":{"hidden":true,"readOnly":true},"label":"Default changed by","localized":false,"name":"defaultLayoutChangedBy","type":"text"}]','{"description":"The header & footer set pages are drawn inside when they choose none of their own. Set from the Header & footer list.","hidden":true}','code',1,0,0,NULL,NULL,NULL,NULL,'a58a522c82c355c911beb7d23484bdb5bdb8dfa2becbb64b8b1fde3d0efbedf1',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('2f38ccec-c1f0-4e01-92fc-d682ec6b4e98','page-builder-site-code','Site Code','single_page_builder_site_code',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"admin":{"readOnly":true},"label":"Head","localized":false,"name":"headSource","type":"textarea"},{"admin":{"readOnly":true},"label":"End of body","localized":false,"name":"bodySource","type":"textarea"},{"admin":{"hidden":true,"readOnly":true},"label":"Head entries","name":"head","type":"json"},{"admin":{"hidden":true,"readOnly":true},"label":"End of body entries","name":"body","type":"json"},{"admin":{"hidden":true,"readOnly":true},"label":"Changed by","localized":false,"name":"changedBy","type":"text"}]','{"description":"Code added to every page of the site. Changed in Settings, under Site.","hidden":true}','code',1,0,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'1db6be20129d2bc9d385389e63d4ac1d047990f074b4fbabd767cc4b002db9e7',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('b8cb31b9-605e-492a-a651-0f002b52f604','site-settings','Site Settings','single_site_settings',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"label":"Site Name","localized":false,"name":"siteName","required":true,"type":"text"},{"label":"Tagline","name":"tagline","type":"textarea"},{"component":"seo","label":"Default SEO","name":"seo","type":"component"}]','{}','code',1,0,1,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'8ea4ce97622df5c31d0a9663202a201da90ad6668d3cee173a4c3ac7e18db581',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "dynamic_singles" ("id", "slug", "label", "table_name", "description", "fields", "admin", "source", "locked", "status", "localized", "versions", "revalidate", "webhooks", "config_path", "schema_hash", "schema_version", "migration_status", "last_migration_id", "created_by", "created_at", "updated_at") VALUES('f82f0e0e-6957-43a4-bd57-4ef2096d74a5','site-style','Site Style','single_site_style',NULL,'[{"label":"Title","localized":false,"name":"title","required":true,"type":"text"},{"label":"Slug","localized":false,"name":"slug","required":true,"type":"text","unique":true},{"admin":{"description":"A token set: { tokens: [{ id?, name, label?, kind, values: { light, dark? }, fluid?: { small, large }, group? }], prefix?, darkMode?, fluidRange?: { min, max }, order?: [identity], builtInColoursShown?: boolean, siteText?: { body?, h1?…h6?, link?, button?, caption? } }. Values are per mode; \"light\" is what a reader with no mode set resolves. `id` is the token''s stable identity — set it once and a later rename of `name` leaves every page that references the token working; omit it and the name is the identity. `fluid` is the two sizes in px a fluid size was made from, and `fluidRange` the screen widths in px it grows between (360 to 1280 when absent). `group` is the named group a colour is listed under and `order` the identities of the colours in the order they are listed, both display-only. `builtInColoursShown: false` leaves the built-in colours the site does not use out of the Design panel and the colour pickers; they are still written on every page. `siteText` sets the text of every page: each row holds `fontFamily`, `fontSize` and `lineHeight` (a variable reference such as { $token: \"font-size.h2\" } or a value; the Body font is `body.fontFamily` set to { $token: \"font.body\" } and the Headings font is `fontFamily` set to { $token: \"font.heading\" } on every heading row), and the `link` row `color`, `hoverColor` and `underline` (\"always\", \"hover\" or \"never\") instead; a row left out keeps its built-in value."},"label":"Design tokens","name":"tokens","type":"json"},{"admin":{"description":"Self-hosted @font-face definitions: [{ family, src: [{ url, format? }], weight?, style? }]. Files must live on this site."},"label":"Font faces","name":"fonts","type":"json"},{"admin":{"description":"Reusable style presets: [{ id, slug, label?, orderIndex, styles, locked? }]. Documents reference a class by id; a later orderIndex overrides an earlier one. `label` is the name authors see; `locked: true` holds the class as it is until it is unlocked."},"label":"Named classes","name":"classes","type":"json"},{"admin":{"description":"The site''s breakpoints: { viewport: [{ id, label, maxWidth? }], container: [...] }. Ids must be unique across both axes; the base breakpoint has no maxWidth."},"label":"Breakpoints","name":"breakpoints","type":"json"}]','{"description":"Site-wide design tokens, fonts, classes and breakpoints for pages built from blocks.","icon":"Palette"}','code',1,0,0,'{"enabled":true,"drafts":{"enabled":true,"autosave":{"enabled":true,"intervalMs":1000}},"maxPerDoc":50}',NULL,NULL,NULL,'c565a9373778365db99ffc4f99f2d4f00a3356adbe7e14b9c97fb6fb459959c8',1,'applied',NULL,NULL,1795409227,1795409227);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('196f52e8b9ee9af8a1f6efc7643944f765b59ece49f624bdc9442804ce7b3469','nextly:authors',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('e610992ebb64c532e52a1bf8965e68ddc39624a9aedfa029ed9e022e7fda1b90','nextly:block-pages',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('6e1d0f3ee1e7a4e57e7b9c9f849b827d5fb9630b7a4aed557c0aa4241c5b0d25','nextly:categories',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('4bc3f91485047dd868569cd04c78536223036443f6944cd35e5a080e4af3c784','nextly:components',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('3f6055ebf4e2e790d78cdec59abebc514a12efe3ba2eac83fbdc9d14477b86b6','nextly:form-submission-resends',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('b55bd0b602d772cda029806d44dfd6cff9d79e036fe671b68d1cca4b626eb3fc','nextly:form-submission-sends',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('e43a21fe5f8326f2b558d2bf0f9511eb8ab154830dbc21c7c30cbfab956f4d46','nextly:form-submissions',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('dc89a5f5fb2d249a7a19d6f90d8a4570c52f6a17c6107180c04c9a3cb540ea08','nextly:form-uploads',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('8f0a1fe2cbeca15a2e8f48e423da6b8926c7dd0d9ec056ba9cb4da0dc10beda3','nextly:forms',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('1ae6c0cba0a90552d7ef46de27b6d4c9d50050c2f37df2ced0bf528a651e514d','nextly:layouts',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('90ddf72aa37d60f19135fcac40945c3d3ef70a8ba2fa3e07baef09db333268a5','nextly:nx_pb_address_claims',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('b40f545e925b03821fdc21ff42d85f26925a1613087ebdde038f187ba56547ab','nextly:nx_pb_class_usage',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('0934dd1d2250257e0c815e4f1bf8444689faf1773dd32c669194e72d119f4480','nextly:nx_pb_component_retired',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('345827994938fb50297f0c43a5954c56a77c506ecff30871504d50bf1558b3b0','nextly:nx_pb_component_usage',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('1fb73701362b2ddd37ce5a48c537f404d5bf76bc892e63854c83f4e9e9e4255c','nextly:nx_pb_usage_backfill',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('f7336b4be5e930dbee8010131d536479b9e24a7a5023c8eb9dbd50a20ea61172','nextly:pages',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('ab4f77ac592b98f0fb738cc32d879e0b3962e07d008ed4d85458cb8639a8e752','nextly:patterns',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('8b0c6efbe48b7f60bc93a0120f901e50e6f12253b0c4c3d0df7825491cd024a4','nextly:posts',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('3605cc0ff8c05260d0520356db39c189864f60d1b2ff0bfcf57328fd74d38a46','nextly:tags',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('eb5895cd9d57f56cc4353e8320ee8318c5c0a50f043740fa3d65bb0fd1640cf2','nextly:templates',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('42154262594900e3715c2c2eb56e8d20dd8c29a97b11c7d8b106ead41e484245','nextly:single:announcement',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('ec788ab296ed5baa48a7611054330223cb52d36b333f7c46f53b90c360c8dfed','nextly:single:homepage',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('c78830075125ee97a521f7a78edb8dea657e4fafcd2a24d31cbf1f3260d6311c','nextly:single:landing-page',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('6237ef38c37ab913772883cda6cea0eeca6e617b1d07ea50ee48119a24aea5a0','nextly:single:page-builder-settings',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('8418a57f7e6cb6f51937a9a617fa96b9f8c58523ffe62150870c8e4e5f48b687','nextly:single:page-builder-site-code',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('da349ada08ecfa4c18881030e9b062ff97533a6b0396908514a734fbe3df70e8','nextly:single:site-settings',1795409229679);
INSERT INTO "nextly_cache_tag_expiries" ("id", "tag", "expired_at") VALUES('d84dbfa1c24f9b12ac60a6f6bccd86d52e3e7e0b1dc14b687a57acae8bb5ad85','nextly:single:site-style',1795409229679);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('registry_record','{"point":null,"baseline":{"collections":{},"singles":{},"fieldGroups":{},"permissions":[],"ownedPermissions":[]}}',1795409226);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('schema_version','{"migration":"20261123_044656_955_unique_localization_pages","seq":1}',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('public-read-upgrade-notice','"not-due"',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('preset-grants-grandfathered','{"collections":{}}',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('preset_grants_release','{"release":"0.0.2-alpha.79"}',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('collections-closed-to-super-admin-in-code','{"collections":{}}',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('public-role-created','"created"',1795409227);
INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES('public-role-granted','{"role":"e5ed396a-58e3-4750-9fef-4f5da3f5a936","granted":["018eae8f-588f-46e0-aa8e-3db5866a0f9e","3ba55e28-78a6-47e3-8f8f-b7822d3e46c9","3e46ca97-83b3-4fb4-8188-410290811d78","44dd9af2-a595-4c59-931d-4072e034d13a","4f9168e9-851d-40a9-b92e-79444fdf38d4","78e7f408-436b-46e2-ba4e-e160aabce1dc","b94efeea-ada0-4c89-823d-b9965dedb39e","eced415b-c198-45d7-b5fe-0faa7ca5f829"],"declared":{"018eae8f-588f-46e0-aa8e-3db5866a0f9e":{"action":"create","resource":"form-submissions","owner":"@nextlyhq/plugin-form-builder"}}}',1795409227);
INSERT INTO "nextly_rbac_epoch" ("id", "revision", "generation", "updated_at") VALUES('global',8,'846a8086-b96f-4925-9563-b388bbe8d5b8',1795409227);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('fcce5bd0-ab75-43ac-b580-fb311061d96b','core_apply','applied','cli-migrate',NULL,NULL,'core',NULL,1795409225833,1795409225837,NULL,NULL,NULL,NULL,249,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('02b3e52c-5e48-429c-902c-e2136c7a0fa5','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping','5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac',NULL,NULL,1795409225942,1795409225962,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('a5ba259d-ab68-4bcd-9fb5-cb7f474d1d65','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals','b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231',NULL,NULL,1795409225983,1795409225992,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('ce806a74-07ed-42d0-9a0d-504e523352d6','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs','55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337',NULL,NULL,1795409226013,1795409226019,NULL,NULL,NULL,NULL,4,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('abe3aad9-8315-40e1-ae08-a7b6f52e3325','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options','b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897',NULL,NULL,1795409226040,1795409226048,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('6f058317-140e-4199-a145-d8bf8f26e6c3','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals','c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8',NULL,NULL,1795409226070,1795409226078,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('536ccb4d-924d-4fc0-82c8-01b2eb73c4b7','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments','2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c',NULL,NULL,1795409226100,1795409226105,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('740d406b-d8e5-456c-843b-1dcfa0641321','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables','261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b',NULL,NULL,1795409226134,1795409226147,NULL,NULL,NULL,NULL,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('e1e16e7f-7a80-4d77-93c2-ef701a429535','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes','bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e',NULL,NULL,1795409226181,1795409226189,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('89316b7f-91d8-4093-8d92-b542a85214ed','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table','677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6',NULL,NULL,1795409226233,1795409226244,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('1dded31b-66ba-489e-81da-37f5f6603faf','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables','ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05',NULL,NULL,1795409226277,1795409226291,NULL,NULL,NULL,NULL,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('6ed7a5d5-a3f7-428d-8340-63554d718620','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261112_193109_764_seed_composition_graph_lock','3d0cd7df9937f5d849c10da3c55b5adbfe788d92601a4b33c802fe99607cb1e6',NULL,NULL,1795409226316,1795409226318,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('df2ad506-388a-408a-a892-ae3699f241a2','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261117_054612_570_create_binding_uses_table','c7dba671d14bfc919719e1d6e7e2c612b53a0fec9dd00ca9f801748964999a04',NULL,NULL,1795409226348,1795409226353,NULL,NULL,NULL,NULL,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('4e137c00-258a-4121-9485-95ab87e35e5b','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261117_132736_174_reset_binding_uses_fill','3c20140487117e9d3909b63ade314ba5b916c76e5387412dbbd5b4b125a592c6',NULL,NULL,1795409226380,1795409226383,NULL,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('027b0c8c-e88e-46bc-9ce6-02439a5e6a60','file_apply','applied','cli-migrate','plugin:@nextlyhq/plugin-page-builder/20261117_184525_129_add_class_usage_blocks','50fbafe7caae279444ebb426966a5f6f45c8e914ee8cf43125e058f4a31332ab',NULL,NULL,1795409226403,1795409226409,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('b0623467-d89a-49ea-8918-a5d44a51cb26','file_apply','applied','cli-migrate','plugin:reading-lists-fixture/20261113_140950_391_create_reading_lists','5a4183056fe82c090a2a3777dd5f40d3ca86c9dbac8acf4ab050ccbb8213a4c8',NULL,NULL,1795409226425,1795409226431,NULL,NULL,NULL,NULL,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('4ade5ac7-4e35-41f4-80af-0a041aee24a0','file_apply','applied','cli-migrate','20261123_044656_930_baseline.sql','b89e04346496be5b8493856794548db335dcff480c73add49caa21d14a5a5748',NULL,NULL,1795409227024,1795409227025,NULL,NULL,NULL,NULL,136,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('dc8fe224-fe8a-4689-bd46-4372149b400f','file_apply','applied','cli-migrate','20261123_044656_931_create_localization_posts.sql','43f159e5bf3da833a4d051e6c86affb50a3a5bcff0e31c255ec80cde039fe414',NULL,NULL,1795409227037,1795409227038,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('1497327b-0764-4c7d-a837-299fdd28b77f','file_apply','applied','cli-migrate','20261123_044656_932_create_localization_categories.sql','a1feeff269cb1f5367f519657cc0eb1d5a9c0542cf0b2d6e3dbccc88dc7a1e9e',NULL,NULL,1795409227041,1795409227042,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('41b71efd-e1a2-451a-99c7-9ce04950c150','file_apply','applied','cli-migrate','20261123_044656_933_create_localization_tags.sql','18c2274bc248fd8c44e64206df634f88f9b74dfbe48f41cd4643a052cfba233d',NULL,NULL,1795409227045,1795409227046,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('98535e02-508e-49ac-8379-13634a570bbe','file_apply','applied','cli-migrate','20261123_044656_934_create_localization_block-pages.sql','36825ca57c37146213b18f259fcb3ba3fe7d8391fbdbd67fd565a2b6b924738f',NULL,NULL,1795409227049,1795409227050,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('13187bdd-91ca-4fa8-b031-0ab3087c0721','file_apply','applied','cli-migrate','20261123_044656_935_create_localization_authors.sql','6e6c0a5505cca03be755316a1225bc398f9ab52828a3439cc0b9363cc9274b27',NULL,NULL,1795409227054,1795409227054,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('fb32da42-60fe-41a6-b5a2-0093616585c9','file_apply','applied','cli-migrate','20261123_044656_936_create_localization_pages.sql','8e21fb688089aa4af19f5db31f91aa6788d9389c8d5b08ad5ecc4d8f200b64de',NULL,NULL,1795409227057,1795409227058,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('87df8fe0-cadc-4e27-a53d-5aa45715dd15','file_apply','applied','cli-migrate','20261123_044656_937_create_localization_patterns.sql','17b2e7acceebdbf3647808d5534bd37aba4fc621d5ab299fdc5c925ea515a2e3',NULL,NULL,1795409227061,1795409227062,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('83d68716-8be7-42ea-897f-dc71b18d756f','file_apply','applied','cli-migrate','20261123_044656_938_create_localization_components.sql','df26811587a482201984c51dc398271c5d4032811875ec018d3a12971a4a6e29',NULL,NULL,1795409227065,1795409227066,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('deb7cb80-658c-4572-9861-22133be39e7a','file_apply','applied','cli-migrate','20261123_044656_939_create_localization_layouts.sql','384e36592c2c46bf6230b3cbdae05dadfdff3631226c10bbd548507cb3dc5f6d',NULL,NULL,1795409227069,1795409227070,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('f1aee343-03f3-420a-955e-f613b39bae2d','file_apply','applied','cli-migrate','20261123_044656_940_create_localization_templates.sql','6d3671ecc9e40f8c1d724c43c2d75721b3a203c0e26a2563b19e05a9565884de',NULL,NULL,1795409227073,1795409227073,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('2eb052b7-3835-4521-9589-484a3c0f2058','file_apply','applied','cli-migrate','20261123_044656_941_create_localization_forms.sql','82d0b8eb062083232c021e8b62d5601a5d6c26f82a0d4c27bcdb80b07486d037',NULL,NULL,1795409227077,1795409227078,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('5b2f1d9b-0ad8-4257-ae4d-dc7d93464a80','file_apply','applied','cli-migrate','20261123_044656_942_create_localization_form-submissions.sql','a9f0737d1035f4061cd066b2dd6eb3d9583365b5010875b03dfa08c105921c11',NULL,NULL,1795409227081,1795409227081,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('37174e74-f36f-427b-97d9-64ad457e47ee','file_apply','applied','cli-migrate','20261123_044656_943_create_localization_form-submission-sends.sql','cfc0e9e43c53cf22da0c6a264696c729cf58557bf2fbb94c0ad486dba553724d',NULL,NULL,1795409227085,1795409227085,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('8ab2af35-5cd6-4fad-aaea-a2e9c936fb52','file_apply','applied','cli-migrate','20261123_044656_944_create_localization_form-uploads.sql','8c4c803af95a2319bc9f103578fabe74936e6a6e170e1b8a81c9008550b94752',NULL,NULL,1795409227088,1795409227089,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('4ddbc72e-ee2a-4bde-a766-302881376b6e','file_apply','applied','cli-migrate','20261123_044656_945_create_localization_form-submission-resends.sql','d9dd83150cf06524a5e266b0af233760c0ffb8074b0eb1f02b4650d8ca107d70',NULL,NULL,1795409227091,1795409227092,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('6afb52cb-031d-42a0-b4da-f433a8018b4c','file_apply','applied','cli-migrate','20261123_044656_946_create_localization_homepage.sql','4ad531f2fd9bedbcac8bcf2712b88d4a9f00edf21d08901dfdcf8d689486ac31',NULL,NULL,1795409227095,1795409227095,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('1771907e-7ddd-4f08-bcf9-b3f2f7beacc6','file_apply','applied','cli-migrate','20261123_044656_947_create_localization_landing-page.sql','bb3061c11d98520ce13df86eaccf97163fbd381e43a35173436d7dc1d85049b1',NULL,NULL,1795409227098,1795409227099,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('f0562912-2fd3-4faf-8f2e-209039aaabc4','file_apply','applied','cli-migrate','20261123_044656_948_create_localization_site-settings.sql','a9f59b5ca061f22938651a216d70d4496d3dc6ba1c73d5acc95a9217cf55dd49',NULL,NULL,1795409227102,1795409227102,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('ce4bf1d6-25d1-416f-a8c8-8fcfc189d2cf','file_apply','applied','cli-migrate','20261123_044656_949_create_localization_announcement.sql','0014a1f647a11b2bdcc7d25f621b822930aec90401e65904b859a9179abffb07',NULL,NULL,1795409227105,1795409227106,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('cfc66490-3e56-42f8-aea0-353bac13a62c','file_apply','applied','cli-migrate','20261123_044656_950_create_localization_seo.sql','7f60f79bfdbcd7d349c5b38270402ef8f9eb346858073fb2a734bd101e06c376',NULL,NULL,1795409227109,1795409227109,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('5cc2c3e1-23d6-4a1d-81b1-2979db2f1410','file_apply','applied','cli-migrate','20261123_044656_951_unique_localization_posts.sql','80a063e8f81de4d03bb92493defeff0141edaaedb371f3503574cdea6ab3b2c7',NULL,NULL,1795409227118,1795409227119,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('bcc582d6-d8d1-4dd2-94d0-1a4113be1001','file_apply','applied','cli-migrate','20261123_044656_952_unique_localization_categories.sql','196163daf2a2e82e5d8b45faf600f15e57da331fe1b9fc16a5e6ccb7629bc955',NULL,NULL,1795409227125,1795409227126,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('382d8fd1-c5ee-47fd-ae1b-70ee1a4ebfae','file_apply','applied','cli-migrate','20261123_044656_953_unique_localization_tags.sql','8630c8b552a28bcadb9650f3efe74b34e187fadf0719f7eaacbf9638276d6b50',NULL,NULL,1795409227140,1795409227141,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('75d79b1e-aee0-474b-8f9b-59c46893aeb0','file_apply','applied','cli-migrate','20261123_044656_954_unique_localization_block-pages.sql','1e666f4c9c6998e468f75dcc46e68827b76b425f253b6e7c8b5a44758bd901a6',NULL,NULL,1795409227146,1795409227146,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_events" ("id", "event_type", "status", "source", "filename", "sha256", "scope_kind", "scope_slug", "started_at", "ended_at", "duration_ms", "applied_by", "note", "statements_planned", "statements_executed", "renames_applied", "error_code", "error_message", "error_json", "superseded_event_ids", "superseded_at", "superseded_by") VALUES('c3b2dc6e-3a94-4edf-9ba9-73b048718e09','file_apply','applied','cli-migrate','20261123_044656_955_unique_localization_pages.sql','31d45dcd1a6ac86cbfdd1a4d58741dd7af19b3b260d6e45ee8295b40d6f8fe1f',NULL,NULL,1795409227151,1795409227152,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__usage_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409225,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__usage_progress','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409225,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__layout_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409225,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__component_deletions','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__component_deletion_hosts','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__site_options','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__breakpoint_removals','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__breakpoint_removal_fragments','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__class_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__component_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__token_usage','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__binding_issues','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__binding_report_runs','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('page_builder__binding_uses','table','','plugin','@nextlyhq/plugin-page-builder','plugin:@nextlyhq/plugin-page-builder','0.0.2-alpha.79',12,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('reading__lists','table','','plugin','reading-lists-fixture','plugin:reading-lists-fixture','0.0.0',1,'active',1795409226,1795409226);
INSERT INTO "nextly_schema_owners" ("table_name", "element_kind", "element_name", "owner_kind", "owner_id", "migrated_by", "owner_version", "schema_version", "state", "created_at", "updated_at") VALUES('reading__list_items','table','','plugin','reading-lists-fixture','plugin:reading-lists-fixture','0.0.0',1,'active',1795409226,1795409226);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d63b80d8-fa07-4bef-b1a6-cdd22249ad55','Create Users','create-users','create','users','Permission to create users',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('2a61bea3-2e6d-42ef-b3d7-731c40f3b838','Read Users','read-users','read','users','Permission to read users',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('15d5cad4-6fa4-41dd-a595-65864a0aa20a','Update Users','update-users','update','users','Permission to update users',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ea6142e3-0765-4e2b-8a65-15679e3f9e96','Delete Users','delete-users','delete','users','Permission to delete users',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('912b047b-4405-44e5-801e-c6fc01142134','Create Roles','create-roles','create','roles','Permission to create roles',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1430feb7-bee4-40c7-93c4-5191ea130b7a','Read Roles','read-roles','read','roles','Permission to read roles',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('f75355cd-6a52-496f-bd3f-193ee3679292','Update Roles','update-roles','update','roles','Permission to update roles',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7ee39aff-1d0b-4789-b606-b21a68a249a8','Delete Roles','delete-roles','delete','roles','Permission to delete roles',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('6cebc783-a03c-4139-a1e0-3aebf622334b','Create Media','create-media','create','media','Permission to upload media files',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('44dd9af2-a595-4c59-931d-4072e034d13a','Read Media','read-media','read','media','Permission to view media files',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('89645c9f-8517-4e62-9d85-fda3a5cad4a7','Update Media','update-media','update','media','Permission to edit media metadata and move files',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4e784be1-2a73-4be3-9fbc-f2e95a8423f2','Delete Media','delete-media','delete','media','Permission to delete media files',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('5864d4a4-8475-417e-9ebc-a4f678e8c5ce','Read Settings','read-settings','read','settings','Permission to read system settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('2180d767-71f6-43d1-998a-24c122ba3331','Create Settings','create-settings','create','settings','Permission to add settings such as user fields and field groups',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('43035bf8-2b44-48ba-8e24-67447e9f3967','Update Settings','update-settings','update','settings','Permission to change system settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('6f0ad989-226e-4c5e-b537-09e80bf6b26c','Delete Settings','delete-settings','delete','settings','Permission to remove settings such as user fields and field groups',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d99d8aac-3220-4d6d-ae9d-94cde3f23aca','Create Email Providers','create-email-providers','create','email-providers','Permission to create email providers',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a67d39e6-2f99-4438-b1a9-4f5fb24b79ee','Read Email Providers','read-email-providers','read','email-providers','Permission to read email providers',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('122d9e28-6e51-490d-a429-44febfaa4a07','Update Email Providers','update-email-providers','update','email-providers','Permission to change email providers',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('715404a4-5a10-483e-866f-0ae47129efcc','Delete Email Providers','delete-email-providers','delete','email-providers','Permission to delete email providers',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4caab913-60e4-494d-9069-11e338392386','Create Email Templates','create-email-templates','create','email-templates','Permission to create email templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('75d763a0-9108-43ec-b068-3f27767caf52','Read Email Templates','read-email-templates','read','email-templates','Permission to read email templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b8ff40cc-0c34-4284-a5b7-0a0a5fa51c9d','Update Email Templates','update-email-templates','update','email-templates','Permission to change email templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9bc6eb93-b3f4-4e53-863d-c5fa1d8156b4','Delete Email Templates','delete-email-templates','delete','email-templates','Permission to delete email templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3077615c-c6ea-44ef-adfa-84bb422c8509','Update API Keys','update-api-keys','update','api-keys','Permission to update API keys',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4415d300-ddd1-4709-be91-700abda972a7','Create API Keys','create-api-keys','create','api-keys','Permission to create API keys',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('24e67645-1be6-4f35-8de6-45caf9df814a','Read API Keys','read-api-keys','read','api-keys','Permission to read API keys',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('aef90a34-79e7-4725-9bcc-13aa055c8663','Delete API Keys','delete-api-keys','delete','api-keys','Permission to delete API keys',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4c8b3ade-5fca-4a0e-b0bf-160564132b46','Update Webhooks','update-webhooks','update','webhooks','Permission to update webhook endpoints',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d0a9d5ec-7f5b-4cc4-87c0-91e088fa1b4e','Create Webhooks','create-webhooks','create','webhooks','Permission to register webhook endpoints',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c42410ad-a95f-4db1-8438-f1b04626191e','Read Webhooks','read-webhooks','read','webhooks','Permission to view webhook endpoints',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('18c627b0-cc7b-4fcd-953c-18e0227f87fa','Delete Webhooks','delete-webhooks','delete','webhooks','Permission to delete webhook endpoints',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d2ca09b5-748f-44e1-bce9-6f7b511f6291','Read Releases','read-content-releases','read','content-releases','Permission to view content releases and their members',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('abe1633b-9a3a-41a6-9774-7cb5ed6db20d','Create Releases','create-content-releases','create','content-releases','Permission to create a content release and choose its members',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7a45e030-1a04-4653-82a3-5fb2fbf2a906','Publish Releases','publish-content-releases','publish','content-releases','Permission to schedule or cancel a content release, which is what makes its content go live',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d90bc0e4-2a14-42ee-bdb7-d917125cd780','Update Releases','update-content-releases','update','content-releases','Permission to rename a content release and change its description',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('f5e23176-e3df-40f1-8d65-c03fc0ee0e4d','Delete Releases','delete-content-releases','delete','content-releases','Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('07cb8ca2-4393-46ac-abd4-03d61bf2adff','Read Email Deliveries','read-email-deliveries','read','email-deliveries','Permission to see the email delivery log and queued email',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('2e65eba4-dfe1-4d58-a636-0c1fd2708941','Manage Email Deliveries','manage-email-deliveries','manage','email-deliveries','Permission to cancel a queued email, and to have one sent again where a plugin offers it',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('bf39d8d1-bec2-4ff6-a267-de9bdb58eb41','Manage Background Jobs','manage-background-jobs','manage','background-jobs','Permission to run the background job queue by hand, outside its schedule',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('6766ac8f-7ca1-488d-b537-a47d5ad59195','Create Authors','create-authors','create','authors','Permission to create authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('e04089f4-3547-40b9-a889-c837c419ce7f','Read Authors','read-authors','read','authors','Permission to read authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('93a6a36f-758c-4ac2-afc8-79f2024b3af6','Update Authors','update-authors','update','authors','Permission to update authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b0351f07-019d-493f-bacc-62b8775f36d1','Delete Authors','delete-authors','delete','authors','Permission to delete authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('23a353f1-c84a-4baa-a456-9dacb45b2bf3','Publish Authors','publish-authors','publish','authors','Permission to publish authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4fd995b1-5f8a-4f96-acab-dafbe46276e5','Unpublish Authors','unpublish-authors','unpublish','authors','Permission to unpublish authors',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b4296111-5623-4230-85b5-25dc08d2746c','Create Block Pages','create-block-pages','create','block-pages','Permission to create block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3e46ca97-83b3-4fb4-8188-410290811d78','Read Block Pages','read-block-pages','read','block-pages','Permission to read block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('6a7df2c3-ab4f-43dd-89d3-617bb6576e3c','Update Block Pages','update-block-pages','update','block-pages','Permission to update block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('63b67c6c-6b94-4096-94e9-19cb2a541325','Delete Block Pages','delete-block-pages','delete','block-pages','Permission to delete block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('f769fc40-9a7d-454d-ba0a-8d67ec38cb1e','Publish Block Pages','publish-block-pages','publish','block-pages','Permission to publish block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0570f3ae-81a7-4316-a8cd-68768fc04936','Unpublish Block Pages','unpublish-block-pages','unpublish','block-pages','Permission to unpublish block pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('25e13ab1-de12-4b8f-9e03-e01bd32cfb8b','Create Categories','create-categories','create','categories','Permission to create categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('8e0f6335-5070-4dce-bde6-abbddfb8921a','Read Categories','read-categories','read','categories','Permission to read categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1613cf56-4a25-4faa-b924-e8871b4a82f4','Update Categories','update-categories','update','categories','Permission to update categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1a8a5469-4718-41eb-8880-fe4a9d3dd749','Delete Categories','delete-categories','delete','categories','Permission to delete categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('6dbdd9b6-e5f4-4705-b3b7-00ab114e7c10','Publish Categories','publish-categories','publish','categories','Permission to publish categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('84b3ca23-a453-4bdf-912d-c0a3db60ee47','Unpublish Categories','unpublish-categories','unpublish','categories','Permission to unpublish categories',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ed8a70fa-c8ed-448a-8ef9-92df08f237ff','Create Components','create-components','create','components','Permission to create components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('08e7eaf9-62ec-450e-99ff-4736ef61b67f','Read Components','read-components','read','components','Permission to read components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('e006887b-0be4-4d66-967b-4ac154807a71','Update Components','update-components','update','components','Permission to update components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d7ba2374-818b-4db1-8c80-10e4490eb5cc','Delete Components','delete-components','delete','components','Permission to delete components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ef26b4f0-8932-48f0-9e77-adf67ef920d4','Publish Components','publish-components','publish','components','Permission to publish components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9597f721-d4b4-4987-be5d-1859043d12f0','Unpublish Components','unpublish-components','unpublish','components','Permission to unpublish components',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9a18345a-6116-46f9-89df-a1d3b8f6bd67','Create Form Submission Resends','create-form-submission-resends','create','form-submission-resends','Permission to create form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3570f4c5-a631-4e9b-b88c-8b9f62f3dda8','Read Form Submission Resends','read-form-submission-resends','read','form-submission-resends','Permission to read form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('e234aea6-4eed-4fb7-8037-1f29d8369674','Update Form Submission Resends','update-form-submission-resends','update','form-submission-resends','Permission to update form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('25c0877c-2dac-4880-86ed-afc134a235f0','Delete Form Submission Resends','delete-form-submission-resends','delete','form-submission-resends','Permission to delete form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b221b1e5-15eb-4ecf-b770-8d09bb7a15aa','Publish Form Submission Resends','publish-form-submission-resends','publish','form-submission-resends','Permission to publish form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('fac166d1-dc2e-41db-a76c-ec7d52e6dff0','Unpublish Form Submission Resends','unpublish-form-submission-resends','unpublish','form-submission-resends','Permission to unpublish form submission resends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a2bc8bed-df3b-49b0-99cb-d388b2ad970c','Create Form Submission Sends','create-form-submission-sends','create','form-submission-sends','Permission to create form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('fa17c8a0-a815-4277-8d32-ae0b1eb0dd7e','Read Form Submission Sends','read-form-submission-sends','read','form-submission-sends','Permission to read form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('f82657b0-19f2-4ee5-86d0-d03286bd5d05','Update Form Submission Sends','update-form-submission-sends','update','form-submission-sends','Permission to update form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('108fe23e-830d-434a-8919-41435af10c0d','Delete Form Submission Sends','delete-form-submission-sends','delete','form-submission-sends','Permission to delete form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('738bd0b7-0891-4c89-9f51-a378dc8c0373','Publish Form Submission Sends','publish-form-submission-sends','publish','form-submission-sends','Permission to publish form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ff2007a5-87e2-4e70-bccc-cd1e5d1e7ebe','Unpublish Form Submission Sends','unpublish-form-submission-sends','unpublish','form-submission-sends','Permission to unpublish form submission sends',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('018eae8f-588f-46e0-aa8e-3db5866a0f9e','Create Form Submissions','create-form-submissions','create','form-submissions','Permission to create form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d30d9793-e859-4069-be44-d61d07092f1c','Read Form Submissions','read-form-submissions','read','form-submissions','Permission to read form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('2933c508-d413-4193-8dcc-215539f5bd77','Update Form Submissions','update-form-submissions','update','form-submissions','Permission to update form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('267a923d-cc7a-4d6d-897f-36402f608f68','Delete Form Submissions','delete-form-submissions','delete','form-submissions','Permission to delete form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4fb104bb-2748-43f2-a169-575d5effe07e','Publish Form Submissions','publish-form-submissions','publish','form-submissions','Permission to publish form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3170869b-8390-4387-8369-4dcf99407e78','Unpublish Form Submissions','unpublish-form-submissions','unpublish','form-submissions','Permission to unpublish form submissions',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('92394795-146c-4b27-b2ef-42234e332a89','Create Form Uploads','create-form-uploads','create','form-uploads','Permission to create form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d2cee325-9b81-4956-8538-24d008f23712','Read Form Uploads','read-form-uploads','read','form-uploads','Permission to read form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('36965c12-d194-4bce-a039-2f8490946ea6','Update Form Uploads','update-form-uploads','update','form-uploads','Permission to update form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('71ed9322-4e1e-4510-9d1d-e0af54d563e6','Delete Form Uploads','delete-form-uploads','delete','form-uploads','Permission to delete form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('519d0a95-5bc5-4c38-85c1-49e6025c4e68','Publish Form Uploads','publish-form-uploads','publish','form-uploads','Permission to publish form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4607ec4b-f2ac-43e2-8902-bf1a8dc2dcc9','Unpublish Form Uploads','unpublish-form-uploads','unpublish','form-uploads','Permission to unpublish form uploads',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('01b8f78e-f8ed-4cc2-a29f-29501fe835c6','Create Forms','create-forms','create','forms','Permission to create forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('78e7f408-436b-46e2-ba4e-e160aabce1dc','Read Forms','read-forms','read','forms','Permission to read forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7330d818-f2b2-41ab-89b0-e53b1ab1d08a','Update Forms','update-forms','update','forms','Permission to update forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('cb747252-e182-444c-ae98-6ef4da946f85','Delete Forms','delete-forms','delete','forms','Permission to delete forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('73629a65-5db4-4a43-891e-2156e3d59421','Publish Forms','publish-forms','publish','forms','Permission to publish forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('59c97a50-a82e-4601-8b6e-d0d1901f5658','Unpublish Forms','unpublish-forms','unpublish','forms','Permission to unpublish forms',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('96e60f4b-8898-406e-b0ba-ddbe632728c0','Create Layouts','create-layouts','create','layouts','Permission to create layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('418f4988-5b0c-455e-994b-a9fc1842431a','Read Layouts','read-layouts','read','layouts','Permission to read layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a31294b5-b617-4201-9fb3-32816ece3e60','Update Layouts','update-layouts','update','layouts','Permission to update layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('079dc5f9-226d-4243-a32c-c7705636ce01','Delete Layouts','delete-layouts','delete','layouts','Permission to delete layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('61af032d-8598-4b8d-a47a-446a6495eaf7','Publish Layouts','publish-layouts','publish','layouts','Permission to publish layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('274c5175-5da7-4aa2-9af4-3c6b3e5ed5f4','Unpublish Layouts','unpublish-layouts','unpublish','layouts','Permission to unpublish layouts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9db35af3-86c3-4a26-9cc9-fb55366ffc96','Create Nx_pb_address_claims','create-nx_pb_address_claims','create','nx_pb_address_claims','Permission to create nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0a46897b-5078-43b6-8c46-38dc9a5904a2','Read Nx_pb_address_claims','read-nx_pb_address_claims','read','nx_pb_address_claims','Permission to read nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1ef7369e-512f-4218-bba1-759f4a6309de','Update Nx_pb_address_claims','update-nx_pb_address_claims','update','nx_pb_address_claims','Permission to update nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('54746c63-3cf0-4c87-8ccd-cc06219450d3','Delete Nx_pb_address_claims','delete-nx_pb_address_claims','delete','nx_pb_address_claims','Permission to delete nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('e5b71197-45d0-44e2-81a4-0e4e90995b4c','Publish Nx_pb_address_claims','publish-nx_pb_address_claims','publish','nx_pb_address_claims','Permission to publish nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a4409eab-70ab-4aca-b3d0-64109a451076','Unpublish Nx_pb_address_claims','unpublish-nx_pb_address_claims','unpublish','nx_pb_address_claims','Permission to unpublish nx_pb_address_claims',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b3547b34-74b7-4ab1-85a2-ea4470a97a78','Create Nx_pb_class_usage','create-nx_pb_class_usage','create','nx_pb_class_usage','Permission to create nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('06dd7502-0b1d-4305-a1b9-adb6ffd3af70','Read Nx_pb_class_usage','read-nx_pb_class_usage','read','nx_pb_class_usage','Permission to read nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('82719eeb-ff99-42eb-b2ea-50e408dd48aa','Update Nx_pb_class_usage','update-nx_pb_class_usage','update','nx_pb_class_usage','Permission to update nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0d19e80e-d8cc-4c58-aa99-623bb6e64185','Delete Nx_pb_class_usage','delete-nx_pb_class_usage','delete','nx_pb_class_usage','Permission to delete nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('5ecaaf26-5a15-40f6-bb52-5845b40c5f32','Publish Nx_pb_class_usage','publish-nx_pb_class_usage','publish','nx_pb_class_usage','Permission to publish nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c28b97e4-efeb-4489-867f-2f69574fe631','Unpublish Nx_pb_class_usage','unpublish-nx_pb_class_usage','unpublish','nx_pb_class_usage','Permission to unpublish nx_pb_class_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b57ff3cb-da5c-4e37-8a61-fd4673a64bec','Create Nx_pb_component_retired','create-nx_pb_component_retired','create','nx_pb_component_retired','Permission to create nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('5d95544c-bd6d-407b-8671-a723d3f496ff','Read Nx_pb_component_retired','read-nx_pb_component_retired','read','nx_pb_component_retired','Permission to read nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('af46e72b-66a2-4c00-ae01-235aa80f47b0','Update Nx_pb_component_retired','update-nx_pb_component_retired','update','nx_pb_component_retired','Permission to update nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('e1baeddb-d3a3-4e66-9d2f-06853479a8d8','Delete Nx_pb_component_retired','delete-nx_pb_component_retired','delete','nx_pb_component_retired','Permission to delete nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('f4b60112-63aa-43f8-8fec-8ab23a50be02','Publish Nx_pb_component_retired','publish-nx_pb_component_retired','publish','nx_pb_component_retired','Permission to publish nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b9d67fd3-01a1-4e9f-b0a7-03022a2ed442','Unpublish Nx_pb_component_retired','unpublish-nx_pb_component_retired','unpublish','nx_pb_component_retired','Permission to unpublish nx_pb_component_retired',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ffe743d4-6f30-40a3-90e7-ba258cbaecec','Create Nx_pb_component_usage','create-nx_pb_component_usage','create','nx_pb_component_usage','Permission to create nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0782e631-aafe-411a-b4ad-8f279c3b1fe8','Read Nx_pb_component_usage','read-nx_pb_component_usage','read','nx_pb_component_usage','Permission to read nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1e94fd04-bda8-4d02-8f71-57d97bbd545a','Update Nx_pb_component_usage','update-nx_pb_component_usage','update','nx_pb_component_usage','Permission to update nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3c8b2ab9-e16f-4ae3-a599-ac0dfce9b0ab','Delete Nx_pb_component_usage','delete-nx_pb_component_usage','delete','nx_pb_component_usage','Permission to delete nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('fdcc2e58-4139-423b-ad86-558efe9c0a59','Publish Nx_pb_component_usage','publish-nx_pb_component_usage','publish','nx_pb_component_usage','Permission to publish nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('65dbe6e5-f189-4baa-83af-83ef9a772ad3','Unpublish Nx_pb_component_usage','unpublish-nx_pb_component_usage','unpublish','nx_pb_component_usage','Permission to unpublish nx_pb_component_usage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1c03645b-1e5e-4bb2-8e9e-1c8cc6f58413','Create Nx_pb_usage_backfill','create-nx_pb_usage_backfill','create','nx_pb_usage_backfill','Permission to create nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a5ff9b18-005b-4b97-b98d-f4e66ad6f35a','Read Nx_pb_usage_backfill','read-nx_pb_usage_backfill','read','nx_pb_usage_backfill','Permission to read nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7c28149e-570d-461d-9e5d-329ea8f0adf5','Update Nx_pb_usage_backfill','update-nx_pb_usage_backfill','update','nx_pb_usage_backfill','Permission to update nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('83fe20aa-4cba-4d57-a62c-992091ba1a92','Delete Nx_pb_usage_backfill','delete-nx_pb_usage_backfill','delete','nx_pb_usage_backfill','Permission to delete nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ccfbaf3a-dc2e-4733-a933-a6ad5d1f3a7f','Publish Nx_pb_usage_backfill','publish-nx_pb_usage_backfill','publish','nx_pb_usage_backfill','Permission to publish nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('65767be7-1586-469e-9d63-f2597a61c6f1','Unpublish Nx_pb_usage_backfill','unpublish-nx_pb_usage_backfill','unpublish','nx_pb_usage_backfill','Permission to unpublish nx_pb_usage_backfill',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7c2fe751-1184-4e03-bdfa-0b1e4b327107','Create Pages','create-pages','create','pages','Permission to create pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b94efeea-ada0-4c89-823d-b9965dedb39e','Read Pages','read-pages','read','pages','Permission to read pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('7dbe2459-500e-4ad7-8c62-d125ac8192a9','Update Pages','update-pages','update','pages','Permission to update pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('b9e9f3dd-6e92-417e-9480-7db92a4e800c','Delete Pages','delete-pages','delete','pages','Permission to delete pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('bb1679d4-c107-4149-9f61-92c0f1fb5de2','Publish Pages','publish-pages','publish','pages','Permission to publish pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('71d70f68-2803-4159-a689-f29474baf254','Unpublish Pages','unpublish-pages','unpublish','pages','Permission to unpublish pages',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3371ce65-eab2-4998-a083-2f6dbb1de99f','Create Patterns','create-patterns','create','patterns','Permission to create patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('fe02a63c-1bdd-45ba-a327-b9bb110db578','Read Patterns','read-patterns','read','patterns','Permission to read patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9ccafce1-cb20-46bc-99b0-84ed6bb62455','Update Patterns','update-patterns','update','patterns','Permission to update patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('10c11f5c-1674-4ff7-9a53-8949f596da59','Delete Patterns','delete-patterns','delete','patterns','Permission to delete patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d7f8b993-7c64-4820-8fb1-1ba23e084479','Publish Patterns','publish-patterns','publish','patterns','Permission to publish patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('60d3802e-bea9-4e37-b750-4258e55d990d','Unpublish Patterns','unpublish-patterns','unpublish','patterns','Permission to unpublish patterns',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('072a70aa-4926-4ce0-900a-d58be7a3380e','Create Posts','create-posts','create','posts','Permission to create posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3ba55e28-78a6-47e3-8f8f-b7822d3e46c9','Read Posts','read-posts','read','posts','Permission to read posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('efc8a104-bd3f-40e9-9038-0860ffa2a39f','Update Posts','update-posts','update','posts','Permission to update posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9ab0bf17-f08c-48df-b4a8-e6207577dfdb','Delete Posts','delete-posts','delete','posts','Permission to delete posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c568f621-b84c-454f-8844-f4a1fa9cf54f','Publish Posts','publish-posts','publish','posts','Permission to publish posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('76973f81-deb3-4caf-ba59-0d5ec7ebca67','Unpublish Posts','unpublish-posts','unpublish','posts','Permission to unpublish posts',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('549cd3ff-0990-4740-8d69-f659e16fcc3f','Create Tags','create-tags','create','tags','Permission to create tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('514f4aac-323f-44b5-b5f3-e9c12e683093','Read Tags','read-tags','read','tags','Permission to read tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('5118334f-158c-4f4d-9db4-0fc2010f678a','Update Tags','update-tags','update','tags','Permission to update tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('14e713f5-ba16-4886-ad4c-1b8a379a839d','Delete Tags','delete-tags','delete','tags','Permission to delete tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('34380372-6194-4f2c-ba10-d2a41bd3c0af','Publish Tags','publish-tags','publish','tags','Permission to publish tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0148e327-9d5a-4e1e-8fa6-77b37214013d','Unpublish Tags','unpublish-tags','unpublish','tags','Permission to unpublish tags',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('585912f6-30cd-4705-a657-565a69278b5c','Create Templates','create-templates','create','templates','Permission to create templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('eced415b-c198-45d7-b5fe-0faa7ca5f829','Read Templates','read-templates','read','templates','Permission to read templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('9c9521b4-b04c-42c8-9594-9726a1bb0948','Update Templates','update-templates','update','templates','Permission to update templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('cbe08fde-1fb4-4d01-83e6-0f9336989da2','Delete Templates','delete-templates','delete','templates','Permission to delete templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1d4a8cfa-99df-4748-8d76-862e83f1f5f1','Publish Templates','publish-templates','publish','templates','Permission to publish templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('721bd466-0d9b-4e32-88ed-3ac8ff9a1420','Unpublish Templates','unpublish-templates','unpublish','templates','Permission to unpublish templates',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('dc848850-a761-4b7f-9700-7dbf12aec373','Read Announcement','read-announcement','read','announcement','Permission to read announcement',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1499ccc0-f047-4d5c-9762-49de4788ea25','Update Announcement','update-announcement','update','announcement','Permission to update announcement',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('70d33997-2520-4520-9459-aa2c4f3904b3','Publish Announcement','publish-announcement','publish','announcement','Permission to publish announcement',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('aa345ee4-41a9-44d0-8391-11e9c06e76d0','Unpublish Announcement','unpublish-announcement','unpublish','announcement','Permission to unpublish announcement',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4f9168e9-851d-40a9-b92e-79444fdf38d4','Read Homepage','read-homepage','read','homepage','Permission to read homepage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('a67bee97-eb18-432e-8dea-2ea555d11375','Update Homepage','update-homepage','update','homepage','Permission to update homepage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('5279ae1d-2313-4ec8-b9f5-4932f0716361','Publish Homepage','publish-homepage','publish','homepage','Permission to publish homepage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('2715213e-4da8-4648-96ca-da4180ac8762','Unpublish Homepage','unpublish-homepage','unpublish','homepage','Permission to unpublish homepage',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('3f97ce9a-75cb-4b1e-8791-ad5df572b4a4','Read Landing Page','read-landing-page','read','landing-page','Permission to read landing page',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c2ce68f3-3a25-4922-9797-224796c3cbe8','Update Landing Page','update-landing-page','update','landing-page','Permission to update landing page',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('83c059fb-d1c2-4184-b089-73aac3b007b5','Publish Landing Page','publish-landing-page','publish','landing-page','Permission to publish landing page',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0e8fdbe4-6e67-45be-9c46-bf768283eb00','Unpublish Landing Page','unpublish-landing-page','unpublish','landing-page','Permission to unpublish landing page',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4f375f0a-203d-4a4e-b5f9-aa72a0a12f3f','Read Page Builder Settings','read-page-builder-settings','read','page-builder-settings','Permission to read page builder settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('233a1788-c684-4a25-92ff-12c42217b8fc','Update Page Builder Settings','update-page-builder-settings','update','page-builder-settings','Permission to update page builder settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('561c2136-4318-426d-b28a-ea2a1cb1b34f','Publish Page Builder Settings','publish-page-builder-settings','publish','page-builder-settings','Permission to publish page builder settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c267a9da-2eab-4998-bc24-c7f98a2ad903','Unpublish Page Builder Settings','unpublish-page-builder-settings','unpublish','page-builder-settings','Permission to unpublish page builder settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4deac9d8-224e-411c-ac95-e8a5d6127571','Read Page Builder Site Code','read-page-builder-site-code','read','page-builder-site-code','Permission to read page builder site code',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('250832ca-abee-4ca4-8ef5-0ff54a6f742b','Update Page Builder Site Code','update-page-builder-site-code','update','page-builder-site-code','Permission to update page builder site code',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('0633c305-b299-4046-919a-4d664e559a29','Publish Page Builder Site Code','publish-page-builder-site-code','publish','page-builder-site-code','Permission to publish page builder site code',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('50c0d872-7aa0-4693-8af3-68d54fe93a09','Unpublish Page Builder Site Code','unpublish-page-builder-site-code','unpublish','page-builder-site-code','Permission to unpublish page builder site code',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('40078d0e-1986-4e52-9e54-86d4cf6fb910','Read Site Settings','read-site-settings','read','site-settings','Permission to read site settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('91e2131e-1de3-46ed-a21b-a5e24d791a6e','Update Site Settings','update-site-settings','update','site-settings','Permission to update site settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('13c84629-18dc-4fc6-b073-99982d9519a2','Publish Site Settings','publish-site-settings','publish','site-settings','Permission to publish site settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('ec8a3d5e-84c5-48f5-8f90-effa7170398b','Unpublish Site Settings','unpublish-site-settings','unpublish','site-settings','Permission to unpublish site settings',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d6e2a943-8673-4e30-9fe0-fb0fef6b7113','Read Site Style','read-site-style','read','site-style','Permission to read site style',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('05d543b0-e2a8-48be-b12d-40b7391a38da','Update Site Style','update-site-style','update','site-style','Permission to update site style',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('fe68950f-773f-454a-9b2e-74d3de306c67','Publish Site Style','publish-site-style','publish','site-style','Permission to publish site style',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('1e7960ba-5a75-4dea-9f9b-d44d51c433b9','Unpublish Site Style','unpublish-site-style','unpublish','site-style','Permission to unpublish site style',NULL,NULL,NULL,0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('60d072de-7adf-4ca7-bc57-415ca04fb635','Manage page builder site settings','manage-page-builder-site','manage','page-builder-site','Change the site''s breakpoints, and choose its default header & footer set.','@nextlyhq/plugin-page-builder',NULL,'General',0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('d26112e3-52d7-4547-8909-2ed910ba9b26','Lock shared styles','lock-page-builder-shared-styles','lock','page-builder-shared-styles','Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.','@nextlyhq/plugin-page-builder',NULL,'General',0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('c3a5d262-23e1-4936-b887-2f7566516465','Manage template routing','manage-template-routing','manage','template-routing','Set or change the address a collection''s entries are served at. A change moves every entry''s live address.','@nextlyhq/plugin-page-builder',NULL,'General',0,1795409227,1795409227);
INSERT INTO "permissions" ("id", "name", "slug", "action", "resource", "description", "owner", "orphaned_at", "permission_group", "danger", "created_at", "updated_at") VALUES('4c1882f5-d682-4a72-8ea1-5d9dcb2e2f0f','Export Submissions','export-submissions','export','submissions','Export form submissions as CSV/JSON','@nextlyhq/plugin-form-builder',NULL,'General',1,1795409227,1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c9271928-cea3-416d-9cf9-75541d49ee11','99893108-6e58-47cc-9f54-d07e06a43360','1499ccc0-f047-4d5c-9762-49de4788ea25',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('69ac9716-7569-4613-925b-2fd54cc4f609','99893108-6e58-47cc-9f54-d07e06a43360','70d33997-2520-4520-9459-aa2c4f3904b3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7391a884-9867-45b8-9b28-3bef3dbf89d7','99893108-6e58-47cc-9f54-d07e06a43360','aa345ee4-41a9-44d0-8391-11e9c06e76d0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4bb5f5aa-11fe-4fd7-95a0-5a7698807c74','99893108-6e58-47cc-9f54-d07e06a43360','dc848850-a761-4b7f-9700-7dbf12aec373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9376e562-bd8f-4876-8780-78a87ebe0011','99893108-6e58-47cc-9f54-d07e06a43360','24e67645-1be6-4f35-8de6-45caf9df814a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d3c5183c-84fa-475d-840e-edd64cfb7da5','99893108-6e58-47cc-9f54-d07e06a43360','3077615c-c6ea-44ef-adfa-84bb422c8509',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('09f1fc2b-31ba-4c83-8c43-ddda20a3d065','99893108-6e58-47cc-9f54-d07e06a43360','4415d300-ddd1-4709-be91-700abda972a7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a6bcbf34-4362-4f4b-8603-2147891eeac0','99893108-6e58-47cc-9f54-d07e06a43360','aef90a34-79e7-4725-9bcc-13aa055c8663',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('062cee76-06b3-4b8f-978b-39dd792893f0','99893108-6e58-47cc-9f54-d07e06a43360','bf39d8d1-bec2-4ff6-a267-de9bdb58eb41',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a68005e0-3649-409b-9a13-6e9dc4ac531d','99893108-6e58-47cc-9f54-d07e06a43360','08e7eaf9-62ec-450e-99ff-4736ef61b67f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dd982ffe-4a24-455f-8b7b-7c696694e7dc','99893108-6e58-47cc-9f54-d07e06a43360','9597f721-d4b4-4987-be5d-1859043d12f0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bd966ca5-ab06-45a5-838c-55f23858dec0','99893108-6e58-47cc-9f54-d07e06a43360','d7ba2374-818b-4db1-8c80-10e4490eb5cc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7e9b4256-10b2-4bfd-8e18-e73c60aac2c5','99893108-6e58-47cc-9f54-d07e06a43360','e006887b-0be4-4d66-967b-4ac154807a71',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e93d8d50-50b6-4384-940a-1f0d6dae3f57','99893108-6e58-47cc-9f54-d07e06a43360','ed8a70fa-c8ed-448a-8ef9-92df08f237ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e6687877-3881-45ac-a36d-c7b84ba7d24d','99893108-6e58-47cc-9f54-d07e06a43360','ef26b4f0-8932-48f0-9e77-adf67ef920d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('becea795-37f6-4ef4-a1dd-8e3fd7be7b81','99893108-6e58-47cc-9f54-d07e06a43360','7a45e030-1a04-4653-82a3-5fb2fbf2a906',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fe4df690-c5d9-4648-8c9f-a944b208353b','99893108-6e58-47cc-9f54-d07e06a43360','abe1633b-9a3a-41a6-9774-7cb5ed6db20d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('520c9787-7b21-4615-b950-ff9b452f4da1','99893108-6e58-47cc-9f54-d07e06a43360','d2ca09b5-748f-44e1-bce9-6f7b511f6291',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3ea7a0a4-f93c-49dc-a704-2e8050430943','99893108-6e58-47cc-9f54-d07e06a43360','d90bc0e4-2a14-42ee-bdb7-d917125cd780',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bcc6a054-3dfb-4455-ac8b-80c885dbff9f','99893108-6e58-47cc-9f54-d07e06a43360','f5e23176-e3df-40f1-8d65-c03fc0ee0e4d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fbf1b714-f52d-4f09-b8ba-faddcafb0532','99893108-6e58-47cc-9f54-d07e06a43360','07cb8ca2-4393-46ac-abd4-03d61bf2adff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2fae2ad2-9c91-46bf-a81d-37d2a52bd71e','99893108-6e58-47cc-9f54-d07e06a43360','2e65eba4-dfe1-4d58-a636-0c1fd2708941',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('55ba38b4-f470-4bbf-98dc-7fc3ac9f2a0c','99893108-6e58-47cc-9f54-d07e06a43360','122d9e28-6e51-490d-a429-44febfaa4a07',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8c1010fc-4434-411e-8c0c-9e4881285d7e','99893108-6e58-47cc-9f54-d07e06a43360','715404a4-5a10-483e-866f-0ae47129efcc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0c5254e6-e601-4e8e-b9d5-f94b183e1e61','99893108-6e58-47cc-9f54-d07e06a43360','a67d39e6-2f99-4438-b1a9-4f5fb24b79ee',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('67449ddf-4ca8-4775-b012-364f65a1b887','99893108-6e58-47cc-9f54-d07e06a43360','d99d8aac-3220-4d6d-ae9d-94cde3f23aca',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dd44ea53-9250-454f-97a2-34403f121dcf','99893108-6e58-47cc-9f54-d07e06a43360','4caab913-60e4-494d-9069-11e338392386',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f67c53f2-73db-4df5-a7d8-a4abd474d044','99893108-6e58-47cc-9f54-d07e06a43360','75d763a0-9108-43ec-b068-3f27767caf52',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('158bb48f-d747-44d4-835f-f215d275751f','99893108-6e58-47cc-9f54-d07e06a43360','9bc6eb93-b3f4-4e53-863d-c5fa1d8156b4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('53048068-a610-4023-8011-1f58c4c02929','99893108-6e58-47cc-9f54-d07e06a43360','b8ff40cc-0c34-4284-a5b7-0a0a5fa51c9d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d84adebe-0689-4200-8b86-af861bff8d2a','99893108-6e58-47cc-9f54-d07e06a43360','25c0877c-2dac-4880-86ed-afc134a235f0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('544dd587-78e2-4bf7-bee9-c614c26f9381','99893108-6e58-47cc-9f54-d07e06a43360','3570f4c5-a631-4e9b-b88c-8b9f62f3dda8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c429e859-1ffe-4d54-91c2-732fec5104e4','99893108-6e58-47cc-9f54-d07e06a43360','9a18345a-6116-46f9-89df-a1d3b8f6bd67',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b2dd102a-d63e-4a1b-9325-f09c78a2cdea','99893108-6e58-47cc-9f54-d07e06a43360','b221b1e5-15eb-4ecf-b770-8d09bb7a15aa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3bb2c352-0938-44e2-a661-6f075cb150e7','99893108-6e58-47cc-9f54-d07e06a43360','e234aea6-4eed-4fb7-8037-1f29d8369674',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('36177bf4-f744-4a23-aa76-2f3957018fe8','99893108-6e58-47cc-9f54-d07e06a43360','fac166d1-dc2e-41db-a76c-ec7d52e6dff0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('985eca75-b6e3-46b2-9adb-30f32bc555c9','99893108-6e58-47cc-9f54-d07e06a43360','108fe23e-830d-434a-8919-41435af10c0d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d8b33554-6381-4c1b-b74b-50edd30a197a','99893108-6e58-47cc-9f54-d07e06a43360','738bd0b7-0891-4c89-9f51-a378dc8c0373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8db6b3fd-9133-4f4e-88c7-2edb9b51ee64','99893108-6e58-47cc-9f54-d07e06a43360','a2bc8bed-df3b-49b0-99cb-d388b2ad970c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d8129fa2-8dc7-472f-9086-ddd4894900d1','99893108-6e58-47cc-9f54-d07e06a43360','f82657b0-19f2-4ee5-86d0-d03286bd5d05',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5b420403-27af-454e-a3fa-b4d9a568c853','99893108-6e58-47cc-9f54-d07e06a43360','fa17c8a0-a815-4277-8d32-ae0b1eb0dd7e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('62e55a26-d833-4f56-80ce-768e9297a5b2','99893108-6e58-47cc-9f54-d07e06a43360','ff2007a5-87e2-4e70-bccc-cd1e5d1e7ebe',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('89d2ce3c-b67c-45e6-ae39-d1ac6ebe88c3','99893108-6e58-47cc-9f54-d07e06a43360','018eae8f-588f-46e0-aa8e-3db5866a0f9e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1edab630-999b-4d66-a38b-96a55937bd47','99893108-6e58-47cc-9f54-d07e06a43360','267a923d-cc7a-4d6d-897f-36402f608f68',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('22085e59-6de4-49a6-a943-0455e2d71bf6','99893108-6e58-47cc-9f54-d07e06a43360','2933c508-d413-4193-8dcc-215539f5bd77',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('197a5fe0-62c1-4115-b3d7-2ca3d485ac5c','99893108-6e58-47cc-9f54-d07e06a43360','3170869b-8390-4387-8369-4dcf99407e78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1c86817e-d818-44e6-9c62-bbe0acb1c15d','99893108-6e58-47cc-9f54-d07e06a43360','4fb104bb-2748-43f2-a169-575d5effe07e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5c54cc7c-2833-4579-afe0-2af5c61eff14','99893108-6e58-47cc-9f54-d07e06a43360','d30d9793-e859-4069-be44-d61d07092f1c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b8cd2518-06da-4826-80a5-4f614240bffe','99893108-6e58-47cc-9f54-d07e06a43360','36965c12-d194-4bce-a039-2f8490946ea6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a1a639d9-bbef-4903-a00c-96c5a213a682','99893108-6e58-47cc-9f54-d07e06a43360','4607ec4b-f2ac-43e2-8902-bf1a8dc2dcc9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('459a18f8-d9a3-4dfe-a4ec-921d0b0a32be','99893108-6e58-47cc-9f54-d07e06a43360','519d0a95-5bc5-4c38-85c1-49e6025c4e68',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('00f003d0-dc27-48cf-a96c-1cdf5df6ce46','99893108-6e58-47cc-9f54-d07e06a43360','71ed9322-4e1e-4510-9d1d-e0af54d563e6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('708999d0-48bb-422f-a264-4504c4db8fee','99893108-6e58-47cc-9f54-d07e06a43360','92394795-146c-4b27-b2ef-42234e332a89',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('aef687cf-75cf-4aa6-99bb-cdcd08fb76fb','99893108-6e58-47cc-9f54-d07e06a43360','d2cee325-9b81-4956-8538-24d008f23712',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('636e75bb-3b37-4f23-b813-b67ccbdaaff1','99893108-6e58-47cc-9f54-d07e06a43360','01b8f78e-f8ed-4cc2-a29f-29501fe835c6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('582897fa-1316-4829-b6d3-05a3f18e56f4','99893108-6e58-47cc-9f54-d07e06a43360','59c97a50-a82e-4601-8b6e-d0d1901f5658',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fdd2a85c-19b5-4dd7-80d1-ee27bea27b03','99893108-6e58-47cc-9f54-d07e06a43360','7330d818-f2b2-41ab-89b0-e53b1ab1d08a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e1eb335b-6b48-4550-b4e7-34fd65cabee6','99893108-6e58-47cc-9f54-d07e06a43360','73629a65-5db4-4a43-891e-2156e3d59421',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ee4bf593-0f19-49eb-8b2b-0fed10fcc53f','99893108-6e58-47cc-9f54-d07e06a43360','78e7f408-436b-46e2-ba4e-e160aabce1dc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3d59706b-84ae-49cb-9cb1-bac2f4a0fe15','99893108-6e58-47cc-9f54-d07e06a43360','cb747252-e182-444c-ae98-6ef4da946f85',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c5fd651b-c189-491d-a8d4-0c1195724fec','99893108-6e58-47cc-9f54-d07e06a43360','2715213e-4da8-4648-96ca-da4180ac8762',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6caec70b-bbef-4e61-95fc-9cdaa7e218d2','99893108-6e58-47cc-9f54-d07e06a43360','4f9168e9-851d-40a9-b92e-79444fdf38d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('abce8cba-8fe8-4033-8210-9a50575a3083','99893108-6e58-47cc-9f54-d07e06a43360','5279ae1d-2313-4ec8-b9f5-4932f0716361',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b82d5b9c-096b-476b-bbcb-a99c133bf693','99893108-6e58-47cc-9f54-d07e06a43360','a67bee97-eb18-432e-8dea-2ea555d11375',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('10451ed6-318f-4cb4-9e7b-484990905820','99893108-6e58-47cc-9f54-d07e06a43360','0e8fdbe4-6e67-45be-9c46-bf768283eb00',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c2cccf35-0b60-4b7e-afdc-4e4c0c97df04','99893108-6e58-47cc-9f54-d07e06a43360','3f97ce9a-75cb-4b1e-8791-ad5df572b4a4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a74617af-74dd-485b-b9a4-05b7f91b2811','99893108-6e58-47cc-9f54-d07e06a43360','83c059fb-d1c2-4184-b089-73aac3b007b5',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('59ca7578-4830-4085-b830-a3cbb0f3ef07','99893108-6e58-47cc-9f54-d07e06a43360','c2ce68f3-3a25-4922-9797-224796c3cbe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('01a9f7c0-c96e-4935-8646-3ec690143ea2','99893108-6e58-47cc-9f54-d07e06a43360','079dc5f9-226d-4243-a32c-c7705636ce01',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ea091538-1b01-4082-a153-c1a6077b4a8b','99893108-6e58-47cc-9f54-d07e06a43360','274c5175-5da7-4aa2-9af4-3c6b3e5ed5f4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a4d53010-e7cc-4dd0-a6ff-42b331fd41c7','99893108-6e58-47cc-9f54-d07e06a43360','418f4988-5b0c-455e-994b-a9fc1842431a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ec7d3e57-ef39-4193-b119-c9928ef55b62','99893108-6e58-47cc-9f54-d07e06a43360','61af032d-8598-4b8d-a47a-446a6495eaf7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('08acc011-ffb6-429a-aa2a-b1bf2f709c9e','99893108-6e58-47cc-9f54-d07e06a43360','96e60f4b-8898-406e-b0ba-ddbe632728c0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('82db5f03-8159-4a9f-a47d-263a0b327b9a','99893108-6e58-47cc-9f54-d07e06a43360','a31294b5-b617-4201-9fb3-32816ece3e60',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e4508b2a-aff3-431b-ac8c-a639cebadc63','99893108-6e58-47cc-9f54-d07e06a43360','44dd9af2-a595-4c59-931d-4072e034d13a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d9efbc79-12a5-42b3-af31-6f79ac300e52','99893108-6e58-47cc-9f54-d07e06a43360','4e784be1-2a73-4be3-9fbc-f2e95a8423f2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2d84f62f-0498-4a72-ab24-426fd39c734c','99893108-6e58-47cc-9f54-d07e06a43360','6cebc783-a03c-4139-a1e0-3aebf622334b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d94ad4ea-3ae4-493f-831b-77c156569790','99893108-6e58-47cc-9f54-d07e06a43360','89645c9f-8517-4e62-9d85-fda3a5cad4a7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2852b0cb-3ffa-4fd2-90e3-4eab830519eb','99893108-6e58-47cc-9f54-d07e06a43360','0a46897b-5078-43b6-8c46-38dc9a5904a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('45efb7ec-80be-47fa-95a8-d495042d0b56','99893108-6e58-47cc-9f54-d07e06a43360','1ef7369e-512f-4218-bba1-759f4a6309de',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5c5dac42-3923-4ef4-9849-f9d6c5f1acc3','99893108-6e58-47cc-9f54-d07e06a43360','54746c63-3cf0-4c87-8ccd-cc06219450d3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('54369e17-e08d-43fb-9286-49a1805049a8','99893108-6e58-47cc-9f54-d07e06a43360','9db35af3-86c3-4a26-9cc9-fb55366ffc96',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('070e7812-75e0-4ed8-9f07-92d5546d3cd6','99893108-6e58-47cc-9f54-d07e06a43360','a4409eab-70ab-4aca-b3d0-64109a451076',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('288b5c70-3cd4-433e-9066-a0dafee0a385','99893108-6e58-47cc-9f54-d07e06a43360','e5b71197-45d0-44e2-81a4-0e4e90995b4c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9f64cc61-5b61-4ee7-af52-532c7f0c1c5b','99893108-6e58-47cc-9f54-d07e06a43360','06dd7502-0b1d-4305-a1b9-adb6ffd3af70',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ca4e1785-4657-4690-83a9-fa4885c08465','99893108-6e58-47cc-9f54-d07e06a43360','0d19e80e-d8cc-4c58-aa99-623bb6e64185',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6f67043e-5ee9-4ebc-9824-3c70e61af680','99893108-6e58-47cc-9f54-d07e06a43360','5ecaaf26-5a15-40f6-bb52-5845b40c5f32',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e42336bb-66f2-4caa-b00e-7ea5764dbf90','99893108-6e58-47cc-9f54-d07e06a43360','82719eeb-ff99-42eb-b2ea-50e408dd48aa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('74f74573-bc7b-4b76-ad6f-e35068352ada','99893108-6e58-47cc-9f54-d07e06a43360','b3547b34-74b7-4ab1-85a2-ea4470a97a78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d60c1e15-7d12-42b6-b368-ec978f86dec8','99893108-6e58-47cc-9f54-d07e06a43360','c28b97e4-efeb-4489-867f-2f69574fe631',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a1edc3c2-b4ca-4bed-b122-8522b93e217d','99893108-6e58-47cc-9f54-d07e06a43360','5d95544c-bd6d-407b-8671-a723d3f496ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dd1faae4-0243-4965-849e-cbff9cd50e1f','99893108-6e58-47cc-9f54-d07e06a43360','af46e72b-66a2-4c00-ae01-235aa80f47b0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('de148582-7e58-4fc5-9fac-75846772b030','99893108-6e58-47cc-9f54-d07e06a43360','b57ff3cb-da5c-4e37-8a61-fd4673a64bec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e95b0fec-ecb1-423a-b4cd-fa13232de1d7','99893108-6e58-47cc-9f54-d07e06a43360','b9d67fd3-01a1-4e9f-b0a7-03022a2ed442',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2c91129b-69b6-47e8-adb1-833246fa2381','99893108-6e58-47cc-9f54-d07e06a43360','e1baeddb-d3a3-4e66-9d2f-06853479a8d8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('708f99b6-a95e-4574-b4a2-3a6ec0d51ad7','99893108-6e58-47cc-9f54-d07e06a43360','f4b60112-63aa-43f8-8fec-8ab23a50be02',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('04e87ff1-c05e-4bf7-8748-9666a5ea51bf','99893108-6e58-47cc-9f54-d07e06a43360','0782e631-aafe-411a-b4ad-8f279c3b1fe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('047c8bbb-89ea-454b-a5ae-f63f7487aab4','99893108-6e58-47cc-9f54-d07e06a43360','1e94fd04-bda8-4d02-8f71-57d97bbd545a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1e96bb4e-4afd-4275-addb-eeeaa80d90d1','99893108-6e58-47cc-9f54-d07e06a43360','3c8b2ab9-e16f-4ae3-a599-ac0dfce9b0ab',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f92c826d-6eaf-42f4-83b5-96f963a41f9d','99893108-6e58-47cc-9f54-d07e06a43360','65dbe6e5-f189-4baa-83af-83ef9a772ad3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('41f2f0ad-9f1b-488e-8208-ad47fbc40364','99893108-6e58-47cc-9f54-d07e06a43360','fdcc2e58-4139-423b-ad86-558efe9c0a59',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e63f0da6-f0c7-41f9-8bbd-638315696d85','99893108-6e58-47cc-9f54-d07e06a43360','ffe743d4-6f30-40a3-90e7-ba258cbaecec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9233f07e-75e2-4e41-84fd-fcf3a2afaa92','99893108-6e58-47cc-9f54-d07e06a43360','1c03645b-1e5e-4bb2-8e9e-1c8cc6f58413',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f6b22a24-faa1-44ea-a952-b97ef1733c62','99893108-6e58-47cc-9f54-d07e06a43360','65767be7-1586-469e-9d63-f2597a61c6f1',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fea3e21c-368f-4c1d-b00b-6953fc8be44e','99893108-6e58-47cc-9f54-d07e06a43360','7c28149e-570d-461d-9e5d-329ea8f0adf5',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('33903308-734e-4e35-8e3c-af07bb19f724','99893108-6e58-47cc-9f54-d07e06a43360','83fe20aa-4cba-4d57-a62c-992091ba1a92',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bf5b28b1-ba67-452b-8e53-386923fad077','99893108-6e58-47cc-9f54-d07e06a43360','a5ff9b18-005b-4b97-b98d-f4e66ad6f35a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c5e98c34-b3c3-43ae-84a9-7105f468a587','99893108-6e58-47cc-9f54-d07e06a43360','ccfbaf3a-dc2e-4733-a933-a6ad5d1f3a7f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3fd27e62-2ebb-49d9-add4-2053557575c1','99893108-6e58-47cc-9f54-d07e06a43360','233a1788-c684-4a25-92ff-12c42217b8fc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5e00d174-5e64-4ded-9263-957c64542a03','99893108-6e58-47cc-9f54-d07e06a43360','4f375f0a-203d-4a4e-b5f9-aa72a0a12f3f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('54bce3db-f84e-4cf4-97c0-12a30714ffa2','99893108-6e58-47cc-9f54-d07e06a43360','561c2136-4318-426d-b28a-ea2a1cb1b34f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5709b298-e56b-4cb0-a05e-205cd124ffda','99893108-6e58-47cc-9f54-d07e06a43360','c267a9da-2eab-4998-bc24-c7f98a2ad903',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('76a81b10-6040-433e-939c-81f2ea841523','99893108-6e58-47cc-9f54-d07e06a43360','d26112e3-52d7-4547-8909-2ed910ba9b26',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2017d3fc-5d0a-41b9-bc1f-67deb0761499','99893108-6e58-47cc-9f54-d07e06a43360','60d072de-7adf-4ca7-bc57-415ca04fb635',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('61b3f9de-23e3-4648-9373-937448e1aa58','99893108-6e58-47cc-9f54-d07e06a43360','0633c305-b299-4046-919a-4d664e559a29',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2f5a5db7-ca01-42e9-bd68-4a9b27bb6e09','99893108-6e58-47cc-9f54-d07e06a43360','250832ca-abee-4ca4-8ef5-0ff54a6f742b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('214f0027-69fa-4c3a-8e0c-080bde642f16','99893108-6e58-47cc-9f54-d07e06a43360','4deac9d8-224e-411c-ac95-e8a5d6127571',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('86e0db3e-5c80-4402-8029-76bc65c164ce','99893108-6e58-47cc-9f54-d07e06a43360','50c0d872-7aa0-4693-8af3-68d54fe93a09',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7b729cb5-e5ad-4c79-bfa3-eecbead6eea7','99893108-6e58-47cc-9f54-d07e06a43360','71d70f68-2803-4159-a689-f29474baf254',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2019d680-0877-434e-a70d-058dbb81c103','99893108-6e58-47cc-9f54-d07e06a43360','7c2fe751-1184-4e03-bdfa-0b1e4b327107',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cb5c2bc8-1776-4405-8a46-f2b08202b278','99893108-6e58-47cc-9f54-d07e06a43360','7dbe2459-500e-4ad7-8c62-d125ac8192a9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d0627c69-9f7f-430d-a604-c8a32bf1afe5','99893108-6e58-47cc-9f54-d07e06a43360','b94efeea-ada0-4c89-823d-b9965dedb39e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('030eefce-5846-4dd5-8491-01a3fdf6ea19','99893108-6e58-47cc-9f54-d07e06a43360','b9e9f3dd-6e92-417e-9480-7db92a4e800c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('706d6a2e-13f6-4450-904d-0aa0bdea99e3','99893108-6e58-47cc-9f54-d07e06a43360','bb1679d4-c107-4149-9f61-92c0f1fb5de2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('816f442a-d679-4700-937b-47c1f01e121f','99893108-6e58-47cc-9f54-d07e06a43360','10c11f5c-1674-4ff7-9a53-8949f596da59',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4ae107af-7a6b-4a80-b25f-712bd4eb471a','99893108-6e58-47cc-9f54-d07e06a43360','3371ce65-eab2-4998-a083-2f6dbb1de99f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('aa8cb74a-3d05-490a-aede-b76d773a09d0','99893108-6e58-47cc-9f54-d07e06a43360','60d3802e-bea9-4e37-b750-4258e55d990d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('df9d16ff-efc0-497a-8c35-7f0f29306715','99893108-6e58-47cc-9f54-d07e06a43360','9ccafce1-cb20-46bc-99b0-84ed6bb62455',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6c3aec75-a451-48f0-bad9-e1b0eda8c369','99893108-6e58-47cc-9f54-d07e06a43360','d7f8b993-7c64-4820-8fb1-1ba23e084479',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1d8e7527-03f6-49d6-956b-7648a579ee4c','99893108-6e58-47cc-9f54-d07e06a43360','fe02a63c-1bdd-45ba-a327-b9bb110db578',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2d49c560-6686-44db-93a8-6071d12c86cd','99893108-6e58-47cc-9f54-d07e06a43360','1430feb7-bee4-40c7-93c4-5191ea130b7a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2abdbf53-be72-480e-89fe-158eca56c854','99893108-6e58-47cc-9f54-d07e06a43360','2180d767-71f6-43d1-998a-24c122ba3331',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a026999a-a817-4cf8-8d9b-9b5dbf1b57f1','99893108-6e58-47cc-9f54-d07e06a43360','43035bf8-2b44-48ba-8e24-67447e9f3967',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9b691538-3988-4ccf-99b1-35bf2e9b55fe','99893108-6e58-47cc-9f54-d07e06a43360','5864d4a4-8475-417e-9ebc-a4f678e8c5ce',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fc9b7beb-ab69-40a3-90b1-38c2b694b775','99893108-6e58-47cc-9f54-d07e06a43360','6f0ad989-226e-4c5e-b537-09e80bf6b26c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6bbfd175-e3d4-41be-9c71-5c7ebed8dc71','99893108-6e58-47cc-9f54-d07e06a43360','13c84629-18dc-4fc6-b073-99982d9519a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('982b98cd-6557-4d2a-8a8a-ebbfa0a953af','99893108-6e58-47cc-9f54-d07e06a43360','40078d0e-1986-4e52-9e54-86d4cf6fb910',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5702e348-721f-4d7d-a3e1-3f2125ae8a43','99893108-6e58-47cc-9f54-d07e06a43360','91e2131e-1de3-46ed-a21b-a5e24d791a6e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bce0f7a3-769e-498c-a3a5-536bb49da679','99893108-6e58-47cc-9f54-d07e06a43360','ec8a3d5e-84c5-48f5-8f90-effa7170398b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a2771f18-685d-4aac-8785-068b29d618b4','99893108-6e58-47cc-9f54-d07e06a43360','05d543b0-e2a8-48be-b12d-40b7391a38da',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5b3b2795-6a8b-4e6c-9174-5f05e85d466f','99893108-6e58-47cc-9f54-d07e06a43360','1e7960ba-5a75-4dea-9f9b-d44d51c433b9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3a5b89cf-89ae-452f-aa4f-e55bffe57e49','99893108-6e58-47cc-9f54-d07e06a43360','d6e2a943-8673-4e30-9fe0-fb0fef6b7113',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d9582268-4237-4db5-a02c-2641fb0ea45f','99893108-6e58-47cc-9f54-d07e06a43360','fe68950f-773f-454a-9b2e-74d3de306c67',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6e52e8d7-b405-4c22-9967-70cd57c0bfb8','99893108-6e58-47cc-9f54-d07e06a43360','4c1882f5-d682-4a72-8ea1-5d9dcb2e2f0f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('141bd1ae-1870-4442-ad5a-1e12976a7e17','99893108-6e58-47cc-9f54-d07e06a43360','c3a5d262-23e1-4936-b887-2f7566516465',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a6762d4b-1392-47f2-814f-eb442ebabc60','99893108-6e58-47cc-9f54-d07e06a43360','1d4a8cfa-99df-4748-8d76-862e83f1f5f1',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2469710a-e033-48a1-8697-fee6231766da','99893108-6e58-47cc-9f54-d07e06a43360','585912f6-30cd-4705-a657-565a69278b5c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9951426f-d0ed-4423-b551-77dcfb10b402','99893108-6e58-47cc-9f54-d07e06a43360','721bd466-0d9b-4e32-88ed-3ac8ff9a1420',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8d67f97a-3dc3-4a29-a0cd-36e9555b8dc9','99893108-6e58-47cc-9f54-d07e06a43360','9c9521b4-b04c-42c8-9594-9726a1bb0948',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('02ab4bff-a058-4b93-9f82-a4dfbeb02274','99893108-6e58-47cc-9f54-d07e06a43360','cbe08fde-1fb4-4d01-83e6-0f9336989da2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('47e613ef-2c38-4e03-a1e7-9f2975979eed','99893108-6e58-47cc-9f54-d07e06a43360','eced415b-c198-45d7-b5fe-0faa7ca5f829',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2f00d60c-fab0-48ed-8e17-3cf16da9fc64','99893108-6e58-47cc-9f54-d07e06a43360','2a61bea3-2e6d-42ef-b3d7-731c40f3b838',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('38a95c34-1cca-4837-94d0-ff306ea98bef','99893108-6e58-47cc-9f54-d07e06a43360','18c627b0-cc7b-4fcd-953c-18e0227f87fa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dc98f8c8-2ba5-48dc-aa64-ff0b96eb2ec7','99893108-6e58-47cc-9f54-d07e06a43360','4c8b3ade-5fca-4a0e-b0bf-160564132b46',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('86ffa900-aa44-4ca9-849d-42abd57b8a2d','99893108-6e58-47cc-9f54-d07e06a43360','c42410ad-a95f-4db1-8438-f1b04626191e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('580bd934-7e94-4935-b1a9-8233fbd6560b','99893108-6e58-47cc-9f54-d07e06a43360','d0a9d5ec-7f5b-4cc4-87c0-91e088fa1b4e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('84dc73f7-f779-4d9e-9655-4b8099a402e8','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1499ccc0-f047-4d5c-9762-49de4788ea25',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fe597b9d-5aaf-4f30-b81b-6c8ea7fd84ea','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','70d33997-2520-4520-9459-aa2c4f3904b3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4c7bfea6-3d9f-4a3e-9fbf-9ff3ac20ce4a','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','aa345ee4-41a9-44d0-8391-11e9c06e76d0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b128055b-fbde-4919-ada7-89ee539c57ce','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','dc848850-a761-4b7f-9700-7dbf12aec373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cd193c5f-2eea-4c9f-ab85-52198ebb58aa','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','08e7eaf9-62ec-450e-99ff-4736ef61b67f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1ecb5502-6889-4bf7-b9f2-7f6f1a41db1b','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','9597f721-d4b4-4987-be5d-1859043d12f0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('681ac7a3-6876-406e-8758-46837d3d143b','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','d7ba2374-818b-4db1-8c80-10e4490eb5cc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8d6a2d29-f436-4aee-8cc7-7ecd67f98be7','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','e006887b-0be4-4d66-967b-4ac154807a71',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a4ce22aa-b412-40bd-9152-55b97cd4ea32','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ed8a70fa-c8ed-448a-8ef9-92df08f237ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7dbfd6fe-1642-41eb-80f0-f210979978dc','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ef26b4f0-8932-48f0-9e77-adf67ef920d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d56e0e45-beae-48cd-a360-ba58f7d9d1f8','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','25c0877c-2dac-4880-86ed-afc134a235f0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a0967ff6-342b-47c3-b879-f43d80372aaa','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','3570f4c5-a631-4e9b-b88c-8b9f62f3dda8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fd2b7e3f-e300-4be1-8800-7041ea884705','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','9a18345a-6116-46f9-89df-a1d3b8f6bd67',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8c36afc8-b240-46d4-b88b-c8d7aa85764a','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b221b1e5-15eb-4ecf-b770-8d09bb7a15aa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('75e1a98b-648a-4eda-a75b-942ec870c41d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','e234aea6-4eed-4fb7-8037-1f29d8369674',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cdd8e926-4086-417e-9a40-d27b8da9c366','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','fac166d1-dc2e-41db-a76c-ec7d52e6dff0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c09914d0-7256-43e7-ab72-ddc5f691b004','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','108fe23e-830d-434a-8919-41435af10c0d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9d4ff19d-0eed-4007-a60e-a24143b2f632','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','738bd0b7-0891-4c89-9f51-a378dc8c0373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('84f17fb7-2e72-40c9-8a0f-5ac3f57ea546','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','a2bc8bed-df3b-49b0-99cb-d388b2ad970c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('004e2878-baa1-4314-985d-30d1a5180d68','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','f82657b0-19f2-4ee5-86d0-d03286bd5d05',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b61bb2b3-ef91-4915-8e06-9e6fdc1bd1b2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','fa17c8a0-a815-4277-8d32-ae0b1eb0dd7e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1dc6a335-417a-4f13-baae-fec166e20b19','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ff2007a5-87e2-4e70-bccc-cd1e5d1e7ebe',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5231aff6-5667-4e6d-a816-d7cad8f1529d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','018eae8f-588f-46e0-aa8e-3db5866a0f9e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('07d29db4-978a-4dc4-8393-ecd53d13f932','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','267a923d-cc7a-4d6d-897f-36402f608f68',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6b7ae608-62ba-40f7-a3cc-e29ed6ffb5c6','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','2933c508-d413-4193-8dcc-215539f5bd77',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('590e334a-f197-430f-9b84-9705b5d786a2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','3170869b-8390-4387-8369-4dcf99407e78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('48f65249-5baf-458f-8e54-2d7a129571e2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4fb104bb-2748-43f2-a169-575d5effe07e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('88e131ab-361d-4e95-9d22-35c77d87321b','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','d30d9793-e859-4069-be44-d61d07092f1c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('38e927fb-fe92-48ae-bcf0-0370fcbaa7df','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','36965c12-d194-4bce-a039-2f8490946ea6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('92529d87-4523-476f-ba3f-c2e3b7ac0883','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4607ec4b-f2ac-43e2-8902-bf1a8dc2dcc9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5af34a5f-828c-405e-9585-be6aa83bd22e','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','519d0a95-5bc5-4c38-85c1-49e6025c4e68',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('184b6519-8a76-419d-b86e-9e5d03690c74','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','71ed9322-4e1e-4510-9d1d-e0af54d563e6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6962af3d-2b70-4b4c-bea9-d8364dbb61ee','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','92394795-146c-4b27-b2ef-42234e332a89',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f8b43211-3ea5-45f6-868a-cdd1b478fdee','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','d2cee325-9b81-4956-8538-24d008f23712',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3030811e-d02a-4bff-9917-006271d57fbe','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','01b8f78e-f8ed-4cc2-a29f-29501fe835c6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('873ece3a-6632-4f2b-a46d-1710fe5f47cf','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','59c97a50-a82e-4601-8b6e-d0d1901f5658',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ead711cd-4528-4b4a-ac66-ab641e4152bc','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','7330d818-f2b2-41ab-89b0-e53b1ab1d08a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3e79b782-f9cd-4a44-82ca-7360f0538b18','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','73629a65-5db4-4a43-891e-2156e3d59421',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5d301801-703d-4a13-919e-e0cd5b082417','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','78e7f408-436b-46e2-ba4e-e160aabce1dc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('45d919cb-f896-4dde-995e-6307c4b02e3d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','cb747252-e182-444c-ae98-6ef4da946f85',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('257b2af9-f3d2-47ef-8d70-4ce1dd34aeb3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','2715213e-4da8-4648-96ca-da4180ac8762',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b2fc3c2a-6fe6-4fdc-9d41-71ae9e4a70e1','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4f9168e9-851d-40a9-b92e-79444fdf38d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e858b4a7-c51f-47a5-a2a5-a8453f0f3e76','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','5279ae1d-2313-4ec8-b9f5-4932f0716361',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b2715732-77d5-49c5-92c6-0bd5e4ef91b9','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','a67bee97-eb18-432e-8dea-2ea555d11375',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('588acd61-bc46-422a-b66f-fe6bf36a3dc9','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','0e8fdbe4-6e67-45be-9c46-bf768283eb00',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('36274959-091e-4745-8bed-de8a574cdd54','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','3f97ce9a-75cb-4b1e-8791-ad5df572b4a4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('776357c7-0d83-40dc-afef-1ca5e1f8c299','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','83c059fb-d1c2-4184-b089-73aac3b007b5',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1ca4b639-6ee3-4dcd-94de-85932ed55627','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','c2ce68f3-3a25-4922-9797-224796c3cbe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5a113121-6367-4a1b-be76-eca7275d57f3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','079dc5f9-226d-4243-a32c-c7705636ce01',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('62ce872f-7e06-43d5-826c-57f9f93ae898','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','274c5175-5da7-4aa2-9af4-3c6b3e5ed5f4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ab7a92e3-b390-427e-988c-4ed3cc4891c2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','418f4988-5b0c-455e-994b-a9fc1842431a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ddaf6932-392f-46f0-9f42-d0d9e9b83a63','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','61af032d-8598-4b8d-a47a-446a6495eaf7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d3d95b9a-930d-4b4a-9db6-abd10299ae9b','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','96e60f4b-8898-406e-b0ba-ddbe632728c0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a2c04b23-d6a4-485d-9360-7171eabfd189','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','a31294b5-b617-4201-9fb3-32816ece3e60',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cc0303fc-5f04-43d1-aa3a-eb527f9fb91f','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','44dd9af2-a595-4c59-931d-4072e034d13a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('410c848c-c329-424a-aba9-d13f08f22118','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4e784be1-2a73-4be3-9fbc-f2e95a8423f2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('39bb843f-a707-46f2-a202-f4675b74713a','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','6cebc783-a03c-4139-a1e0-3aebf622334b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('478e7427-e6e3-42b4-8d5b-9e1375a6b5ff','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','89645c9f-8517-4e62-9d85-fda3a5cad4a7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ad5da727-20b1-4b1a-b600-93d05c038844','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','0a46897b-5078-43b6-8c46-38dc9a5904a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('08274a17-5b03-4077-8cda-382b57250ba9','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1ef7369e-512f-4218-bba1-759f4a6309de',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('562b9fb8-99a2-4845-96de-1fde01f5aa85','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','54746c63-3cf0-4c87-8ccd-cc06219450d3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f3aef6f3-0a7d-4a13-9449-ee989eebaa6f','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','9db35af3-86c3-4a26-9cc9-fb55366ffc96',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cbf95a83-c31c-4853-bbee-adfb6a5083aa','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','a4409eab-70ab-4aca-b3d0-64109a451076',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('29d8f1f3-bda9-4d1b-a59e-4b220e5d0772','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','e5b71197-45d0-44e2-81a4-0e4e90995b4c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a44f928d-2338-47c4-931f-ec2d687ac433','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','06dd7502-0b1d-4305-a1b9-adb6ffd3af70',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9678be9e-4dfc-4a1a-96bf-5afac04c57f8','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','0d19e80e-d8cc-4c58-aa99-623bb6e64185',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3d88210c-841c-49d7-8e71-60b46c8e58d4','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','5ecaaf26-5a15-40f6-bb52-5845b40c5f32',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f0a3e838-6986-4062-a373-88086689b8d9','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','82719eeb-ff99-42eb-b2ea-50e408dd48aa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fee36be7-87b0-4462-8e28-71c4b3e97115','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b3547b34-74b7-4ab1-85a2-ea4470a97a78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2be76078-7edc-4901-9dec-2ee91c89186a','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','c28b97e4-efeb-4489-867f-2f69574fe631',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('881521b5-98bc-4047-ac81-6a19ec0d2d9d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','5d95544c-bd6d-407b-8671-a723d3f496ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ed535e9d-7c00-47fd-880d-6643e96b1fae','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','af46e72b-66a2-4c00-ae01-235aa80f47b0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5d6e6415-789b-45c8-b311-601202722f44','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b57ff3cb-da5c-4e37-8a61-fd4673a64bec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('65047405-0752-4fa4-9c9a-84b27f734b80','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b9d67fd3-01a1-4e9f-b0a7-03022a2ed442',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0c7735ea-af60-4047-a5e9-af4197371b41','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','e1baeddb-d3a3-4e66-9d2f-06853479a8d8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5f963adc-7162-4f6f-b46f-dbed15a10c4d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','f4b60112-63aa-43f8-8fec-8ab23a50be02',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2442249a-8ac1-4f35-9a01-22cfa20bc4cf','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','0782e631-aafe-411a-b4ad-8f279c3b1fe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cff3a199-26f2-4f9c-9687-c33bcfdbaa78','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1e94fd04-bda8-4d02-8f71-57d97bbd545a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('de51d452-4777-45f0-a84c-63bc0b3e0ef1','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','3c8b2ab9-e16f-4ae3-a599-ac0dfce9b0ab',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9993d2aa-a760-46c1-bea2-429bf38d69e6','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','65dbe6e5-f189-4baa-83af-83ef9a772ad3',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fce33c3f-87ad-46f5-b5ed-2614d8e23435','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','fdcc2e58-4139-423b-ad86-558efe9c0a59',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c28dd0f6-cc66-4b48-92e7-548d76aef153','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ffe743d4-6f30-40a3-90e7-ba258cbaecec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5a8477c5-fec0-4ad0-8b5f-90e2490b5488','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1c03645b-1e5e-4bb2-8e9e-1c8cc6f58413',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ec62d480-88d6-418d-8c3d-e2693db1d0c3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','65767be7-1586-469e-9d63-f2597a61c6f1',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ab00cc13-70d5-4f89-8922-6d4c997bfce2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','7c28149e-570d-461d-9e5d-329ea8f0adf5',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dac2afd8-8abe-4b3b-90c6-240f3dd9f88f','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','83fe20aa-4cba-4d57-a62c-992091ba1a92',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('09eb31f2-582d-4147-84fe-627550c24c75','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','a5ff9b18-005b-4b97-b98d-f4e66ad6f35a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f2b8bec4-a5d2-4cba-bd46-8b51d517f071','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ccfbaf3a-dc2e-4733-a933-a6ad5d1f3a7f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8e348ff1-8e97-4827-8746-4f1644153777','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','233a1788-c684-4a25-92ff-12c42217b8fc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('640c3b08-3e7b-4b7c-a337-6c545f97f695','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4f375f0a-203d-4a4e-b5f9-aa72a0a12f3f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0a0c52c4-7a35-41c0-b436-adb890c2386e','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','561c2136-4318-426d-b28a-ea2a1cb1b34f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('763c3a3a-c148-4615-bb8a-b0d81a5a04b8','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','c267a9da-2eab-4998-bc24-c7f98a2ad903',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f0c2ec87-fbaa-46d1-9dc0-01ab172fb04f','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','0633c305-b299-4046-919a-4d664e559a29',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('72a308f2-02c7-4185-b56c-4827aaba96af','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','250832ca-abee-4ca4-8ef5-0ff54a6f742b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6f263daa-114d-4e20-8bc7-ad4e02fe6855','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','4deac9d8-224e-411c-ac95-e8a5d6127571',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('22a832eb-33f3-4f34-90db-ed320cda94c3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','50c0d872-7aa0-4693-8af3-68d54fe93a09',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fe4c830c-ef85-4766-9d99-f8fa2940ae3d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','71d70f68-2803-4159-a689-f29474baf254',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0461884e-ce0d-457f-a75a-27b9eef535f4','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','7c2fe751-1184-4e03-bdfa-0b1e4b327107',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('02a0500c-14b1-4b11-9f52-30ab4ff45f2d','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','7dbe2459-500e-4ad7-8c62-d125ac8192a9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d45934de-19c1-4d5f-a340-8493f4228599','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b94efeea-ada0-4c89-823d-b9965dedb39e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c8f3bbca-992a-4e2e-b2c1-c53de0d3e1c9','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','b9e9f3dd-6e92-417e-9480-7db92a4e800c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ed3c7784-fa60-41af-b283-733a7d530218','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','bb1679d4-c107-4149-9f61-92c0f1fb5de2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('92ea2545-f153-444d-a1e2-d5a255ea8b45','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','10c11f5c-1674-4ff7-9a53-8949f596da59',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c08b48e2-3d8e-45af-b3c4-aaf3f81756ec','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','3371ce65-eab2-4998-a083-2f6dbb1de99f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e73cd6a9-e5d0-4281-8809-cbb766be7a42','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','60d3802e-bea9-4e37-b750-4258e55d990d',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cd2356f5-80fd-4b8d-92fc-ac91298c6979','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','9ccafce1-cb20-46bc-99b0-84ed6bb62455',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f8dc6956-2564-4889-81ce-c45f040fda07','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','d7f8b993-7c64-4820-8fb1-1ba23e084479',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a4c0d25d-381b-42e9-ba3e-5049a38cac5a','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','fe02a63c-1bdd-45ba-a327-b9bb110db578',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8cacc800-6f75-4e6a-b51a-f382c242ace3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','13c84629-18dc-4fc6-b073-99982d9519a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7b211ec5-1749-40ff-8b6e-ecff1613126e','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','40078d0e-1986-4e52-9e54-86d4cf6fb910',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('de03d6fb-7b5a-4d22-b490-764106093cef','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','91e2131e-1de3-46ed-a21b-a5e24d791a6e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6e016a4e-e314-46a0-8260-ac27cb90fcd3','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','ec8a3d5e-84c5-48f5-8f90-effa7170398b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e734e0b5-9914-44e0-a88b-5730c32cea08','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','05d543b0-e2a8-48be-b12d-40b7391a38da',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c4d2cff5-2e13-47d3-8e93-d785d131bacd','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1e7960ba-5a75-4dea-9f9b-d44d51c433b9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1cd4bbca-9191-4279-b5eb-bbcd1cd0392b','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','d6e2a943-8673-4e30-9fe0-fb0fef6b7113',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c167ae78-0080-4bc4-96d6-a9cba29d36f1','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','fe68950f-773f-454a-9b2e-74d3de306c67',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f71f9a69-623e-44a8-a3de-550682463954','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','1d4a8cfa-99df-4748-8d76-862e83f1f5f1',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4c29a968-a268-4ffe-9b8e-829c94dd11b2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','585912f6-30cd-4705-a657-565a69278b5c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9fa99ec4-852b-472f-9776-a045ba4bf97c','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','721bd466-0d9b-4e32-88ed-3ac8ff9a1420',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('138046a1-0fae-4cb1-9777-e9412243db89','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','9c9521b4-b04c-42c8-9594-9726a1bb0948',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5c6a3806-56f6-4e7c-9aa9-ea8ce27571f2','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','cbe08fde-1fb4-4d01-83e6-0f9336989da2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c5f21380-1090-4931-972f-2abd20c17ed5','b5a46dbf-9b46-4bf8-b493-d213c66d6f23','eced415b-c198-45d7-b5fe-0faa7ca5f829',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9671cbe1-922b-4fbe-ac07-a1e826fe0c93','f70f7e34-7cfd-4f35-ba91-e198acc48359','1499ccc0-f047-4d5c-9762-49de4788ea25',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4ab4bb27-3ae1-4901-a08d-f66dfa137650','f70f7e34-7cfd-4f35-ba91-e198acc48359','dc848850-a761-4b7f-9700-7dbf12aec373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('92c7ecc5-3897-4087-98f8-ccacce347de8','f70f7e34-7cfd-4f35-ba91-e198acc48359','08e7eaf9-62ec-450e-99ff-4736ef61b67f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5ee4475d-e7a2-45be-b8bb-8fe0920213dc','f70f7e34-7cfd-4f35-ba91-e198acc48359','e006887b-0be4-4d66-967b-4ac154807a71',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('21c4a0a5-3a57-4eff-b090-52c14d0c089e','f70f7e34-7cfd-4f35-ba91-e198acc48359','ed8a70fa-c8ed-448a-8ef9-92df08f237ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('557a96fe-9271-4d8a-91d3-5d49cc8223ff','f70f7e34-7cfd-4f35-ba91-e198acc48359','3570f4c5-a631-4e9b-b88c-8b9f62f3dda8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ab5f31ca-5492-4536-a3cf-008293034099','f70f7e34-7cfd-4f35-ba91-e198acc48359','9a18345a-6116-46f9-89df-a1d3b8f6bd67',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5844dd07-c173-4c25-8307-27144964e86b','f70f7e34-7cfd-4f35-ba91-e198acc48359','e234aea6-4eed-4fb7-8037-1f29d8369674',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5c1fa1f8-d0ac-4274-8975-dd6176f9d4a9','f70f7e34-7cfd-4f35-ba91-e198acc48359','a2bc8bed-df3b-49b0-99cb-d388b2ad970c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c32c738a-dae0-4ffc-b7f1-bd245dcb7cb4','f70f7e34-7cfd-4f35-ba91-e198acc48359','f82657b0-19f2-4ee5-86d0-d03286bd5d05',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8b2d3b0c-44b8-4cfe-a462-654f89c82c3c','f70f7e34-7cfd-4f35-ba91-e198acc48359','fa17c8a0-a815-4277-8d32-ae0b1eb0dd7e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e94bfaa2-6aed-4f72-923e-8a4ee084b082','f70f7e34-7cfd-4f35-ba91-e198acc48359','018eae8f-588f-46e0-aa8e-3db5866a0f9e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('aeba93e7-aec3-47f5-8aa1-89602b96e01a','f70f7e34-7cfd-4f35-ba91-e198acc48359','2933c508-d413-4193-8dcc-215539f5bd77',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5d99201f-178f-4ef9-8def-69cb3eb5372d','f70f7e34-7cfd-4f35-ba91-e198acc48359','d30d9793-e859-4069-be44-d61d07092f1c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0adb6666-a8dc-41cf-aff8-e32c3ad9071d','f70f7e34-7cfd-4f35-ba91-e198acc48359','36965c12-d194-4bce-a039-2f8490946ea6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('91c1e4a5-27ab-4f9d-b30e-9abac612cc6b','f70f7e34-7cfd-4f35-ba91-e198acc48359','92394795-146c-4b27-b2ef-42234e332a89',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3b03cb8b-1a96-4c1d-8841-681cdc457577','f70f7e34-7cfd-4f35-ba91-e198acc48359','d2cee325-9b81-4956-8538-24d008f23712',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bb2c2397-c152-4a8e-950e-aa5789a9431a','f70f7e34-7cfd-4f35-ba91-e198acc48359','01b8f78e-f8ed-4cc2-a29f-29501fe835c6',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('95acd5e7-1838-4918-838e-33a19a892631','f70f7e34-7cfd-4f35-ba91-e198acc48359','7330d818-f2b2-41ab-89b0-e53b1ab1d08a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('261b55f8-5a70-41ae-a5b4-e6dbceffd8e4','f70f7e34-7cfd-4f35-ba91-e198acc48359','78e7f408-436b-46e2-ba4e-e160aabce1dc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('81b819e1-322a-4df2-8662-882e70303aff','f70f7e34-7cfd-4f35-ba91-e198acc48359','4f9168e9-851d-40a9-b92e-79444fdf38d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3138a1d6-cbdf-4f05-bdc1-598fcdabb4df','f70f7e34-7cfd-4f35-ba91-e198acc48359','a67bee97-eb18-432e-8dea-2ea555d11375',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c863b5c6-0c8e-4528-864b-75b11870c454','f70f7e34-7cfd-4f35-ba91-e198acc48359','3f97ce9a-75cb-4b1e-8791-ad5df572b4a4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('5cb9446c-2924-46a2-a9fa-5ddaaa732680','f70f7e34-7cfd-4f35-ba91-e198acc48359','c2ce68f3-3a25-4922-9797-224796c3cbe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e5fe36f1-8410-4ddf-b20c-ea26d73b53f2','f70f7e34-7cfd-4f35-ba91-e198acc48359','418f4988-5b0c-455e-994b-a9fc1842431a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9781d80c-9224-46ad-b283-5d0994c58c1d','f70f7e34-7cfd-4f35-ba91-e198acc48359','96e60f4b-8898-406e-b0ba-ddbe632728c0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4ffa2804-b2c0-4ce6-86da-0f914cd0cb1f','f70f7e34-7cfd-4f35-ba91-e198acc48359','a31294b5-b617-4201-9fb3-32816ece3e60',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('05b8fe1d-6003-4b34-ae25-8c155efba531','f70f7e34-7cfd-4f35-ba91-e198acc48359','44dd9af2-a595-4c59-931d-4072e034d13a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('93857e67-e04d-4e11-9945-8a5baede6eae','f70f7e34-7cfd-4f35-ba91-e198acc48359','6cebc783-a03c-4139-a1e0-3aebf622334b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fc87f56d-1b1f-4ea7-92e5-44a8d7bd8480','f70f7e34-7cfd-4f35-ba91-e198acc48359','89645c9f-8517-4e62-9d85-fda3a5cad4a7',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4d28e6a7-5b0b-40f2-bff8-ef425be9bec7','f70f7e34-7cfd-4f35-ba91-e198acc48359','0a46897b-5078-43b6-8c46-38dc9a5904a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('006dd318-5871-4431-b262-2262cd257362','f70f7e34-7cfd-4f35-ba91-e198acc48359','1ef7369e-512f-4218-bba1-759f4a6309de',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1ab5afbb-2575-4133-8469-1efda8a6a933','f70f7e34-7cfd-4f35-ba91-e198acc48359','9db35af3-86c3-4a26-9cc9-fb55366ffc96',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('a1baec41-0268-4f23-b262-02d8798d5304','f70f7e34-7cfd-4f35-ba91-e198acc48359','06dd7502-0b1d-4305-a1b9-adb6ffd3af70',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('95f7f55f-7d75-4700-b123-58036a7d0d88','f70f7e34-7cfd-4f35-ba91-e198acc48359','82719eeb-ff99-42eb-b2ea-50e408dd48aa',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('deff7204-c83b-4c18-9d0d-2158bcca5eb2','f70f7e34-7cfd-4f35-ba91-e198acc48359','b3547b34-74b7-4ab1-85a2-ea4470a97a78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0e68bd88-70bc-4bb9-b10b-4ebeb741ccf6','f70f7e34-7cfd-4f35-ba91-e198acc48359','5d95544c-bd6d-407b-8671-a723d3f496ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('86d82cf4-0c50-4a67-8a53-bd2ac424c89f','f70f7e34-7cfd-4f35-ba91-e198acc48359','af46e72b-66a2-4c00-ae01-235aa80f47b0',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bad00a82-8598-4cec-bf5a-9fe10bb029af','f70f7e34-7cfd-4f35-ba91-e198acc48359','b57ff3cb-da5c-4e37-8a61-fd4673a64bec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ef70744c-6bb8-45ee-96a3-d132b37ddb1d','f70f7e34-7cfd-4f35-ba91-e198acc48359','0782e631-aafe-411a-b4ad-8f279c3b1fe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ccceac7c-7c55-4761-b9cb-a5fdadac97f2','f70f7e34-7cfd-4f35-ba91-e198acc48359','1e94fd04-bda8-4d02-8f71-57d97bbd545a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6eb85a37-f947-4d8b-bf73-06a91339cfe2','f70f7e34-7cfd-4f35-ba91-e198acc48359','ffe743d4-6f30-40a3-90e7-ba258cbaecec',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('64671e06-c11e-4090-b135-793bdcfec603','f70f7e34-7cfd-4f35-ba91-e198acc48359','1c03645b-1e5e-4bb2-8e9e-1c8cc6f58413',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('e90814c1-2f9b-40e4-b7c3-00bdea74a1e7','f70f7e34-7cfd-4f35-ba91-e198acc48359','7c28149e-570d-461d-9e5d-329ea8f0adf5',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d2837ad8-60df-4919-ad60-1d3d8e1f87aa','f70f7e34-7cfd-4f35-ba91-e198acc48359','a5ff9b18-005b-4b97-b98d-f4e66ad6f35a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4f397248-fee2-42da-b179-28db63b28490','f70f7e34-7cfd-4f35-ba91-e198acc48359','233a1788-c684-4a25-92ff-12c42217b8fc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ff566db6-e31a-40f8-b0e8-dc7ae1cc2eda','f70f7e34-7cfd-4f35-ba91-e198acc48359','4f375f0a-203d-4a4e-b5f9-aa72a0a12f3f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('297f9e45-3a82-4256-b861-c7fee351ceae','f70f7e34-7cfd-4f35-ba91-e198acc48359','250832ca-abee-4ca4-8ef5-0ff54a6f742b',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('609643df-319c-4444-ab0b-4be5e7788c27','f70f7e34-7cfd-4f35-ba91-e198acc48359','4deac9d8-224e-411c-ac95-e8a5d6127571',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('76940278-c3e0-4194-bbae-dc1935415bd0','f70f7e34-7cfd-4f35-ba91-e198acc48359','7c2fe751-1184-4e03-bdfa-0b1e4b327107',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('242475bf-3033-4949-95fd-17eb7d67c6ce','f70f7e34-7cfd-4f35-ba91-e198acc48359','7dbe2459-500e-4ad7-8c62-d125ac8192a9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('395ac2f2-8462-4af9-833e-f70f1f272cda','f70f7e34-7cfd-4f35-ba91-e198acc48359','b94efeea-ada0-4c89-823d-b9965dedb39e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('96143b51-fda2-4983-a7c3-945c3d6cb3de','f70f7e34-7cfd-4f35-ba91-e198acc48359','3371ce65-eab2-4998-a083-2f6dbb1de99f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('64182e61-8510-4e13-828e-21537fef4a27','f70f7e34-7cfd-4f35-ba91-e198acc48359','9ccafce1-cb20-46bc-99b0-84ed6bb62455',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7da0b923-0e30-4f37-81a8-7eb9eef22bf4','f70f7e34-7cfd-4f35-ba91-e198acc48359','fe02a63c-1bdd-45ba-a327-b9bb110db578',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8a3f7721-cfec-4485-a5ad-6e4b5d731804','f70f7e34-7cfd-4f35-ba91-e198acc48359','40078d0e-1986-4e52-9e54-86d4cf6fb910',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0462fdf5-4ddf-4a3d-8411-d56d40a0422b','f70f7e34-7cfd-4f35-ba91-e198acc48359','91e2131e-1de3-46ed-a21b-a5e24d791a6e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('b865f96e-5ea3-403a-a303-08db2c323988','f70f7e34-7cfd-4f35-ba91-e198acc48359','05d543b0-e2a8-48be-b12d-40b7391a38da',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ee2138d3-41f6-4172-b12a-fa42ed2172d2','f70f7e34-7cfd-4f35-ba91-e198acc48359','d6e2a943-8673-4e30-9fe0-fb0fef6b7113',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8e65530d-615c-41f9-8510-332004a1c0a7','f70f7e34-7cfd-4f35-ba91-e198acc48359','585912f6-30cd-4705-a657-565a69278b5c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6f4b84ad-e83a-4b58-834b-4f07713950c7','f70f7e34-7cfd-4f35-ba91-e198acc48359','9c9521b4-b04c-42c8-9594-9726a1bb0948',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('eddb2a88-dc76-40fd-b4bd-7bf82137ea06','f70f7e34-7cfd-4f35-ba91-e198acc48359','eced415b-c198-45d7-b5fe-0faa7ca5f829',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('269fd573-36df-4f21-aae9-94a5c159da8e','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','dc848850-a761-4b7f-9700-7dbf12aec373',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9fd92fd2-3576-496a-a10c-1cd841c64a4d','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','08e7eaf9-62ec-450e-99ff-4736ef61b67f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('1cc9622d-f250-4d4a-ab43-5e45cd66eee8','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','d2ca09b5-748f-44e1-bce9-6f7b511f6291',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d7a8ef6a-883d-463e-8a0a-983dd3fcea89','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','07cb8ca2-4393-46ac-abd4-03d61bf2adff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('76bac1b4-8857-46b7-81c2-646be1903776','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','a67d39e6-2f99-4438-b1a9-4f5fb24b79ee',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('37c0fe96-1e99-49e0-87a5-a902d83c5ca2','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','75d763a0-9108-43ec-b068-3f27767caf52',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('52aa0b25-a762-4231-bcf8-1d59a40f73de','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','3570f4c5-a631-4e9b-b88c-8b9f62f3dda8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ff8e7f3a-6b7d-4a62-9ee0-1555faaa8dcd','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','fa17c8a0-a815-4277-8d32-ae0b1eb0dd7e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('063bcec6-fd04-401a-9c79-5ca253f29b67','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','d30d9793-e859-4069-be44-d61d07092f1c',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4b559241-e9aa-47d1-b695-1bc15a2caed6','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','d2cee325-9b81-4956-8538-24d008f23712',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('4988ec63-345c-4886-a37b-ea9cfebb5f06','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','78e7f408-436b-46e2-ba4e-e160aabce1dc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('216e7253-da25-45cf-81bd-2329967d1a7f','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','4f9168e9-851d-40a9-b92e-79444fdf38d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('f9846a99-540d-4f3e-820a-1634f9eae9ce','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','3f97ce9a-75cb-4b1e-8791-ad5df572b4a4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('9761b88d-9740-4d5a-aec2-cd7bc56117ff','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','418f4988-5b0c-455e-994b-a9fc1842431a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8dd09bb5-fdca-4c34-bf2b-07f5cc53804e','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','44dd9af2-a595-4c59-931d-4072e034d13a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('52492a19-5c89-4a79-8d63-65e08e847391','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','0a46897b-5078-43b6-8c46-38dc9a5904a2',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('cfbcbeb8-15a2-40b8-9545-f064d20180dc','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','06dd7502-0b1d-4305-a1b9-adb6ffd3af70',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('99daa324-edca-4c04-96de-0b2ce3629bbd','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','5d95544c-bd6d-407b-8671-a723d3f496ff',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('0a733037-e4cf-4192-abe5-3bc9c109dbe4','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','0782e631-aafe-411a-b4ad-8f279c3b1fe8',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('2ce2c002-f27e-400e-8754-73da2652c9be','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','a5ff9b18-005b-4b97-b98d-f4e66ad6f35a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6be507cb-364a-4273-8372-95fc9c770868','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','4f375f0a-203d-4a4e-b5f9-aa72a0a12f3f',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8560436d-6389-4f53-a219-b874d2ff4ad0','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','4deac9d8-224e-411c-ac95-e8a5d6127571',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c33035db-a39e-424e-ade0-b53806530ec9','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','b94efeea-ada0-4c89-823d-b9965dedb39e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('3cec0e63-b636-4b23-b9f2-108bc2dd88df','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','fe02a63c-1bdd-45ba-a327-b9bb110db578',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('d6a873b0-4882-4e1b-b7ca-3bbc3b87796c','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','1430feb7-bee4-40c7-93c4-5191ea130b7a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('434428ae-9d92-4c5c-9fbd-918c4549c84c','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','5864d4a4-8475-417e-9ebc-a4f678e8c5ce',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('bb602d76-ff0b-4a68-a96f-4ad94a4eb13a','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','40078d0e-1986-4e52-9e54-86d4cf6fb910',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('8230fe01-f50f-41af-89a1-d40439f18c8d','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','d6e2a943-8673-4e30-9fe0-fb0fef6b7113',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('c6d09dfe-8ca5-4c8c-8b01-6059306622e8','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','eced415b-c198-45d7-b5fe-0faa7ca5f829',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7b98c9f2-12ee-4c67-9f4b-6130bb44e794','96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','c42410ad-a95f-4db1-8438-f1b04626191e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('7b241fbe-3465-40c2-98c9-defea192fd20','e5ed396a-58e3-4750-9fef-4f5da3f5a936','44dd9af2-a595-4c59-931d-4072e034d13a',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('ef844d93-8ce9-42a4-aedb-c2abb9c4367b','e5ed396a-58e3-4750-9fef-4f5da3f5a936','3e46ca97-83b3-4fb4-8188-410290811d78',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('fa9418b1-96e2-4ce2-9f19-1b3a15f4c4ac','e5ed396a-58e3-4750-9fef-4f5da3f5a936','78e7f408-436b-46e2-ba4e-e160aabce1dc',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('dfca23f6-0fb5-45fb-989c-3944af13e221','e5ed396a-58e3-4750-9fef-4f5da3f5a936','b94efeea-ada0-4c89-823d-b9965dedb39e',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('08c4594b-1686-49f7-bf81-d09d175a50d8','e5ed396a-58e3-4750-9fef-4f5da3f5a936','3ba55e28-78a6-47e3-8f8f-b7822d3e46c9',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('add4a777-a3b9-46d5-b2a3-bd1e30a7be6f','e5ed396a-58e3-4750-9fef-4f5da3f5a936','eced415b-c198-45d7-b5fe-0faa7ca5f829',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('6c72ee6d-fa00-45ef-bb50-72a620b23b6b','e5ed396a-58e3-4750-9fef-4f5da3f5a936','4f9168e9-851d-40a9-b92e-79444fdf38d4',1795409227);
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at") VALUES('96b05c7b-3a74-4334-9d09-b05c491d8d90','e5ed396a-58e3-4750-9fef-4f5da3f5a936','018eae8f-588f-46e0-aa8e-3db5866a0f9e',1795409227);
INSERT INTO "roles" ("id", "name", "slug", "description", "level", "is_system", "created_at", "updated_at") VALUES('99893108-6e58-47cc-9f54-d07e06a43360','Admin','admin','Everything except granting access to others',90,1,1795409227,1795409227);
INSERT INTO "roles" ("id", "name", "slug", "description", "level", "is_system", "created_at", "updated_at") VALUES('b5a46dbf-9b46-4bf8-b493-d213c66d6f23','Editor','editor','Full control of content and media, including publishing',50,1,1795409227,1795409227);
INSERT INTO "roles" ("id", "name", "slug", "description", "level", "is_system", "created_at", "updated_at") VALUES('f70f7e34-7cfd-4f35-ba91-e198acc48359','Author','author','Write content, but not publish or delete it',30,1,1795409227,1795409227);
INSERT INTO "roles" ("id", "name", "slug", "description", "level", "is_system", "created_at", "updated_at") VALUES('96d0d9c8-e9f1-4f4b-b845-ca6cc7cb7d81','Viewer','viewer','Read content, change nothing',10,1,1795409227,1795409227);
INSERT INTO "roles" ("id", "name", "slug", "description", "level", "is_system", "created_at", "updated_at") VALUES('e5ed396a-58e3-4750-9fef-4f5da3f5a936','Public','public','What anyone may do without signing in',0,1,1795409227,1795409227);
DELETE FROM sqlite_sequence;
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
CREATE INDEX `email_deliveries_provider_type_idx` ON `email_deliveries` (`provider_type`,`created_at`);
CREATE INDEX `email_deliveries_retention_idx` ON `email_deliveries` (`retention_class`,`created_at`);
CREATE INDEX `email_deliveries_principal_idx` ON `email_deliveries` (`principal_kind`,`principal_id`);
CREATE INDEX `email_deliveries_key_idx` ON `email_deliveries` (`key_digest`);
CREATE INDEX `email_deliveries_queued_idx` ON `email_deliveries` (`queued_id`);
CREATE INDEX `email_deliveries_provider_origin_idx` ON `email_deliveries` (`provider_origin`,`created_at`);
CREATE INDEX `email_deliveries_template_idx` ON `email_deliveries` (`template_slug`,`status`,`created_at`);
CREATE INDEX `email_deliveries_template_created_idx` ON `email_deliveries` (`template_slug`,`created_at`,`id`);
CREATE INDEX `email_providers_type_idx` ON `email_providers` (`type`);
CREATE INDEX `email_providers_is_default_idx` ON `email_providers` (`is_default`);
CREATE INDEX `email_providers_is_active_idx` ON `email_providers` (`is_active`);
CREATE INDEX `email_providers_created_at_idx` ON `email_providers` (`created_at`);
CREATE INDEX `email_queue_state_idx` ON `email_queue` (`state`,`settled_at`);
CREATE INDEX `email_queue_principal_idx` ON `email_queue` (`principal_kind`,`principal_id`);
CREATE INDEX `email_queue_created_idx` ON `email_queue` (`created_at`,`id`);
CREATE INDEX `email_queue_template_idx` ON `email_queue` (`template_slug`,`created_at`);
CREATE INDEX `email_queue_provider_type_idx` ON `email_queue` (`provider_type`,`created_at`);
CREATE INDEX `email_queue_provider_origin_idx` ON `email_queue` (`provider_origin`,`created_at`);
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
CREATE UNIQUE INDEX `nextly_external_identities_key_uidx` ON `nextly_external_identities` (`key_digest`);
CREATE INDEX `nextly_external_identities_user_idx` ON `nextly_external_identities` (`user_id`);
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
CREATE INDEX `nextly_release_members_doc_walk_idx` ON `nextly_release_members` (`scope_kind`,`scope_slug`,`entry_id`,`id`);
CREATE INDEX `nextly_release_members_release_idx` ON `nextly_release_members` (`release_id`);
CREATE INDEX `nextly_releases_due_idx` ON `nextly_releases` (`state`,`scheduled_at`);
CREATE INDEX `nextly_releases_scheduled_idx` ON `nextly_releases` (`scheduled_at`);
CREATE INDEX `nextly_releases_published_idx` ON `nextly_releases` (`published_at`);
CREATE UNIQUE INDEX `nextly_review_states_key_uidx` ON `nextly_review_states` (`part_key`);
CREATE INDEX `nextly_review_states_doc_idx` ON `nextly_review_states` (`scope_kind`,`scope_slug`,`entry_id`);
CREATE INDEX `nextly_review_states_stage_idx` ON `nextly_review_states` (`scope_kind`,`scope_slug`,`stage`);
CREATE INDEX `nextly_review_states_waiting_idx` ON `nextly_review_states` (`scope_kind`,`scope_slug`,`stage`,`entered_at`,`part_key`);
CREATE INDEX `nextly_review_states_assignee_idx` ON `nextly_review_states` (`assignee_kind`,`assignee_id`);
CREATE INDEX `nextly_schedule_windows_window_idx` ON `nextly_schedule_windows` (`window_at`);
CREATE INDEX `nextly_schema_events_started_at_idx` ON `nextly_schema_events` (`started_at`);
CREATE INDEX `nextly_schema_events_scope_idx` ON `nextly_schema_events` (`scope_kind`,`scope_slug`);
CREATE INDEX `nsc_expires_at_idx` ON `nextly_spent_challenges` (`expires_at`);
CREATE UNIQUE INDEX `nextly_translation_provenance_uidx` ON `nextly_translation_provenance` (`scope_kind`,`scope_slug`,`entry_id`,`locale`,`part_state`,`field_path`);
CREATE INDEX `nextly_translation_provenance_field_idx` ON `nextly_translation_provenance` (`scope_kind`,`scope_slug`,`entry_id`,`field_path`,`part_state`);
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
CREATE INDEX `user_roles_role_id_idx` ON `user_roles` (`role_id`);
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
CREATE INDEX "idx_page_builder__binding_uses_source_kind_source_key_001e79k" ON "page_builder__binding_uses" ("source_kind", "source_key");
CREATE INDEX "idx_page_builder__binding_uses_document_key" ON "page_builder__binding_uses" ("document_key");
CREATE INDEX "idx_reading__lists_owner_id" ON "reading__lists" ("owner_id");
CREATE UNIQUE INDEX "uq_reading__list_items_list_id_post_id_11e06ud" ON "reading__list_items" ("list_id", "post_id");
CREATE INDEX "idx_reading__list_items_post_id" ON "reading__list_items" ("post_id");
CREATE INDEX "idx_comp_seo_parent" ON "comp_seo" ("_parent_id", "_parent_table", "_parent_field");
CREATE INDEX "idx_comp_seo_created_at" ON "comp_seo" ("created_at");
CREATE INDEX "idx_comp_seo_og_image" ON "comp_seo" ("og_image");
CREATE UNIQUE INDEX "idx_dc_authors_slug" ON "dc_authors" ("slug");
CREATE INDEX "idx_dc_authors_created_by" ON "dc_authors" ("created_by");
CREATE INDEX "idx_dc_authors_created_at" ON "dc_authors" ("created_at");
CREATE INDEX "idx_dc_authors_avatar" ON "dc_authors" ("avatar");
CREATE INDEX "idx_dc_block_pages_created_by" ON "dc_block_pages" ("created_by");
CREATE INDEX "idx_dc_block_pages_created_at" ON "dc_block_pages" ("created_at");
CREATE INDEX "idx_dc_categories_created_by" ON "dc_categories" ("created_by");
CREATE INDEX "idx_dc_categories_created_at" ON "dc_categories" ("created_at");
CREATE UNIQUE INDEX "idx_dc_components_slug" ON "dc_components" ("slug");
CREATE INDEX "idx_dc_components_created_by" ON "dc_components" ("created_by");
CREATE INDEX "idx_dc_components_created_at" ON "dc_components" ("created_at");
CREATE UNIQUE INDEX "idx_dc_form_submission_resends_slug" ON "dc_form_submission_resends" ("slug");
CREATE INDEX "idx_dc_form_submission_resends_created_by" ON "dc_form_submission_resends" ("created_by");
CREATE INDEX "idx_dc_form_submission_resends_created_at" ON "dc_form_submission_resends" ("created_at");
CREATE INDEX "idx_dc_form_submission_resends_submission" ON "dc_form_submission_resends" ("submission");
CREATE UNIQUE INDEX "idx_dc_form_submission_sends_slug" ON "dc_form_submission_sends" ("slug");
CREATE INDEX "idx_dc_form_submission_sends_created_by" ON "dc_form_submission_sends" ("created_by");
CREATE INDEX "idx_dc_form_submission_sends_created_at" ON "dc_form_submission_sends" ("created_at");
CREATE INDEX "idx_dc_form_submission_sends_submission" ON "dc_form_submission_sends" ("submission");
CREATE INDEX "idx_dc_form_submission_sends_queued_id" ON "dc_form_submission_sends" ("queued_id");
CREATE INDEX "idx_dc_form_submission_sends_form_notification_06wq5om" ON "dc_form_submission_sends" ("form", "notification");
CREATE UNIQUE INDEX "idx_dc_form_submissions_slug" ON "dc_form_submissions" ("slug");
CREATE INDEX "idx_dc_form_submissions_created_by" ON "dc_form_submissions" ("created_by");
CREATE INDEX "idx_dc_form_submissions_created_at" ON "dc_form_submissions" ("created_at");
CREATE INDEX "idx_dc_form_submissions_form" ON "dc_form_submissions" ("form");
CREATE INDEX "idx_dc_form_submissions_status" ON "dc_form_submissions" ("status");
CREATE INDEX "idx_dc_form_submissions_submitted_at" ON "dc_form_submissions" ("submitted_at");
CREATE UNIQUE INDEX "uq_dc_form_submissions_form_response_key_1ak966i" ON "dc_form_submissions" ("form", "response_key");
CREATE UNIQUE INDEX "idx_dc_form_uploads_slug" ON "dc_form_uploads" ("slug");
CREATE INDEX "idx_dc_form_uploads_created_by" ON "dc_form_uploads" ("created_by");
CREATE INDEX "idx_dc_form_uploads_created_at" ON "dc_form_uploads" ("created_at");
CREATE UNIQUE INDEX "uq_dc_form_uploads_media_submission_1v7nb99" ON "dc_form_uploads" ("media", "submission");
CREATE INDEX "idx_dc_form_uploads_submission" ON "dc_form_uploads" ("submission");
CREATE INDEX "idx_dc_form_uploads_form" ON "dc_form_uploads" ("form");
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
CREATE INDEX "idx_dc_pages_created_by" ON "dc_pages" ("created_by");
CREATE INDEX "idx_dc_pages_created_at" ON "dc_pages" ("created_at");
CREATE INDEX "idx_dc_pages_layout" ON "dc_pages" ("layout");
CREATE UNIQUE INDEX "idx_dc_patterns_slug" ON "dc_patterns" ("slug");
CREATE INDEX "idx_dc_patterns_created_by" ON "dc_patterns" ("created_by");
CREATE INDEX "idx_dc_patterns_created_at" ON "dc_patterns" ("created_at");
CREATE INDEX "idx_dc_posts_created_by" ON "dc_posts" ("created_by");
CREATE INDEX "idx_dc_posts_created_at" ON "dc_posts" ("created_at");
CREATE INDEX "idx_dc_posts_featured_image" ON "dc_posts" ("featured_image");
CREATE INDEX "idx_dc_posts_last_saved_at" ON "dc_posts" ("last_saved_at");
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
CREATE UNIQUE INDEX "uq_dc_posts_locales_slug__locale_1mvq6jl" ON "dc_posts_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';
CREATE UNIQUE INDEX "uq_dc_categories_locales_slug__locale_1mvq6jl" ON "dc_categories_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';
CREATE UNIQUE INDEX "uq_dc_tags_locales_slug__locale_1mvq6jl" ON "dc_tags_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';
CREATE UNIQUE INDEX "uq_dc_block_pages_locales_slug__locale_1mvq6jl" ON "dc_block_pages_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';
CREATE UNIQUE INDEX "uq_dc_pages_locales_slug__locale_1mvq6jl" ON "dc_pages_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';
COMMIT;
