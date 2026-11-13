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
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('preset_grants_release', '\"{\\\"release\\\":\\\"0.0.2-alpha.75\\\"}\"', '2026-11-13 15:51:48');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('registry_record', '\"{\\\"point\\\":null,\\\"baseline\\\":{\\\"collections\\\":{},\\\"singles\\\":{},\\\"fieldGroups\\\":{},\\\"permissions\\\":[]}}\"', '2026-11-13 15:51:47');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('schema_version', '\"{\\\"migration\\\":\\\"20261113_155140_852_create_localization_seo\\\",\\\"seq\\\":1}\"', '2026-11-13 15:51:48');
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
INSERT INTO `nextly_rbac_epoch` (`id`, `revision`, `generation`, `updated_at`) VALUES ('global', '6', '669b2a6b-8ada-4943-8bff-67d703ec66fa', '2026-11-13 15:51:48');
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
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('0c108530-5833-4156-a871-2d2feebc986e', 'file_apply', 'applied', 'cli-migrate', '20261113_155140_849_create_localization_authors.sql', '16ba7bac5a12885b7ada1107f52c4df6b48c6f926045133e7c3034601f2e55ab', NULL, NULL, '2026-11-13 15:51:47.828', '2026-11-13 15:51:47.837', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('0c753c5d-2b29-42a6-aa37-a4288f690cef', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-13 15:51:46.838', '2026-11-13 15:51:46.855', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('1b78cbfe-6f0c-4655-b18e-9dfcc2dace4e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-13 15:51:46.884', '2026-11-13 15:51:46.910', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('3ccaf91c-f6dc-4e9e-bab0-f6ba69cc681e', 'file_apply', 'applied', 'cli-migrate', '20261113_155140_850_create_localization_site-settings.sql', '5f5f1a85355e4551f6499ceda4d7b00c1a10e0a31116a497b095cdafc59920e1', NULL, NULL, '2026-11-13 15:51:47.841', '2026-11-13 15:51:47.849', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('46587bb3-160e-488f-927f-fd9333a16a8b', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-13 15:51:46.425', '2026-11-13 15:51:46.437', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('495a41c1-815f-4c05-9ea5-9e5987246913', 'file_apply', 'applied', 'cli-migrate', '20261113_155140_851_create_localization_announcement.sql', '0c350b18669bc4b47019ede3dfd2baa9da48758eaf21a6b3b8334053e00eb90f', NULL, NULL, '2026-11-13 15:51:47.853', '2026-11-13 15:51:47.862', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('5473f879-d780-4dc9-ae4b-700b1ab1dcad', 'file_apply', 'applied', 'cli-migrate', '20261113_155140_848_baseline.sql', 'ead84cd85f61ba3bdced399febfdca7a4fb7cf58d9f3e390aa423491ca211fb8', NULL, NULL, '2026-11-13 15:51:46.991', '2026-11-13 15:51:47.811', NULL, NULL, NULL, NULL, 121, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('7dd12186-5fe9-4bea-9831-7cbb6d17d237', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-13 15:51:46.321', '2026-11-13 15:51:46.323', NULL, NULL, NULL, NULL, 220, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('860e42b9-6f4a-494d-8b5b-d46fcc77e319', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-13 15:51:46.693', '2026-11-13 15:51:46.727', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('8a1408a6-eaff-41f9-8a76-82fb03bb97e1', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-13 15:51:46.542', '2026-11-13 15:51:46.556', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('8f2c5e48-468f-411e-8f08-cf589ff496e7', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-13 15:51:46.637', '2026-11-13 15:51:46.654', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('903e8d86-0982-465a-b65f-89418c4dd660', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-13 15:51:46.769', '2026-11-13 15:51:46.797', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('c874b829-218c-4e88-ae77-0f460eae470c', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-13 15:51:46.590', '2026-11-13 15:51:46.603', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d69f08fe-3c47-455b-8f48-3ebb8f5552ca', 'file_apply', 'applied', 'cli-migrate', '20261113_155140_852_create_localization_seo.sql', 'ccf2b72f682c397caa1afeb7201c5cfa5cde09f3eccc468c6d99fea73ed19550', NULL, NULL, '2026-11-13 15:51:47.866', '2026-11-13 15:51:47.874', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d9456d22-5fa7-4abb-8eb3-04f0228c0baf', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-13 15:51:46.473', '2026-11-13 15:51:46.504', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('dc2dae9f-1e14-4a0f-8447-f87c2d499528', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-13 15:51:46.369', '2026-11-13 15:51:46.390', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
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
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:46', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:46', '2026-11-13 15:51:47');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:46', '2026-11-13 15:51:47');
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
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('071883f5-e415-4e15-85a2-690db0239f57', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0a2d9251-0dce-441e-8592-cda1936d289c', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0ac38b5c-381e-45e3-b310-674276c412fb', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0c4851ef-5161-41f4-8b8b-780ab79d24f7', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0e18cc80-e2ef-400b-b5b0-237001f5e106', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0e401887-dd10-4f9d-9814-4f1ec1c0b8e5', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0ed4dd3a-dc9c-4ea1-9e30-10aa864f22f8', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('150baf15-dc32-4409-a918-f87c6e6fceb1', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1633c8fd-e679-46d6-9476-616857af263e', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2f32164a-3807-4822-87ec-8080afcac850', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site\'s breakpoints, and choose its default Layout.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('31196ee9-7553-4371-aed8-bc1c24c7e0eb', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('32071aa3-9436-458b-a01e-ce5954b02264', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('33563e84-5379-4280-8bf6-c735f3b27281', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection\'s entries are served at. A change moves every entry\'s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('363b90ae-c530-4e14-83be-78466c247c79', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4e2c2c7d-5053-4c4b-97f2-021785efd2d6', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5a8515c5-f397-415a-bd7e-359c8b6545c4', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site\'s shared styles. A locked style can\'t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5eb52810-5ca2-40cc-a9f7-5342c66b7ad1', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('69a48737-918c-4431-af68-b0551125b58e', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('70df9d86-0ea0-4c04-8c9d-449e10a5c89c', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('73a4af72-75bd-49f7-bf80-daa7c3d2af29', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('75de75bc-081d-432d-ab45-929c43fd75bf', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('76a06454-0d8e-4bb9-add6-46bb412e2f1f', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7a8127ef-dbad-4928-9322-43c655fffb60', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7fa6d861-6acf-425b-be43-d786babba00e', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('89bc52c2-b9b6-4253-bc21-6d8482737461', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('980f38f4-b7b3-45b9-b905-8fabaf452113', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a52d3288-9e52-460c-8eeb-3dcc1fead854', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a98976b7-cae5-4d26-a6f7-6a2711d658b7', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ad344bc8-2c66-493b-9c2e-b34598888e6b', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b67e9432-f226-433d-9521-36b9d24e6a7b', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('bb654373-fca9-4f90-a795-5e604f763e89', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c19fe127-a572-43c2-8832-127bbf6e97a0', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c761e99d-5959-46d4-92e3-a0824a1fef5a', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c95fb7d6-dc79-44b3-a27f-ceaca1ece0a4', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ce487ac7-2f47-4b85-89f2-9e7275c6846b', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dfa39252-609d-4472-9864-617bb6cc5dbb', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dfe351f4-abb2-4609-aed6-374e94d11ea9', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e3bf8f26-0aa8-49c0-a516-463e57ecbacd', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e8f07a46-d164-4a71-ac6b-b23671a3f309', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e9d1d386-ce35-4f65-9a15-6bd1c92eadc1', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ed86a992-214d-4721-8648-f0ce3147c8c5', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, 0, '2026-11-13 15:51:47', '2026-11-13 15:51:47');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f74afdfd-dc69-472e-b200-ec4c54dc9b90', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', 1, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
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
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('06e80b93-c0a8-4ec9-9b50-43f061499034', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '2f32164a-3807-4822-87ec-8080afcac850', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('08140c09-455e-424a-8e07-ef5a7605977b', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '150baf15-dc32-4409-a918-f87c6e6fceb1', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('157426ed-ab7b-4d0d-bd4a-47433261937c', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'dfe351f4-abb2-4609-aed6-374e94d11ea9', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1c959614-bef0-4a38-8a46-62ef428453ba', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '4e2c2c7d-5053-4c4b-97f2-021785efd2d6', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1da43929-48a6-4dff-9627-66df3b85a622', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0ed4dd3a-dc9c-4ea1-9e30-10aa864f22f8', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('247b4501-bcf7-4aff-9b53-c0e7153ad5e6', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', 'bb654373-fca9-4f90-a795-5e604f763e89', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('25c3c5df-8e44-4975-b090-161703ca6c94', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '980f38f4-b7b3-45b9-b905-8fabaf452113', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2f1a2847-d0ae-4215-bf95-f6950a29a4f0', '67f1e9cd-bad0-4e75-bb11-a4095b66c28a', '69a48737-918c-4431-af68-b0551125b58e', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3059f091-0ccc-47d1-b5fe-45ab446c5531', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '33563e84-5379-4280-8bf6-c735f3b27281', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('331ca029-d299-4ce2-b52d-6b2a65ca60a3', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'e9d1d386-ce35-4f65-9a15-6bd1c92eadc1', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3379339f-ef9e-424d-ab1c-fafaf7844864', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '70df9d86-0ea0-4c04-8c9d-449e10a5c89c', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('35052da3-3758-4047-8423-c6fea9af4de9', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '0ed4dd3a-dc9c-4ea1-9e30-10aa864f22f8', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3d7ca9d5-74ed-48a2-9ba6-ad9697f5da97', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0c4851ef-5161-41f4-8b8b-780ab79d24f7', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3df85f2a-cb28-44a8-9940-e5b03a5bdf87', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '071883f5-e415-4e15-85a2-690db0239f57', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('40224412-cf9a-4830-8a41-4b278e98092d', '995d7bff-0f9e-44ef-a831-f47a7e902771', '70df9d86-0ea0-4c04-8c9d-449e10a5c89c', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('420c3846-817b-449a-a562-81cf690cdf7d', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '363b90ae-c530-4e14-83be-78466c247c79', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4eee924b-d9d1-4dfd-b2cb-ff72f1b6b305', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '31196ee9-7553-4371-aed8-bc1c24c7e0eb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('51983403-dd77-4bd8-93ae-20d4a11e6120', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '89bc52c2-b9b6-4253-bc21-6d8482737461', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('621f792c-0d4e-4ddc-a284-c074e11130c5', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'bb654373-fca9-4f90-a795-5e604f763e89', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('65cdc27e-e814-40a5-a3dd-40b02addf722', '995d7bff-0f9e-44ef-a831-f47a7e902771', '69a48737-918c-4431-af68-b0551125b58e', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6932d84a-51df-48a3-911d-ae0382622917', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'a98976b7-cae5-4d26-a6f7-6a2711d658b7', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('700214bb-baf6-4c88-9716-a51b82de8ed1', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'ad344bc8-2c66-493b-9c2e-b34598888e6b', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('70129179-1621-471e-a282-dc4cf08b86b8', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '76a06454-0d8e-4bb9-add6-46bb412e2f1f', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('737add38-b00e-409e-b860-f1ac61a1a09e', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0e401887-dd10-4f9d-9814-4f1ec1c0b8e5', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('76a7bbb0-e56c-4585-8132-d2f0616dfea7', '67f1e9cd-bad0-4e75-bb11-a4095b66c28a', '70df9d86-0ea0-4c04-8c9d-449e10a5c89c', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('79a6a19b-fc7d-4de9-b4b6-cc4fe2a22c9d', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'c761e99d-5959-46d4-92e3-a0824a1fef5a', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7bed6258-18bd-4de4-b653-6cb9c7a1ef2e', '995d7bff-0f9e-44ef-a831-f47a7e902771', '32071aa3-9436-458b-a01e-ce5954b02264', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7fef3f7c-65bd-4446-90ea-8e1b35433b82', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0ac38b5c-381e-45e3-b310-674276c412fb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('886b2922-ace6-473a-89a0-699587f9ee17', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '69a48737-918c-4431-af68-b0551125b58e', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ab4e859-746e-4170-8e32-e41ead514e02', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'c19fe127-a572-43c2-8832-127bbf6e97a0', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8d5b601a-fbf4-41ef-adfc-e2e78f21d4f9', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'ce487ac7-2f47-4b85-89f2-9e7275c6846b', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ea13874-018d-4a89-8509-a6a084626334', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '76a06454-0d8e-4bb9-add6-46bb412e2f1f', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('917fafde-a64a-4ec3-8bae-8e276bf67582', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', 'a98976b7-cae5-4d26-a6f7-6a2711d658b7', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('94dee2c2-7ba3-4c2c-b796-b70fe4253737', '995d7bff-0f9e-44ef-a831-f47a7e902771', '31196ee9-7553-4371-aed8-bc1c24c7e0eb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('965322c7-40d1-44c8-9c6f-2615b4be224d', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '73a4af72-75bd-49f7-bf80-daa7c3d2af29', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9852604d-1a7e-44a4-9178-12cbe237b720', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0a2d9251-0dce-441e-8592-cda1936d289c', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('994ba954-9eb0-4a17-9d9a-b9e3029c5808', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '5a8515c5-f397-415a-bd7e-359c8b6545c4', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a5bb149d-beb8-48cd-9c40-560a2fa61ee6', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'b67e9432-f226-433d-9521-36b9d24e6a7b', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a63ff42b-c0bb-4c97-bc89-a6683dfe5e7d', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '0ac38b5c-381e-45e3-b310-674276c412fb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a754119f-c6a1-497a-8f5b-e9717e48c439', '67f1e9cd-bad0-4e75-bb11-a4095b66c28a', '31196ee9-7553-4371-aed8-bc1c24c7e0eb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a95900f3-ef93-442d-af99-bd57cdf934ac', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '150baf15-dc32-4409-a918-f87c6e6fceb1', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ace20d05-c68f-48e4-90d7-a01200c2dcac', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'e8f07a46-d164-4a71-ac6b-b23671a3f309', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b24ecce5-f234-4a9a-8f82-646d1b531aea', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'f74afdfd-dc69-472e-b200-ec4c54dc9b90', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b67d057f-e5be-4da7-b3d1-dbb7168d86ae', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '0e18cc80-e2ef-400b-b5b0-237001f5e106', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bba594e2-58f6-4d22-b1b4-d61f1126fdbe', '8c738927-0c2a-43f3-8f12-181ca5c4164f', 'e3bf8f26-0aa8-49c0-a516-463e57ecbacd', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c831a0bd-9838-4787-ae7e-51c4ff8ee0ca', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '75de75bc-081d-432d-ab45-929c43fd75bf', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d93fb9d1-8280-41f1-9efe-544ce4035baa', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '4e2c2c7d-5053-4c4b-97f2-021785efd2d6', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dc344f0e-9040-4742-b2a8-81ff379e6e45', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '5eb52810-5ca2-40cc-a9f7-5342c66b7ad1', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e335076b-8a65-444b-a1e5-0dffad98c798', '9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', '73a4af72-75bd-49f7-bf80-daa7c3d2af29', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f44b2c4b-587f-4920-8976-5d7cf199207d', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '31196ee9-7553-4371-aed8-bc1c24c7e0eb', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f65ff3bb-ed16-4002-8826-50820e0e177d', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '32071aa3-9436-458b-a01e-ce5954b02264', '2026-11-13 15:51:48');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f9093b73-94e8-497d-af03-f967dbcf7c6b', '8c738927-0c2a-43f3-8f12-181ca5c4164f', '1633c8fd-e679-46d6-9476-616857af263e', '2026-11-13 15:51:48');
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
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('67f1e9cd-bad0-4e75-bb11-a4095b66c28a', 'Author', 'author', 'Write content, but not publish or delete it', 30, 1, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('8c738927-0c2a-43f3-8f12-181ca5c4164f', 'Admin', 'admin', 'Everything except granting access to others', 90, 1, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('995d7bff-0f9e-44ef-a831-f47a7e902771', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, 1, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('9ec6d139-8ca3-4c45-a267-8f9b1d1cfcbb', 'Viewer', 'viewer', 'Read everything, change nothing', 10, 1, '2026-11-13 15:51:48', '2026-11-13 15:51:48');
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
