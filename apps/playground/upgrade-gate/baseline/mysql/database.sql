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
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('preset_grants_release', '\"{\\\"release\\\":\\\"0.0.2-alpha.75\\\"}\"', '2026-11-13 16:17:21');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('registry_record', '\"{\\\"point\\\":null,\\\"baseline\\\":{\\\"collections\\\":{},\\\"singles\\\":{},\\\"fieldGroups\\\":{},\\\"permissions\\\":[]}}\"', '2026-11-13 16:17:20');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('schema_version', '\"{\\\"migration\\\":\\\"20261113_161711_888_create_localization_seo\\\",\\\"seq\\\":1}\"', '2026-11-13 16:17:21');
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
INSERT INTO `nextly_rbac_epoch` (`id`, `revision`, `generation`, `updated_at`) VALUES ('global', '6', '40793919-4189-4d52-824d-8373ab3180b9', '2026-11-13 16:17:21');
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
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('16eae8d4-f941-40d8-b538-78a7362120bc', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-13 16:17:19.038', '2026-11-13 16:17:19.040', NULL, NULL, NULL, NULL, 220, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('3059d0a0-6cd4-4667-9413-0b566e5d2218', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-13 16:17:19.225', '2026-11-13 16:17:19.252', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('35ee1993-e08f-4067-8d9e-5c7476e7f795', 'file_apply', 'applied', 'cli-migrate', '20261113_161711_887_create_localization_announcement.sql', 'fadb07e8faad3c953494f3afe29588970db54abb4244d63afdb738d1f0558994', NULL, NULL, '2026-11-13 16:17:20.915', '2026-11-13 16:17:20.926', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('49a84f2d-830d-425d-9939-5dd6842c1866', 'file_apply', 'applied', 'cli-migrate', '20261113_161711_888_create_localization_seo.sql', '7e558d404c91bfb3f747b3e88d79823c4972fec603dadcfa2e415764afcb26c8', NULL, NULL, '2026-11-13 16:17:20.931', '2026-11-13 16:17:20.942', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('503ac0a0-a251-439d-9678-7d98e687cced', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-13 16:17:19.568', '2026-11-13 16:17:19.590', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('6c3bf88b-485a-4a38-b15f-07dbf3d43e11', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-13 16:17:19.404', '2026-11-13 16:17:19.433', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('6e49e84e-a474-4a3d-9767-e486a843f090', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-13 16:17:19.291', '2026-11-13 16:17:19.309', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('759c50fe-18df-4667-85ae-4283c5d9945b', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-13 16:17:19.677', '2026-11-13 16:17:19.706', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('90b43338-2339-4767-98b1-b6427c51b7d3', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-13 16:17:19.349', '2026-11-13 16:17:19.365', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('90b5d382-5c8c-492d-bd4e-04e3b58e1d93', 'file_apply', 'applied', 'cli-migrate', '20261113_161711_884_baseline.sql', '13e0312677b4fbf129cc7bbe6d4957fda538179613d74aa99834e67634851f71', NULL, NULL, '2026-11-13 16:17:19.797', '2026-11-13 16:17:20.817', NULL, NULL, NULL, NULL, 121, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('9711a19c-ecce-4090-af9f-372fd1c32099', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-13 16:17:19.094', '2026-11-13 16:17:19.123', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('992078fa-79a9-4ef4-9ea3-06700cb36eb8', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-13 16:17:19.170', '2026-11-13 16:17:19.189', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('ae85e62e-4d50-42be-bb12-be37dc7bc558', 'file_apply', 'applied', 'cli-migrate', '20261113_161711_886_create_localization_site-settings.sql', 'f146cc9c8bfd77eaf0a13af4cd1e7a7fee23c5f5d41537626ca454fda33e40da', NULL, NULL, '2026-11-13 16:17:20.897', '2026-11-13 16:17:20.910', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('cda91e3b-b633-4d50-95a0-69a8c3858772', 'file_apply', 'applied', 'cli-migrate', '20261113_161711_885_create_localization_authors.sql', 'a21da49e611bb345401b589dcf394e531cc990f6a0c8dba2e5743a222db1f748', NULL, NULL, '2026-11-13 16:17:20.863', '2026-11-13 16:17:20.889', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d440d989-96e9-40ac-a7c7-774514fb08d3', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-13 16:17:19.625', '2026-11-13 16:17:19.647', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f5bcc0de-f254-4058-a995-ae4368a674bf', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-13 16:17:19.484', '2026-11-13 16:17:19.526', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
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
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 16:17:19', '2026-11-13 16:17:20');
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
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('05bb918d-11c7-4c99-91e1-5d44820ff318', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('060c6cca-f5a5-4292-a97f-7aca091ce272', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('172ef8dc-ce25-47ba-952e-0d866109ef9d', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1a57171a-c580-4c27-9980-abb5c6378c15', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2010db33-1b56-4f7e-9af6-e50d666cc256', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2a5e8310-9bf9-4b26-a87a-a9f12aa19eab', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection\'s entries are served at. A change moves every entry\'s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('30f1a4b9-946a-4fa9-b8b9-3c0009b6ec85', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3105d42f-dba8-4f5e-975b-7cc7881d0883', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4bad646b-3639-4813-9bae-57d935565952', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('512172b4-31b1-43b0-84ed-b0299e621139', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site\'s breakpoints, and choose its default Layout.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5526a42a-99b0-45d2-87ba-f5315b3808c6', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('57c2c6b9-4fcf-41cf-9f2c-56a8777e44c8', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5bea1b1f-f469-47a1-ada2-423fb713d113', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('67f85d3c-6e04-4c94-8a9e-ae9ef64c4eab', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6b7c870e-b829-4980-86ae-3e7972e48aa7', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7246d716-5305-4f9c-9856-541162fcfb25', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('73c88488-c092-4e11-9759-6e9eb79b5e8e', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7ae4fe90-d966-47dd-a726-9ca4eebce214', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7bf9de6c-7897-4feb-b5a8-1c456a340189', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8f1ad9fa-4660-43ee-982f-2d2ee02fb009', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('908470b6-e2a3-4b1a-a940-95b1b677d37c', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('90c3cb79-97d4-4c42-b344-9f6ba539b96b', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9bd73a9d-2db6-4805-bc26-1a6a1fe5052e', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9c55fca3-a0e0-496f-9343-4183de902922', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site\'s shared styles. A locked style can\'t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a110c3b1-aa50-4528-839e-47a4525d1101', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a82b2677-5fa9-4c79-84ed-4f63dc289afe', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', 1, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a905332a-441e-4bea-af88-6378548e8668', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a94c9689-1972-4f17-b218-35a95075f2f6', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('bf2815cf-6952-4f8e-bc85-d153a6e042f8', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c4655000-f61a-4bf1-8e46-111ce747a7a0', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ca41d2b2-00b6-4a86-ac32-8825a75a96c0', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cd248fcc-2a1a-432d-a348-338a91540691', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cf9288da-0785-476e-871e-61ef575e10bc', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d7e639a0-4ac5-4ed1-899a-38097cab52f6', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('db8e634d-7ef3-4e9f-a382-29c4a2de5a1f', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dfd52c52-3e1b-4bd2-aaf6-8edc19d1e45c', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e288ed5a-0b82-4567-bbd7-a2f2235dfd47', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e4b475d5-d2df-4ab1-a60e-05b449968de7', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f15945c1-d2f5-4a05-a054-dc1ae13f69a7', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f1fb478b-8fa9-4ff8-8ec4-016b7cd6aa86', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, 0, '2026-11-13 16:17:20', '2026-11-13 16:17:20');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f47ade05-d475-4384-ae02-6db4e6a6f34f', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ffc21f2c-bf8a-4c4d-8cfd-cd74ba75cc4f', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, 0, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
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
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('04337ad1-b0e2-47df-83af-f4bcf37af2fc', '6fdc6675-8abf-4185-b583-a66c42552056', '1a57171a-c580-4c27-9980-abb5c6378c15', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('06feb81c-4862-4670-9277-d12224f8397c', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'bf2815cf-6952-4f8e-bc85-d153a6e042f8', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('07b727c4-e170-429c-bd20-68056ead7f14', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'e288ed5a-0b82-4567-bbd7-a2f2235dfd47', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0b3d4135-19c6-491b-a38f-81dff7d5b062', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '73c88488-c092-4e11-9759-6e9eb79b5e8e', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0deab4e6-7bef-4d7e-9aec-572a218a82c0', '6fdc6675-8abf-4185-b583-a66c42552056', 'f1fb478b-8fa9-4ff8-8ec4-016b7cd6aa86', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0f7d6262-21a1-4b6d-bb70-18f898ef58af', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '30f1a4b9-946a-4fa9-b8b9-3c0009b6ec85', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1bf8af72-3ad7-466d-9c1b-57ba14885119', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '8f1ad9fa-4660-43ee-982f-2d2ee02fb009', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2287ed63-813c-40a6-b5e9-71d3772941a8', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '9c55fca3-a0e0-496f-9343-4183de902922', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('289edffe-a0a4-4432-901b-c63928e3d55d', '6fdc6675-8abf-4185-b583-a66c42552056', 'e4b475d5-d2df-4ab1-a60e-05b449968de7', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('29a69d16-9982-427e-bcc5-b8c18e901d0d', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '1a57171a-c580-4c27-9980-abb5c6378c15', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2b656a92-4bdd-4d2c-a78e-5009946e9016', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '908470b6-e2a3-4b1a-a940-95b1b677d37c', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2bd150c8-1727-498d-82ee-9d03d6e8d215', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '3105d42f-dba8-4f5e-975b-7cc7881d0883', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2fdedf8b-4b57-4fde-be98-90adf167c6b3', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'a82b2677-5fa9-4c79-84ed-4f63dc289afe', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('35f1c4b7-cf80-4eb7-9e8e-b5a4b48b462b', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '172ef8dc-ce25-47ba-952e-0d866109ef9d', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('37b339b2-18f5-41d2-8a01-9832ec25c35f', '6fdc6675-8abf-4185-b583-a66c42552056', 'd7e639a0-4ac5-4ed1-899a-38097cab52f6', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('37c15771-fbcc-4fc3-91aa-3ab64ceb0ab9', '6fdc6675-8abf-4185-b583-a66c42552056', '2010db33-1b56-4f7e-9af6-e50d666cc256', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('382e99cc-a13c-4cb4-a7a3-8b9dd60baa49', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '2010db33-1b56-4f7e-9af6-e50d666cc256', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3d6c3872-7a35-4348-8edc-e6c31cf892b0', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'e4b475d5-d2df-4ab1-a60e-05b449968de7', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5a785fb6-d4fb-4153-945e-1beb2e2f42d3', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '2a5e8310-9bf9-4b26-a87a-a9f12aa19eab', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5cd07f2b-d187-45b2-bdf2-76bdbd59537a', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '90c3cb79-97d4-4c42-b344-9f6ba539b96b', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5eeaf294-4e36-4c16-973b-eaaacf3435ff', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'cd248fcc-2a1a-432d-a348-338a91540691', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('60cebf21-a799-491f-89b5-7bff85cfe426', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'f15945c1-d2f5-4a05-a054-dc1ae13f69a7', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('632f7e5b-00cb-4931-8929-219bd2c21a08', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '6b7c870e-b829-4980-86ae-3e7972e48aa7', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6ef3d614-5cca-447f-b3f7-bf6490e923ce', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'd7e639a0-4ac5-4ed1-899a-38097cab52f6', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7c0c576d-47d5-43f2-a89a-b287941d7c4b', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'a110c3b1-aa50-4528-839e-47a4525d1101', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('81511ed1-9d3a-4ab7-8f91-d84fdccc951a', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'ca41d2b2-00b6-4a86-ac32-8825a75a96c0', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('83904c99-2cd8-488d-968a-8517ba5cf899', '6fdc6675-8abf-4185-b583-a66c42552056', '3105d42f-dba8-4f5e-975b-7cc7881d0883', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('85cdbf19-3e78-4250-9d05-294e3bc1b320', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'ffc21f2c-bf8a-4c4d-8cfd-cd74ba75cc4f', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8a0e0421-ff86-405e-beec-8bea41e842c3', 'b87f1f45-6426-41da-8639-90a77342d89e', '30f1a4b9-946a-4fa9-b8b9-3c0009b6ec85', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8f2fef38-cea0-4bc9-88d7-3b76326bfe3c', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'cf9288da-0785-476e-871e-61ef575e10bc', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9224bb50-a324-4e33-9731-76b4a6265846', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '7246d716-5305-4f9c-9856-541162fcfb25', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('968cef5b-6c9b-42e1-a15b-d4a9d170b56c', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '7ae4fe90-d966-47dd-a726-9ca4eebce214', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9db1ef9a-6318-4c77-b3ed-db82716d3bb5', '6fdc6675-8abf-4185-b583-a66c42552056', '73c88488-c092-4e11-9759-6e9eb79b5e8e', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9e461c0a-3311-48bf-91c3-f89eafef942a', '6fdc6675-8abf-4185-b583-a66c42552056', '57c2c6b9-4fcf-41cf-9f2c-56a8777e44c8', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9fdd0d6f-0984-48ee-a19a-6b1ba037f537', '721c3967-2612-4b61-b573-eb0956234ece', '5bea1b1f-f469-47a1-ada2-423fb713d113', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a1def205-8ced-4346-9787-6d9be3f34df9', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '67f85d3c-6e04-4c94-8a9e-ae9ef64c4eab', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a200dfc2-f12e-4e5c-bd8f-7e17d24af833', '721c3967-2612-4b61-b573-eb0956234ece', '1a57171a-c580-4c27-9980-abb5c6378c15', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a5bc30d6-f366-4cad-9a04-6788e158643f', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'f1fb478b-8fa9-4ff8-8ec4-016b7cd6aa86', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ad233ba0-9c88-4d23-9f72-bd995408611d', '721c3967-2612-4b61-b573-eb0956234ece', '6b7c870e-b829-4980-86ae-3e7972e48aa7', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('add78543-5f10-4785-be31-77c6a23eeab3', 'b87f1f45-6426-41da-8639-90a77342d89e', '1a57171a-c580-4c27-9980-abb5c6378c15', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('aeb46d41-c230-4bde-bd38-71a5fd4c0a9d', '6fdc6675-8abf-4185-b583-a66c42552056', '67f85d3c-6e04-4c94-8a9e-ae9ef64c4eab', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('aeec44bf-1f1e-49f8-81b5-b233d549ca19', 'b87f1f45-6426-41da-8639-90a77342d89e', '5bea1b1f-f469-47a1-ada2-423fb713d113', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b62dfbc3-b810-457e-9721-c1de0c8a02af', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'a905332a-441e-4bea-af88-6378548e8668', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ba2cc8de-c99f-4bce-99c1-f06b3f55bf78', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'a94c9689-1972-4f17-b218-35a95075f2f6', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c03b39de-ba46-41fc-8cf6-90235c633fa2', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '57c2c6b9-4fcf-41cf-9f2c-56a8777e44c8', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c1091e5f-99f3-4db3-a972-01ed90eeedcd', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '512172b4-31b1-43b0-84ed-b0299e621139', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c5982a6b-d146-4f55-a908-45f687bcca8c', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '5526a42a-99b0-45d2-87ba-f5315b3808c6', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dd3a0ab7-5a3e-4f4a-acea-ff72f87f85b7', '721c3967-2612-4b61-b573-eb0956234ece', '30f1a4b9-946a-4fa9-b8b9-3c0009b6ec85', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dda8c683-398e-4b18-9d07-fca91b2534fb', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '5bea1b1f-f469-47a1-ada2-423fb713d113', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dddca138-3807-42ba-815c-90af1db608c0', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '4bad646b-3639-4813-9bae-57d935565952', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e19ccc40-9f55-4999-8dc2-da9596c853cd', '33ce8c68-3856-448d-b635-58a64e3ad6ea', 'f47ade05-d475-4384-ae02-6db4e6a6f34f', '2026-11-13 16:17:21');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ec59d6d3-95b3-4b5e-94c2-87dff5919568', '33ce8c68-3856-448d-b635-58a64e3ad6ea', '05bb918d-11c7-4c99-91e1-5d44820ff318', '2026-11-13 16:17:21');
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
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('33ce8c68-3856-448d-b635-58a64e3ad6ea', 'Admin', 'admin', 'Everything except granting access to others', 90, 1, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('6fdc6675-8abf-4185-b583-a66c42552056', 'Viewer', 'viewer', 'Read everything, change nothing', 10, 1, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('721c3967-2612-4b61-b573-eb0956234ece', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, 1, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('b87f1f45-6426-41da-8639-90a77342d89e', 'Author', 'author', 'Write content, but not publish or delete it', 30, 1, '2026-11-13 16:17:21', '2026-11-13 16:17:21');
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
