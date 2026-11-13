SET FOREIGN_KEY_CHECKS=0;
CREATE TABLE `activity_log` (
  `id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `actor_type` varchar(16) DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `user_email` varchar(255) DEFAULT NULL,
  `action` varchar(10) NOT NULL,
  `collection` varchar(255) NOT NULL,
  `entry_id` varchar(191) DEFAULT NULL,
  `entry_title` text,
  `locale` varchar(32) DEFAULT NULL,
  `subject_kind` varchar(16) DEFAULT NULL,
  `metadata` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `identity_erased_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_activity_log_created_at` (`created_at`),
  KEY `idx_activity_log_collection` (`collection`,`created_at`),
  KEY `idx_activity_log_user_id` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `api_keys` (
  `id` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `key_hash` varchar(64) NOT NULL,
  `key_prefix` varchar(16) NOT NULL,
  `token_type` varchar(20) NOT NULL,
  `role_id` varchar(191) DEFAULT NULL,
  `user_id` varchar(191) NOT NULL,
  `expires_at` datetime DEFAULT NULL,
  `last_used_at` datetime DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_keys_key_hash_unique` (`key_hash`),
  KEY `api_keys_user_id_idx` (`user_id`),
  KEY `api_keys_role_id_idx` (`role_id`),
  KEY `api_keys_is_active_expires_at_idx` (`is_active`,`expires_at`),
  CONSTRAINT `api_keys_role_id_roles_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `api_keys_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `audit_log` (
  `id` varchar(191) NOT NULL,
  `kind` varchar(64) NOT NULL,
  `actor_user_id` varchar(191) DEFAULT NULL,
  `target_user_id` varchar(191) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `metadata` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `identity_erased_at` datetime DEFAULT NULL,
  `actor_kind` varchar(191) DEFAULT NULL,
  `actor_principal_kind` varchar(191) DEFAULT NULL,
  `actor_principal_id` varchar(191) DEFAULT NULL,
  `target_principal_kind` varchar(191) DEFAULT NULL,
  `target_principal_id` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `audit_log_kind_idx` (`kind`),
  KEY `audit_log_actor_user_id_idx` (`actor_user_id`),
  KEY `audit_log_target_user_id_idx` (`target_user_id`),
  KEY `audit_log_created_at_idx` (`created_at`),
  KEY `audit_log_actor_principal_idx` (`actor_principal_kind`,`actor_principal_id`),
  KEY `audit_log_target_principal_idx` (`target_principal_kind`,`target_principal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `comp_seo` (
  `id` varchar(36) NOT NULL,
  `_parent_id` varchar(36) NOT NULL,
  `_parent_table` varchar(255) NOT NULL,
  `_parent_field` varchar(255) NOT NULL,
  `_order` int DEFAULT '0',
  `_component_type` varchar(255) DEFAULT NULL,
  `og_image` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_comp_seo_parent` (`_parent_id`,`_parent_table`,`_parent_field`),
  KEY `idx_comp_seo_created_at` (`created_at`),
  KEY `idx_comp_seo_og_image` (`og_image`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `comp_seo_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `meta_title` varchar(255) DEFAULT NULL,
  `meta_description` text,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `comp_seo_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `comp_seo` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_authors` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `article_count` int DEFAULT NULL,
  `avatar` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_authors_slug` (`slug`),
  KEY `idx_dc_authors_created_by` (`created_by`),
  KEY `idx_dc_authors_created_at` (`created_at`),
  KEY `idx_dc_authors_avatar` (`avatar`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_authors_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_status` varchar(20) NOT NULL DEFAULT 'draft',
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `bio` text,
  `job_title` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_authors_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_authors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_block_pages` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_block_pages_slug` (`slug`),
  KEY `idx_dc_block_pages_created_by` (`created_by`),
  KEY `idx_dc_block_pages_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_categories` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `icon` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_categories_slug` (`slug`),
  KEY `idx_dc_categories_created_by` (`created_by`),
  KEY `idx_dc_categories_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_components` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(255) DEFAULT NULL,
  `area` varchar(255) DEFAULT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_components_slug` (`slug`),
  KEY `idx_dc_components_created_by` (`created_by`),
  KEY `idx_dc_components_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submissions` (
  `id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `form` varchar(36) DEFAULT NULL,
  `data` json NOT NULL,
  `status` varchar(255) NOT NULL,
  `spam_reason` varchar(255) DEFAULT NULL,
  `notes` text,
  `ip_address` varchar(255) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `submitted_at` timestamp NOT NULL,
  `edited_at` timestamp NULL DEFAULT NULL,
  `edited_by` varchar(255) DEFAULT NULL,
  `response_key` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_form_submissions_slug` (`slug`),
  UNIQUE KEY `uq_dc_form_submissions_form_response_key_1ak966i` (`form`,`response_key`),
  KEY `idx_dc_form_submissions_created_by` (`created_by`),
  KEY `idx_dc_form_submissions_created_at` (`created_at`),
  KEY `idx_dc_form_submissions_form` (`form`),
  KEY `idx_dc_form_submissions_status` (`status`),
  KEY `idx_dc_form_submissions_submitted_at` (`submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_forms` (
  `id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `fields` json NOT NULL,
  `settings` json DEFAULT NULL,
  `notifications` json DEFAULT NULL,
  `status` varchar(255) NOT NULL,
  `went_live_at` timestamp NULL DEFAULT NULL,
  `closed_message` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_forms_slug` (`slug`),
  KEY `idx_dc_forms_created_by` (`created_by`),
  KEY `idx_dc_forms_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_layouts` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `areas` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_layouts_slug` (`slug`),
  KEY `idx_dc_layouts_created_by` (`created_by`),
  KEY `idx_dc_layouts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_nx_pb_address_claims` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `claim_key` varchar(255) NOT NULL,
  `kind` varchar(255) NOT NULL,
  `locale` varchar(255) DEFAULT NULL,
  `path` text,
  `holder_collection` varchar(255) DEFAULT NULL,
  `holder_id` varchar(255) DEFAULT NULL,
  `space` varchar(255) DEFAULT NULL,
  `blocked_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_nx_pb_address_claims_slug` (`slug`),
  UNIQUE KEY `uq_dc_nx_pb_address_claims_claim_key` (`claim_key`),
  KEY `idx_dc_nx_pb_address_claims_created_by` (`created_by`),
  KEY `idx_dc_nx_pb_address_claims_created_at` (`created_at`),
  KEY `idx_dc_nx_pb_address_claims_kind` (`kind`),
  KEY `idx_dc_nx_pb_address_claims_holder_collection` (`holder_collection`),
  KEY `idx_dc_nx_pb_address_claims_holder_id` (`holder_id`),
  KEY `idx_dc_nx_pb_address_claims_space` (`space`),
  KEY `idx_dc_nx_pb_address_claims_blocked_by` (`blocked_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_nx_pb_class_usage` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope` varchar(255) DEFAULT NULL,
  `entity` varchar(255) DEFAULT NULL,
  `entity_key` varchar(255) DEFAULT NULL,
  `field` varchar(255) DEFAULT NULL,
  `locale` varchar(255) DEFAULT NULL,
  `variant` varchar(255) DEFAULT NULL,
  `class_id` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_nx_pb_class_usage_slug` (`slug`),
  KEY `idx_dc_nx_pb_class_usage_created_by` (`created_by`),
  KEY `idx_dc_nx_pb_class_usage_created_at` (`created_at`),
  KEY `idx_dc_nx_pb_class_usage_entity_key` (`entity_key`),
  KEY `idx_dc_nx_pb_class_usage_class_id` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_nx_pb_component_retired` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `identity` varchar(255) NOT NULL,
  `component_id` varchar(255) NOT NULL,
  `kind` varchar(255) NOT NULL,
  `exposure_id` text NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_nx_pb_component_retired_slug` (`slug`),
  UNIQUE KEY `uq_dc_nx_pb_component_retired_identity` (`identity`),
  KEY `idx_dc_nx_pb_component_retired_created_by` (`created_by`),
  KEY `idx_dc_nx_pb_component_retired_created_at` (`created_at`),
  KEY `idx_dc_nx_pb_component_retired_component_id` (`component_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_nx_pb_component_usage` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope` varchar(255) DEFAULT NULL,
  `entity` varchar(255) DEFAULT NULL,
  `entity_key` varchar(255) DEFAULT NULL,
  `field` varchar(255) DEFAULT NULL,
  `locale` varchar(255) DEFAULT NULL,
  `variant` varchar(255) DEFAULT NULL,
  `kind` varchar(255) DEFAULT NULL,
  `component_id` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_nx_pb_component_usage_slug` (`slug`),
  KEY `idx_dc_nx_pb_component_usage_created_by` (`created_by`),
  KEY `idx_dc_nx_pb_component_usage_created_at` (`created_at`),
  KEY `idx_dc_nx_pb_component_usage_entity_key` (`entity_key`),
  KEY `idx_dc_nx_pb_component_usage_component_id` (`component_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_nx_pb_usage_backfill` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope_key` varchar(255) DEFAULT NULL,
  `generation` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_nx_pb_usage_backfill_slug` (`slug`),
  KEY `idx_dc_nx_pb_usage_backfill_created_by` (`created_by`),
  KEY `idx_dc_nx_pb_usage_backfill_created_at` (`created_at`),
  KEY `idx_dc_nx_pb_usage_backfill_scope_key` (`scope_key`),
  KEY `idx_dc_nx_pb_usage_backfill_generation` (`generation`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_pages` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `content` json DEFAULT NULL,
  `layout` varchar(36) DEFAULT NULL,
  `no_header_footer` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_pages_slug` (`slug`),
  KEY `idx_dc_pages_created_by` (`created_by`),
  KEY `idx_dc_pages_created_at` (`created_at`),
  KEY `idx_dc_pages_layout` (`layout`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_patterns` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(255) DEFAULT NULL,
  `keywords` varchar(255) DEFAULT NULL,
  `granularity` varchar(255) NOT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_patterns_slug` (`slug`),
  KEY `idx_dc_patterns_created_by` (`created_by`),
  KEY `idx_dc_patterns_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_posts` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `excerpt` text,
  `meta_title` varchar(255) DEFAULT NULL,
  `meta_description` varchar(255) DEFAULT NULL,
  `editor_mode` varchar(255) DEFAULT NULL,
  `content` text,
  `custom_script` text,
  `settings` json DEFAULT NULL,
  `sections` json DEFAULT NULL,
  `categories` json DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `featured_image` varchar(36) DEFAULT NULL,
  `published_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_posts_slug` (`slug`),
  KEY `idx_dc_posts_created_by` (`created_by`),
  KEY `idx_dc_posts_created_at` (`created_at`),
  KEY `idx_dc_posts_featured_image` (`featured_image`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_tags` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_tags_slug` (`slug`),
  KEY `idx_dc_tags_created_by` (`created_by`),
  KEY `idx_dc_tags_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_templates` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `collection` varchar(255) DEFAULT NULL,
  `entry` varchar(255) DEFAULT NULL,
  `entry_collection` varchar(255) DEFAULT NULL,
  `entry_id` varchar(255) DEFAULT NULL,
  `forked_from` varchar(255) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_templates_slug` (`slug`),
  UNIQUE KEY `uq_dc_templates_collection` (`collection`),
  UNIQUE KEY `uq_dc_templates_entry` (`entry`),
  UNIQUE KEY `uq_dc_templates_address` (`address`),
  KEY `idx_dc_templates_created_by` (`created_by`),
  KEY `idx_dc_templates_created_at` (`created_at`),
  KEY `idx_dc_templates_entry_collection` (`entry_collection`),
  KEY `idx_dc_templates_forked_from` (`forked_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dynamic_collections` (
  `id` varchar(191) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `labels` json NOT NULL,
  `table_name` varchar(255) NOT NULL,
  `description` text,
  `fields` json NOT NULL,
  `timestamps` tinyint(1) NOT NULL DEFAULT '1',
  `status` tinyint(1) NOT NULL DEFAULT '0',
  `localized` tinyint(1) NOT NULL DEFAULT '0',
  `versions` json DEFAULT NULL,
  `revalidate` json DEFAULT NULL,
  `webhooks` json DEFAULT NULL,
  `admin` json DEFAULT NULL,
  `hooks` json DEFAULT NULL,
  `source` varchar(255) NOT NULL DEFAULT 'ui',
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `config_path` varchar(500) DEFAULT NULL,
  `schema_hash` varchar(64) NOT NULL,
  `schema_version` int NOT NULL DEFAULT '1',
  `migration_status` varchar(20) NOT NULL DEFAULT 'pending',
  `last_migration_id` varchar(100) DEFAULT NULL,
  `created_by` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug_unique` (`slug`),
  UNIQUE KEY `table_name_unique` (`table_name`),
  KEY `dynamic_collections_source_idx` (`source`),
  KEY `dynamic_collections_migration_status_idx` (`migration_status`),
  KEY `dynamic_collections_created_by_idx` (`created_by`),
  KEY `dynamic_collections_created_at_idx` (`created_at`),
  KEY `dynamic_collections_updated_at_idx` (`updated_at`),
  CONSTRAINT `dynamic_collections_created_by_users_id_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dynamic_components` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `label` varchar(255) NOT NULL,
  `table_name` varchar(255) NOT NULL,
  `description` text,
  `fields` json NOT NULL,
  `admin` json DEFAULT NULL,
  `source` varchar(255) NOT NULL DEFAULT 'ui',
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `localized` tinyint(1) NOT NULL DEFAULT '0',
  `config_path` varchar(500) DEFAULT NULL,
  `schema_hash` varchar(64) NOT NULL,
  `schema_version` int NOT NULL DEFAULT '1',
  `migration_status` varchar(20) NOT NULL DEFAULT 'pending',
  `last_migration_id` varchar(36) DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug_unique` (`slug`),
  UNIQUE KEY `table_name_unique` (`table_name`),
  KEY `dynamic_components_source_idx` (`source`),
  KEY `dynamic_components_migration_status_idx` (`migration_status`),
  KEY `dynamic_components_created_by_idx` (`created_by`),
  KEY `dynamic_components_created_at_idx` (`created_at`),
  KEY `dynamic_components_updated_at_idx` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dynamic_singles` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `label` varchar(255) NOT NULL,
  `table_name` varchar(255) NOT NULL,
  `description` text,
  `fields` json NOT NULL,
  `admin` json DEFAULT NULL,
  `source` varchar(255) NOT NULL DEFAULT 'ui',
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '0',
  `localized` tinyint(1) NOT NULL DEFAULT '0',
  `versions` json DEFAULT NULL,
  `revalidate` json DEFAULT NULL,
  `webhooks` json DEFAULT NULL,
  `config_path` varchar(500) DEFAULT NULL,
  `schema_hash` varchar(64) NOT NULL,
  `schema_version` int NOT NULL DEFAULT '1',
  `migration_status` varchar(20) NOT NULL DEFAULT 'pending',
  `last_migration_id` varchar(36) DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug_unique` (`slug`),
  UNIQUE KEY `table_name_unique` (`table_name`),
  KEY `dynamic_singles_source_idx` (`source`),
  KEY `dynamic_singles_migration_status_idx` (`migration_status`),
  KEY `dynamic_singles_created_by_idx` (`created_by`),
  KEY `dynamic_singles_created_at_idx` (`created_at`),
  KEY `dynamic_singles_updated_at_idx` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_brand` (
  `id` varchar(50) NOT NULL,
  `logo_url` varchar(2048) DEFAULT NULL,
  `logo_width` int DEFAULT NULL,
  `accent_color` varchar(16) DEFAULT NULL,
  `background_color` varchar(16) DEFAULT NULL,
  `content_color` varchar(16) DEFAULT NULL,
  `font_family` varchar(32) DEFAULT NULL,
  `footer_text` text,
  `footer_links` json DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_deliveries` (
  `id` varchar(36) NOT NULL,
  `provider_id` varchar(36) DEFAULT NULL,
  `provider_type` varchar(50) NOT NULL,
  `template_slug` varchar(255) DEFAULT NULL,
  `recipient_hash` varchar(64) NOT NULL,
  `recipient_kind` varchar(3) NOT NULL,
  `status` varchar(20) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT '1',
  `next_attempt_at` datetime(3) DEFAULT NULL,
  `error` text,
  `message_id` text,
  `retention_class` varchar(50) NOT NULL,
  `principal_kind` varchar(191) DEFAULT NULL,
  `principal_id` varchar(191) DEFAULT NULL,
  `key_digest` varchar(64) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `email_deliveries_created_idx` (`created_at`),
  KEY `email_deliveries_recipient_idx` (`recipient_hash`,`created_at`),
  KEY `email_deliveries_status_created_idx` (`status`,`created_at`),
  KEY `email_deliveries_provider_idx` (`provider_id`,`created_at`),
  KEY `email_deliveries_retention_idx` (`retention_class`,`created_at`),
  KEY `email_deliveries_principal_idx` (`principal_kind`,`principal_id`),
  KEY `email_deliveries_key_idx` (`key_digest`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_providers` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` varchar(50) NOT NULL,
  `from_email` varchar(255) NOT NULL,
  `from_name` varchar(255) DEFAULT NULL,
  `configuration` json NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `email_providers_type_idx` (`type`),
  KEY `email_providers_is_default_idx` (`is_default`),
  KEY `email_providers_is_active_idx` (`is_active`),
  KEY `email_providers_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_queue` (
  `id` varchar(36) NOT NULL,
  `scope` text NOT NULL,
  `state` varchar(16) NOT NULL,
  `job_id` varchar(36) DEFAULT NULL,
  `message` longtext,
  `principal_kind` varchar(191) DEFAULT NULL,
  `principal_id` varchar(191) DEFAULT NULL,
  `failure` text,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  `settled_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `email_queue_state_idx` (`state`,`settled_at`),
  KEY `email_queue_principal_idx` (`principal_kind`,`principal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_queue_recipients` (
  `queued_id` varchar(36) NOT NULL,
  `recipient_hash` varchar(64) NOT NULL,
  `recipient_kind` varchar(8) NOT NULL,
  PRIMARY KEY (`queued_id`,`recipient_hash`),
  KEY `email_queue_recipients_hash_idx` (`recipient_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_send_claims` (
  `id` varchar(36) NOT NULL,
  `scope` text NOT NULL,
  `key_digest` varchar(64) DEFAULT NULL,
  `message_digest` varchar(64) DEFAULT NULL,
  `state` varchar(16) NOT NULL,
  `holder` varchar(36) NOT NULL,
  `result` longtext,
  `claimed_at` bigint NOT NULL,
  `lease_expires_at` bigint NOT NULL,
  `settled_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_send_claims_key_idx` (`key_digest`),
  KEY `email_send_claims_state_idx` (`state`,`settled_at`),
  KEY `email_send_claims_lease_idx` (`lease_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_templates` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `subject` text NOT NULL,
  `html_content` text NOT NULL,
  `plain_text_content` text,
  `preheader` text,
  `kind` varchar(20) DEFAULT 'template',
  `layout_id` varchar(36) DEFAULT NULL,
  `variables` json DEFAULT NULL,
  `use_layout` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `provider_id` varchar(36) DEFAULT NULL,
  `from_override` text,
  `reply_to` text,
  `cc` json DEFAULT NULL,
  `bcc` json DEFAULT NULL,
  `attachments` json DEFAULT NULL,
  `owner_kind` varchar(20) DEFAULT NULL,
  `owner_name` text,
  `overridden` tinyint(1) DEFAULT NULL,
  `base_digest` varchar(64) DEFAULT NULL,
  `base_version` json DEFAULT NULL,
  `carries_secret` tinyint(1) DEFAULT NULL,
  `description` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug_unique` (`slug`),
  KEY `email_templates_is_active_idx` (`is_active`),
  KEY `email_templates_provider_id_idx` (`provider_id`),
  KEY `email_templates_kind_idx` (`kind`),
  KEY `email_templates_layout_id_idx` (`layout_id`),
  KEY `email_templates_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `email_verification_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `identifier` varchar(255) NOT NULL,
  `user_id` varchar(191) DEFAULT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `evt_identifier_token_hash_unique` (`identifier`,`token_hash`),
  KEY `evt_user_id_idx` (`user_id`),
  KEY `evt_expires_idx` (`expires`),
  KEY `evt_token_hash_idx` (`token_hash`),
  CONSTRAINT `email_verification_tokens_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `media` (
  `id` varchar(36) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `size` int NOT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `duration` int DEFAULT NULL,
  `url` text NOT NULL,
  `thumbnail_url` text,
  `focal_x` int DEFAULT NULL,
  `focal_y` int DEFAULT NULL,
  `alt_text` text,
  `caption` text,
  `tags` json DEFAULT NULL,
  `folder_id` varchar(255) DEFAULT NULL,
  `uploaded_by` varchar(255) DEFAULT NULL,
  `uploaded_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `media_uploaded_by_idx` (`uploaded_by`),
  KEY `media_mime_type_idx` (`mime_type`),
  KEY `media_uploaded_at_idx` (`uploaded_at`),
  KEY `media_folder_id_idx` (`folder_id`),
  CONSTRAINT `media_folder_id_media_folders_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `media_folders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `media_uploaded_by_users_id_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `media_folders` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `parent_id` varchar(255) DEFAULT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `media_folders_parent_id_idx` (`parent_id`),
  KEY `media_folders_created_by_idx` (`created_by`),
  KEY `media_folders_created_at_idx` (`created_at`),
  CONSTRAINT `media_folders_created_by_users_id_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `media_folders_parent_id_media_folders_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `media_folders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_cache_tag_expiries` (
  `id` varchar(64) NOT NULL,
  `tag` text NOT NULL,
  `expired_at` bigint NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ncte_expired_at_idx` (`expired_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_content_event_parts` (
  `event_id` varchar(36) NOT NULL,
  `part` varchar(35) NOT NULL,
  PRIMARY KEY (`event_id`,`part`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_content_events` (
  `id` varchar(36) NOT NULL,
  `subject_kind` varchar(16) NOT NULL,
  `subject_slug` varchar(255) DEFAULT NULL,
  `subject_id` varchar(255) NOT NULL,
  `kind` varchar(64) NOT NULL,
  `ends_subject` tinyint(1) NOT NULL DEFAULT '0',
  `ended_by` varchar(36) DEFAULT NULL,
  `actor_kind` varchar(16) NOT NULL,
  `actor_id` varchar(255) DEFAULT NULL,
  `actor_principal_kind` varchar(64) DEFAULT NULL,
  `actor_name` varchar(255) DEFAULT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `from_state` varchar(64) DEFAULT NULL,
  `to_state` varchar(64) DEFAULT NULL,
  `note` text,
  `version_no` int DEFAULT NULL,
  `payload` json DEFAULT NULL,
  `definition_hash` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `nextly_content_events_subject_idx` (`subject_kind`,`subject_slug`,`subject_id`,`id`),
  KEY `nextly_content_events_ends_idx` (`ends_subject`,`occurred_at`),
  KEY `nextly_content_events_ended_by_idx` (`ended_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_dashboard_pins` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `target_type` varchar(16) NOT NULL,
  `target_slug` varchar(191) NOT NULL,
  `entry_id` varchar(191) NOT NULL,
  `pinned_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_dashboard_pins_target_uidx` (`user_id`,`target_type`,`target_slug`,`entry_id`),
  KEY `nextly_dashboard_pins_user_idx` (`user_id`,`pinned_at`),
  KEY `nextly_dashboard_pins_entry_idx` (`target_type`,`target_slug`,`entry_id`),
  CONSTRAINT `nextly_dashboard_pins_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_dashboard_preferences` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `preference_key` varchar(64) NOT NULL,
  `value` varchar(255) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_dashboard_preferences_key_uidx` (`user_id`,`preference_key`),
  CONSTRAINT `nextly_dashboard_preferences_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_deleted_principals` (
  `digest` varchar(64) NOT NULL,
  `deleted_at` datetime NOT NULL,
  PRIMARY KEY (`digest`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_document_lock` (
  `id` varchar(191) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `slug` varchar(191) NOT NULL,
  `entry_id` varchar(191) NOT NULL,
  `owner_id` varchar(191) NOT NULL,
  `claim_token` varchar(36) NOT NULL,
  `owner_label` varchar(255) DEFAULT NULL,
  `acquired_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `waiting_until` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ndl_expires_at_idx` (`expires_at`),
  KEY `ndl_scope_idx` (`scope_kind`,`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_events` (
  `id` varchar(191) NOT NULL,
  `type` varchar(100) NOT NULL,
  `resource_kind` varchar(20) NOT NULL,
  `resource_collection` varchar(255) DEFAULT NULL,
  `resource_id` varchar(191) DEFAULT NULL,
  `payload` json NOT NULL,
  `actor_type` varchar(20) DEFAULT NULL,
  `actor_id` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `fanned_out_at` datetime DEFAULT NULL,
  `outcome` varchar(16) NOT NULL DEFAULT 'success',
  `retention_class` varchar(20) NOT NULL DEFAULT 'webhook',
  PRIMARY KEY (`id`),
  KEY `nextly_events_type_created_at_idx` (`type`,`created_at`),
  KEY `nextly_events_fanned_out_at_idx` (`fanned_out_at`,`created_at`),
  KEY `nextly_events_retention_idx` (`retention_class`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_field_group_lock` (
  `id` int NOT NULL,
  `owner` text,
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_field_group_lock` (`id`, `owner`, `expires_at`) VALUES (1, NULL, NULL);
CREATE TABLE `nextly_i18n_archive` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `collection` varchar(191) NOT NULL,
  `entity_kind` varchar(20) NOT NULL DEFAULT 'unknown',
  `entry_id` varchar(191) NOT NULL,
  `locale` varchar(20) NOT NULL,
  `field` varchar(191) NOT NULL,
  `value` longtext,
  `archived_at` datetime(3) NOT NULL DEFAULT (now(3)),
  PRIMARY KEY (`id`),
  KEY `nextly_i18n_archive_lookup_idx` (`collection`,`entry_id`,`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_jobs` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(191) NOT NULL,
  `input` json DEFAULT NULL,
  `state` varchar(32) NOT NULL,
  `run_at` datetime(3) DEFAULT NULL,
  `run_as_user_id` varchar(191) DEFAULT NULL,
  `dedupe_key` varchar(191) DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  `next_attempt_at` datetime(3) DEFAULT NULL,
  `locked_by` varchar(191) DEFAULT NULL,
  `locked_until` datetime(3) DEFAULT NULL,
  `last_error` text,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_jobs_dedupe_idx` (`dedupe_key`),
  KEY `nextly_jobs_due_idx` (`state`,`run_at`),
  KEY `nextly_jobs_recent_idx` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_languages` (
  `code` varchar(20) NOT NULL,
  `label` varchar(255) NOT NULL,
  `direction` varchar(3) NOT NULL DEFAULT 'ltr',
  `fallback` text NOT NULL,
  `position` int NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `revision` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_limit_store` (
  `id` varchar(64) NOT NULL,
  `value` text,
  `expires_at` bigint NOT NULL,
  `generation` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nls_expires_at_idx` (`expires_at`),
  KEY `nls_generation_idx` (`generation`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_media_usage` (
  `id` varchar(36) NOT NULL,
  `media_id` varchar(36) NOT NULL,
  `subject_kind` varchar(16) NOT NULL,
  `subject_slug` varchar(191) NOT NULL,
  `document_id` varchar(191) NOT NULL,
  `field_path` varchar(255) NOT NULL,
  `locale` varchar(35) NOT NULL,
  `address` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_media_usage_uidx` (`subject_kind`,`subject_slug`,`document_id`,`field_path`,`locale`,`media_id`),
  KEY `nextly_media_usage_media_idx` (`media_id`),
  CONSTRAINT `nextly_media_usage_media_id_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `media` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_meta` (
  `key` varchar(191) NOT NULL,
  `value` json DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`key`),
  KEY `nextly_meta_updated_at_idx` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('preset_grants_release', '\"{\\\"release\\\":\\\"0.0.2-alpha.75\\\"}\"', '2026-11-13 16:08:31');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('registry_record', '\"{\\\"point\\\":null,\\\"baseline\\\":{\\\"collections\\\":{},\\\"singles\\\":{},\\\"fieldGroups\\\":{},\\\"permissions\\\":[]}}\"', '2026-11-13 16:08:30');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('schema_version', '\"{\\\"migration\\\":\\\"20261113_160824_193_create_localization_seo\\\",\\\"seq\\\":1}\"', '2026-11-13 16:08:30');
CREATE TABLE `nextly_notices` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `kind` varchar(64) NOT NULL,
  `subject_type` varchar(64) NOT NULL,
  `subject_id` varchar(191) NOT NULL,
  `occurrence` varchar(191) NOT NULL,
  `dedupe_key` varchar(64) NOT NULL,
  `data` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `read_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_notices_dedupe_uidx` (`dedupe_key`),
  KEY `nextly_notices_user_idx` (`user_id`,`read_at`,`created_at`,`id`),
  KEY `nextly_notices_inbox_idx` (`user_id`,`created_at`,`id`),
  KEY `nextly_notices_subject_idx` (`subject_type`,`subject_id`),
  KEY `nextly_notices_created_idx` (`created_at`),
  CONSTRAINT `nextly_notices_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_one_time_secrets` (
  `id` varchar(36) NOT NULL,
  `owner` text NOT NULL,
  `purpose` varchar(64) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `subject_key` varchar(64) NOT NULL,
  `kind` varchar(8) NOT NULL,
  `secret_hash` varchar(64) NOT NULL,
  `live_key` varchar(64) DEFAULT NULL,
  `issue_seq` int DEFAULT NULL,
  `data` text,
  `expires_at` timestamp NOT NULL,
  `spent_at` timestamp NULL DEFAULT NULL,
  `voided_at` timestamp NULL DEFAULT NULL,
  `wrong_tries` int NOT NULL DEFAULT '0',
  `max_wrong_tries` int DEFAULT NULL,
  `created_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_one_time_secrets_live_key_unique` (`live_key`),
  UNIQUE KEY `nextly_one_time_secrets_issue_unique` (`subject_key`,`purpose`,`kind`,`issue_seq`),
  KEY `nextly_one_time_secrets_hash_idx` (`secret_hash`),
  KEY `nextly_one_time_secrets_subject_key_idx` (`subject_key`),
  KEY `nextly_one_time_secrets_expires_idx` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_plugin_event_deliveries` (
  `id` varchar(36) NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `subscriber` text NOT NULL,
  `subscriber_key` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  `next_attempt_at` datetime(3) NOT NULL,
  `locked_by` varchar(64) DEFAULT NULL,
  `locked_until` datetime(3) DEFAULT NULL,
  `last_error` text,
  `created_at` datetime(3) NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_plugin_event_deliveries_event_subscriber_unique` (`event_id`,`subscriber_key`),
  KEY `nextly_plugin_event_deliveries_due_idx` (`status`,`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_plugin_events` (
  `id` varchar(36) NOT NULL,
  `owner` text NOT NULL,
  `name` text NOT NULL,
  `payload` mediumtext NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `fanned_out_at` datetime(3) DEFAULT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `nextly_plugin_events_fan_out_idx` (`fanned_out_at`,`created_at`),
  KEY `nextly_plugin_events_finished_idx` (`finished_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_plugin_settings` (
  `owner` varchar(191) NOT NULL,
  `key` varchar(191) NOT NULL,
  `value` mediumtext NOT NULL,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL,
  `updated_by` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`owner`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_preview_links` (
  `id` varchar(64) NOT NULL,
  `document_kind` varchar(16) NOT NULL,
  `document_slug` varchar(255) NOT NULL,
  `entry_id` varchar(255) DEFAULT NULL,
  `locale` varchar(64) DEFAULT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `generation` int NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `revoked_by` varchar(191) DEFAULT NULL,
  `open_count` int NOT NULL DEFAULT '0',
  `last_opened_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `nextly_preview_links_document_idx` (`document_kind`,`document_slug`,`entry_id`),
  KEY `nextly_preview_links_expires_idx` (`expires_at`),
  KEY `nextly_preview_links_created_by_idx` (`created_by`),
  KEY `nextly_preview_links_revoked_by_idx` (`revoked_by`),
  KEY `nextly_preview_links_revoked_idx` (`revoked_at`),
  CONSTRAINT `nextly_preview_links_created_by_users_id_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nextly_preview_links_revoked_by_users_id_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_rbac_epoch` (
  `id` varchar(32) NOT NULL,
  `revision` bigint NOT NULL,
  `generation` varchar(64) NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_rbac_epoch` (`id`, `revision`, `generation`, `updated_at`) VALUES ('global', '6', '0fba5751-d2aa-49df-a7c7-821131787d5e', '2026-11-13 16:08:31');
CREATE TABLE `nextly_received_webhooks` (
  `delivery_key` varchar(64) NOT NULL,
  `owner` text NOT NULL,
  `provider` varchar(191) NOT NULL,
  `delivery_id` varchar(191) DEFAULT NULL,
  `freshness` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL,
  `claim_token` varchar(36) NOT NULL,
  `lease_until` timestamp NULL DEFAULT NULL,
  `received_at` timestamp NOT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `prune_at` timestamp NOT NULL,
  PRIMARY KEY (`delivery_key`),
  KEY `nextly_received_webhooks_prune_idx` (`prune_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_release_members` (
  `id` varchar(36) NOT NULL,
  `release_id` varchar(36) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_slug` varchar(255) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `locale` varchar(32) DEFAULT NULL,
  `action` varchar(32) NOT NULL,
  `member_key` varchar(64) NOT NULL,
  `single_slot` int DEFAULT NULL,
  `applied_revision` int DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_release_members_key_uidx` (`member_key`),
  UNIQUE KEY `nextly_release_members_single_uidx` (`release_id`,`single_slot`),
  KEY `nextly_release_members_doc_idx` (`scope_kind`,`scope_slug`,`entry_id`,`locale`),
  KEY `nextly_release_members_release_idx` (`release_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_releases` (
  `id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `scheduled_at` datetime(3) DEFAULT NULL,
  `timezone` varchar(64) DEFAULT NULL,
  `state` varchar(32) NOT NULL,
  `kind` varchar(16) NOT NULL DEFAULT 'release',
  `published_at` datetime(3) DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `revision` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `nextly_releases_due_idx` (`state`,`scheduled_at`),
  KEY `nextly_releases_scheduled_idx` (`scheduled_at`),
  KEY `nextly_releases_published_idx` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_review_states` (
  `id` varchar(36) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_slug` varchar(255) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `part` varchar(35) DEFAULT NULL,
  `part_key` varchar(64) NOT NULL,
  `stage` varchar(64) NOT NULL,
  `entered_at` datetime(3) NOT NULL,
  `entered_by` varchar(255) DEFAULT NULL,
  `assignee_kind` varchar(16) DEFAULT NULL,
  `assignee_id` varchar(255) DEFAULT NULL,
  `due_at` datetime(3) DEFAULT NULL,
  `approved_version_no` int DEFAULT NULL,
  `approved_digest` varchar(64) DEFAULT NULL,
  `approved_by` varchar(255) DEFAULT NULL,
  `approved_at` datetime(3) DEFAULT NULL,
  `definition_hash` varchar(64) NOT NULL,
  `revision` int NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_review_states_key_uidx` (`part_key`),
  KEY `nextly_review_states_doc_idx` (`scope_kind`,`scope_slug`,`entry_id`),
  KEY `nextly_review_states_stage_idx` (`scope_kind`,`scope_slug`,`stage`),
  KEY `nextly_review_states_assignee_idx` (`assignee_kind`,`assignee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_schedule_windows` (
  `schedule_key` varbinary(191) NOT NULL,
  `window_at` datetime(3) NOT NULL,
  `job_id` varchar(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`schedule_key`,`window_at`),
  KEY `nextly_schedule_windows_window_idx` (`window_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_schema_events` (
  `id` varchar(36) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL,
  `source` varchar(32) NOT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `sha256` varchar(64) DEFAULT NULL,
  `scope_kind` varchar(32) DEFAULT NULL,
  `scope_slug` varchar(255) DEFAULT NULL,
  `started_at` datetime(3) NOT NULL,
  `ended_at` datetime(3) DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `applied_by` varchar(255) DEFAULT NULL,
  `note` text,
  `statements_planned` int DEFAULT NULL,
  `statements_executed` int DEFAULT NULL,
  `renames_applied` int DEFAULT NULL,
  `error_code` varchar(64) DEFAULT NULL,
  `error_message` text,
  `error_json` json DEFAULT NULL,
  `superseded_event_ids` json DEFAULT NULL,
  `superseded_at` datetime(3) DEFAULT NULL,
  `superseded_by` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `nextly_schema_events_started_at_idx` (`started_at`),
  KEY `nextly_schema_events_scope_idx` (`scope_kind`,`scope_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('0931f090-2090-4f0a-a373-a0668b6c7a48', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-13 16:08:29.456', '2026-11-13 16:08:29.470', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('1c88438b-549b-4561-9155-cf879b1bada5', 'file_apply', 'applied', 'cli-migrate', '20261113_160824_189_baseline.sql', 'f3d525585c230aa8f655fa459366d3ca7be8bd4197928435d72c00043bd723e0', NULL, NULL, '2026-11-13 16:08:29.663', '2026-11-13 16:08:30.371', NULL, NULL, NULL, NULL, 121, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('23e61d51-52b9-4409-909f-f6cc7c41ec63', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-13 16:08:29.167', '2026-11-13 16:08:29.189', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('5bdc9174-2756-4fdf-8568-f562999ac73d', 'file_apply', 'applied', 'cli-migrate', '20261113_160824_193_create_localization_seo.sql', '837ed5be13a6a4ad5d4e2a4ca43c0ddb47385d5dbd38d209eb59c7ef9d76bbdd', NULL, NULL, '2026-11-13 16:08:30.444', '2026-11-13 16:08:30.452', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('715a39fb-7c98-4edf-8cc4-605a9ee42ba4', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-13 16:08:29.234', '2026-11-13 16:08:29.251', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('81788e67-6be0-40d3-8bcf-ac856c2630b9', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-13 16:08:29.564', '2026-11-13 16:08:29.596', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('86782454-7831-4237-8233-5228aadf3240', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-13 16:08:29.506', '2026-11-13 16:08:29.527', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('9d310545-8aef-455e-87e4-6c09913ff6c2', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-13 16:08:29.348', '2026-11-13 16:08:29.368', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('9e35c463-7d59-4efd-b7b2-ad757de733fa', 'file_apply', 'applied', 'cli-migrate', '20261113_160824_192_create_localization_announcement.sql', 'fa8e60fe69befbc3d3e126b1e27dcf4cd070f026c70faf597e2f1a2c4deba826', NULL, NULL, '2026-11-13 16:08:30.430', '2026-11-13 16:08:30.440', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('a0014853-6233-48c9-aa9e-c46607c20c2d', 'file_apply', 'applied', 'cli-migrate', '20261113_160824_191_create_localization_site-settings.sql', 'a72ab5cb8b7a8c5c290f8db8363ac5902f82089b2629d961aa64ebc278a15dcc', NULL, NULL, '2026-11-13 16:08:30.412', '2026-11-13 16:08:30.425', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('a94c3e28-d261-47ec-a7b8-fb91e1352f5b', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-13 16:08:29.288', '2026-11-13 16:08:29.303', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('ae31b9df-1f09-4f87-95fd-7676b580a987', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-13 16:08:29.110', '2026-11-13 16:08:29.129', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('bc5587e6-9969-4462-946f-b7cbdfaebf1d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-13 16:08:29.400', '2026-11-13 16:08:29.426', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('e54d553f-68ca-4db0-ab77-f1fe13a3f858', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-13 16:08:29.023', '2026-11-13 16:08:29.024', NULL, NULL, NULL, NULL, 220, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f9e78741-4bbc-430a-bf9c-2ad42da4a152', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-13 16:08:29.061', '2026-11-13 16:08:29.080', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('fc3e9d30-df1a-4b74-9e85-7b2c31f09de0', 'file_apply', 'applied', 'cli-migrate', '20261113_160824_190_create_localization_authors.sql', '2cc3400a4a8e3e0952e731439580f58da727bc61dc5c954019634975b4c191ba', NULL, NULL, '2026-11-13 16:08:30.395', '2026-11-13 16:08:30.407', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
CREATE TABLE `nextly_schema_lock` (
  `id` int NOT NULL,
  `owner` text,
  `command` text,
  `acquired_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_schema_lock` (`id`, `owner`, `command`, `acquired_at`, `expires_at`) VALUES (1, NULL, NULL, NULL, NULL);
CREATE TABLE `nextly_schema_owners` (
  `table_name` varchar(64) NOT NULL,
  `element_kind` varchar(16) NOT NULL DEFAULT 'table',
  `element_name` varchar(64) NOT NULL DEFAULT '',
  `owner_kind` varchar(32) NOT NULL,
  `owner_id` varchar(255) NOT NULL,
  `migrated_by` varchar(255) NOT NULL,
  `owner_version` varchar(64) DEFAULT NULL,
  `schema_version` int DEFAULT NULL,
  `state` varchar(32) NOT NULL,
  `created_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`table_name`,`element_kind`,`element_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:08:29', '2026-11-13 16:08:30');
CREATE TABLE `nextly_spent_challenges` (
  `id` varchar(64) NOT NULL,
  `expires_at` bigint NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nsc_expires_at_idx` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_version_pins` (
  `id` varchar(36) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_slug` varchar(255) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `holder` varchar(64) NOT NULL,
  `slot` varchar(191) NOT NULL,
  `version_no` int NOT NULL,
  `pin_key` varchar(64) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_version_pins_key_uidx` (`pin_key`),
  KEY `nextly_version_pins_doc_idx` (`scope_kind`,`scope_slug`,`entry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_version_views` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_slug` varchar(255) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `part` varchar(35) DEFAULT NULL,
  `view_key` varchar(64) NOT NULL,
  `version_no` int NOT NULL,
  `previous_version_no` int DEFAULT NULL,
  `viewed_at` datetime(3) NOT NULL,
  `visit_started_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_version_views_key_uidx` (`view_key`),
  KEY `nextly_version_views_doc_idx` (`scope_kind`,`scope_slug`,`entry_id`),
  KEY `nextly_version_views_user_idx` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_versions` (
  `id` varchar(36) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_slug` varchar(255) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `version_no` int DEFAULT NULL,
  `status` varchar(32) NOT NULL,
  `is_autosave` tinyint(1) NOT NULL DEFAULT '0',
  `snapshot` json NOT NULL,
  `label` text,
  `locale` varchar(32) DEFAULT NULL,
  `source_version_no` int DEFAULT NULL,
  `draft_key` varchar(64) DEFAULT NULL,
  `created_by` varchar(191) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `revision` int NOT NULL DEFAULT '0',
  `base_version_no` int DEFAULT NULL,
  `base_draft_revision` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_versions_seq_uidx` (`scope_kind`,`scope_slug`,`entry_id`,`version_no`),
  UNIQUE KEY `nextly_versions_working_draft_uidx` (`draft_key`),
  KEY `nextly_versions_doc_recent_idx` (`scope_kind`,`scope_slug`,`entry_id`,`created_at`),
  KEY `nextly_versions_pending_edits_idx` (`is_autosave`,`status`,`version_no`,`scope_slug`,`updated_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_webhook_deliveries` (
  `id` varchar(191) NOT NULL,
  `webhook_id` varchar(191) NOT NULL,
  `event_id` varchar(191) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT '0',
  `next_attempt_at` datetime DEFAULT NULL,
  `locked_by` varchar(191) DEFAULT NULL,
  `locked_until` datetime DEFAULT NULL,
  `last_status_code` int DEFAULT NULL,
  `last_latency_ms` int DEFAULT NULL,
  `last_error` text,
  `last_response_snippet` text,
  `attempts` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_webhook_deliveries_webhook_event_unique` (`webhook_id`,`event_id`),
  KEY `nextly_webhook_deliveries_status_next_idx` (`status`,`next_attempt_at`),
  KEY `nextly_webhook_deliveries_event_idx` (`event_id`),
  KEY `nextly_webhook_deliveries_retention_idx` (`status`,`updated_at`),
  KEY `nextly_webhook_deliveries_webhook_created_idx` (`webhook_id`,`created_at`,`id`),
  CONSTRAINT `nextly_webhook_deliveries_event_id_nextly_events_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `nextly_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nextly_webhook_deliveries_webhook_id_nextly_webhooks_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `nextly_webhooks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_webhooks` (
  `id` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `url` text NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `event_types` json NOT NULL,
  `filter` json DEFAULT NULL,
  `headers` json DEFAULT NULL,
  `secret_hash` json NOT NULL,
  `secret_prefix` varchar(16) NOT NULL,
  `field_allowlist` json DEFAULT NULL,
  `created_by` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `nextly_webhooks_enabled_idx` (`enabled`),
  KEY `nextly_webhooks_created_by_users_id_fkey` (`created_by`),
  CONSTRAINT `nextly_webhooks_created_by_users_id_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_widget_layout` (
  `id` varchar(191) NOT NULL,
  `scope_kind` varchar(32) NOT NULL,
  `scope_id` varchar(191) NOT NULL,
  `layout` mediumtext NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_workflow_settings` (
  `id` varchar(36) NOT NULL,
  `workflow` varchar(64) NOT NULL,
  `settings` text NOT NULL,
  `revision` int NOT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_workflow_settings_workflow_uidx` (`workflow`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__binding_issues` (
  `id` varchar(36) NOT NULL,
  `document_key` varchar(512) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `document_id` varchar(255) DEFAULT NULL,
  `place` varchar(16) NOT NULL,
  `issues` json NOT NULL,
  `dirty` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__binding_issues_document_key` (`document_key`),
  KEY `idx_page_builder__binding_issues_dirty` (`dirty`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__binding_report_runs` (
  `id` varchar(36) NOT NULL,
  `name` varchar(32) NOT NULL,
  `checked` varchar(64) DEFAULT NULL,
  `checking` varchar(64) DEFAULT NULL,
  `cursor` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__binding_report_runs_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__breakpoint_removal_fragments` (
  `id` varchar(36) NOT NULL,
  `run_id` char(36) NOT NULL,
  `document_key` varchar(512) NOT NULL,
  `host` json DEFAULT NULL,
  `form` varchar(16) NOT NULL,
  `fragment` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_page_builder__breakpoint_removal_fragments_run_id` (`run_id`),
  KEY `idx_page_builder__breakpoint_removal_fragments_created_at` (`created_at`),
  KEY `idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv` (`run_id`,`document_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__breakpoint_removals` (
  `id` varchar(36) NOT NULL,
  `removed_ids` text NOT NULL,
  `before` text NOT NULL,
  `started_by` varchar(255) NOT NULL,
  `phase` varchar(16) NOT NULL DEFAULT 'converting',
  `cursor` varchar(1024) DEFAULT NULL,
  `open_key` varchar(16) DEFAULT NULL,
  `undoes` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__breakpoint_removals_open_key` (`open_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__class_usage` (
  `id` varchar(36) NOT NULL,
  `scope` varchar(16) NOT NULL,
  `entity` varchar(255) NOT NULL,
  `entity_key` varchar(255) NOT NULL,
  `field` varchar(255) NOT NULL,
  `locale` varchar(64) NOT NULL,
  `variant` varchar(16) NOT NULL,
  `class_id` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_page_builder__class_usage_entity_entity_key_178r965` (`entity`,`entity_key`),
  KEY `idx_page_builder__class_usage_class_id` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__component_deletion_hosts` (
  `id` varchar(36) NOT NULL,
  `deletion_id` char(36) NOT NULL,
  `host_key` varchar(512) NOT NULL,
  `state` varchar(16) NOT NULL,
  `reason` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01` (`deletion_id`,`host_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__component_deletions` (
  `id` varchar(36) NOT NULL,
  `component_id` varchar(255) NOT NULL,
  `purpose` varchar(32) NOT NULL,
  `started_by` varchar(255) NOT NULL,
  `phase` varchar(16) NOT NULL DEFAULT 'converting',
  `cursor` varchar(1024) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__component_deletions_component_id_purpo_1mlwby6` (`component_id`,`purpose`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__component_usage` (
  `id` varchar(36) NOT NULL,
  `scope` varchar(16) NOT NULL,
  `entity` varchar(255) NOT NULL,
  `entity_key` varchar(255) NOT NULL,
  `field` varchar(255) NOT NULL,
  `locale` varchar(64) NOT NULL,
  `variant` varchar(16) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `component_id` varchar(512) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_page_builder__component_usage_entity_entity_key_178r965` (`entity`,`entity_key`),
  KEY `idx_page_builder__component_usage_component_id` (`component_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__layout_removals` (
  `id` varchar(36) NOT NULL,
  `layout_id` varchar(255) NOT NULL,
  `action` varchar(16) NOT NULL,
  `step` varchar(16) NOT NULL,
  `token` char(36) NOT NULL,
  `started_by` varchar(255) DEFAULT NULL,
  `pages_left` int DEFAULT NULL,
  `copy` json DEFAULT NULL,
  `copy_version` varchar(128) DEFAULT NULL,
  `settled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__layout_removals_layout_id` (`layout_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__site_options` (
  `id` varchar(36) NOT NULL,
  `name` varchar(64) NOT NULL,
  `value` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__site_options_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__token_usage` (
  `id` varchar(36) NOT NULL,
  `scope` varchar(16) NOT NULL,
  `entity` varchar(255) NOT NULL,
  `entity_key` varchar(255) NOT NULL,
  `field` varchar(255) NOT NULL,
  `locale` varchar(64) NOT NULL,
  `variant` varchar(16) NOT NULL,
  `token_id` varchar(512) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_page_builder__token_usage_entity_entity_key_178r965` (`entity`,`entity_key`),
  KEY `idx_page_builder__token_usage_token_id` (`token_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__usage_progress` (
  `id` varchar(36) NOT NULL,
  `token` char(36) NOT NULL,
  `scope_key` varchar(512) NOT NULL,
  `cursor` varchar(255) DEFAULT NULL,
  `done` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__usage_progress_token_scope_key_0ujeq6m` (`token`,`scope_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `page_builder__usage_runs` (
  `id` varchar(36) NOT NULL,
  `name` varchar(64) NOT NULL,
  `generation` varchar(512) NOT NULL,
  `token` char(36) NOT NULL,
  `dirty` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_builder__usage_runs_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `identifier` varchar(255) NOT NULL,
  `user_id` varchar(191) DEFAULT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `prt_identifier_token_hash_unique` (`identifier`,`token_hash`),
  KEY `prt_user_id_idx` (`user_id`),
  KEY `prt_expires_idx` (`expires`),
  KEY `prt_token_hash_idx` (`token_hash`),
  KEY `prt_used_at_idx` (`used_at`),
  CONSTRAINT `password_reset_tokens_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `permissions` (
  `id` varchar(191) NOT NULL,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `action` varchar(50) NOT NULL,
  `resource` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `owner` varchar(191) DEFAULT NULL,
  `orphaned_at` datetime DEFAULT NULL,
  `permission_group` varchar(191) DEFAULT NULL,
  `danger` tinyint(1) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `permissions_action_resource_unique` (`action`,`resource`),
  UNIQUE KEY `permissions_slug_unique` (`slug`),
  KEY `permissions_resource_idx` (`resource`),
  KEY `permissions_action_idx` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('048576c9-6c63-4c89-8025-7571f6842a14', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0db8ecbc-b91e-4bbb-98b6-12fa40d5ffa3', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1564df58-383f-44a7-9a98-132ec9b83ba0', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1e1661b6-3782-482a-ad1a-98ae0f368d73', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2677c154-1c83-4c9c-82ce-ce96202a5553', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('296cac18-d0f8-4d36-bc54-706d79597cef', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2a89bd68-ee59-4e30-a8a5-3dfe760eb754', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('32d184dd-3341-4fbd-a274-4bea3568982f', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3f4c0bf2-38e1-4999-a715-c7bfbe224bf7', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('424e7a94-e7bf-4d02-bb3b-13a784db22a5', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('530bab23-128a-4fa1-89e9-68b28280ff09', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('55ae7f5f-a48d-4937-a04e-3a81cc627142', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('55ee4ba8-c950-4ff5-86d8-f93b2b95c53d', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('563b4570-0855-4293-bf6b-680e3e93e1e8', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('58423562-72b5-46ba-8b53-bbe3f5491339', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6460cc71-963f-488a-9502-3558871bd9e1', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('69927e7a-2db8-4b0e-8680-764f1be4dc49', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('71666013-ffe6-4c4c-93b2-fc5ad9e60d29', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('754ebb6e-0f5c-4b9a-872d-c0cbcf3c3326', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8b1fcc8d-7fa5-4fc2-84c4-def61b59faa5', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site\'s shared styles. A locked style can\'t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8b83b801-7455-45c9-aa18-48c1251fb84a', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('922cdc19-a9e0-46ea-96c8-c59d3287cdbe', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9fb1b900-835c-4191-b87a-0bc27dfb8b84', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('bf5e71c8-0bd5-41bb-9d20-ede81989dbc8', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c3822d5c-778b-4d8f-864c-1a9dba0495f1', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ca118744-3dd7-4f87-915f-dc5d15bc549b', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site\'s breakpoints, and choose its default Layout.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cbae1972-0111-4e10-b6f6-b8bc0c4ce212', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cc107464-59a6-4494-9e31-7025e80f2da7', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cc33104f-5d76-4018-bfb6-bf725d4a7edb', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cfcd6829-87f2-47f3-beb3-7c5d69329988', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d06559e1-a027-4328-b7db-8f49650aa055', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d1dc00b4-f837-4826-9dd9-59a985778d95', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d4cd43e5-5eba-46af-bf58-65b67a79927e', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dc625155-8f91-4d88-84df-322667dd8ab2', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection\'s entries are served at. A change moves every entry\'s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e44b24cc-1e43-4b67-93fa-47906ea98c75', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e6d9aa55-4b78-4359-a9c5-52f9b5d2ebbc', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', 1, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ea46adef-3842-4440-8a0d-7f9e640af2d0', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('eb24b82a-322a-42de-b4bf-42ef6b715c78', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ed75adcf-ebcd-4c65-968a-abd3089256ed', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f3de28b2-68df-4747-9bf8-aec0eec3b597', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f675bac3-ae07-4e2f-8fc3-9cde52399604', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('fd0b32a1-c9d0-49fc-a8d8-8326d0e0079a', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, 0, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
CREATE TABLE `refresh_tokens` (
  `id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `user_agent` text,
  `ip_address` varchar(45) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `refresh_tokens_token_hash_idx` (`token_hash`),
  KEY `refresh_tokens_user_id_idx` (`user_id`),
  KEY `refresh_tokens_expires_at_idx` (`expires_at`),
  CONSTRAINT `refresh_tokens_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `role_inherits` (
  `id` varchar(191) NOT NULL,
  `parent_role_id` varchar(191) NOT NULL,
  `child_role_id` varchar(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_inherits_parent_child_unique` (`parent_role_id`,`child_role_id`),
  KEY `role_inherits_child_idx` (`child_role_id`),
  KEY `role_inherits_parent_idx` (`parent_role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `role_permissions` (
  `id` varchar(191) NOT NULL,
  `role_id` varchar(191) NOT NULL,
  `permission_id` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_permissions_role_permission_unique` (`role_id`,`permission_id`),
  KEY `role_permissions_role_id_idx` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('01319ba7-726b-4d8b-987b-d41bd207ee18', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', 'ea46adef-3842-4440-8a0d-7f9e640af2d0', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('035ec99c-24f3-49fe-8db0-15c474bbd482', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'd1dc00b4-f837-4826-9dd9-59a985778d95', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('109ad3c3-4ec2-4b0f-8e22-5142edc06123', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'e6d9aa55-4b78-4359-a9c5-52f9b5d2ebbc', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1e717e44-8e38-4c3a-96c5-cf02d1405fd3', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'bf5e71c8-0bd5-41bb-9d20-ede81989dbc8', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('258c6b46-6e4d-4b2e-87ae-ad69623acca2', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'f3de28b2-68df-4747-9bf8-aec0eec3b597', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2ab71cb4-e6f3-41c8-a1a4-3c581621f35f', '82caf993-7642-47cf-b131-1d96e26cabed', '8b83b801-7455-45c9-aa18-48c1251fb84a', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2fb0ba7a-5d91-4799-865d-691f3dc69464', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'ea46adef-3842-4440-8a0d-7f9e640af2d0', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('339ce197-1e75-4567-9fac-b0ef5e2764ca', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', 'cbae1972-0111-4e10-b6f6-b8bc0c4ce212', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('33d73d17-754b-45ef-8d19-a91fd17a6b84', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '71666013-ffe6-4c4c-93b2-fc5ad9e60d29', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('34aaf385-2173-44de-a475-b7358d49951a', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '048576c9-6c63-4c89-8025-7571f6842a14', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3e856adb-4b95-4dc5-ae2b-5254a52b4e35', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', 'ed75adcf-ebcd-4c65-968a-abd3089256ed', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4ef4e592-1091-4790-aef7-d7ae503fafa1', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '754ebb6e-0f5c-4b9a-872d-c0cbcf3c3326', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('503b4ee9-4f84-464b-9d59-57a8de1d578b', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '55ae7f5f-a48d-4937-a04e-3a81cc627142', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5605ba8f-2b52-4fcc-a61f-4ad338304f13', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '2a89bd68-ee59-4e30-a8a5-3dfe760eb754', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('58eaff65-fa0f-486f-b38d-1e5fd39dd167', 'e552c97f-aa8b-43fa-b0b7-2c57ef7cd1c0', '754ebb6e-0f5c-4b9a-872d-c0cbcf3c3326', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6268aada-9ce0-4f37-9087-5cc7304af5f8', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '3f4c0bf2-38e1-4999-a715-c7bfbe224bf7', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('656e6ea6-ddd8-42e3-993b-100905db49dd', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'c3822d5c-778b-4d8f-864c-1a9dba0495f1', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('65f98c3c-c4c4-43d3-b1a2-a1f2269b4f03', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'd4cd43e5-5eba-46af-bf58-65b67a79927e', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6e2804ff-69c1-4200-8f62-d4b8ade6e6c5', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '754ebb6e-0f5c-4b9a-872d-c0cbcf3c3326', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7350eeda-4f1f-44c2-9745-5f7c5111e1e0', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'cc107464-59a6-4494-9e31-7025e80f2da7', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7e1cb716-773e-45f7-b5e3-be0570e2941a', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'eb24b82a-322a-42de-b4bf-42ef6b715c78', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7e82a84d-3502-4f3d-baa4-e6086e85dcc5', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '2677c154-1c83-4c9c-82ce-ce96202a5553', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('81a9e4bc-b481-43ec-b2d5-f1d0f9807140', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'd06559e1-a027-4328-b7db-8f49650aa055', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8511e29d-dcf9-4029-b990-a0177d70b440', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '2a89bd68-ee59-4e30-a8a5-3dfe760eb754', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8553f274-6390-4890-8d4a-0683d6ac1042', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '71666013-ffe6-4c4c-93b2-fc5ad9e60d29', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('88d4bca2-f136-492c-8f2c-e1085a381cd4', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '563b4570-0855-4293-bf6b-680e3e93e1e8', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8960323d-e6e2-4522-af03-f80a9f3ae5ce', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '8b83b801-7455-45c9-aa18-48c1251fb84a', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('898112c0-4a8f-4999-aa11-2c114535dd12', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '2677c154-1c83-4c9c-82ce-ce96202a5553', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8b438382-d745-43df-a9c6-3c066184cec2', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '0db8ecbc-b91e-4bbb-98b6-12fa40d5ffa3', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8fd61723-1d1e-4ea8-aa14-2dc95fe164fb', '82caf993-7642-47cf-b131-1d96e26cabed', 'd4cd43e5-5eba-46af-bf58-65b67a79927e', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('92eb7216-f270-497a-9fa8-3b2d1fc1f778', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'cbae1972-0111-4e10-b6f6-b8bc0c4ce212', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('932faa8a-536f-4b57-93e3-a5203ee69425', 'e552c97f-aa8b-43fa-b0b7-2c57ef7cd1c0', '1e1661b6-3782-482a-ad1a-98ae0f368d73', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('983e259e-faa9-4ce3-a9f4-353031a1ccba', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '1564df58-383f-44a7-9a98-132ec9b83ba0', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9af06bbf-de11-4433-b5e1-46c28565c7c0', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'ca118744-3dd7-4f87-915f-dc5d15bc549b', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9fb92aa6-2b11-4ebf-8e62-3f7982c31715', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'ed75adcf-ebcd-4c65-968a-abd3089256ed', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a707a4ed-dbcc-4c9e-9093-187e46812c65', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '530bab23-128a-4fa1-89e9-68b28280ff09', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a763a7ef-bb0f-4b39-903f-a22cae8ac8b3', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '296cac18-d0f8-4d36-bc54-706d79597cef', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a8a68d21-049c-42e9-a0fb-e2b373dba558', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '0db8ecbc-b91e-4bbb-98b6-12fa40d5ffa3', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b82fbf56-5fe6-43e7-b5bd-9b3ce9fac026', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '6460cc71-963f-488a-9502-3558871bd9e1', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b88e3d2b-c2ce-43e9-bd13-7a065d48cfea', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '55ee4ba8-c950-4ff5-86d8-f93b2b95c53d', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bc598bb9-8d27-4724-81aa-5f1e1de310c8', '0f9450c1-af4b-4f6b-8ec4-a134d0591c44', '3f4c0bf2-38e1-4999-a715-c7bfbe224bf7', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('beef9fd4-c08a-410b-87a6-5c832a5ef2fb', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '8b1fcc8d-7fa5-4fc2-84c4-def61b59faa5', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c02f718e-917d-43e7-a69d-e8aad961cec2', 'e552c97f-aa8b-43fa-b0b7-2c57ef7cd1c0', 'd4cd43e5-5eba-46af-bf58-65b67a79927e', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c54f936c-a860-4670-9b8c-9bab0168bce3', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '922cdc19-a9e0-46ea-96c8-c59d3287cdbe', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d166a4b1-5632-4d1e-882c-043db97f3abc', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '58423562-72b5-46ba-8b53-bbe3f5491339', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d5fa799a-62a1-4959-bc2b-2649eb3c9b37', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '1e1661b6-3782-482a-ad1a-98ae0f368d73', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('daf2b7ec-20e4-4281-98ee-34e95f910d29', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'e44b24cc-1e43-4b67-93fa-47906ea98c75', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dff77036-4db6-44ec-a799-1325282eca61', '82caf993-7642-47cf-b131-1d96e26cabed', '754ebb6e-0f5c-4b9a-872d-c0cbcf3c3326', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e85c5022-f2fa-489b-94e4-e88691d98c64', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'dc625155-8f91-4d88-84df-322667dd8ab2', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('eb498cd1-05f3-4858-9119-a210545d834b', '82caf993-7642-47cf-b131-1d96e26cabed', '1e1661b6-3782-482a-ad1a-98ae0f368d73', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ebc68c7a-0e0d-48b8-bd6a-ba024b5ded0e', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '69927e7a-2db8-4b0e-8680-764f1be4dc49', '2026-11-13 16:08:30');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f82127d0-df89-4987-9d9f-17a494ce4a1b', '4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', '424e7a94-e7bf-4d02-bb3b-13a784db22a5', '2026-11-13 16:08:30');
CREATE TABLE `roles` (
  `id` varchar(191) NOT NULL,
  `name` varchar(50) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `level` int NOT NULL DEFAULT '0',
  `is_system` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_name_unique` (`name`),
  UNIQUE KEY `roles_slug_unique` (`slug`),
  KEY `roles_level_idx` (`level`),
  KEY `roles_is_system_idx` (`is_system`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('0f9450c1-af4b-4f6b-8ec4-a134d0591c44', 'Viewer', 'viewer', 'Read everything, change nothing', 10, 1, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('4e5c3750-f7e2-4cf5-9d38-63de52c30ffd', 'Admin', 'admin', 'Everything except granting access to others', 90, 1, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('82caf993-7642-47cf-b131-1d96e26cabed', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, 1, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('e552c97f-aa8b-43fa-b0b7-2c57ef7cd1c0', 'Author', 'author', 'Write content, but not publish or delete it', 30, 1, '2026-11-13 16:08:30', '2026-11-13 16:08:30');
CREATE TABLE `single_announcement` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `campaign` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_announcement_slug` (`slug`),
  KEY `idx_single_announcement_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_announcement_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_status` varchar(20) NOT NULL DEFAULT 'draft',
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `headline` varchar(255) DEFAULT NULL,
  `body` text,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `single_announcement_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `single_announcement` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_homepage` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `layout` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_homepage_slug` (`slug`),
  KEY `idx_single_homepage_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_landing_page` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp NULL DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `hero` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_landing_page_slug` (`slug`),
  KEY `idx_single_landing_page_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_page_builder_settings` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `default_layout` varchar(36) DEFAULT NULL,
  `seeded_layout` varchar(36) DEFAULT NULL,
  `default_layout_changed_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_page_builder_settings_slug` (`slug`),
  KEY `idx_single_page_builder_settings_created_at` (`created_at`),
  KEY `idx_single_page_builder_settings_default_layout` (`default_layout`),
  KEY `idx_single_page_builder_settings_seeded_layout` (`seeded_layout`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_page_builder_site_code` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `head_source` text,
  `body_source` text,
  `head` json DEFAULT NULL,
  `body` json DEFAULT NULL,
  `changed_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_page_builder_site_code_slug` (`slug`),
  KEY `idx_single_page_builder_site_code_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_site_settings` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `site_name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_site_settings_slug` (`slug`),
  KEY `idx_single_site_settings_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_site_settings_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `tagline` text,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `single_site_settings_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `single_site_settings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_site_style` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `tokens` json DEFAULT NULL,
  `fonts` json DEFAULT NULL,
  `classes` json DEFAULT NULL,
  `breakpoints` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_site_style_slug` (`slug`),
  KEY `idx_single_site_style_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `site_settings` (
  `id` varchar(50) NOT NULL,
  `application_name` varchar(255) DEFAULT NULL,
  `site_url` varchar(2048) DEFAULT NULL,
  `admin_email` varchar(255) DEFAULT NULL,
  `timezone` varchar(100) DEFAULT NULL,
  `date_format` varchar(50) DEFAULT NULL,
  `time_format` varchar(50) DEFAULT NULL,
  `logo_url` varchar(2048) DEFAULT NULL,
  `logo_url_dark` varchar(2048) DEFAULT NULL,
  `custom_sidebar_groups` varchar(4096) DEFAULT NULL,
  `plugin_placements` varchar(4096) DEFAULT NULL,
  `preview_token_generation` int NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `user_field_definitions` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `label` varchar(255) NOT NULL,
  `type` varchar(50) NOT NULL,
  `required` tinyint(1) NOT NULL DEFAULT '0',
  `default_value` varchar(255) DEFAULT NULL,
  `options` json DEFAULT NULL,
  `plugin_options` json DEFAULT NULL,
  `has_many` tinyint(1) DEFAULT NULL,
  `min_length` int DEFAULT NULL,
  `max_length` int DEFAULT NULL,
  `min_value` double DEFAULT NULL,
  `max_value` double DEFAULT NULL,
  `placeholder` varchar(255) DEFAULT NULL,
  `description` text,
  `sort_order` int NOT NULL DEFAULT '0',
  `source` varchar(10) NOT NULL DEFAULT 'ui',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_field_defs_name_unique_idx` (`name`),
  KEY `user_field_defs_source_idx` (`source`),
  KEY `user_field_defs_is_active_idx` (`is_active`),
  KEY `user_field_defs_sort_order_idx` (`sort_order`),
  KEY `user_field_defs_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `user_invite_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` varchar(191) NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uit_user_id_unique` (`user_id`),
  KEY `uit_token_hash_idx` (`token_hash`),
  KEY `uit_expires_idx` (`expires`),
  CONSTRAINT `user_invite_tokens_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `user_roles` (
  `id` varchar(191) NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `role_id` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (now()),
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_roles_user_role_unique` (`user_id`,`role_id`),
  KEY `user_roles_user_id_idx` (`user_id`),
  KEY `user_roles_expires_at_idx` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `users` (
  `id` varchar(191) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `email_verified` datetime DEFAULT NULL,
  `email_verified_via` varchar(16) DEFAULT NULL,
  `password_updated_at` datetime DEFAULT NULL,
  `image` varchar(255) DEFAULT NULL,
  `interface_language` varchar(35) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `deactivated_at` datetime DEFAULT NULL,
  `must_change_password` tinyint(1) DEFAULT NULL,
  `session_epoch` int DEFAULT NULL,
  `failed_login_attempts` int NOT NULL DEFAULT '0',
  `locked_until` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `users_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
SET FOREIGN_KEY_CHECKS=1;
