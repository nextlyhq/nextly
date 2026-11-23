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
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dc_block_pages_created_by` (`created_by`),
  KEY `idx_dc_block_pages_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_block_pages_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  UNIQUE KEY `uq_dc_block_pages_locales_slug__locale_1mvq6jl` ((sha2(weight_string(nullif(`slug`,_utf8mb4'')),256)),`_locale`),
  CONSTRAINT `dc_block_pages_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_block_pages` (`id`) ON DELETE CASCADE
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
  `icon` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dc_categories_created_by` (`created_by`),
  KEY `idx_dc_categories_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_categories_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`_parent`,`_locale`),
  UNIQUE KEY `uq_dc_categories_locales_slug__locale_1mvq6jl` ((sha2(weight_string(nullif(`slug`,_utf8mb4'')),256)),`_locale`),
  CONSTRAINT `dc_categories_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_categories` (`id`) ON DELETE CASCADE
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
  `slug` varchar(255) NOT NULL,
  `area` varchar(255) DEFAULT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_components_slug` (`slug`),
  KEY `idx_dc_components_created_by` (`created_by`),
  KEY `idx_dc_components_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_components_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `description` text,
  `category` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_components_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_components` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submission_resends` (
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
  `submission` varchar(255) NOT NULL,
  `ticked` json DEFAULT NULL,
  `exclude` json DEFAULT NULL,
  `retire` json DEFAULT NULL,
  `settled` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_form_submission_resends_slug` (`slug`),
  KEY `idx_dc_form_submission_resends_created_by` (`created_by`),
  KEY `idx_dc_form_submission_resends_created_at` (`created_at`),
  KEY `idx_dc_form_submission_resends_submission` (`submission`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submission_resends_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `notification` varchar(255) DEFAULT NULL,
  `requested_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_form_submission_resends_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_form_submission_resends` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submission_sends` (
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
  `submission` varchar(255) NOT NULL,
  `queued_id` varchar(255) NOT NULL,
  `form` varchar(255) DEFAULT NULL,
  `notification` varchar(255) DEFAULT NULL,
  `attempts` int DEFAULT NULL,
  `retries` int DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT NULL,
  `cancel` json DEFAULT NULL,
  `cancel_requested` json DEFAULT NULL,
  `configured` json DEFAULT NULL,
  `recipients` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_form_submission_sends_slug` (`slug`),
  KEY `idx_dc_form_submission_sends_created_by` (`created_by`),
  KEY `idx_dc_form_submission_sends_created_at` (`created_at`),
  KEY `idx_dc_form_submission_sends_submission` (`submission`),
  KEY `idx_dc_form_submission_sends_queued_id` (`queued_id`),
  KEY `idx_dc_form_submission_sends_form_notification_06wq5om` (`form`,`notification`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submission_sends_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `send_key` varchar(255) DEFAULT NULL,
  `notification_name` varchar(255) DEFAULT NULL,
  `state` varchar(255) DEFAULT NULL,
  `retired_by` varchar(255) DEFAULT NULL,
  `requested_by` varchar(255) DEFAULT NULL,
  `resend` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_form_submission_sends_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_form_submission_sends` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submissions` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `form` varchar(36) NOT NULL,
  `data` json NOT NULL,
  `status` varchar(255) NOT NULL,
  `submitted_at` timestamp NOT NULL,
  `edited_at` timestamp NULL DEFAULT NULL,
  `response_key` varchar(255) DEFAULT NULL,
  `asked` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_form_submissions_slug` (`slug`),
  UNIQUE KEY `uq_dc_form_submissions_form_response_key_1ak966i` (`form`,`response_key`),
  KEY `idx_dc_form_submissions_created_by` (`created_by`),
  KEY `idx_dc_form_submissions_created_at` (`created_at`),
  KEY `idx_dc_form_submissions_form` (`form`),
  KEY `idx_dc_form_submissions_status` (`status`),
  KEY `idx_dc_form_submissions_submitted_at` (`submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_submissions_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `spam_reason` varchar(255) DEFAULT NULL,
  `notes` text,
  `ip_address` varchar(255) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `page` text,
  `edited_by` varchar(255) DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_form_submissions_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_form_submissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_uploads` (
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
  `media` varchar(255) NOT NULL,
  `form` varchar(255) NOT NULL,
  `submission` varchar(255) DEFAULT NULL,
  `released_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_form_uploads_slug` (`slug`),
  UNIQUE KEY `uq_dc_form_uploads_media_submission_1v7nb99` (`media`,`submission`),
  KEY `idx_dc_form_uploads_created_by` (`created_by`),
  KEY `idx_dc_form_uploads_created_at` (`created_at`),
  KEY `idx_dc_form_uploads_submission` (`submission`),
  KEY `idx_dc_form_uploads_form` (`form`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_form_uploads_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `field` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_form_uploads_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_form_uploads` (`id`) ON DELETE CASCADE
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
  `slug` varchar(255) NOT NULL,
  `fields` json NOT NULL,
  `settings` json DEFAULT NULL,
  `notifications` json DEFAULT NULL,
  `status` varchar(255) NOT NULL,
  `went_live_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_forms_slug` (`slug`),
  KEY `idx_dc_forms_created_by` (`created_by`),
  KEY `idx_dc_forms_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_forms_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `description` text,
  `closed_message` text,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_forms_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_forms` (`id`) ON DELETE CASCADE
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
  `slug` varchar(255) NOT NULL,
  `areas` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_layouts_slug` (`slug`),
  KEY `idx_dc_layouts_created_by` (`created_by`),
  KEY `idx_dc_layouts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_layouts_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_layouts_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_layouts` (`id`) ON DELETE CASCADE
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
  `content` json DEFAULT NULL,
  `layout` varchar(36) DEFAULT NULL,
  `no_header_footer` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dc_pages_created_by` (`created_by`),
  KEY `idx_dc_pages_created_at` (`created_at`),
  KEY `idx_dc_pages_layout` (`layout`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_pages_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  UNIQUE KEY `uq_dc_pages_locales_slug__locale_1mvq6jl` ((sha2(weight_string(nullif(`slug`,_utf8mb4'')),256)),`_locale`),
  CONSTRAINT `dc_pages_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_pages` (`id`) ON DELETE CASCADE
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
  `slug` varchar(255) NOT NULL,
  `granularity` varchar(255) NOT NULL,
  `content` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dc_patterns_slug` (`slug`),
  KEY `idx_dc_patterns_created_by` (`created_by`),
  KEY `idx_dc_patterns_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_patterns_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `description` text,
  `category` varchar(255) DEFAULT NULL,
  `keywords` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_patterns_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_patterns` (`id`) ON DELETE CASCADE
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
  `editor_mode` varchar(255) DEFAULT NULL,
  `settings` json DEFAULT NULL,
  `sections` json DEFAULT NULL,
  `categories` json DEFAULT NULL,
  `tags` json DEFAULT NULL,
  `featured_image` varchar(36) DEFAULT NULL,
  `published_at` timestamp NULL DEFAULT NULL,
  `last_saved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dc_posts_created_by` (`created_by`),
  KEY `idx_dc_posts_created_at` (`created_at`),
  KEY `idx_dc_posts_featured_image` (`featured_image`),
  KEY `idx_dc_posts_last_saved_at` (`last_saved_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_posts_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `excerpt` text,
  `meta_title` varchar(255) DEFAULT NULL,
  `meta_description` varchar(255) DEFAULT NULL,
  `content` text,
  `custom_script` text,
  PRIMARY KEY (`_parent`,`_locale`),
  UNIQUE KEY `uq_dc_posts_locales_slug__locale_1mvq6jl` ((sha2(weight_string(nullif(`slug`,_utf8mb4'')),256)),`_locale`),
  CONSTRAINT `dc_posts_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_posts` (`id`) ON DELETE CASCADE
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
  PRIMARY KEY (`id`),
  KEY `idx_dc_tags_created_by` (`created_by`),
  KEY `idx_dc_tags_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `dc_tags_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`_parent`,`_locale`),
  UNIQUE KEY `uq_dc_tags_locales_slug__locale_1mvq6jl` ((sha2(weight_string(nullif(`slug`,_utf8mb4'')),256)),`_locale`),
  CONSTRAINT `dc_tags_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_tags` (`id`) ON DELETE CASCADE
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
CREATE TABLE `dc_templates_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `dc_templates_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `dc_templates` (`id`) ON DELETE CASCADE
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
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('03797b81-e302-4bd0-a3ac-c16081fdbf74', 'block-pages', '{\"plural\": \"Block Pages\", \"singular\": \"Block Page\"}', 'dc_block_pages', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true}, {\"name\": \"content\", \"type\": \"json\", \"admin\": {\"description\": \"A @nextlyhq/blocks-engine BlockDocument. Rendered by blocks-react, not by the page builder.\"}, \"label\": \"Block document\"}]', 1, 1, 0, '{\"drafts\": {\"enabled\": false, \"autosave\": {\"enabled\": false, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'code', 1, NULL, 'e8ac65cbc2e6c69a97ea4503fe8df15c2aee64487d1190bbdc790e76b0a0e7bb', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('07c8b0c7-b078-457d-839f-7b2f22f39954', 'form-submissions', '{\"plural\": \"Submissions\", \"singular\": \"Submission\"}', 'dc_form_submissions', 'View and manage form submissions', '[{\"name\": \"form\", \"type\": \"relationship\", \"admin\": {\"readOnly\": true, \"description\": \"The form this submission belongs to\"}, \"label\": \"Form\", \"required\": true, \"relationTo\": \"forms\"}, {\"name\": \"data\", \"type\": \"json\", \"admin\": {\"readOnly\": true, \"description\": \"The submitted form data as JSON\"}, \"label\": \"Submission Data\", \"required\": true}, {\"name\": \"status\", \"type\": \"select\", \"admin\": {\"description\": \"Track whether this submission has been reviewed\"}, \"index\": true, \"label\": \"Status\", \"options\": [{\"label\": \"New\", \"value\": \"new\"}, {\"label\": \"Read\", \"value\": \"read\"}, {\"label\": \"Archived\", \"value\": \"archived\"}, {\"label\": \"Spam\", \"value\": \"spam\"}], \"required\": true, \"defaultValue\": \"new\"}, {\"name\": \"spamReason\", \"type\": \"text\", \"admin\": {\"readOnly\": true, \"description\": \"Which spam check flagged this submission (empty for clean submissions)\"}, \"label\": \"Spam Reason\"}, {\"name\": \"notes\", \"type\": \"textarea\", \"admin\": {\"description\": \"Notes visible only to admins (not shown to submitter)\"}, \"label\": \"Internal Notes\"}, {\"name\": \"ipAddress\", \"type\": \"text\", \"admin\": {\"readOnly\": true, \"description\": \"IP address of the submitter\"}, \"label\": \"IP Address\"}, {\"name\": \"userAgent\", \"type\": \"text\", \"admin\": {\"readOnly\": true, \"description\": \"Browser/device information of the submitter\"}, \"label\": \"User Agent\"}, {\"name\": \"page\", \"type\": \"textarea\", \"admin\": {\"hidden\": true}, \"label\": \"Page\"}, {\"name\": \"submittedAt\", \"type\": \"date\", \"admin\": {\"readOnly\": true, \"description\": \"When the form was submitted\"}, \"index\": true, \"label\": \"Submitted At\", \"required\": true}, {\"name\": \"editedAt\", \"type\": \"date\", \"admin\": {\"readOnly\": true, \"description\": \"When an admin last edited the submitted data\"}, \"label\": \"Edited At\"}, {\"name\": \"editedBy\", \"type\": \"text\", \"admin\": {\"readOnly\": true, \"description\": \"ID of the admin who last edited the submitted data\"}, \"label\": \"Edited By\"}, {\"name\": \"responseKey\", \"type\": \"text\", \"admin\": {\"hidden\": true}, \"label\": \"One-response key\", \"localized\": false}, {\"name\": \"asked\", \"type\": \"json\", \"admin\": {\"hidden\": true}, \"label\": \"Fields asked\"}, {\"name\": \"title\", \"type\": \"text\", \"admin\": {\"hidden\": true}, \"label\": \"Sender\"}]', 1, 0, 0, NULL, NULL, '{\"record\": false}', '{\"group\": \"Forms\", \"order\": 51, \"isPlugin\": true, \"components\": {\"views\": {\"Edit\": {\"Component\": \"@nextlyhq/plugin-form-builder/admin#SubmissionPage\"}, \"List\": {\"Component\": \"@nextlyhq/plugin-form-builder/admin#SubmissionsView\"}}}, \"useAsTitle\": \"title\", \"disableCreate\": true}', NULL, 'plugin:@nextlyhq/plugin-form-builder', 1, NULL, '6335712e6584ae42de074501c22a31e8b4bde2543c7e512003708f3efc9593f0', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('1018f39d-57b5-432f-af14-a1b241074161', 'nx_pb_address_claims', '{\"plural\": \"Address claims\", \"singular\": \"Address claim\"}', 'dc_nx_pb_address_claims', 'Which document holds each served address. Maintained automatically.', '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"claimKey\", \"type\": \"text\", \"label\": \"Claim key\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"kind\", \"type\": \"text\", \"index\": true, \"label\": \"Kind\", \"required\": true, \"localized\": false}, {\"name\": \"locale\", \"type\": \"text\", \"label\": \"Locale\", \"localized\": false}, {\"name\": \"path\", \"type\": \"textarea\", \"label\": \"Path\", \"localized\": false}, {\"name\": \"holderCollection\", \"type\": \"text\", \"index\": true, \"label\": \"Holder collection\", \"localized\": false}, {\"name\": \"holderId\", \"type\": \"text\", \"index\": true, \"label\": \"Holder id\", \"localized\": false}, {\"name\": \"space\", \"type\": \"text\", \"index\": true, \"label\": \"Space\", \"localized\": false}, {\"name\": \"blockedBy\", \"type\": \"text\", \"index\": true, \"label\": \"Blocked by\", \"localized\": false}]', 0, 0, 0, NULL, NULL, '{\"record\": false}', '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '8de6f4426cda5d37ee85d440bf70cf74258b36994c39f96b0a6aa26bdf98a1f2', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('317b1412-c4e6-4c99-a61a-9e12c1ada0d1', 'authors', '{\"plural\": \"Authors\", \"singular\": \"Author\"}', 'dc_authors', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"bio\", \"type\": \"textarea\", \"label\": \"Biography\"}, {\"name\": \"jobTitle\", \"type\": \"text\", \"label\": \"Role / Title\"}, {\"name\": \"articleCount\", \"type\": \"number\", \"label\": \"Article Count\"}, {\"name\": \"avatar\", \"type\": \"upload\", \"label\": \"Avatar\", \"relationTo\": \"media\"}]', 1, 1, 1, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\"}', NULL, 'code', 1, NULL, '9574b54dab8dab53d40130bff603d766e1004126b673d9873a4e7a0b3a54a69f', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('347f48b3-ab29-4096-9029-c022bf8acb01', 'form-uploads', '{\"plural\": \"Form uploads\", \"singular\": \"Form upload\"}', 'dc_form_uploads', NULL, '[{\"name\": \"media\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"form\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"field\", \"type\": \"text\", \"required\": true}, {\"name\": \"submission\", \"type\": \"text\", \"localized\": false}, {\"name\": \"releasedAt\", \"type\": \"date\"}]', 1, 0, 0, NULL, NULL, '{\"record\": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', 1, NULL, 'ac95228adc18eecf6702f32e049e2887f3113374eed27648f58581a338325e3f', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('439b2b1c-15da-42b1-ac67-87ea5b7ac0fe', 'forms', '{\"plural\": \"Forms\", \"singular\": \"Form\"}', 'dc_forms', 'Create and manage your form templates using the visual form builder. Create and manage forms for collecting user submissions', '[{\"name\": \"name\", \"type\": \"text\", \"admin\": {\"description\": \"Internal name for this form (not shown to users)\"}, \"label\": \"Form Name\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"admin\": {\"description\": \"URL-friendly identifier. Used in API: /api/forms/{slug}\"}, \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"description\", \"type\": \"textarea\", \"admin\": {\"description\": \"Internal notes about this form\'s purpose\"}, \"label\": \"Description\"}, {\"name\": \"fields\", \"type\": \"json\", \"admin\": {\"description\": \"Form field configuration. Managed by the Form Builder UI.\"}, \"label\": \"Form Fields\", \"required\": true, \"defaultValue\": []}, {\"name\": \"settings\", \"type\": \"group\", \"label\": \"Form Settings\", \"fields\": [{\"name\": \"submitButtonText\", \"type\": \"text\", \"admin\": {\"description\": \"Text displayed on the form submit button\"}, \"label\": \"Submit Button Text\", \"defaultValue\": \"Submit\"}, {\"name\": \"confirmationType\", \"type\": \"select\", \"admin\": {\"description\": \"What happens after a successful form submission\"}, \"label\": \"After Submission\", \"options\": [{\"label\": \"Show Message\", \"value\": \"message\"}, {\"label\": \"Redirect to URL\", \"value\": \"redirect\"}, {\"label\": \"Redirect to Page\", \"value\": \"relationship\"}], \"defaultValue\": \"message\"}, {\"name\": \"successMessage\", \"type\": \"textarea\", \"admin\": {\"condition\": {\"field\": \"settings.confirmationType\", \"equals\": \"message\"}, \"description\": \"Message shown after successful submission\"}, \"label\": \"Success Message\", \"defaultValue\": \"Thank you for your submission!\"}, {\"name\": \"redirectUrl\", \"type\": \"text\", \"admin\": {\"condition\": {\"field\": \"settings.confirmationType\", \"equals\": \"redirect\"}, \"description\": \"URL to redirect to after submission\"}, \"label\": \"Redirect URL\"}, {\"name\": \"redirectPage\", \"type\": \"relationship\", \"admin\": {\"condition\": {\"field\": \"settings.confirmationType\", \"equals\": \"relationship\"}, \"description\": \"Select a page to redirect to after submission\"}, \"label\": \"Redirect Page\", \"relationTo\": [\"pages\"]}, {\"name\": \"allowMultipleSubmissions\", \"type\": \"checkbox\", \"admin\": {\"hidden\": true}, \"label\": \"Allow Multiple Submissions\"}, {\"name\": \"oneResponse\", \"type\": \"select\", \"label\": \"One response per person\", \"options\": [{\"label\": \"Allow several responses\", \"value\": \"off\"}, {\"label\": \"One per email address\", \"value\": \"email\"}, {\"label\": \"One per browser\", \"value\": \"browser\"}, {\"label\": \"One per network (IP address)\", \"value\": \"ip\"}]}, {\"name\": \"oneResponseField\", \"type\": \"text\", \"label\": \"Email field for one response per person\"}, {\"name\": \"oneResponseVersion\", \"type\": \"number\", \"admin\": {\"hidden\": true}, \"label\": \"One-response version\", \"defaultValue\": 0}, {\"name\": \"oneResponseKeyedVersion\", \"type\": \"number\", \"admin\": {\"hidden\": true}, \"label\": \"One-response keys made for version\"}, {\"name\": \"honeypotEnabled\", \"type\": \"checkbox\", \"admin\": {\"description\": \"Per-form honeypot override; unset inherits the plugin default\"}, \"label\": \"Honeypot\"}, {\"name\": \"captchaEnabled\", \"type\": \"checkbox\", \"admin\": {\"hidden\": true}, \"label\": \"Enable reCAPTCHA\"}, {\"name\": \"botCheck\", \"type\": \"select\", \"label\": \"Bot check\", \"options\": [{\"label\": \"Site default\", \"value\": \"default\"}, {\"label\": \"Off\", \"value\": \"off\"}, {\"label\": \"reCAPTCHA\", \"value\": \"recaptcha\"}, {\"label\": \"Turnstile\", \"value\": \"turnstile\"}]}, {\"name\": \"closesAt\", \"type\": \"date\", \"label\": \"Closes at\"}, {\"min\": 1, \"name\": \"submissionLimit\", \"type\": \"number\", \"label\": \"Submission limit\"}, {\"name\": \"storeIpAndBrowser\", \"type\": \"checkbox\", \"label\": \"Store IP address and browser\", \"defaultValue\": true}, {\"min\": 1, \"name\": \"keepDays\", \"type\": \"number\", \"label\": \"Keep submissions for (days)\"}, {\"name\": \"internalNote\", \"type\": \"textarea\", \"label\": \"Internal note\"}, {\"name\": \"captchaSiteKey\", \"type\": \"text\", \"admin\": {\"condition\": {\"field\": \"settings.captchaEnabled\", \"equals\": true}, \"description\": \"Override the default reCAPTCHA site key for this form\"}, \"label\": \"reCAPTCHA Site Key\"}]}, {\"name\": \"notifications\", \"type\": \"json\", \"admin\": {\"description\": \"Email notification rules. Managed by the Form Builder UI.\"}, \"label\": \"Notifications\", \"defaultValue\": []}, {\"name\": \"status\", \"type\": \"select\", \"admin\": {\"description\": \"Only published forms can receive submissions. Closed forms display a message instead.\"}, \"label\": \"Status\", \"options\": [{\"label\": \"Draft\", \"value\": \"draft\"}, {\"label\": \"Published\", \"value\": \"published\"}, {\"label\": \"Closed\", \"value\": \"closed\"}], \"required\": true, \"defaultValue\": \"draft\"}, {\"name\": \"wentLiveAt\", \"type\": \"date\", \"admin\": {\"readOnly\": true, \"description\": \"When this form first went live. Written once and never changed.\"}, \"label\": \"First Published\"}, {\"name\": \"closedMessage\", \"type\": \"textarea\", \"admin\": {\"condition\": {\"field\": \"status\", \"equals\": \"closed\"}, \"description\": \"Message shown when form status is \'closed\'\"}, \"label\": \"Closed Form Message\", \"defaultValue\": \"This form is no longer accepting submissions.\"}]', 1, 0, 0, NULL, NULL, NULL, '{\"group\": \"Forms\", \"order\": 50, \"isPlugin\": true, \"components\": {\"views\": {\"Edit\": {\"Component\": \"@nextlyhq/plugin-form-builder/admin#FormBuilderView\"}}}, \"useAsTitle\": \"name\"}', NULL, 'plugin:@nextlyhq/plugin-form-builder', 1, NULL, '5a578f2b745016e46ea3657b3d54e09ff12bc8755351484ace308b1e510d63ff', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('524c75a3-0bd5-4a84-9db0-49b6577dcf6f', 'pages', '{\"plural\": \"Pages\", \"singular\": \"Page\"}', 'dc_pages', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true}, {\"name\": \"content\", \"type\": \"blocks\", \"label\": \"Page Builder\"}, {\"name\": \"layout\", \"type\": \"relationship\", \"admin\": {\"hidden\": true, \"description\": \"Leave empty to use the site\'s default header & footer set.\"}, \"label\": \"Header & footer\", \"relationTo\": \"layouts\"}, {\"name\": \"noHeaderFooter\", \"type\": \"checkbox\", \"admin\": {\"hidden\": true}, \"label\": \"No header or footer\", \"defaultValue\": false}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '8c4db2ea8a7cc335c49460cd47a2e4bcc6f9d18551265ad8c10aa455dfdfe79a', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('601728ef-5264-4fbc-b803-6be48df77613', 'categories', '{\"plural\": \"Categories\", \"singular\": \"Category\"}', 'dc_categories', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true}, {\"name\": \"description\", \"type\": \"textarea\"}, {\"name\": \"icon\", \"type\": \"icon\", \"label\": \"Icon\"}]', 1, 0, 0, NULL, NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'code', 1, NULL, 'bb9fa3378bdb739e5cf91fff9efd293e17cd805975945c94a715a97d7bd62dc5', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('685983ca-088e-4089-b408-015c5c3f69e9', 'nx_pb_component_retired', '{\"plural\": \"Retired component fields\", \"singular\": \"Retired component field\"}', 'dc_nx_pb_component_retired', 'Fields removed from components. Maintained automatically when a component is published.', '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"identity\", \"type\": \"text\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"componentId\", \"type\": \"text\", \"index\": true, \"required\": true, \"localized\": false}, {\"name\": \"kind\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"exposureId\", \"type\": \"textarea\", \"required\": true, \"localized\": false}]', 0, 0, 0, NULL, NULL, '{\"record\": false}', '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, 'acaf1e1f5553f49a23e1e868045655032f62f7782ee899b2a1b3ac74d783a71e', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('68a4a97f-856e-4951-8bfd-da19dbcc696c', 'components', '{\"plural\": \"Components\", \"singular\": \"Component\"}', 'dc_components', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"description\", \"type\": \"textarea\"}, {\"name\": \"category\", \"type\": \"text\"}, {\"name\": \"area\", \"type\": \"select\", \"admin\": {\"isClearable\": true, \"placeholder\": \"Anywhere\"}, \"label\": \"Use as\", \"options\": [{\"label\": \"Header\", \"value\": \"header\"}, {\"label\": \"Footer\", \"value\": \"footer\"}]}, {\"name\": \"content\", \"type\": \"blocks\", \"label\": \"Component\", \"blocks\": {\"kinds\": [\"component\"]}}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"hidden\": true, \"components\": {\"BeforeListTable\": \"@nextlyhq/plugin-page-builder/admin#ComponentListTools\"}, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\", \"disableDelete\": true}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '3c59abcd739fcfbb2753cb953d44828e41893c1c2ed432af503ae662d375a301', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('7ac895d6-e54c-4abb-8780-0a485e645983', 'tags', '{\"plural\": \"Tags\", \"singular\": \"Tag\"}', 'dc_tags', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true}, {\"name\": \"description\", \"type\": \"textarea\"}]', 1, 0, 0, NULL, NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'code', 1, NULL, '200bd33fa25e12a7c3744ab96cd121402cd32bb6af4a0413911a737bab950a94', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('872b2e74-93af-45f2-bd3a-e22fdfe3c516', 'nx_pb_usage_backfill', '{\"plural\": \"Usage backfill\", \"singular\": \"Usage backfill\"}', 'dc_nx_pb_usage_backfill', 'No longer used. The page builder keeps its usage index progress elsewhere, and nothing reads these rows.', '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"scopeKey\", \"type\": \"text\", \"index\": true, \"label\": \"Scope key\", \"localized\": false}, {\"name\": \"generation\", \"type\": \"text\", \"index\": true, \"label\": \"Generation\", \"localized\": false}]', 0, 0, 0, NULL, NULL, '{\"record\": false}', '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '52cb3df6ca6a996ae81c74e0dc2964785a89000a9e98046978224f4a30057909', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('8b8fb57a-fdd4-452b-9259-e96e37a4faeb', 'templates', '{\"plural\": \"Collection templates\", \"singular\": \"Collection template\"}', 'dc_templates', NULL, '[{\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"title\", \"type\": \"text\", \"required\": true, \"maxLength\": 255}, {\"name\": \"collection\", \"type\": \"text\", \"admin\": {\"component\": \"@nextlyhq/plugin-page-builder/admin#TemplateCollectionField\", \"condition\": {\"field\": \"entry\", \"equals\": \"\"}, \"description\": \"The collection whose entries this template draws. A collection has one template, and it cannot be changed once the template exists.\"}, \"label\": \"Collection\", \"unique\": true, \"localized\": false}, {\"name\": \"entry\", \"type\": \"text\", \"admin\": {\"hidden\": true, \"description\": \"The entry this design serves, when it is an entry\'s own design rather than its collection\'s template. Set when it is made, and never changed.\"}, \"label\": \"Entry\", \"unique\": true, \"localized\": false}, {\"name\": \"entryCollection\", \"type\": \"text\", \"admin\": {\"hidden\": true}, \"index\": true, \"label\": \"Entry\'s collection\", \"localized\": false}, {\"name\": \"entryId\", \"type\": \"text\", \"admin\": {\"hidden\": true}, \"label\": \"Entry id\", \"localized\": false}, {\"name\": \"forkedFrom\", \"type\": \"text\", \"admin\": {\"hidden\": true}, \"index\": true, \"label\": \"Copied from\", \"localized\": false}, {\"name\": \"address\", \"type\": \"text\", \"admin\": {\"component\": \"@nextlyhq/plugin-page-builder/admin#TemplateAddressField\", \"condition\": {\"field\": \"entry\", \"equals\": \"\"}, \"description\": \"Where this collection\'s entries are served: with /blog, the entry hello is served at /blog/hello once the template is published. Changing it moves every entry to the new address and frees the old ones.\", \"placeholder\": \"/blog\"}, \"label\": \"Address\", \"unique\": true, \"localized\": false, \"maxLength\": 255}, {\"name\": \"content\", \"type\": \"blocks\", \"label\": \"Collection template\", \"blocks\": {\"kinds\": [\"template\"]}}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\", \"defaultColumns\": [\"title\", \"collection\", \"address\", \"status\"]}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '3949d5829f15fbc49a505c57c53cce5543a11a81c81c7bb1408c871f7883be2b', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('bd596ef7-6706-413e-a68d-fee32afca749', 'posts', '{\"plural\": \"Posts\", \"singular\": \"Post\"}', 'dc_posts', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true}, {\"name\": \"excerpt\", \"type\": \"textarea\"}, {\"name\": \"metaTitle\", \"type\": \"text\"}, {\"name\": \"metaDescription\", \"type\": \"text\"}, {\"name\": \"editorMode\", \"type\": \"select\", \"admin\": {\"description\": \"Choose how to build this post\'s body.\"}, \"label\": \"Editor\", \"options\": [{\"label\": \"Standard editor\", \"value\": \"standard\"}, {\"label\": \"Page Builder\", \"value\": \"page-builder\"}], \"defaultValue\": \"standard\"}, {\"name\": \"content\", \"type\": \"richText\", \"admin\": {\"condition\": {\"field\": \"editorMode\", \"equals\": \"standard\"}}}, {\"name\": \"customScript\", \"type\": \"code\", \"admin\": {\"language\": \"typescript\", \"description\": \"Runs when this post is rendered.\"}}, {\"name\": \"settings\", \"type\": \"json\", \"admin\": {\"description\": \"Arbitrary per-post configuration.\"}}, {\"name\": \"sections\", \"type\": \"blocks\", \"admin\": {\"condition\": {\"field\": \"editorMode\", \"equals\": \"page-builder\"}}, \"blocks\": {\"allow\": [\"core/*\"]}}, {\"name\": \"categories\", \"type\": \"relationship\", \"hasMany\": true, \"relationTo\": \"categories\"}, {\"name\": \"tags\", \"type\": \"relationship\", \"hasMany\": true, \"relationTo\": \"tags\"}, {\"name\": \"featuredImage\", \"type\": \"upload\", \"relationTo\": \"media\"}, {\"name\": \"publishedAt\", \"type\": \"date\"}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\"}', NULL, 'code', 1, NULL, '58ad88c3c41de147d5158ee231bc1fedf1e412ab634ccebd3f1c96b70a81aa2b', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('c82966d7-a33d-48d0-87e7-bb246d4427b2', 'nx_pb_class_usage', '{\"plural\": \"Class usage\", \"singular\": \"Class usage\"}', 'dc_nx_pb_class_usage', 'No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.', '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"scope\", \"type\": \"text\", \"label\": \"Scope\", \"localized\": false}, {\"name\": \"entity\", \"type\": \"text\", \"label\": \"Entity\", \"localized\": false}, {\"name\": \"entityKey\", \"type\": \"text\", \"index\": true, \"label\": \"Entity key\", \"localized\": false}, {\"name\": \"field\", \"type\": \"text\", \"label\": \"Field\", \"localized\": false}, {\"name\": \"locale\", \"type\": \"text\", \"label\": \"Locale\", \"localized\": false}, {\"name\": \"variant\", \"type\": \"text\", \"label\": \"Variant\", \"localized\": false}, {\"name\": \"classId\", \"type\": \"text\", \"index\": true, \"label\": \"Class id\", \"localized\": false}]', 0, 0, 0, NULL, NULL, '{\"record\": false}', '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '097355078d3cdff17284a917aba3f65a628cf18532561d57270fac46d554b261', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('c88a839b-4e0c-4c1b-aa48-bf08eb51f32b', 'form-submission-resends', '{\"plural\": \"Submission resends\", \"singular\": \"Submission resend\"}', 'dc_form_submission_resends', NULL, '[{\"name\": \"submission\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"notification\", \"type\": \"text\", \"required\": true}, {\"name\": \"requestedBy\", \"type\": \"text\"}, {\"name\": \"ticked\", \"type\": \"json\"}, {\"name\": \"exclude\", \"type\": \"json\"}, {\"name\": \"retire\", \"type\": \"json\"}, {\"name\": \"settled\", \"type\": \"json\"}]', 1, 0, 0, NULL, NULL, '{\"record\": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', 1, NULL, '302306984b5fc1c8832cca99fec3a8cb3b47b90579e17cae99f94cdcf96f04f8', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('d024efe6-7954-4216-8474-6fe08774fd2e', 'form-submission-sends', '{\"plural\": \"Submission sends\", \"singular\": \"Submission send\"}', 'dc_form_submission_sends', NULL, '[{\"name\": \"submission\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"queuedId\", \"type\": \"text\", \"required\": true, \"localized\": false}, {\"name\": \"sendKey\", \"type\": \"text\", \"required\": true}, {\"name\": \"form\", \"type\": \"text\", \"localized\": false}, {\"name\": \"notification\", \"type\": \"text\", \"localized\": false}, {\"name\": \"notificationName\", \"type\": \"text\"}, {\"name\": \"state\", \"type\": \"text\"}, {\"name\": \"attempts\", \"type\": \"number\"}, {\"name\": \"retries\", \"type\": \"number\"}, {\"name\": \"changedAt\", \"type\": \"date\"}, {\"name\": \"cancel\", \"type\": \"json\"}, {\"name\": \"cancelRequested\", \"type\": \"json\"}, {\"name\": \"retiredBy\", \"type\": \"text\"}, {\"name\": \"configured\", \"type\": \"json\"}, {\"name\": \"recipients\", \"type\": \"json\"}, {\"name\": \"requestedBy\", \"type\": \"text\"}, {\"name\": \"resend\", \"type\": \"text\"}]', 1, 0, 0, NULL, NULL, '{\"record\": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', 1, NULL, '0779c8813feb5a919d2c2e40ed279cc893a7a9ea856e779e4c3c9adfb0416640', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('ecf5d854-99bb-4e53-8d35-dfc6e77e25b3', 'patterns', '{\"plural\": \"Saved sections\", \"singular\": \"Saved section\"}', 'dc_patterns', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"description\", \"type\": \"textarea\"}, {\"name\": \"category\", \"type\": \"text\"}, {\"name\": \"keywords\", \"type\": \"text\"}, {\"name\": \"granularity\", \"type\": \"select\", \"options\": [{\"label\": \"element\", \"value\": \"element\"}, {\"label\": \"group\", \"value\": \"group\"}, {\"label\": \"section\", \"value\": \"section\"}, {\"label\": \"page\", \"value\": \"page\"}], \"required\": true}, {\"name\": \"content\", \"type\": \"blocks\", \"label\": \"Saved section\", \"blocks\": {\"kinds\": [\"pattern\"]}}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"hidden\": true, \"components\": {\"BeforeListTable\": \"@nextlyhq/plugin-page-builder/admin#TransferImport\"}, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, 'e9c577d0f3fc82d2caa8342275a071942f4b92e6ff3ed6dcd9a138a0b195a313', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('ee6d05da-8b71-4da8-90f5-01b43b70a3cd', 'nx_pb_component_usage', '{\"plural\": \"Component usage\", \"singular\": \"Component usage\"}', 'dc_nx_pb_component_usage', 'No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.', '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"scope\", \"type\": \"text\", \"label\": \"Scope\", \"localized\": false}, {\"name\": \"entity\", \"type\": \"text\", \"label\": \"Entity\", \"localized\": false}, {\"name\": \"entityKey\", \"type\": \"text\", \"index\": true, \"label\": \"Entity key\", \"localized\": false}, {\"name\": \"field\", \"type\": \"text\", \"label\": \"Field\", \"localized\": false}, {\"name\": \"locale\", \"type\": \"text\", \"label\": \"Locale\", \"localized\": false}, {\"name\": \"variant\", \"type\": \"text\", \"label\": \"Variant\", \"localized\": false}, {\"name\": \"kind\", \"type\": \"text\", \"label\": \"Kind\", \"localized\": false}, {\"name\": \"componentId\", \"type\": \"text\", \"index\": true, \"label\": \"Component id\", \"localized\": false}]', 0, 0, 0, NULL, NULL, '{\"record\": false}', '{\"hidden\": true, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '36ce808b133ef5c9e6ec6cdf729238823fcee558f3e423400d6365d9d69c066b', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_collections` (`id`, `slug`, `labels`, `table_name`, `description`, `fields`, `timestamps`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `admin`, `hooks`, `source`, `locked`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('fa90699d-0edd-4da3-80a3-eb1d2cb40c46', 'layouts', '{\"plural\": \"Header & footer\", \"singular\": \"Header & footer set\"}', 'dc_layouts', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"required\": true}, {\"name\": \"slug\", \"type\": \"text\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"description\", \"type\": \"textarea\"}, {\"name\": \"areas\", \"type\": \"repeater\", \"fields\": [{\"name\": \"area\", \"type\": \"select\", \"options\": [{\"label\": \"Header\", \"value\": \"header\"}, {\"label\": \"Footer\", \"value\": \"footer\"}], \"required\": true}, {\"name\": \"component\", \"type\": \"relationship\", \"required\": true, \"relationTo\": \"components\"}]}]', 1, 1, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, '{\"hidden\": true, \"components\": {\"BeforeListTable\": \"@nextlyhq/plugin-page-builder/admin#LayoutListTools\"}, \"pagination\": {\"limits\": [10, 25, 50, 100], \"defaultLimit\": 10}, \"useAsTitle\": \"title\"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', 1, NULL, '9f54922cbb0eaf858d0392bd216d06a7c478bc8114cd5ab799231e9c8b75620b', 1, 'applied', NULL, NULL, '2026-11-23 04:48:11', '2026-11-23 04:48:12');
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
INSERT INTO `dynamic_components` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `localized`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('2404135f-e135-40f8-a0a7-ba43dad363f8', 'seo', 'SEO Metadata', 'comp_seo', NULL, '[{\"name\": \"metaTitle\", \"type\": \"text\", \"label\": \"Meta Title\"}, {\"name\": \"metaDescription\", \"type\": \"textarea\", \"label\": \"Meta Description\"}, {\"name\": \"ogImage\", \"type\": \"upload\", \"label\": \"OG Image\", \"relationTo\": \"media\"}]', '{\"category\": \"Shared\", \"description\": \"Search-engine and social-share metadata.\"}', 'code', 1, 1, 'components/seo.ts', 'b42685ed7e2e672728c80c48271817c2d4b8b958d789f6355536f4bba02d13f7', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
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
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('07eea8fe-d82a-4f27-8098-ae146402fe32', 'page-builder-site-code', 'Site Code', 'single_page_builder_site_code', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"headSource\", \"type\": \"textarea\", \"admin\": {\"readOnly\": true}, \"label\": \"Head\", \"localized\": false}, {\"name\": \"bodySource\", \"type\": \"textarea\", \"admin\": {\"readOnly\": true}, \"label\": \"End of body\", \"localized\": false}, {\"name\": \"head\", \"type\": \"json\", \"admin\": {\"hidden\": true, \"readOnly\": true}, \"label\": \"Head entries\"}, {\"name\": \"body\", \"type\": \"json\", \"admin\": {\"hidden\": true, \"readOnly\": true}, \"label\": \"End of body entries\"}, {\"name\": \"changedBy\", \"type\": \"text\", \"admin\": {\"hidden\": true, \"readOnly\": true}, \"label\": \"Changed by\", \"localized\": false}]', '{\"hidden\": true, \"description\": \"Code added to every page of the site. Changed in Settings, under Site.\"}', 'code', 1, 0, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, '1db6be20129d2bc9d385389e63d4ac1d047990f074b4fbabd767cc4b002db9e7', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('49b4a885-d7ad-4d98-bd41-aef282b880d9', 'announcement', 'Announcement', 'single_announcement', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"campaign\", \"type\": \"text\", \"label\": \"Campaign\", \"localized\": false}, {\"name\": \"headline\", \"type\": \"text\", \"label\": \"Headline\"}, {\"name\": \"body\", \"type\": \"textarea\", \"label\": \"Body\"}]', '{}', 'code', 1, 1, 1, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, '383af6a2a438d655a05f247e3505a7a49158601211a53fa2fd63bba4bf99cc77', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('53ad8e6b-56f1-48bc-bd44-fb034f8d5bd9', 'landing-page', 'Landing Page', 'single_landing_page', NULL, '[{\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"title\", \"type\": \"text\"}, {\"name\": \"hero\", \"type\": \"blocks\", \"label\": \"Hero section\", \"blocks\": {\"allow\": [\"core/*\"]}}]', '{}', 'code', 1, 1, 0, '{\"drafts\": {\"enabled\": false, \"autosave\": {\"enabled\": false, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, '0f6e230b923e46a497101a43d5535df61d034f9f992d09efb5e598af25777309', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('a465ff20-0340-4f7b-8330-65b701ac2120', 'homepage', 'Homepage', 'single_homepage', NULL, '[{\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"title\", \"type\": \"text\"}, {\"name\": \"layout\", \"type\": \"blocks\", \"label\": \"Layout\", \"blocks\": {\"allow\": [\"core/*\"]}}]', '{}', 'code', 1, 0, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, '5d793e3ec0ba01cd60314dedc10e877554cde735e7218d69a2cc207229abaf24', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('ab5bc69f-13eb-4cd4-9f32-590aa3d7f057', 'site-settings', 'Site Settings', 'single_site_settings', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"siteName\", \"type\": \"text\", \"label\": \"Site Name\", \"required\": true, \"localized\": false}, {\"name\": \"tagline\", \"type\": \"textarea\", \"label\": \"Tagline\"}, {\"name\": \"seo\", \"type\": \"component\", \"label\": \"Default SEO\", \"component\": \"seo\"}]', '{}', 'code', 1, 0, 1, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, '8ea4ce97622df5c31d0a9663202a201da90ad6668d3cee173a4c3ac7e18db581', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('d053eb3e-734e-4436-a710-d879a2bbb98a', 'site-style', 'Site Style', 'single_site_style', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"tokens\", \"type\": \"json\", \"admin\": {\"description\": \"A token set: { tokens: [{ id?, name, label?, kind, values: { light, dark? }, fluid?: { small, large }, group? }], prefix?, darkMode?, fluidRange?: { min, max }, order?: [identity], builtInColoursShown?: boolean, siteText?: { body?, h1?…h6?, link?, button?, caption? } }. Values are per mode; \\\"light\\\" is what a reader with no mode set resolves. `id` is the token\'s stable identity — set it once and a later rename of `name` leaves every page that references the token working; omit it and the name is the identity. `fluid` is the two sizes in px a fluid size was made from, and `fluidRange` the screen widths in px it grows between (360 to 1280 when absent). `group` is the named group a colour is listed under and `order` the identities of the colours in the order they are listed, both display-only. `builtInColoursShown: false` leaves the built-in colours the site does not use out of the Design panel and the colour pickers; they are still written on every page. `siteText` sets the text of every page: each row holds `fontFamily`, `fontSize` and `lineHeight` (a variable reference such as { $token: \\\"font-size.h2\\\" } or a value; the Body font is `body.fontFamily` set to { $token: \\\"font.body\\\" } and the Headings font is `fontFamily` set to { $token: \\\"font.heading\\\" } on every heading row), and the `link` row `color`, `hoverColor` and `underline` (\\\"always\\\", \\\"hover\\\" or \\\"never\\\") instead; a row left out keeps its built-in value.\"}, \"label\": \"Design tokens\"}, {\"name\": \"fonts\", \"type\": \"json\", \"admin\": {\"description\": \"Self-hosted @font-face definitions: [{ family, src: [{ url, format? }], weight?, style? }]. Files must live on this site.\"}, \"label\": \"Font faces\"}, {\"name\": \"classes\", \"type\": \"json\", \"admin\": {\"description\": \"Reusable style presets: [{ id, slug, label?, orderIndex, styles, locked? }]. Documents reference a class by id; a later orderIndex overrides an earlier one. `label` is the name authors see; `locked: true` holds the class as it is until it is unlocked.\"}, \"label\": \"Named classes\"}, {\"name\": \"breakpoints\", \"type\": \"json\", \"admin\": {\"description\": \"The site\'s breakpoints: { viewport: [{ id, label, maxWidth? }], container: [...] }. Ids must be unique across both axes; the base breakpoint has no maxWidth.\"}, \"label\": \"Breakpoints\"}]', '{\"icon\": \"Palette\", \"description\": \"Site-wide design tokens, fonts, classes and breakpoints for pages built from blocks.\"}', 'code', 1, 0, 0, '{\"drafts\": {\"enabled\": true, \"autosave\": {\"enabled\": true, \"intervalMs\": 1000}}, \"enabled\": true, \"maxPerDoc\": 50}', NULL, NULL, NULL, 'c565a9373778365db99ffc4f99f2d4f00a3356adbe7e14b9c97fb6fb459959c8', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `dynamic_singles` (`id`, `slug`, `label`, `table_name`, `description`, `fields`, `admin`, `source`, `locked`, `status`, `localized`, `versions`, `revalidate`, `webhooks`, `config_path`, `schema_hash`, `schema_version`, `migration_status`, `last_migration_id`, `created_by`, `created_at`, `updated_at`) VALUES ('f876dedd-4753-43df-a6bc-347164333afc', 'page-builder-settings', 'Page Builder Settings', 'single_page_builder_settings', NULL, '[{\"name\": \"title\", \"type\": \"text\", \"label\": \"Title\", \"required\": true, \"localized\": false}, {\"name\": \"slug\", \"type\": \"text\", \"label\": \"Slug\", \"unique\": true, \"required\": true, \"localized\": false}, {\"name\": \"defaultLayout\", \"type\": \"relationship\", \"admin\": {\"readOnly\": true}, \"label\": \"Default header & footer set\", \"relationTo\": \"layouts\"}, {\"name\": \"seededLayout\", \"type\": \"relationship\", \"admin\": {\"hidden\": true, \"readOnly\": true}, \"label\": \"Seeded header & footer set\", \"relationTo\": \"layouts\"}, {\"name\": \"defaultLayoutChangedBy\", \"type\": \"text\", \"admin\": {\"hidden\": true, \"readOnly\": true}, \"label\": \"Default changed by\", \"localized\": false}]', '{\"hidden\": true, \"description\": \"The header & footer set pages are drawn inside when they choose none of their own. Set from the Header & footer list.\"}', 'code', 1, 0, 0, NULL, NULL, NULL, NULL, 'a58a522c82c355c911beb7d23484bdb5bdb8dfa2becbb64b8b1fde3d0efbedf1', 1, 'applied', NULL, NULL, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
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
  `queued_id` varchar(36) DEFAULT NULL,
  `template_owner` text,
  `template_overridden` tinyint(1) DEFAULT NULL,
  `template_digest` varchar(64) DEFAULT NULL,
  `failure_kind` varchar(16) DEFAULT NULL,
  `failure_status` int DEFAULT NULL,
  `provider_origin` varchar(16) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `email_deliveries_created_idx` (`created_at`),
  KEY `email_deliveries_recipient_idx` (`recipient_hash`,`created_at`),
  KEY `email_deliveries_status_created_idx` (`status`,`created_at`),
  KEY `email_deliveries_provider_idx` (`provider_id`,`created_at`),
  KEY `email_deliveries_provider_type_idx` (`provider_type`,`created_at`),
  KEY `email_deliveries_retention_idx` (`retention_class`,`created_at`),
  KEY `email_deliveries_principal_idx` (`principal_kind`,`principal_id`),
  KEY `email_deliveries_key_idx` (`key_digest`),
  KEY `email_deliveries_queued_idx` (`queued_id`),
  KEY `email_deliveries_provider_origin_idx` (`provider_origin`,`created_at`),
  KEY `email_deliveries_template_idx` (`template_slug`,`status`,`created_at`),
  KEY `email_deliveries_template_created_idx` (`template_slug`,`created_at`,`id`)
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
  `template_slug` varchar(255) DEFAULT NULL,
  `message_kind` varchar(16) DEFAULT NULL,
  `recipient_kinds` varchar(16) DEFAULT NULL,
  `provider_type` varchar(50) DEFAULT NULL,
  `provider_id` varchar(36) DEFAULT NULL,
  `provider_origin` varchar(16) DEFAULT NULL,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  `settled_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `email_queue_state_idx` (`state`,`settled_at`),
  KEY `email_queue_principal_idx` (`principal_kind`,`principal_id`),
  KEY `email_queue_created_idx` (`created_at`,`id`),
  KEY `email_queue_template_idx` (`template_slug`,`created_at`),
  KEY `email_queue_provider_type_idx` (`provider_type`,`created_at`),
  KEY `email_queue_provider_origin_idx` (`provider_origin`,`created_at`)
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
  `format` varchar(10) DEFAULT NULL,
  `blocks` json DEFAULT NULL,
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
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('0934dd1d2250257e0c815e4f1bf8444689faf1773dd32c669194e72d119f4480', 'nextly:nx_pb_component_retired', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('196f52e8b9ee9af8a1f6efc7643944f765b59ece49f624bdc9442804ce7b3469', 'nextly:authors', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('1ae6c0cba0a90552d7ef46de27b6d4c9d50050c2f37df2ced0bf528a651e514d', 'nextly:layouts', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('1fb73701362b2ddd37ce5a48c537f404d5bf76bc892e63854c83f4e9e9e4255c', 'nextly:nx_pb_usage_backfill', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('345827994938fb50297f0c43a5954c56a77c506ecff30871504d50bf1558b3b0', 'nextly:nx_pb_component_usage', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('3605cc0ff8c05260d0520356db39c189864f60d1b2ff0bfcf57328fd74d38a46', 'nextly:tags', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('3f6055ebf4e2e790d78cdec59abebc514a12efe3ba2eac83fbdc9d14477b86b6', 'nextly:form-submission-resends', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('42154262594900e3715c2c2eb56e8d20dd8c29a97b11c7d8b106ead41e484245', 'nextly:single:announcement', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('4bc3f91485047dd868569cd04c78536223036443f6944cd35e5a080e4af3c784', 'nextly:components', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('6237ef38c37ab913772883cda6cea0eeca6e617b1d07ea50ee48119a24aea5a0', 'nextly:single:page-builder-settings', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('6e1d0f3ee1e7a4e57e7b9c9f849b827d5fb9630b7a4aed557c0aa4241c5b0d25', 'nextly:categories', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('8418a57f7e6cb6f51937a9a617fa96b9f8c58523ffe62150870c8e4e5f48b687', 'nextly:single:page-builder-site-code', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('8b0c6efbe48b7f60bc93a0120f901e50e6f12253b0c4c3d0df7825491cd024a4', 'nextly:posts', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('8f0a1fe2cbeca15a2e8f48e423da6b8926c7dd0d9ec056ba9cb4da0dc10beda3', 'nextly:forms', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('90ddf72aa37d60f19135fcac40945c3d3ef70a8ba2fa3e07baef09db333268a5', 'nextly:nx_pb_address_claims', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('ab4f77ac592b98f0fb738cc32d879e0b3962e07d008ed4d85458cb8639a8e752', 'nextly:patterns', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('b40f545e925b03821fdc21ff42d85f26925a1613087ebdde038f187ba56547ab', 'nextly:nx_pb_class_usage', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('b55bd0b602d772cda029806d44dfd6cff9d79e036fe671b68d1cca4b626eb3fc', 'nextly:form-submission-sends', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('c78830075125ee97a521f7a78edb8dea657e4fafcd2a24d31cbf1f3260d6311c', 'nextly:single:landing-page', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('d84dbfa1c24f9b12ac60a6f6bccd86d52e3e7e0b1dc14b687a57acae8bb5ad85', 'nextly:single:site-style', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('da349ada08ecfa4c18881030e9b062ff97533a6b0396908514a734fbe3df70e8', 'nextly:single:site-settings', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('dc89a5f5fb2d249a7a19d6f90d8a4570c52f6a17c6107180c04c9a3cb540ea08', 'nextly:form-uploads', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('e43a21fe5f8326f2b558d2bf0f9511eb8ab154830dbc21c7c30cbfab956f4d46', 'nextly:form-submissions', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('e610992ebb64c532e52a1bf8965e68ddc39624a9aedfa029ed9e022e7fda1b90', 'nextly:block-pages', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('eb5895cd9d57f56cc4353e8320ee8318c5c0a50f043740fa3d65bb0fd1640cf2', 'nextly:templates', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('ec788ab296ed5baa48a7611054330223cb52d36b333f7c46f53b90c360c8dfed', 'nextly:single:homepage', '1795409295172');
INSERT INTO `nextly_cache_tag_expiries` (`id`, `tag`, `expired_at`) VALUES ('f7336b4be5e930dbee8010131d536479b9e24a7a5023c8eb9dbd50a20ea61172', 'nextly:pages', '1795409295172');
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
CREATE TABLE `nextly_external_identities` (
  `id` varchar(36) NOT NULL,
  `provider_key` text NOT NULL,
  `issuer` text NOT NULL,
  `subject` text NOT NULL,
  `key_digest` varchar(64) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `user_id` varchar(191) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_external_identities_key_uidx` (`key_digest`),
  KEY `nextly_external_identities_user_idx` (`user_id`),
  CONSTRAINT `nextly_external_identities_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
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
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('collections-closed-to-super-admin-in-code', '\"{\\\"collections\\\":{}}\"', '2026-11-23 04:48:13');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('preset_grants_release', '\"{\\\"release\\\":\\\"0.0.2-alpha.79\\\"}\"', '2026-11-23 04:48:13');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('preset-grants-grandfathered', '\"{\\\"collections\\\":{}}\"', '2026-11-23 04:48:13');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('public-read-upgrade-notice', '\"\\\"not-due\\\"\"', '2026-11-23 04:48:12');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('public-role-created', '\"\\\"created\\\"\"', '2026-11-23 04:48:13');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('public-role-granted', '\"{\\\"role\\\":\\\"d50b40dd-430f-4f35-8c3a-c2a51a838bd8\\\",\\\"granted\\\":[\\\"27aa5246-ae7d-4623-bdf2-22b8af9e4832\\\",\\\"34b4bb65-fca8-4a8d-8b20-0168cd91a28b\\\",\\\"7760a715-7fdd-4cdc-b34c-d53658b2d2ba\\\",\\\"91592f4d-a3c5-43b2-b732-98c25756a15e\\\",\\\"abf23400-4843-4f3a-aa22-de3184af318d\\\",\\\"b1747205-2416-4de2-b322-df7480048a12\\\",\\\"c93006d7-6264-455d-b9df-afe1c00fec36\\\",\\\"ef98bb82-d071-4c8f-8335-8bda9e6e15a8\\\"],\\\"declared\\\":{\\\"ef98bb82-d071-4c8f-8335-8bda9e6e15a8\\\":{\\\"action\\\":\\\"create\\\",\\\"resource\\\":\\\"form-submissions\\\",\\\"owner\\\":\\\"@nextlyhq/plugin-form-builder\\\"}}}\"', '2026-11-23 04:48:13');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('registry_record', '\"{\\\"point\\\":null,\\\"baseline\\\":{\\\"collections\\\":{},\\\"singles\\\":{},\\\"fieldGroups\\\":{},\\\"permissions\\\":[],\\\"ownedPermissions\\\":[]}}\"', '2026-11-23 04:48:05');
INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) VALUES ('schema_version', '\"{\\\"migration\\\":\\\"20261123_044742_398_unique_localization_pages\\\",\\\"seq\\\":1}\"', '2026-11-23 04:48:12');
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
INSERT INTO `nextly_rbac_epoch` (`id`, `revision`, `generation`, `updated_at`) VALUES ('global', '8', '41a093cd-1512-4f8f-92b2-7380bcfc22ec', '2026-11-23 04:48:13');
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
  KEY `nextly_release_members_doc_walk_idx` (`scope_kind`,`scope_slug`,`entry_id`,`id`),
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
  KEY `nextly_review_states_waiting_idx` (`scope_kind`,`scope_slug`,`stage`,`entered_at`,`part_key`),
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
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('00b6d4bc-062f-4c8a-a202-51c7f31f3b44', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_380_create_localization_patterns.sql', '6bcc31e160dc4ae832a38ad88cfe0df292ac85867fbb8082d62ccb75d5927916', NULL, NULL, '2026-11-23 04:48:10.139', '2026-11-23 04:48:10.164', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('08ce264b-8f8d-40da-829e-86e01e5392bf', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_384_create_localization_forms.sql', 'f086f874acce1047cdb53d2b1a3c91011a973304988fdbeb6bd19f71cf4b7e4e', NULL, NULL, '2026-11-23 04:48:10.303', '2026-11-23 04:48:10.325', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('0cb2fb10-45d7-41b4-a7d2-02706593f1fa', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-23 04:48:02.154', '2026-11-23 04:48:02.225', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('1593a669-e2b9-49e6-914d-9921c80f1160', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_390_create_localization_landing-page.sql', '74e07f6950067543660c97d37b8d3c38810ecd665391bbf090b2eb02dea4f055', NULL, NULL, '2026-11-23 04:48:10.566', '2026-11-23 04:48:10.599', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('1a529ca9-aea5-4b99-b335-97d469614df4', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-23 04:48:01.552', '2026-11-23 04:48:01.557', NULL, NULL, NULL, NULL, 237, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('1fede42a-b216-42b3-9b50-c837a11a7bf8', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_391_create_localization_site-settings.sql', 'bf2d26ea50f2004fbe57990fd41ccc0d32a3e4578bcee6c2c6fdb6de1e244cb7', NULL, NULL, '2026-11-23 04:48:10.611', '2026-11-23 04:48:10.644', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('2392b60b-8e4b-409d-ae11-4248ecb5bda4', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_396_unique_localization_tags.sql', '9503d566f29ef9bf79f74bd9525995fd0a0d0fc00d1dc0d6f5aa702c265b7704', NULL, NULL, '2026-11-23 04:48:10.881', '2026-11-23 04:48:10.924', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('2e8a06c0-5ea5-468a-953e-17aac05ea4dd', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_393_create_localization_seo.sql', 'a3bb5bb55e6f7fcb9e45b39527291d7b9656fe44f369224cbe3e691ada6a7a6a', NULL, NULL, '2026-11-23 04:48:10.690', '2026-11-23 04:48:10.722', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('30c5a408-3de2-4f6d-8879-91ff49b7eb63', 'file_apply', 'applied', 'cli-migrate', 'plugin:reading-lists-fixture/20261113_140950_391_create_reading_lists', '5a4183056fe82c090a2a3777dd5f40d3ca86c9dbac8acf4ab050ccbb8213a4c8', NULL, NULL, '2026-11-23 04:48:04.048', '2026-11-23 04:48:04.148', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('338830d1-0683-4510-9a2f-2528ff5645d6', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_376_create_localization_tags.sql', 'f10c884e46ec43d04c09cae9ebb2b074004633725884dadea474c8d10f30b4f4', NULL, NULL, '2026-11-23 04:48:09.972', '2026-11-23 04:48:09.995', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('382d188c-06e0-448f-af5d-aa84cd4eab43', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-23 04:48:03.328', '2026-11-23 04:48:03.473', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('5da87f04-d367-4812-925a-b06b3d9cf4a8', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-23 04:48:02.624', '2026-11-23 04:48:02.679', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('69760892-242a-486e-885f-3a2a890c5647', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-23 04:48:02.466', '2026-11-23 04:48:02.537', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('6da493bb-0cc2-4744-9411-eb4595f7029b', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_379_create_localization_pages.sql', '25ffa6985feff9ee22783d561a8c8a7db5834e30a5e4580b29fad9a8ea989231', NULL, NULL, '2026-11-23 04:48:10.101', '2026-11-23 04:48:10.128', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('70fe8b9b-ce1a-49fa-8e16-b16ddc5a6596', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_382_create_localization_layouts.sql', '3f4663fdcae14559059d29eb868609f8ae689c5be3fefa933341d7ce3a275e72', NULL, NULL, '2026-11-23 04:48:10.221', '2026-11-23 04:48:10.252', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('79a4f144-b6f2-47f8-afb4-ee7c3a1c38b8', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-23 04:48:01.772', '2026-11-23 04:48:01.893', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('7a0d6c82-fbd4-4eb0-8f2d-ddfceb065ff2', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_054612_570_create_binding_uses_table', 'c7dba671d14bfc919719e1d6e7e2c612b53a0fec9dd00ca9f801748964999a04', NULL, NULL, '2026-11-23 04:48:03.707', '2026-11-23 04:48:03.770', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('7a5178c2-4a9f-4ad7-8ff0-958d11a96e06', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-23 04:48:01.978', '2026-11-23 04:48:02.065', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('820f903b-d151-4e24-bb7e-3ce0663500a3', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_387_create_localization_form-uploads.sql', '30c3bf98db1621e3e5818ca6a80985677cc0ebfde0f6b3c83af336967486736b', NULL, NULL, '2026-11-23 04:48:10.441', '2026-11-23 04:48:10.472', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('90a52fed-fb22-4383-8833-e95c8dde4293', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_132736_174_reset_binding_uses_fill', '3c20140487117e9d3909b63ade314ba5b916c76e5387412dbbd5b4b125a592c6', NULL, NULL, '2026-11-23 04:48:03.861', '2026-11-23 04:48:03.878', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('9939caae-bfd7-428a-8101-a91f5a344231', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_397_unique_localization_block-pages.sql', 'e2917c797e5ae9e3b6d0dded91b6101813737e8e2a059e9463412c89451cb77a', NULL, NULL, '2026-11-23 04:48:10.947', '2026-11-23 04:48:10.984', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('a0e1d706-3c3d-45b4-83a2-bfecbac3e2fc', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_373_baseline.sql', '4743d8af38b3af32278c28612c5202f811504bfde0b4fa77a54812cee28c77b1', NULL, NULL, '2026-11-23 04:48:04.901', '2026-11-23 04:48:09.822', NULL, NULL, NULL, NULL, 136, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('a3d4da06-1313-44cd-aeaf-5ba05ac0e248', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_398_unique_localization_pages.sql', '0082b0c95e45baca4a2f2ea12ba66024cec7c2d3c6ce7d330147a2fb834bdb85', NULL, NULL, '2026-11-23 04:48:11.006', '2026-11-23 04:48:11.044', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('a7ea10c7-fc4a-470b-839c-63facb2f0ce1', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_374_create_localization_posts.sql', '69987f0c7727d35ff732bd622a012e0725b9467702226721b79541cf169dd0f4', NULL, NULL, '2026-11-23 04:48:09.878', '2026-11-23 04:48:09.912', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('ad9ffe99-f751-470f-989b-bc1be39e6494', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_375_create_localization_categories.sql', 'b7ff44624150f4d3ae7c84ab93f6f2e7a7af0115dec6b7d24ef52ca425ad6e6c', NULL, NULL, '2026-11-23 04:48:09.927', '2026-11-23 04:48:09.955', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('ae99e069-9159-44ed-94bd-7fde13d246c3', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_386_create_localization_form-submission-sends.sql', '5ad03b1d4a28c86d5b00d744c391be733e716a90089cdb989b5702e1a8052bce', NULL, NULL, '2026-11-23 04:48:10.385', '2026-11-23 04:48:10.424', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('b0e322cc-7b27-4034-90b5-5c480d701503', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_385_create_localization_form-submissions.sql', 'c3d967a44f4dce3a74a56b8896344c2a29b469a6b5c190464e4cc57e9ab41181', NULL, NULL, '2026-11-23 04:48:10.339', '2026-11-23 04:48:10.370', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('b2eed5e0-6d01-4286-bc87-a1aad61a05bc', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-23 04:48:03.169', '2026-11-23 04:48:03.222', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('be98e509-c457-45ca-890f-a1995aae2513', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_377_create_localization_block-pages.sql', '9e27ac8859540e76e74de38dccb8428c2872cf8268d7d33a61e8b32287131a67', NULL, NULL, '2026-11-23 04:48:10.005', '2026-11-23 04:48:10.037', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('c10b8915-4753-4140-85fb-b40300b04b2d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-23 04:48:02.313', '2026-11-23 04:48:02.393', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('c81fd577-e140-4e1d-b601-88fb0c36a4d5', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_378_create_localization_authors.sql', '0075a886a5d7425971ade4ac899730a17a9a386df89e2f1b912dbc557a2a5c40', NULL, NULL, '2026-11-23 04:48:10.056', '2026-11-23 04:48:10.088', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('c8a14e0e-3db7-4036-93c0-6aa56de8431d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261112_193109_764_seed_composition_graph_lock', '3d0cd7df9937f5d849c10da3c55b5adbfe788d92601a4b33c802fe99607cb1e6', NULL, NULL, '2026-11-23 04:48:03.575', '2026-11-23 04:48:03.589', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('cdf171aa-a6b9-4c6c-b214-6797a6148483', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_184525_129_add_class_usage_blocks', '50fbafe7caae279444ebb426966a5f6f45c8e914ee8cf43125e058f4a31332ab', NULL, NULL, '2026-11-23 04:48:03.953', '2026-11-23 04:48:03.985', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d02fdd06-dfdf-4ff0-9a57-93a00c1a7f68', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-23 04:48:02.993', '2026-11-23 04:48:03.050', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d6095c2c-1623-4689-97cc-a546d2e12216', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_389_create_localization_homepage.sql', '1f51f35c1adafc930959ace6361b97db0dee0596d67886f0fea3f24d86089286', NULL, NULL, '2026-11-23 04:48:10.524', '2026-11-23 04:48:10.550', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('d80d96e2-aeaa-4875-a00c-37041d9e7c45', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-23 04:48:02.790', '2026-11-23 04:48:02.880', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('de90b698-6360-42cf-b969-0bda9faf8ad6', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_383_create_localization_templates.sql', 'ac57bd86400e8a8dd33184cee3428c79be32bf99a3d153875fafa9b5d6331b3d', NULL, NULL, '2026-11-23 04:48:10.266', '2026-11-23 04:48:10.289', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f21b6f27-a6c4-42e6-96c1-884b34b24eab', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_381_create_localization_components.sql', 'f68bd7bab90091b27d8b40630a9567517fc1b09b4d75acd0aae0e55e92c01d68', NULL, NULL, '2026-11-23 04:48:10.177', '2026-11-23 04:48:10.204', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f583b8da-b85a-4441-b571-9976d28ede4b', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_395_unique_localization_categories.sql', '3602c769c680a45a5766a3a5fda32f8751f5612fbfc06791474ac179ac73d658', NULL, NULL, '2026-11-23 04:48:10.817', '2026-11-23 04:48:10.862', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f601ca1e-a932-444c-aaaa-ca8b89425e65', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_388_create_localization_form-submission-resends.sql', 'd6c7f17ce49ae78dfa0fbbc37d6e2c3f5a665e9d22bc23c2c18f8e68e7f40883', NULL, NULL, '2026-11-23 04:48:10.484', '2026-11-23 04:48:10.509', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f94d7be4-ecbd-406d-b739-fa5afe7d3856', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_394_unique_localization_posts.sql', '34b4f60145dd59c5845acd563b76c046f2d7452e089e4ce437bb77190c127a3f', NULL, NULL, '2026-11-23 04:48:10.754', '2026-11-23 04:48:10.797', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO `nextly_schema_events` (`id`, `event_type`, `status`, `source`, `filename`, `sha256`, `scope_kind`, `scope_slug`, `started_at`, `ended_at`, `duration_ms`, `applied_by`, `note`, `statements_planned`, `statements_executed`, `renames_applied`, `error_code`, `error_message`, `error_json`, `superseded_event_ids`, `superseded_at`, `superseded_by`) VALUES ('f9cc8097-945c-43ec-af52-4d24f582f83a', 'file_apply', 'applied', 'cli-migrate', '20261123_044742_392_create_localization_announcement.sql', '460cdf59d562d45ca6c7dceaf4afd723b48b36946277fd46f8bca904d5007d9b', NULL, NULL, '2026-11-23 04:48:10.658', '2026-11-23 04:48:10.682', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
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
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__binding_uses', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:04', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:03', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:48:02', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('reading__list_items', 'table', '', 'plugin', 'reading-lists-fixture', 'plugin:reading-lists-fixture', '0.0.0', 1, 'active', '2026-11-23 04:48:04', '2026-11-23 04:48:04');
INSERT INTO `nextly_schema_owners` (`table_name`, `element_kind`, `element_name`, `owner_kind`, `owner_id`, `migrated_by`, `owner_version`, `schema_version`, `state`, `created_at`, `updated_at`) VALUES ('reading__lists', 'table', '', 'plugin', 'reading-lists-fixture', 'plugin:reading-lists-fixture', '0.0.0', 1, 'active', '2026-11-23 04:48:04', '2026-11-23 04:48:04');
CREATE TABLE `nextly_spent_challenges` (
  `id` varchar(64) NOT NULL,
  `expires_at` bigint NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nsc_expires_at_idx` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `nextly_translation_provenance` (
  `id` varchar(36) NOT NULL,
  `scope_kind` varchar(16) NOT NULL,
  `scope_slug` varchar(191) NOT NULL,
  `entry_id` varchar(191) NOT NULL,
  `locale` varchar(35) NOT NULL,
  `part_state` varchar(8) NOT NULL,
  `field_path` varchar(255) NOT NULL,
  `value_fingerprint` varchar(64) NOT NULL,
  `origin` varchar(16) NOT NULL,
  `engine` varchar(191) DEFAULT NULL,
  `actor_kind` varchar(32) DEFAULT NULL,
  `actor_id` varchar(191) DEFAULT NULL,
  `actor_principal_kind` varchar(191) DEFAULT NULL,
  `source_locale` varchar(35) DEFAULT NULL,
  `source_fingerprint` varchar(64) DEFAULT NULL,
  `origin_row_id` varchar(191) DEFAULT NULL,
  `written_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nextly_translation_provenance_uidx` (`scope_kind`,`scope_slug`,`entry_id`,`locale`,`part_state`,`field_path`),
  KEY `nextly_translation_provenance_field_idx` (`scope_kind`,`scope_slug`,`entry_id`,`field_path`,`part_state`)
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
  `field_sources` json DEFAULT NULL,
  `changed_locales` json DEFAULT NULL,
  `shared_changed` tinyint(1) DEFAULT NULL,
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
CREATE TABLE `page_builder__binding_uses` (
  `id` varchar(36) NOT NULL,
  `document_key` varchar(512) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `document_id` varchar(255) DEFAULT NULL,
  `place` varchar(16) NOT NULL,
  `version` varchar(16) NOT NULL,
  `locale` text,
  `blocks_field` text NOT NULL,
  `node_id` text NOT NULL,
  `block_type` text NOT NULL,
  `block_name` text,
  `prop` text NOT NULL,
  `path` text NOT NULL,
  `source_kind` varchar(16) NOT NULL,
  `source_key` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_page_builder__binding_uses_source_kind_source_key_001e79k` (`source_kind`,`source_key`),
  KEY `idx_page_builder__binding_uses_document_key` (`document_key`)
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
  `blocks` int DEFAULT NULL,
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
INSERT INTO `page_builder__site_options` (`id`, `name`, `value`, `created_at`, `updated_at`) VALUES ('1140a64d-e6f9-11f1-9aa0-62baba1e9d0a', 'composition-graph-lock', '1140a693-e6f9-11f1-9aa0-62baba1e9d0a', '2026-11-23 04:48:03', '2026-11-23 04:48:03');
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
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0119583d-64ec-4da7-8d55-11f3c3836521', 'Delete Nx_pb_usage_backfill', 'delete-nx_pb_usage_backfill', 'delete', 'nx_pb_usage_backfill', 'Permission to delete nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('043106b4-6d16-46da-9c30-00de7133f630', 'Publish Pages', 'publish-pages', 'publish', 'pages', 'Permission to publish pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('050919cd-1a3a-4f61-8f32-29e7d0667382', 'Read Form Submissions', 'read-form-submissions', 'read', 'form-submissions', 'Permission to read form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('05cc892b-37bd-4737-88e4-c4d5ec54496a', 'Update Authors', 'update-authors', 'update', 'authors', 'Permission to update authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('0834e3dc-7281-47a9-baeb-0ad15161604d', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('09322733-d955-4645-aa93-81885091ec07', 'Update Form Uploads', 'update-form-uploads', 'update', 'form-uploads', 'Permission to update form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('09356863-e1ba-4a62-9783-f83b375497ab', 'Create Authors', 'create-authors', 'create', 'authors', 'Permission to create authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('09f32a3e-1467-46fd-9463-856a8a13ac48', 'Create Form Uploads', 'create-form-uploads', 'create', 'form-uploads', 'Permission to create form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('111f9ffd-1905-408a-a14f-05a2c1f346f1', 'Publish Nx_pb_component_usage', 'publish-nx_pb_component_usage', 'publish', 'nx_pb_component_usage', 'Permission to publish nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('12c48a1d-93ca-457f-a843-a0b4b476ad31', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('16afa4bb-c894-407b-b7d3-0191510ae1b3', 'Update Landing Page', 'update-landing-page', 'update', 'landing-page', 'Permission to update landing page', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('16b1fbc6-4e62-4f06-b1b3-d254d322ade6', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1782a35f-8a82-4d6d-925f-9024e8c433f3', 'Publish Nx_pb_address_claims', 'publish-nx_pb_address_claims', 'publish', 'nx_pb_address_claims', 'Permission to publish nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1abb7387-1e1f-4b08-8372-3f4250869052', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site\'s shared styles. A locked style can\'t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('1d9b1884-2e26-4ad8-bd7f-12ffb0b7e3db', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('208b8b46-68e5-4679-bd12-7cab64173762', 'Unpublish Site Style', 'unpublish-site-style', 'unpublish', 'site-style', 'Permission to unpublish site style', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('220585f5-922a-4251-b5c3-ca2e598167d4', 'Delete Block Pages', 'delete-block-pages', 'delete', 'block-pages', 'Permission to delete block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('235f45f7-cd7f-422a-a155-9bd8a37afa75', 'Unpublish Nx_pb_component_retired', 'unpublish-nx_pb_component_retired', 'unpublish', 'nx_pb_component_retired', 'Permission to unpublish nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('23f76574-fe9e-4133-8aa7-260c734070e7', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2523bd54-3b74-410e-abfb-1a65fd8ea129', 'Unpublish Patterns', 'unpublish-patterns', 'unpublish', 'patterns', 'Permission to unpublish patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('26927365-7f66-4414-baa8-f37383f08540', 'Update Posts', 'update-posts', 'update', 'posts', 'Permission to update posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('26fef2ad-7f17-4f3c-8f61-a5c7b4d1dd1b', 'Unpublish Tags', 'unpublish-tags', 'unpublish', 'tags', 'Permission to unpublish tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('27aa5246-ae7d-4623-bdf2-22b8af9e4832', 'Read Posts', 'read-posts', 'read', 'posts', 'Permission to read posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2a10ec7f-cb5e-441f-a787-cc1c35fe4237', 'Update Nx_pb_address_claims', 'update-nx_pb_address_claims', 'update', 'nx_pb_address_claims', 'Permission to update nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2b02dfb0-4808-4a18-ba40-8321aff8a93c', 'Delete Form Uploads', 'delete-form-uploads', 'delete', 'form-uploads', 'Permission to delete form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2cd899df-b7dd-4e71-b933-d4a8e767244c', 'Publish Landing Page', 'publish-landing-page', 'publish', 'landing-page', 'Permission to publish landing page', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2dc77964-a04e-420f-8280-e5d105934b82', 'Delete Nx_pb_component_retired', 'delete-nx_pb_component_retired', 'delete', 'nx_pb_component_retired', 'Permission to delete nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2e4604e7-cd99-4c4b-b231-5a1136c9cb23', 'Unpublish Layouts', 'unpublish-layouts', 'unpublish', 'layouts', 'Permission to unpublish layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('2fc97b3c-db22-4a46-b2b2-14a2a11c626e', 'Create Nx_pb_component_usage', 'create-nx_pb_component_usage', 'create', 'nx_pb_component_usage', 'Permission to create nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('30b63816-d63e-4f0b-94b4-156b22916dd0', 'Publish Homepage', 'publish-homepage', 'publish', 'homepage', 'Permission to publish homepage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3132060c-bf9c-46f9-af8b-b9ab28e240a9', 'Read Authors', 'read-authors', 'read', 'authors', 'Permission to read authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3212c9d2-36ab-4c72-b988-a20b46a07c11', 'Read Email Deliveries', 'read-email-deliveries', 'read', 'email-deliveries', 'Permission to see the email delivery log and queued email', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('346ce559-c65e-4120-b495-a42ca63b2a03', 'Update Site Style', 'update-site-style', 'update', 'site-style', 'Permission to update site style', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('34b4bb65-fca8-4a8d-8b20-0168cd91a28b', 'Read Forms', 'read-forms', 'read', 'forms', 'Permission to read forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('355883b4-764e-4de5-8227-c4eb93fbb13a', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('35700fee-c275-4a0c-bac1-93b5405b46f2', 'Unpublish Forms', 'unpublish-forms', 'unpublish', 'forms', 'Permission to unpublish forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('36e3afe5-5ffd-4989-ae8b-ae5789b18044', 'Unpublish Authors', 'unpublish-authors', 'unpublish', 'authors', 'Permission to unpublish authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3911f6f5-40be-4534-a25f-32032dc59848', 'Unpublish Form Submission Sends', 'unpublish-form-submission-sends', 'unpublish', 'form-submission-sends', 'Permission to unpublish form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3a2ad225-39bf-4c81-a83d-491cdf5a562d', 'Unpublish Page Builder Site Code', 'unpublish-page-builder-site-code', 'unpublish', 'page-builder-site-code', 'Permission to unpublish page builder site code', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3a459d2b-bfa7-4680-aa88-0ad1591880eb', 'Create Components', 'create-components', 'create', 'components', 'Permission to create components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3a54df1c-7e34-491b-98b4-179ef6bcfbe3', 'Unpublish Block Pages', 'unpublish-block-pages', 'unpublish', 'block-pages', 'Permission to unpublish block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3b3e8170-8fc0-42ae-84ab-f57818c4ec6b', 'Delete Tags', 'delete-tags', 'delete', 'tags', 'Permission to delete tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3b922709-f6b5-4fb3-ae5e-2d4cfd983a29', 'Publish Categories', 'publish-categories', 'publish', 'categories', 'Permission to publish categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3c256c40-a6f7-446c-b72b-827e4b643c4f', 'Read Patterns', 'read-patterns', 'read', 'patterns', 'Permission to read patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3cbf7536-eb8c-4239-916b-6707800cac8c', 'Publish Posts', 'publish-posts', 'publish', 'posts', 'Permission to publish posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('3dd259e5-797d-4b70-856d-0a1aa9d3fd09', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection\'s entries are served at. A change moves every entry\'s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4110e4a3-276b-4073-9187-acb53f7d8c71', 'Read Nx_pb_component_retired', 'read-nx_pb_component_retired', 'read', 'nx_pb_component_retired', 'Permission to read nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('428777be-df5a-4fa5-8c3f-0301b519cbf6', 'Unpublish Nx_pb_address_claims', 'unpublish-nx_pb_address_claims', 'unpublish', 'nx_pb_address_claims', 'Permission to unpublish nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('44e58d9a-e0ce-4ad7-8f29-764986d77bbc', 'Read Announcement', 'read-announcement', 'read', 'announcement', 'Permission to read announcement', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('46421e9e-9be6-498c-bddd-3e8423ea12ed', 'Publish Site Style', 'publish-site-style', 'publish', 'site-style', 'Permission to publish site style', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('48101f93-5447-404b-96ea-18d5c6636620', 'Publish Page Builder Settings', 'publish-page-builder-settings', 'publish', 'page-builder-settings', 'Permission to publish page builder settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4890aa17-b34d-4417-a734-78b0e1a48bd3', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('49923149-9d21-49c4-b0d6-d56c6b6285ee', 'Publish Site Settings', 'publish-site-settings', 'publish', 'site-settings', 'Permission to publish site settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('49cfcc24-fd99-46ce-aaa2-5a1a9cb0cb10', 'Update Nx_pb_component_retired', 'update-nx_pb_component_retired', 'update', 'nx_pb_component_retired', 'Permission to update nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4c471686-5fb3-4203-9fb3-b9ea66021196', 'Update Components', 'update-components', 'update', 'components', 'Permission to update components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4c611b36-a6a1-47b6-8cbc-387ec7d86416', 'Read Site Style', 'read-site-style', 'read', 'site-style', 'Permission to read site style', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('4f78b877-d7f4-4cfb-9478-45a78aa88d2d', 'Unpublish Nx_pb_component_usage', 'unpublish-nx_pb_component_usage', 'unpublish', 'nx_pb_component_usage', 'Permission to unpublish nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('51ce5795-7077-4e13-a1de-f8e5b76df1c1', 'Update Nx_pb_class_usage', 'update-nx_pb_class_usage', 'update', 'nx_pb_class_usage', 'Permission to update nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('52a79b1a-48f3-4acd-9447-28887e497222', 'Create Form Submission Sends', 'create-form-submission-sends', 'create', 'form-submission-sends', 'Permission to create form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('538d62da-089d-4b99-943c-f29e69930b1e', 'Read Tags', 'read-tags', 'read', 'tags', 'Permission to read tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('53f9933a-56a9-45fa-b164-77a546cfd7c3', 'Manage Email Deliveries', 'manage-email-deliveries', 'manage', 'email-deliveries', 'Permission to cancel a queued email, and to have one sent again where a plugin offers it', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5702e6b8-aa5b-47d0-9f33-1d51d775d2fc', 'Unpublish Landing Page', 'unpublish-landing-page', 'unpublish', 'landing-page', 'Permission to unpublish landing page', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5c33c879-37d8-4ed1-8f5f-c812a6a5722a', 'Update Block Pages', 'update-block-pages', 'update', 'block-pages', 'Permission to update block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5d9aacfe-72b5-4237-b334-8a6a267c62ae', 'Read Nx_pb_usage_backfill', 'read-nx_pb_usage_backfill', 'read', 'nx_pb_usage_backfill', 'Permission to read nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('5e3d1b5f-b6fa-4fc8-ac9e-baf8b2a3b502', 'Unpublish Templates', 'unpublish-templates', 'unpublish', 'templates', 'Permission to unpublish templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('61797495-d93a-47b7-bd2e-69435bb3fe77', 'Delete Templates', 'delete-templates', 'delete', 'templates', 'Permission to delete templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('63795a19-252c-464c-a9da-4aea559e6709', 'Create Patterns', 'create-patterns', 'create', 'patterns', 'Permission to create patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('644a87a8-246d-4f6b-9cd7-f088d072eece', 'Unpublish Posts', 'unpublish-posts', 'unpublish', 'posts', 'Permission to unpublish posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('647de2a0-0a54-4381-8616-1a5d31145216', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('661daad6-04e8-49b7-bd0f-2e457fa5136d', 'Delete Nx_pb_address_claims', 'delete-nx_pb_address_claims', 'delete', 'nx_pb_address_claims', 'Permission to delete nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('66c3f54a-8ce3-47a7-8531-e78a5d6839de', 'Read Nx_pb_class_usage', 'read-nx_pb_class_usage', 'read', 'nx_pb_class_usage', 'Permission to read nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('682832f3-8d7a-4753-943d-4ebfc1238308', 'Publish Nx_pb_usage_backfill', 'publish-nx_pb_usage_backfill', 'publish', 'nx_pb_usage_backfill', 'Permission to publish nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('687e6593-d73e-4ac4-99ed-0d6568f3d497', 'Update Page Builder Site Code', 'update-page-builder-site-code', 'update', 'page-builder-site-code', 'Permission to update page builder site code', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6894e6c5-93c5-4300-8926-cc4583db4116', 'Read Components', 'read-components', 'read', 'components', 'Permission to read components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6a1f9f37-4b9f-4510-81d4-195cca3ca4b1', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6bc79172-e387-4baf-bc96-5f7c13292121', 'Publish Form Submission Resends', 'publish-form-submission-resends', 'publish', 'form-submission-resends', 'Permission to publish form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6be146e7-713d-49ce-9d52-f09cdf7207b8', 'Publish Tags', 'publish-tags', 'publish', 'tags', 'Permission to publish tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6d9a1bc5-35b9-4293-b0d6-2e11b54d341e', 'Create Layouts', 'create-layouts', 'create', 'layouts', 'Permission to create layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('6dc8a19f-baf8-47ae-96ad-7831353eb6f6', 'Read Form Uploads', 'read-form-uploads', 'read', 'form-uploads', 'Permission to read form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('707b3799-9f14-4726-8b47-9425c2da7046', 'Delete Nx_pb_component_usage', 'delete-nx_pb_component_usage', 'delete', 'nx_pb_component_usage', 'Permission to delete nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('71d32eeb-e7d2-49d2-b6fc-a620caf824e1', 'Publish Form Uploads', 'publish-form-uploads', 'publish', 'form-uploads', 'Permission to publish form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('71e78a86-f165-4636-b2d3-fa8cad0db4e4', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('73822148-fae5-46a7-9342-7a2346fa2806', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site\'s breakpoints, and choose its default header & footer set.', '@nextlyhq/plugin-page-builder', NULL, 'General', 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('73955aff-c814-4156-8d43-2d45f10b53e4', 'Publish Announcement', 'publish-announcement', 'publish', 'announcement', 'Permission to publish announcement', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('74291a5a-8cf3-49e3-b5d0-8f93c8aa2469', 'Delete Patterns', 'delete-patterns', 'delete', 'patterns', 'Permission to delete patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('760d80b8-d6f8-4fbf-8b79-a4ce1c7cccd0', 'Update Site Settings', 'update-site-settings', 'update', 'site-settings', 'Permission to update site settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7760a715-7fdd-4cdc-b34c-d53658b2d2ba', 'Read Homepage', 'read-homepage', 'read', 'homepage', 'Permission to read homepage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('78662adc-53e2-4b90-862c-5564adf8f709', 'Publish Templates', 'publish-templates', 'publish', 'templates', 'Permission to publish templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('78de2f09-6231-49ac-98f8-9432f4258d4a', 'Delete Components', 'delete-components', 'delete', 'components', 'Permission to delete components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7969ae97-3f92-46d2-a2d1-dcd571ce12cc', 'Update Nx_pb_component_usage', 'update-nx_pb_component_usage', 'update', 'nx_pb_component_usage', 'Permission to update nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7989da4d-60ff-4d53-b54b-4f258ae49645', 'Read Page Builder Settings', 'read-page-builder-settings', 'read', 'page-builder-settings', 'Permission to read page builder settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7a29393e-977f-421f-8ae2-0adda016f5fc', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7e0fce5a-0e38-4507-b619-12ffd5b2f727', 'Delete Authors', 'delete-authors', 'delete', 'authors', 'Permission to delete authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7e12af84-4ea5-4b19-8384-0bc949c0de77', 'Update Forms', 'update-forms', 'update', 'forms', 'Permission to update forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7f510271-2c0b-4d96-82ec-bcf69439a646', 'Create Templates', 'create-templates', 'create', 'templates', 'Permission to create templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7f8473f3-ab74-4dc6-b4d9-0a61c2cc71bb', 'Update Page Builder Settings', 'update-page-builder-settings', 'update', 'page-builder-settings', 'Permission to update page builder settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7fc4715b-4574-4fbd-9319-a94797b4f72a', 'Update Form Submission Sends', 'update-form-submission-sends', 'update', 'form-submission-sends', 'Permission to update form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('7fec8b82-fad7-420b-bf20-70153240abe7', 'Publish Page Builder Site Code', 'publish-page-builder-site-code', 'publish', 'page-builder-site-code', 'Permission to publish page builder site code', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('805a7870-d067-437d-bd95-b645a3e556b6', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8319fc94-9fc0-4b50-ae63-47979c9c2100', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', 1, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8442d221-0ae1-4067-9b84-9b1d5353cd05', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('85838348-6c04-4be4-85b5-8672b6487157', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('86b2c079-9900-4ab7-b7ba-5db0fc1cf7da', 'Update Pages', 'update-pages', 'update', 'pages', 'Permission to update pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('87720d03-916a-431d-af3d-f8c1b4383a7d', 'Update Categories', 'update-categories', 'update', 'categories', 'Permission to update categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8c288a13-a854-4158-bd8a-7df1dbd6bc28', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8d8fc2bd-604e-4508-a3c2-414ecd4aafda', 'Unpublish Form Submissions', 'unpublish-form-submissions', 'unpublish', 'form-submissions', 'Permission to unpublish form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8e03cf63-787d-4dc2-95a4-1f212a7f26c6', 'Unpublish Pages', 'unpublish-pages', 'unpublish', 'pages', 'Permission to unpublish pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8e919727-f1c0-4c28-9d81-c5b83f6b8757', 'Publish Form Submissions', 'publish-form-submissions', 'publish', 'form-submissions', 'Permission to publish form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('8eb0fcfd-46be-42ad-8dec-1235dea56c0a', 'Publish Nx_pb_class_usage', 'publish-nx_pb_class_usage', 'publish', 'nx_pb_class_usage', 'Permission to publish nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('91592f4d-a3c5-43b2-b732-98c25756a15e', 'Read Templates', 'read-templates', 'read', 'templates', 'Permission to read templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('921d2642-0c33-47f6-a0f8-2f6de14009ad', 'Unpublish Nx_pb_class_usage', 'unpublish-nx_pb_class_usage', 'unpublish', 'nx_pb_class_usage', 'Permission to unpublish nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('92993648-3166-4620-b541-78168740d6b7', 'Unpublish Form Submission Resends', 'unpublish-form-submission-resends', 'unpublish', 'form-submission-resends', 'Permission to unpublish form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('93fcf0bb-928b-4b8c-b73c-36301770be8b', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('943f6ece-aba0-465f-a987-e5807292675a', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9a3cf8e0-a7c1-473b-9dc2-af2b0b5913d8', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9a5d98b0-3fad-4bdc-859a-2bfa4cc532ce', 'Unpublish Components', 'unpublish-components', 'unpublish', 'components', 'Permission to unpublish components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9c338bab-4c2c-47f7-8948-05596a3546f5', 'Create Tags', 'create-tags', 'create', 'tags', 'Permission to create tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9e8c070d-ed04-4579-b045-36e822ea9dae', 'Delete Pages', 'delete-pages', 'delete', 'pages', 'Permission to delete pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('9eced01f-6d38-417a-8d48-31700a1103e9', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a32facf9-a463-4da9-89c3-ca9e5547385a', 'Create Categories', 'create-categories', 'create', 'categories', 'Permission to create categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a51a5f9f-dcff-419d-9fc3-e9bc0fa0597c', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a66db1fe-4243-4957-b41d-5b663c55aec0', 'Unpublish Form Uploads', 'unpublish-form-uploads', 'unpublish', 'form-uploads', 'Permission to unpublish form uploads', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a67d7e43-1d95-43e6-8a09-6b3bfd31d80d', 'Delete Forms', 'delete-forms', 'delete', 'forms', 'Permission to delete forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a82aac83-7a61-46e7-a39f-d529c4bf6c66', 'Unpublish Page Builder Settings', 'unpublish-page-builder-settings', 'unpublish', 'page-builder-settings', 'Permission to unpublish page builder settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('a90ec6a8-0ecd-435a-9c97-19139e143c00', 'Update Form Submissions', 'update-form-submissions', 'update', 'form-submissions', 'Permission to update form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('aadde006-8f35-46a3-8cd2-ec0065718a6a', 'Create Nx_pb_component_retired', 'create-nx_pb_component_retired', 'create', 'nx_pb_component_retired', 'Permission to create nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('abf23400-4843-4f3a-aa22-de3184af318d', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ad7fc495-905f-4b18-9404-09c95a0154df', 'Publish Components', 'publish-components', 'publish', 'components', 'Permission to publish components', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('af3f9949-43c8-4172-8727-47b54c719e82', 'Read Nx_pb_component_usage', 'read-nx_pb_component_usage', 'read', 'nx_pb_component_usage', 'Permission to read nx_pb_component_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b0b648c6-73b5-4013-819d-0f8c956458c0', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b1747205-2416-4de2-b322-df7480048a12', 'Read Block Pages', 'read-block-pages', 'read', 'block-pages', 'Permission to read block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b1b4fde0-74b9-4d16-ae65-b4c2b17e4532', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b25fcc7a-502d-43d0-91b9-30f99e9d82ab', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b35ac67d-b90d-48ae-a0da-acd1271ff202', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b3e94600-d989-4c09-813d-0acf0b9a12e5', 'Unpublish Nx_pb_usage_backfill', 'unpublish-nx_pb_usage_backfill', 'unpublish', 'nx_pb_usage_backfill', 'Permission to unpublish nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b5f0e09b-31bc-403f-8faa-bd21050f88d5', 'Read Nx_pb_address_claims', 'read-nx_pb_address_claims', 'read', 'nx_pb_address_claims', 'Permission to read nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b63c8c78-df4d-4ff3-a26c-8aacf30dfa9c', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('b8bd43fd-fd73-47ef-a519-4bbd17265848', 'Publish Layouts', 'publish-layouts', 'publish', 'layouts', 'Permission to publish layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ba736e04-eddf-43c5-ba10-b31af48520dc', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('bb320781-15a7-4053-988c-2f0984ef6238', 'Delete Layouts', 'delete-layouts', 'delete', 'layouts', 'Permission to delete layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('bbde210b-2abd-4685-8c0b-fa937b2549a8', 'Delete Form Submissions', 'delete-form-submissions', 'delete', 'form-submissions', 'Permission to delete form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('be5a331e-991b-419a-b1e4-6f26eb47fe8e', 'Read Landing Page', 'read-landing-page', 'read', 'landing-page', 'Permission to read landing page', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c12ebfb8-9798-49c4-be48-ecdedbe7ffd8', 'Delete Posts', 'delete-posts', 'delete', 'posts', 'Permission to delete posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c2e058e6-3cd4-4209-acb9-2c6c73b27b77', 'Update Announcement', 'update-announcement', 'update', 'announcement', 'Permission to update announcement', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c811505e-370a-4444-8c36-9c0c998d8e69', 'Create Nx_pb_address_claims', 'create-nx_pb_address_claims', 'create', 'nx_pb_address_claims', 'Permission to create nx_pb_address_claims', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('c93006d7-6264-455d-b9df-afe1c00fec36', 'Read Pages', 'read-pages', 'read', 'pages', 'Permission to read pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cb2a8163-d002-4004-beb6-56ce4176c5b9', 'Create Form Submission Resends', 'create-form-submission-resends', 'create', 'form-submission-resends', 'Permission to create form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cc0d4d58-3501-4c8c-b4a1-48ce29a18497', 'Publish Authors', 'publish-authors', 'publish', 'authors', 'Permission to publish authors', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cc9daa0b-e17b-4eda-b054-a6c88dd769b2', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('cd818432-462a-4dcd-9d05-547c8428fec9', 'Create Nx_pb_usage_backfill', 'create-nx_pb_usage_backfill', 'create', 'nx_pb_usage_backfill', 'Permission to create nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d1d34d9f-d273-4cb4-ba24-427a523e90f3', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d21c0b1b-00f6-4278-b66b-a895806c1518', 'Unpublish Site Settings', 'unpublish-site-settings', 'unpublish', 'site-settings', 'Permission to unpublish site settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d26053b7-8461-4336-8336-5dea2ad27581', 'Publish Nx_pb_component_retired', 'publish-nx_pb_component_retired', 'publish', 'nx_pb_component_retired', 'Permission to publish nx_pb_component_retired', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d34e5ddd-ca55-4a4b-b626-23c1fa7bf5d4', 'Create Block Pages', 'create-block-pages', 'create', 'block-pages', 'Permission to create block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d3be4d0f-b242-4183-8e3f-b21bc9e7627b', 'Create Nx_pb_class_usage', 'create-nx_pb_class_usage', 'create', 'nx_pb_class_usage', 'Permission to create nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d62d85ee-4240-4a5d-987e-5fdff34ee725', 'Update Layouts', 'update-layouts', 'update', 'layouts', 'Permission to update layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('d8c7a118-bde1-49f8-8d29-40478c545399', 'Update Templates', 'update-templates', 'update', 'templates', 'Permission to update templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('db5a4579-65c2-4a84-9709-dd2d5be4bb92', 'Publish Block Pages', 'publish-block-pages', 'publish', 'block-pages', 'Permission to publish block pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('db98b0e1-b461-4b18-9f58-e4bc5e6fc0cc', 'Update Nx_pb_usage_backfill', 'update-nx_pb_usage_backfill', 'update', 'nx_pb_usage_backfill', 'Permission to update nx_pb_usage_backfill', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dbe51162-3932-4b3f-b0b2-048a4c45f268', 'Create Forms', 'create-forms', 'create', 'forms', 'Permission to create forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dd97f3ab-6789-4c4b-af19-278a3529aaa9', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('de77bb8e-8d36-408b-9670-f481dcc1f959', 'Read Site Settings', 'read-site-settings', 'read', 'site-settings', 'Permission to read site settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('df7b5604-a9ba-4efd-8c73-23dab7547910', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('dfa4a032-4ac4-4147-8b36-a7e967e0c01d', 'Update Form Submission Resends', 'update-form-submission-resends', 'update', 'form-submission-resends', 'Permission to update form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e20d0b5b-046a-4773-ac19-4e44ddd5fb72', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e25a0f66-3aed-4ccd-869a-367189b3040d', 'Create Posts', 'create-posts', 'create', 'posts', 'Permission to create posts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e2a2a7ef-4877-4c23-9a8f-e88991ef6494', 'Read Form Submission Resends', 'read-form-submission-resends', 'read', 'form-submission-resends', 'Permission to read form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e2d86be6-d9e5-4586-bf41-a0911cd7962b', 'Unpublish Announcement', 'unpublish-announcement', 'unpublish', 'announcement', 'Permission to unpublish announcement', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e3d3d2e7-76f9-4d61-8733-78caaa672be8', 'Update Homepage', 'update-homepage', 'update', 'homepage', 'Permission to update homepage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e73bafdd-68b8-4258-ac05-4d29cfebef76', 'Update Tags', 'update-tags', 'update', 'tags', 'Permission to update tags', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('e9aa24c2-ea9d-4fd6-b9b8-1bf40eebe256', 'Read Form Submission Sends', 'read-form-submission-sends', 'read', 'form-submission-sends', 'Permission to read form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ef920320-d93d-4a0c-9d82-1919da796d3c', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('ef98bb82-d071-4c8f-8335-8bda9e6e15a8', 'Create Form Submissions', 'create-form-submissions', 'create', 'form-submissions', 'Permission to create form submissions', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f05b92c0-194e-485d-ba58-08976df71dd4', 'Read Page Builder Site Code', 'read-page-builder-site-code', 'read', 'page-builder-site-code', 'Permission to read page builder site code', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f19341f1-4ba1-4ea2-92ec-117059f78c35', 'Unpublish Homepage', 'unpublish-homepage', 'unpublish', 'homepage', 'Permission to unpublish homepage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f1f05f1f-dd59-4f7e-934e-8a464a2b6699', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f26b319c-6c3d-4ffb-af08-ba1f7e45f5c1', 'Publish Form Submission Sends', 'publish-form-submission-sends', 'publish', 'form-submission-sends', 'Permission to publish form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f299ac39-37ff-4eea-be28-65ea8a49d0ab', 'Delete Categories', 'delete-categories', 'delete', 'categories', 'Permission to delete categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f2b337a1-7eb6-4ccf-bdd2-facea2cfd289', 'Publish Forms', 'publish-forms', 'publish', 'forms', 'Permission to publish forms', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f3535a22-56bd-4061-88fc-ac646e3a790f', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f6933520-ada6-4aa1-9cce-41c4c0f396ba', 'Update Patterns', 'update-patterns', 'update', 'patterns', 'Permission to update patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f6ffa4f2-e29c-496c-b69c-b73eabf9dfe5', 'Delete Form Submission Sends', 'delete-form-submission-sends', 'delete', 'form-submission-sends', 'Permission to delete form submission sends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f7825a39-39be-42a6-9584-f43420e95efc', 'Read Layouts', 'read-layouts', 'read', 'layouts', 'Permission to read layouts', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f86dd8f9-1560-4978-b0b9-8cbe986b2d0b', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f8c1b203-36e7-48f2-8cf3-cf972d3f8bb3', 'Delete Nx_pb_class_usage', 'delete-nx_pb_class_usage', 'delete', 'nx_pb_class_usage', 'Permission to delete nx_pb_class_usage', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f97dab72-6e7a-4a3b-bd11-8bcc215ab228', 'Create Pages', 'create-pages', 'create', 'pages', 'Permission to create pages', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f98af846-53cc-4b2a-b1b9-6cfa885af9de', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('f9fc9ead-4bef-4a6c-9990-534b886274a4', 'Read Categories', 'read-categories', 'read', 'categories', 'Permission to read categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('fa7a526e-1cb9-4b5a-8cf8-0c02c67b637f', 'Delete Form Submission Resends', 'delete-form-submission-resends', 'delete', 'form-submission-resends', 'Permission to delete form submission resends', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('fab1c6f5-ade7-4bd8-b351-052cccd91875', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('fac184d7-5339-4eef-a832-7ca641fbaa24', 'Unpublish Categories', 'unpublish-categories', 'unpublish', 'categories', 'Permission to unpublish categories', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `permissions` (`id`, `name`, `slug`, `action`, `resource`, `description`, `owner`, `orphaned_at`, `permission_group`, `danger`, `created_at`, `updated_at`) VALUES ('fd7e4a55-0e1a-476c-bbaa-2644c5f0a172', 'Publish Patterns', 'publish-patterns', 'publish', 'patterns', 'Permission to publish patterns', NULL, NULL, NULL, 0, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
CREATE TABLE `reading__list_items` (
  `id` varchar(36) NOT NULL,
  `list_id` varchar(255) NOT NULL,
  `post_id` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reading__list_items_list_id_post_id_11e06ud` (`list_id`,`post_id`),
  KEY `idx_reading__list_items_post_id` (`post_id`),
  CONSTRAINT `fk_reading__list_items_list_id` FOREIGN KEY (`list_id`) REFERENCES `reading__lists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `reading__lists` (
  `id` varchar(36) NOT NULL,
  `owner_id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reading__lists_owner_id` (`owner_id`),
  CONSTRAINT `fk_reading__lists_owner_id` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
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
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0014ab14-3fe5-47ac-88e2-bd6fdd61b130', 'a92f3175-8686-4666-afc3-c3c161a53b36', '35700fee-c275-4a0c-bac1-93b5405b46f2', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0130bc32-78c6-4863-9408-cae9d8faa8d1', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '4110e4a3-276b-4073-9187-acb53f7d8c71', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('01363c6e-99b5-4a19-bda9-ba6923f080c1', '21c36921-6d41-4050-93f4-c03874b434f5', '111f9ffd-1905-408a-a14f-05a2c1f346f1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('02053d9e-e33c-4d40-b3f4-268256e9d458', '21c36921-6d41-4050-93f4-c03874b434f5', '73955aff-c814-4156-8d43-2d45f10b53e4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('02d31694-f8fc-4fe6-b269-c4fd606fa585', '7224f683-fdef-4346-975e-a1a8c595a74c', '6a1f9f37-4b9f-4510-81d4-195cca3ca4b1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('03d637bf-9485-4a85-b924-78dccdc96246', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f3535a22-56bd-4061-88fc-ac646e3a790f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('054d4759-b9c4-485e-be7f-062177a26362', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f8c1b203-36e7-48f2-8cf3-cf972d3f8bb3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0657eb77-d37b-4976-870d-c5206f8e25bb', '21c36921-6d41-4050-93f4-c03874b434f5', '7969ae97-3f92-46d2-a2d1-dcd571ce12cc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('07615357-5068-4a95-bf60-b09846221300', 'a92f3175-8686-4666-afc3-c3c161a53b36', '6bc79172-e387-4baf-bc96-5f7c13292121', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('07d8dfbd-4b33-4904-9993-c9e76a85adee', '21c36921-6d41-4050-93f4-c03874b434f5', 'cb2a8163-d002-4004-beb6-56ce4176c5b9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0c7fa878-1275-4c2a-a951-3c1687c54745', 'a92f3175-8686-4666-afc3-c3c161a53b36', '661daad6-04e8-49b7-bd0f-2e457fa5136d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0cb685dd-884f-496e-bc44-4becb88e8915', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '2fc97b3c-db22-4a46-b2b2-14a2a11c626e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('0fd019bf-c20e-47a2-9847-fa5f3da4befb', '21c36921-6d41-4050-93f4-c03874b434f5', '91592f4d-a3c5-43b2-b732-98c25756a15e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('10dabf50-12ca-4a6e-a17e-90b60a2c7d93', '21c36921-6d41-4050-93f4-c03874b434f5', 'f05b92c0-194e-485d-ba58-08976df71dd4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('111ab151-8eb6-430f-ae99-5891cf432621', 'a92f3175-8686-4666-afc3-c3c161a53b36', '8e03cf63-787d-4dc2-95a4-1f212a7f26c6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('123e2ac9-ec04-4360-91c2-fff4e84fbaf9', 'a92f3175-8686-4666-afc3-c3c161a53b36', '61797495-d93a-47b7-bd2e-69435bb3fe77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('12f640fe-2ff3-4b09-a51f-f9962c3270b5', 'a92f3175-8686-4666-afc3-c3c161a53b36', '3c256c40-a6f7-446c-b72b-827e4b643c4f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('130caec0-c988-485e-95db-b2272cb95446', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', 'ef98bb82-d071-4c8f-8335-8bda9e6e15a8', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1327f22f-88dd-487b-89fc-0e2541a6029c', '21c36921-6d41-4050-93f4-c03874b434f5', 'aadde006-8f35-46a3-8cd2-ec0065718a6a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('13325f5e-bfa3-4473-86ff-04f7f3544693', '7224f683-fdef-4346-975e-a1a8c595a74c', 'af3f9949-43c8-4172-8727-47b54c719e82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('13826bbb-d457-4e9e-a3a8-a5dc4196e81c', '21c36921-6d41-4050-93f4-c03874b434f5', '682832f3-8d7a-4753-943d-4ebfc1238308', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('13b9083e-29dd-4a59-bcfb-343827af7424', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7f8473f3-ab74-4dc6-b4d9-0a61c2cc71bb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('13ea1f0e-b89a-4095-9bcf-fffdd9af64d6', '21c36921-6d41-4050-93f4-c03874b434f5', 'be5a331e-991b-419a-b1e4-6f26eb47fe8e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('145bc2cf-fc2f-4a6d-a168-3d64103bfe81', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', '7760a715-7fdd-4cdc-b34c-d53658b2d2ba', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('148cd0e3-e724-4704-a9ba-6be9be46cc87', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '3a459d2b-bfa7-4680-aa88-0ad1591880eb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('15f41aa6-9a86-42ef-a356-d6cba2c4eb69', '21c36921-6d41-4050-93f4-c03874b434f5', '6d9a1bc5-35b9-4293-b0d6-2e11b54d341e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('15f83b77-4305-406d-b01e-93c46e14c433', '21c36921-6d41-4050-93f4-c03874b434f5', '8e919727-f1c0-4c28-9d81-c5b83f6b8757', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('16e8597e-0597-472f-9d2c-640065548dff', '7224f683-fdef-4346-975e-a1a8c595a74c', '050919cd-1a3a-4f61-8f32-29e7d0667382', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('17b9a569-298b-45f9-adb0-bb64bd78d7f5', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', 'abf23400-4843-4f3a-aa22-de3184af318d', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('18aabc04-7628-45a8-9170-6c01044bb901', 'a92f3175-8686-4666-afc3-c3c161a53b36', '30b63816-d63e-4f0b-94b4-156b22916dd0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('18bb499d-1081-4c2b-a7f9-d823d321719e', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'de77bb8e-8d36-408b-9670-f481dcc1f959', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('19048077-b42c-4681-abb0-77e1587d8400', '21c36921-6d41-4050-93f4-c03874b434f5', 'ba736e04-eddf-43c5-ba10-b31af48520dc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('19295839-86fb-4bd9-a58d-f60c513b5b85', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7e12af84-4ea5-4b19-8384-0bc949c0de77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1a28d7b3-ba4e-4d72-b84c-9946b3f47ea4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '66c3f54a-8ce3-47a7-8531-e78a5d6839de', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1acbc1e0-904d-4e29-b0d1-4a390f852f51', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', 'c93006d7-6264-455d-b9df-afe1c00fec36', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1c40d457-76ec-4143-beb4-90aabba0c77f', '21c36921-6d41-4050-93f4-c03874b434f5', '71d32eeb-e7d2-49d2-b6fc-a620caf824e1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1caacc63-93b2-4133-b026-a3098c66a829', '21c36921-6d41-4050-93f4-c03874b434f5', 'de77bb8e-8d36-408b-9670-f481dcc1f959', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1cd1e56e-9f75-4b32-aca3-1cde29a828ef', 'a92f3175-8686-4666-afc3-c3c161a53b36', '48101f93-5447-404b-96ea-18d5c6636620', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1de9f614-d49d-4cb3-9c62-275e0ea0b147', 'a92f3175-8686-4666-afc3-c3c161a53b36', '34b4bb65-fca8-4a8d-8b20-0168cd91a28b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1e3e115c-2f38-4dab-b2f3-d0cbdaf85405', '21c36921-6d41-4050-93f4-c03874b434f5', 'b35ac67d-b90d-48ae-a0da-acd1271ff202', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1ecb7046-91e0-4831-bef3-e147c08b7c01', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', '34b4bb65-fca8-4a8d-8b20-0168cd91a28b', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('1fb06460-5611-44dd-b770-32aee257edfe', 'a92f3175-8686-4666-afc3-c3c161a53b36', '0119583d-64ec-4da7-8d55-11f3c3836521', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('20077ca8-648d-4d0d-8a61-dd4a038b1685', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', 'b1747205-2416-4de2-b322-df7480048a12', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2258ba4d-04c8-4afd-a9d0-6a60c3aa083e', '21c36921-6d41-4050-93f4-c03874b434f5', 'e20d0b5b-046a-4773-ac19-4e44ddd5fb72', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('24cc72e8-f385-4f68-afbe-dc3749a60496', 'a92f3175-8686-4666-afc3-c3c161a53b36', '09f32a3e-1467-46fd-9463-856a8a13ac48', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('24d8a7d2-444c-46e7-8c3b-3cccce0bad2a', 'a92f3175-8686-4666-afc3-c3c161a53b36', '6894e6c5-93c5-4300-8926-cc4583db4116', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('25b53362-80ab-4820-8e3e-3331dcf2af3d', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'a67d7e43-1d95-43e6-8a09-6b3bfd31d80d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2673e47b-2c32-4a88-ae7c-38a59c06f36d', '21c36921-6d41-4050-93f4-c03874b434f5', '09322733-d955-4645-aa93-81885091ec07', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('26ac472a-73cf-4656-bf47-7a235fcc6192', '21c36921-6d41-4050-93f4-c03874b434f5', '9a5d98b0-3fad-4bdc-859a-2bfa4cc532ce', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('287afe6b-e040-4a7b-b3e9-7d5785c423fd', '21c36921-6d41-4050-93f4-c03874b434f5', '8442d221-0ae1-4067-9b84-9b1d5353cd05', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('28c1081d-bae7-4809-924e-cec9e9dfe20f', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'dfa4a032-4ac4-4147-8b36-a7e967e0c01d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('29ae3a0f-95d6-4d51-ae1c-114dfac27e55', '21c36921-6d41-4050-93f4-c03874b434f5', 'fd7e4a55-0e1a-476c-bbaa-2644c5f0a172', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('29b720f0-fc3b-4fc4-b9e3-85848c9ac7c2', '21c36921-6d41-4050-93f4-c03874b434f5', '4f78b877-d7f4-4cfb-9478-45a78aa88d2d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2b261331-5730-4104-93e1-e4ce72222f54', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'a90ec6a8-0ecd-435a-9c97-19139e143c00', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2c3f2f62-a03e-4566-8959-cf6664c59b04', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'e9aa24c2-ea9d-4fd6-b9b8-1bf40eebe256', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2c51f7e3-5d16-4158-bf7f-67143eba2e7f', '21c36921-6d41-4050-93f4-c03874b434f5', '30b63816-d63e-4f0b-94b4-156b22916dd0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2d79e359-0e57-436a-b34e-55a1b8ef376c', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2e4604e7-cd99-4c4b-b231-5a1136c9cb23', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2d7a77cb-2ed0-40f3-9bae-76b03b039003', '21c36921-6d41-4050-93f4-c03874b434f5', 'f26b319c-6c3d-4ffb-af08-ba1f7e45f5c1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2daf961c-dc2a-46f5-a515-d5ea8756bce8', '7224f683-fdef-4346-975e-a1a8c595a74c', 'de77bb8e-8d36-408b-9670-f481dcc1f959', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2dcfd082-de54-49dc-9d08-1d168b938026', '21c36921-6d41-4050-93f4-c03874b434f5', '44e58d9a-e0ce-4ad7-8f29-764986d77bbc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2de9dca2-bd46-4e58-925c-33d94d0dd67f', '21c36921-6d41-4050-93f4-c03874b434f5', 'abf23400-4843-4f3a-aa22-de3184af318d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('2f44d3f6-4fbd-441a-80d7-96e0a6ce612f', '21c36921-6d41-4050-93f4-c03874b434f5', '921d2642-0c33-47f6-a0f8-2f6de14009ad', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('307be79c-b52a-4aa0-ab33-b081117de478', 'a92f3175-8686-4666-afc3-c3c161a53b36', '4110e4a3-276b-4073-9187-acb53f7d8c71', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3150a848-2e0b-4416-ba87-588618a926ee', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'dbe51162-3932-4b3f-b0b2-048a4c45f268', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('31fb8da7-390c-4ea5-a11f-76d13f7924fb', '21c36921-6d41-4050-93f4-c03874b434f5', '9e8c070d-ed04-4579-b045-36e822ea9dae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('33847143-6359-4e0b-87c4-f152dd9ecb14', '21c36921-6d41-4050-93f4-c03874b434f5', '2dc77964-a04e-420f-8280-e5d105934b82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('33d6827e-8b73-4489-9f6f-9695cb9c88e8', '21c36921-6d41-4050-93f4-c03874b434f5', '3911f6f5-40be-4534-a25f-32032dc59848', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('34493289-a0a1-4925-8893-9915a667ec64', '21c36921-6d41-4050-93f4-c03874b434f5', '3c256c40-a6f7-446c-b72b-827e4b643c4f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('34793290-d03b-40dd-9fd1-4a866f1eb5d0', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'c2e058e6-3cd4-4209-acb9-2c6c73b27b77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('34d75991-b6ce-484b-94e9-05b60469272e', 'a92f3175-8686-4666-afc3-c3c161a53b36', '3a2ad225-39bf-4c81-a83d-491cdf5a562d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('34edb4e8-ce8e-4b0b-91d3-e0c3be2c789b', '21c36921-6d41-4050-93f4-c03874b434f5', '16b1fbc6-4e62-4f06-b1b3-d254d322ade6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('356bcd6d-b8c1-44c3-8ac2-76bbbb72f4f9', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7f510271-2c0b-4d96-82ec-bcf69439a646', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3686d7c4-0707-492c-8d4e-634bf2a115e4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '46421e9e-9be6-498c-bddd-3e8423ea12ed', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('37105bc5-5706-4ba3-8aa1-93f75721945f', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'abf23400-4843-4f3a-aa22-de3184af318d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3760ee3d-0b25-4456-a236-9291534dbe08', '21c36921-6d41-4050-93f4-c03874b434f5', 'a82aac83-7a61-46e7-a39f-d529c4bf6c66', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3926475f-ba1e-4e9e-9dc0-fbfc11ae3a6f', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2b02dfb0-4808-4a18-ba40-8321aff8a93c', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('392e1bbe-7fe6-4b36-b8ae-e834945ca9b2', '21c36921-6d41-4050-93f4-c03874b434f5', '707b3799-9f14-4726-8b47-9425c2da7046', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('39901d6a-4a95-4bbc-9d6c-7c6ceba9f004', '21c36921-6d41-4050-93f4-c03874b434f5', 'a51a5f9f-dcff-419d-9fc3-e9bc0fa0597c', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3a416dab-6f69-4074-bee7-64aace05a851', '7224f683-fdef-4346-975e-a1a8c595a74c', 'e20d0b5b-046a-4773-ac19-4e44ddd5fb72', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3aec3f61-3658-4cf7-84af-6d96e636db3a', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '760d80b8-d6f8-4fbf-8b79-a4ce1c7cccd0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3c2df2c6-9aeb-4ddd-bb5e-b5a4f5206e3e', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'd26053b7-8461-4336-8336-5dea2ad27581', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3cc4f926-de0a-486f-9a7a-1adc402395c4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '63795a19-252c-464c-a9da-4aea559e6709', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3eb375bb-6a97-473e-b288-4e18500c1d93', '21c36921-6d41-4050-93f4-c03874b434f5', '2a10ec7f-cb5e-441f-a787-cc1c35fe4237', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('3f75dc09-7acb-486f-9a04-3514e61d3b9d', '7224f683-fdef-4346-975e-a1a8c595a74c', 'f1f05f1f-dd59-4f7e-934e-8a464a2b6699', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4199572a-598e-4d4a-8e84-934294647f91', '21c36921-6d41-4050-93f4-c03874b434f5', '8eb0fcfd-46be-42ad-8dec-1235dea56c0a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('41cfc000-1fb7-49a3-8282-765b423d5e45', '21c36921-6d41-4050-93f4-c03874b434f5', '46421e9e-9be6-498c-bddd-3e8423ea12ed', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('41f3a26f-d4ec-499a-9f4f-5dd29d62c4ce', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'b5f0e09b-31bc-403f-8faa-bd21050f88d5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('429d3019-5b9f-4f07-b555-5dc21a16dbfa', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'be5a331e-991b-419a-b1e4-6f26eb47fe8e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('432f8847-ff4f-416d-bb59-1326f208695d', '21c36921-6d41-4050-93f4-c03874b434f5', '0834e3dc-7281-47a9-baeb-0ad15161604d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('447df23a-ef50-458c-a47c-0949a912e572', '7224f683-fdef-4346-975e-a1a8c595a74c', '91592f4d-a3c5-43b2-b732-98c25756a15e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('44857c8a-9b9b-461f-9e5d-ce9b1e66e335', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'd3be4d0f-b242-4183-8e3f-b21bc9e7627b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('45edf8ca-24c5-4828-ae21-4e7947f7ada8', 'a92f3175-8686-4666-afc3-c3c161a53b36', '09322733-d955-4645-aa93-81885091ec07', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('47561633-6998-4c40-b4fe-99a069dd438c', 'a92f3175-8686-4666-afc3-c3c161a53b36', '78de2f09-6231-49ac-98f8-9432f4258d4a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('476eaefa-efef-4d40-8704-37927a7f7ec7', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '050919cd-1a3a-4f61-8f32-29e7d0667382', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('478887eb-9927-43d0-b24d-0b7465293a81', '21c36921-6d41-4050-93f4-c03874b434f5', 'a90ec6a8-0ecd-435a-9c97-19139e143c00', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('47961169-df7e-4184-8912-5082551dbba6', 'a92f3175-8686-4666-afc3-c3c161a53b36', '71d32eeb-e7d2-49d2-b6fc-a620caf824e1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('48dc94d8-1427-4e09-96d4-73fc7edab20a', '21c36921-6d41-4050-93f4-c03874b434f5', 'b1b4fde0-74b9-4d16-ae65-b4c2b17e4532', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('49d6c200-bc33-4db4-affc-42e475622f37', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '6d9a1bc5-35b9-4293-b0d6-2e11b54d341e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4a1a8166-01d0-491b-a01f-9219084e2d37', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'e9aa24c2-ea9d-4fd6-b9b8-1bf40eebe256', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4a7b52a2-8303-4c78-b2b2-e62a0a788290', '21c36921-6d41-4050-93f4-c03874b434f5', '428777be-df5a-4fa5-8c3f-0301b519cbf6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4ab6e5f3-2dc9-46d1-bcc8-1bf65dfb8d3a', '21c36921-6d41-4050-93f4-c03874b434f5', '8319fc94-9fc0-4b50-ae63-47979c9c2100', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4abbbcfd-dbbe-4864-b004-4aa6467754c9', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'd21c0b1b-00f6-4278-b66b-a895806c1518', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4b3e1ef3-9fed-4936-b20a-a07526c24d53', 'a92f3175-8686-4666-afc3-c3c161a53b36', '8442d221-0ae1-4067-9b84-9b1d5353cd05', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4b64c4fe-bdd7-492f-a25a-fc1bc2442277', '21c36921-6d41-4050-93f4-c03874b434f5', '1abb7387-1e1f-4b08-8372-3f4250869052', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4b69fe52-d90b-4f86-a69b-0a7b35be6ce2', '21c36921-6d41-4050-93f4-c03874b434f5', '6dc8a19f-baf8-47ae-96ad-7831353eb6f6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4b6d11ff-2fe8-48cb-9a63-6b589298ed4a', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'ef98bb82-d071-4c8f-8335-8bda9e6e15a8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4b7315f2-5aec-49df-ae1f-c135e2355391', '21c36921-6d41-4050-93f4-c03874b434f5', 'f6933520-ada6-4aa1-9cce-41c4c0f396ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4bcaed21-24d6-4713-a048-f5b995a9473b', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f6ffa4f2-e29c-496c-b69c-b73eabf9dfe5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4beba9cc-d508-46f6-8397-a488ba31d083', '21c36921-6d41-4050-93f4-c03874b434f5', '7e12af84-4ea5-4b19-8384-0bc949c0de77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4c02dbd6-1f56-44e6-adbb-5ca2f1b125a2', '7224f683-fdef-4346-975e-a1a8c595a74c', '6894e6c5-93c5-4300-8926-cc4583db4116', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4c41179a-d183-42ea-9d9b-2a766a525770', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '51ce5795-7077-4e13-a1de-f8e5b76df1c1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4c5c27d1-60c1-49b0-8d79-926722e1781e', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f6933520-ada6-4aa1-9cce-41c4c0f396ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4c5c38d7-c4cb-4e44-af0a-f9ff476b8109', '21c36921-6d41-4050-93f4-c03874b434f5', '8e03cf63-787d-4dc2-95a4-1f212a7f26c6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('4e6843ce-3529-46a8-9e0f-efa535070034', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '34b4bb65-fca8-4a8d-8b20-0168cd91a28b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('50a77523-3699-49d9-99b3-99b70ab2010b', '21c36921-6d41-4050-93f4-c03874b434f5', '2fc97b3c-db22-4a46-b2b2-14a2a11c626e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5176d02e-20a5-481f-9274-fa5a4bd9d4bc', 'a92f3175-8686-4666-afc3-c3c161a53b36', '8eb0fcfd-46be-42ad-8dec-1235dea56c0a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('537c0916-015e-4417-b279-e8be8b461587', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'f3535a22-56bd-4061-88fc-ac646e3a790f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('538872ef-5d7e-491a-a09e-4e80da69cf8b', '21c36921-6d41-4050-93f4-c03874b434f5', 'f6ffa4f2-e29c-496c-b69c-b73eabf9dfe5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('54e05142-51d4-4cf4-b758-30f3d50c2088', '21c36921-6d41-4050-93f4-c03874b434f5', '2523bd54-3b74-410e-abfb-1a65fd8ea129', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('556e0d4a-b56b-45f3-9e83-6de56b6f2b17', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'b5f0e09b-31bc-403f-8faa-bd21050f88d5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('564e920d-c30a-4446-9c82-754a03b89f7b', '21c36921-6d41-4050-93f4-c03874b434f5', '2b02dfb0-4808-4a18-ba40-8321aff8a93c', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('56500504-7fcf-4a3a-ba40-fda0eba557b1', '21c36921-6d41-4050-93f4-c03874b434f5', 'f86dd8f9-1560-4978-b0b9-8cbe986b2d0b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('56505dd2-6258-4ea3-b16b-55beb16ef6c8', 'a92f3175-8686-4666-afc3-c3c161a53b36', '050919cd-1a3a-4f61-8f32-29e7d0667382', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5682513c-29d0-4cf6-9476-3fe26d80a4ac', 'a92f3175-8686-4666-afc3-c3c161a53b36', '91592f4d-a3c5-43b2-b732-98c25756a15e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('56a51c9c-5b6f-4d31-bd98-431dcc381101', '21c36921-6d41-4050-93f4-c03874b434f5', '7a29393e-977f-421f-8ae2-0adda016f5fc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('56bd767a-4f37-447b-b0b5-80eb50a63700', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'a90ec6a8-0ecd-435a-9c97-19139e143c00', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('576a862a-8271-4605-bf65-57c873c6aa73', 'a92f3175-8686-4666-afc3-c3c161a53b36', '208b8b46-68e5-4679-bd12-7cab64173762', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5770866a-788c-4b80-b34f-a816ef839067', '21c36921-6d41-4050-93f4-c03874b434f5', '050919cd-1a3a-4f61-8f32-29e7d0667382', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('57cba771-b8a9-40d7-aa30-8e0ce5fe52d7', 'a92f3175-8686-4666-afc3-c3c161a53b36', '86b2c079-9900-4ab7-b7ba-5db0fc1cf7da', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('57de9052-e9ab-47f1-9b4f-e4dcb23049e4', '7224f683-fdef-4346-975e-a1a8c595a74c', 'e9aa24c2-ea9d-4fd6-b9b8-1bf40eebe256', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('57e2dbbf-0964-4267-becb-166c59edf284', '21c36921-6d41-4050-93f4-c03874b434f5', 'dfa4a032-4ac4-4147-8b36-a7e967e0c01d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('58de7e5a-1872-4058-a051-9a84d9ecd94a', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7969ae97-3f92-46d2-a2d1-dcd571ce12cc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('590061a0-afd4-4019-80e8-0de1330ac4c4', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7fc4715b-4574-4fbd-9319-a94797b4f72a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('591656e3-2c40-4a86-8d03-eabf9923f4e1', '21c36921-6d41-4050-93f4-c03874b434f5', '661daad6-04e8-49b7-bd0f-2e457fa5136d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5970b88c-ef08-47f0-aa56-d1ceeb07425e', '21c36921-6d41-4050-93f4-c03874b434f5', '5d9aacfe-72b5-4237-b334-8a6a267c62ae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5a8053d5-e697-4407-a94a-511a06869939', '21c36921-6d41-4050-93f4-c03874b434f5', 'b8bd43fd-fd73-47ef-a519-4bbd17265848', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5b95871d-93dc-460a-a1fe-4056a08df1a7', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7989da4d-60ff-4d53-b54b-4f258ae49645', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5cd6638b-a44f-4880-9a1a-d7b2b0507d28', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'fd7e4a55-0e1a-476c-bbaa-2644c5f0a172', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('5d9cf832-2a37-4ed0-be36-daeeb9ca6497', '21c36921-6d41-4050-93f4-c03874b434f5', 'e2d86be6-d9e5-4586-bf41-a0911cd7962b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('60b9cf86-405e-4252-acca-3ed3ab0368ed', '7224f683-fdef-4346-975e-a1a8c595a74c', '4c611b36-a6a1-47b6-8cbc-387ec7d86416', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('62d6f992-05a0-4ba9-9aed-f08807786b55', '21c36921-6d41-4050-93f4-c03874b434f5', '7760a715-7fdd-4cdc-b34c-d53658b2d2ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('63a244f0-ba29-42b1-9641-55df03ffc5cc', 'a92f3175-8686-4666-afc3-c3c161a53b36', '44e58d9a-e0ce-4ad7-8f29-764986d77bbc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('64482abe-5319-46e2-ba2c-cde4fc095a3f', '21c36921-6d41-4050-93f4-c03874b434f5', 'e2a2a7ef-4877-4c23-9a8f-e88991ef6494', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6608117b-6fd4-4432-9a7f-fb5d63386daa', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'cb2a8163-d002-4004-beb6-56ce4176c5b9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('67166d1b-e2bf-489b-b789-18b8278899a0', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'cd818432-462a-4dcd-9d05-547c8428fec9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6735f325-994c-4f65-aa23-238df439ef0b', '21c36921-6d41-4050-93f4-c03874b434f5', 'e3d3d2e7-76f9-4d61-8733-78caaa672be8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('67989f6a-0912-421c-93e2-404ef807d175', 'a92f3175-8686-4666-afc3-c3c161a53b36', '111f9ffd-1905-408a-a14f-05a2c1f346f1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('67ed73b6-e8ec-4fc7-90d9-781d5339f472', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'f97dab72-6e7a-4a3b-bd11-8bcc215ab228', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('692588ab-e6f6-43e1-ac67-bbdecdee4f7b', '21c36921-6d41-4050-93f4-c03874b434f5', 'f19341f1-4ba1-4ea2-92ec-117059f78c35', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('695846fb-89a2-47e8-a47d-879b50af2c2d', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'd62d85ee-4240-4a5d-987e-5fdff34ee725', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6999c02a-0cc5-4e54-b931-5349d81eec35', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '49cfcc24-fd99-46ce-aaa2-5a1a9cb0cb10', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('69a7f8f6-d7a9-4904-9921-3227bc319ff4', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'b3e94600-d989-4c09-813d-0acf0b9a12e5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6b2774ee-ee16-4725-95b9-efde8aa7fd28', '21c36921-6d41-4050-93f4-c03874b434f5', '043106b4-6d16-46da-9c30-00de7133f630', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6b5218e7-b1f8-462b-800d-fe102414bdee', '21c36921-6d41-4050-93f4-c03874b434f5', 'a66db1fe-4243-4957-b41d-5b663c55aec0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6c6ec7ef-88bd-4dbe-8e1c-f9bb11ee1087', '7224f683-fdef-4346-975e-a1a8c595a74c', '355883b4-764e-4de5-8227-c4eb93fbb13a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6ce6f641-9273-43a0-b327-b3aa8d407510', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'abf23400-4843-4f3a-aa22-de3184af318d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6ce80759-8f84-4783-9b31-48e0e692f1bf', '21c36921-6d41-4050-93f4-c03874b434f5', '235f45f7-cd7f-422a-a155-9bd8a37afa75', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6e09fa60-6b91-4c6d-856a-5dc8298f44af', '21c36921-6d41-4050-93f4-c03874b434f5', '8d8fc2bd-604e-4508-a3c2-414ecd4aafda', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6e258781-a9e9-4736-85e1-f4337be31251', '21c36921-6d41-4050-93f4-c03874b434f5', '7fec8b82-fad7-420b-bf20-70153240abe7', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6eac37a5-b27b-4e4c-98b5-413d67f12d04', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'c93006d7-6264-455d-b9df-afe1c00fec36', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6eca9dd9-cd49-4e44-bc20-4f4c2e1f6fa6', '21c36921-6d41-4050-93f4-c03874b434f5', '805a7870-d067-437d-bd95-b645a3e556b6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6f680902-acce-4915-88b9-964fd8038e62', '7224f683-fdef-4346-975e-a1a8c595a74c', 'f7825a39-39be-42a6-9584-f43420e95efc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('6fe97fac-f91a-448f-960d-e9b72f739e27', '21c36921-6d41-4050-93f4-c03874b434f5', 'db98b0e1-b461-4b18-9f58-e4bc5e6fc0cc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7091d354-e809-4870-b953-d27f762f3805', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '16afa4bb-c894-407b-b7d3-0191510ae1b3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('70f0bcef-4a11-4713-8e3b-e545d6f215c7', '7224f683-fdef-4346-975e-a1a8c595a74c', 'c93006d7-6264-455d-b9df-afe1c00fec36', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('717dd86d-4616-45f1-be1a-3e6a0c479c40', '21c36921-6d41-4050-93f4-c03874b434f5', '85838348-6c04-4be4-85b5-8672b6487157', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7207b79d-d9b9-44ca-bbd9-c46b0274ebd2', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'a66db1fe-4243-4957-b41d-5b663c55aec0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7270e5f7-6ea2-4c51-805e-c9b5d3bef3a6', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '2a10ec7f-cb5e-441f-a787-cc1c35fe4237', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('72f8c3f5-a87d-41b2-b7d4-3b6c2bbb70e4', '21c36921-6d41-4050-93f4-c03874b434f5', 'dbe51162-3932-4b3f-b0b2-048a4c45f268', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('73c2f7ad-b562-468c-a8d6-140b3816b0d3', '21c36921-6d41-4050-93f4-c03874b434f5', '3212c9d2-36ab-4c72-b988-a20b46a07c11', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('73cded41-8097-4c86-9547-a580a5880245', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'cb2a8163-d002-4004-beb6-56ce4176c5b9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('74082b5e-232c-4399-8230-aaef8ac2a646', '21c36921-6d41-4050-93f4-c03874b434f5', 'fab1c6f5-ade7-4bd8-b351-052cccd91875', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7599ba32-f000-4b41-9548-936b8a5a1057', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', '27aa5246-ae7d-4623-bdf2-22b8af9e4832', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('76d43b98-6073-4212-8c33-7f9804aa1dc0', '7224f683-fdef-4346-975e-a1a8c595a74c', 'f05b92c0-194e-485d-ba58-08976df71dd4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7780700e-aea2-46f8-8399-0f201b87fe6a', 'a92f3175-8686-4666-afc3-c3c161a53b36', '52a79b1a-48f3-4acd-9447-28887e497222', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('780a105e-df45-4086-83a2-5847ac46e562', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'af3f9949-43c8-4172-8727-47b54c719e82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('784911e2-a9c2-445a-8a89-2e8e386ec481', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '09f32a3e-1467-46fd-9463-856a8a13ac48', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7874b23e-4f3c-4100-bb16-5ff36d2b92fa', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'e3d3d2e7-76f9-4d61-8733-78caaa672be8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('79458d3e-a00d-478c-9e6f-6d08997f90dc', '7224f683-fdef-4346-975e-a1a8c595a74c', 'cc9daa0b-e17b-4eda-b054-a6c88dd769b2', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7a800fb5-0f27-44cc-9ef9-9334316234c2', 'd50b40dd-430f-4f35-8c3a-c2a51a838bd8', '91592f4d-a3c5-43b2-b732-98c25756a15e', '2026-11-23 04:48:13');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7b317e24-17ed-44b5-ab4b-e39bcf41dd79', '21c36921-6d41-4050-93f4-c03874b434f5', '4890aa17-b34d-4417-a734-78b0e1a48bd3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7b3b2eba-c423-42f5-9841-2cd3b692eec0', 'a92f3175-8686-4666-afc3-c3c161a53b36', '51ce5795-7077-4e13-a1de-f8e5b76df1c1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7d96cc27-8226-4d7e-9ac7-4902c37e8149', '21c36921-6d41-4050-93f4-c03874b434f5', 'fa7a526e-1cb9-4b5a-8cf8-0c02c67b637f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7e77dda9-b9ad-4eeb-b24d-db75fce37cb9', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7fc4715b-4574-4fbd-9319-a94797b4f72a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('7fb4231d-21b2-40dd-a3ba-def3a7b238fa', '21c36921-6d41-4050-93f4-c03874b434f5', '78de2f09-6231-49ac-98f8-9432f4258d4a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('80bec99f-eff4-404e-b771-0c7b97f01486', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'ef98bb82-d071-4c8f-8335-8bda9e6e15a8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('80bf7ad9-326d-48ab-8605-6134bb878611', 'a92f3175-8686-4666-afc3-c3c161a53b36', '428777be-df5a-4fa5-8c3f-0301b519cbf6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8298fe0f-916a-4f5b-b228-669da05dfe76', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '4c611b36-a6a1-47b6-8cbc-387ec7d86416', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('82e8c101-89d2-40ad-976e-e00f57c10e4c', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'd8c7a118-bde1-49f8-8d29-40478c545399', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('83fc4e09-c02e-45f1-9a60-c2cf463be903', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2523bd54-3b74-410e-abfb-1a65fd8ea129', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('84345faa-6e93-4d22-adc2-2d4a12ed4ad7', '7224f683-fdef-4346-975e-a1a8c595a74c', '66c3f54a-8ce3-47a7-8531-e78a5d6839de', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('845c9bc2-6ca7-44a4-8629-a812389fc130', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '44e58d9a-e0ce-4ad7-8f29-764986d77bbc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('85a3e144-5c71-409d-95f5-1264c557aeaf', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'e2a2a7ef-4877-4c23-9a8f-e88991ef6494', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('86090d57-2872-4e70-93dd-2aeda1d32f62', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'f05b92c0-194e-485d-ba58-08976df71dd4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('864dc893-e288-495e-ab33-fea12fccc220', '21c36921-6d41-4050-93f4-c03874b434f5', '09f32a3e-1467-46fd-9463-856a8a13ac48', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8698088c-c61a-4a48-b2e5-cdb1a395a52c', 'a92f3175-8686-4666-afc3-c3c161a53b36', '760d80b8-d6f8-4fbf-8b79-a4ce1c7cccd0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('87cd8734-5dc8-4f71-85cf-8a2a19aaf278', '21c36921-6d41-4050-93f4-c03874b434f5', '4c471686-5fb3-4203-9fb3-b9ea66021196', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8835b961-36e5-465f-8e59-3494c6e911b4', '21c36921-6d41-4050-93f4-c03874b434f5', '3a459d2b-bfa7-4680-aa88-0ad1591880eb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('885fcd8f-e758-40d6-a1c3-68bf4425e7a9', '21c36921-6d41-4050-93f4-c03874b434f5', 'd3be4d0f-b242-4183-8e3f-b21bc9e7627b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8976252c-922f-449e-9add-b8b2317b5c66', '7224f683-fdef-4346-975e-a1a8c595a74c', '7989da4d-60ff-4d53-b54b-4f258ae49645', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('899cac1e-4115-459b-9c06-d392ff178324', 'a92f3175-8686-4666-afc3-c3c161a53b36', '3a459d2b-bfa7-4680-aa88-0ad1591880eb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ab5ef10-a748-4c55-bc5f-8322bf97abcb', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f26b319c-6c3d-4ffb-af08-ba1f7e45f5c1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ae9c1ff-0219-4147-a9da-5e115fbb0450', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'cd818432-462a-4dcd-9d05-547c8428fec9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ca2c2fb-989c-4d34-b047-b6f4ba4d77df', '21c36921-6d41-4050-93f4-c03874b434f5', 'c2e058e6-3cd4-4209-acb9-2c6c73b27b77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8d101041-d14f-4a9d-8a6c-c40a31cd12c4', '21c36921-6d41-4050-93f4-c03874b434f5', '2e4604e7-cd99-4c4b-b231-5a1136c9cb23', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8d99d7b5-7eb0-444d-b6a6-25d0f96c5ca2', '7224f683-fdef-4346-975e-a1a8c595a74c', '93fcf0bb-928b-4b8c-b73c-36301770be8b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8dad7afe-4fa5-4e17-ab9c-590338f352d7', 'a92f3175-8686-4666-afc3-c3c161a53b36', '3911f6f5-40be-4534-a25f-32032dc59848', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8ee9f010-105f-43c2-88f3-9a90d760bf6b', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'd8c7a118-bde1-49f8-8d29-40478c545399', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('8f15d246-af45-41a1-ac4e-99c7bae5dffb', '21c36921-6d41-4050-93f4-c03874b434f5', 'd21c0b1b-00f6-4278-b66b-a895806c1518', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9014727b-7f97-4ee7-b89c-c7eb2bb0fce9', 'a92f3175-8686-4666-afc3-c3c161a53b36', '5d9aacfe-72b5-4237-b334-8a6a267c62ae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('90ab8e84-1dc9-4448-ba7c-c439e4c8e5d1', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7fec8b82-fad7-420b-bf20-70153240abe7', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('90dc3ae0-9a22-4fdc-a945-d22e9619910b', '21c36921-6d41-4050-93f4-c03874b434f5', '760d80b8-d6f8-4fbf-8b79-a4ce1c7cccd0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('91c85f4f-4053-45fb-ac73-58225d397057', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'dbe51162-3932-4b3f-b0b2-048a4c45f268', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('922aad70-db13-4bf1-9520-d321f7a1007a', '7224f683-fdef-4346-975e-a1a8c595a74c', '6dc8a19f-baf8-47ae-96ad-7831353eb6f6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('92c31277-bc52-44be-855a-7e70986528b0', '21c36921-6d41-4050-93f4-c03874b434f5', 'bb320781-15a7-4053-988c-2f0984ef6238', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('93057bb7-09e6-4eee-ab26-81b3bf65fad7', 'a92f3175-8686-4666-afc3-c3c161a53b36', '16afa4bb-c894-407b-b7d3-0191510ae1b3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('942e27ec-a28b-4e23-9bf0-58888ca37e22', '21c36921-6d41-4050-93f4-c03874b434f5', '63795a19-252c-464c-a9da-4aea559e6709', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('946405f1-63bd-4398-838a-ef5e4d620e1d', '21c36921-6d41-4050-93f4-c03874b434f5', '6894e6c5-93c5-4300-8926-cc4583db4116', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('94bb57b3-06d6-44e3-86ce-dd04e4fd0647', '21c36921-6d41-4050-93f4-c03874b434f5', '9a3cf8e0-a7c1-473b-9dc2-af2b0b5913d8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('94f4456a-dd3b-475b-93b1-e0d13732687a', '21c36921-6d41-4050-93f4-c03874b434f5', 'f97dab72-6e7a-4a3b-bd11-8bcc215ab228', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('95f1e0ca-5e82-4c27-af37-4d3dddcd092b', '21c36921-6d41-4050-93f4-c03874b434f5', 'bbde210b-2abd-4685-8c0b-fa937b2549a8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9735b920-b8e4-44da-adbb-47cc4185ad79', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '09322733-d955-4645-aa93-81885091ec07', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9835a57b-016f-4b56-9aac-4b55abccb223', '21c36921-6d41-4050-93f4-c03874b434f5', '61797495-d93a-47b7-bd2e-69435bb3fe77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('986000ab-6118-4223-b1bd-699a0bf4ed02', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '5d9aacfe-72b5-4237-b334-8a6a267c62ae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('98ce9d19-5590-4380-bc2a-e09fc899cae5', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'f7825a39-39be-42a6-9584-f43420e95efc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9942b4c7-077f-43c1-ab6e-b63ef2f70319', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'd62d85ee-4240-4a5d-987e-5fdff34ee725', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9965ed00-9aa1-4036-bbf5-ec3e0e3b9537', '7224f683-fdef-4346-975e-a1a8c595a74c', 'e2a2a7ef-4877-4c23-9a8f-e88991ef6494', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9a2983dd-1798-4d86-9eb6-ef15a55fbe99', '21c36921-6d41-4050-93f4-c03874b434f5', '0119583d-64ec-4da7-8d55-11f3c3836521', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9b51eaa7-af7e-42c7-b3e6-181ca746a9f7', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '86b2c079-9900-4ab7-b7ba-5db0fc1cf7da', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9c06831f-bd79-4aac-83e6-16328ada9097', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2a10ec7f-cb5e-441f-a787-cc1c35fe4237', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9c8fd3e9-74ee-4f71-9015-b5882cf43072', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '687e6593-d73e-4ac4-99ed-0d6568f3d497', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9cf8a544-b9cc-4379-b6ca-dcfc45c7e2e0', 'a92f3175-8686-4666-afc3-c3c161a53b36', '4c611b36-a6a1-47b6-8cbc-387ec7d86416', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9d91b068-791c-4d4f-8107-1b431eb54a63', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '63795a19-252c-464c-a9da-4aea559e6709', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9db8f5d1-017b-442e-841d-86125c811f3a', '21c36921-6d41-4050-93f4-c03874b434f5', 'cd818432-462a-4dcd-9d05-547c8428fec9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9dda2d50-334a-4f22-b0e0-c501561f9563', '21c36921-6d41-4050-93f4-c03874b434f5', '346ce559-c65e-4120-b495-a42ca63b2a03', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9e423d96-91f0-4a61-900b-d676e31eaddb', 'a92f3175-8686-4666-afc3-c3c161a53b36', '73955aff-c814-4156-8d43-2d45f10b53e4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9efc7c9f-0e7e-4401-9249-e706b61a33a3', '21c36921-6d41-4050-93f4-c03874b434f5', '3a2ad225-39bf-4c81-a83d-491cdf5a562d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9f632db7-9ba8-4947-9f65-739ccc11f470', '21c36921-6d41-4050-93f4-c03874b434f5', 'f7825a39-39be-42a6-9584-f43420e95efc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9f96dc2f-6d32-4f6a-ac12-db6f70d2b2fe', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'db98b0e1-b461-4b18-9f58-e4bc5e6fc0cc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('9fc73d02-c908-4de4-b0c1-6832a5433640', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '6894e6c5-93c5-4300-8926-cc4583db4116', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a0cbc808-1c2b-488b-a866-0a07c2cd95ba', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7760a715-7fdd-4cdc-b34c-d53658b2d2ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a2e23c60-004c-42d1-ae44-5eb666183114', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'aadde006-8f35-46a3-8cd2-ec0065718a6a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a33dca65-2bc5-4eca-b795-2904c57bf9c6', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'bb320781-15a7-4053-988c-2f0984ef6238', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a344513e-996f-4e32-83c3-0e9c235b7f6a', '21c36921-6d41-4050-93f4-c03874b434f5', '3dd259e5-797d-4b70-856d-0a1aa9d3fd09', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a35405d0-4900-404d-b0f1-1ae2eab329ed', '21c36921-6d41-4050-93f4-c03874b434f5', '52a79b1a-48f3-4acd-9447-28887e497222', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a4ceca58-9f64-45bc-b6db-32ce69d66302', '21c36921-6d41-4050-93f4-c03874b434f5', 'f2b337a1-7eb6-4ccf-bdd2-facea2cfd289', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a5a54ada-102b-4049-8744-5dc1d2faf213', '21c36921-6d41-4050-93f4-c03874b434f5', '34b4bb65-fca8-4a8d-8b20-0168cd91a28b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a5b288ee-1ede-48d8-8d6e-3380719015c2', '21c36921-6d41-4050-93f4-c03874b434f5', 'f8c1b203-36e7-48f2-8cf3-cf972d3f8bb3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a686f5c4-43cd-4546-96a9-0522c417b001', '21c36921-6d41-4050-93f4-c03874b434f5', '66c3f54a-8ce3-47a7-8531-e78a5d6839de', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a7925d46-90ac-4340-be0b-68f8b4807a1c', '7224f683-fdef-4346-975e-a1a8c595a74c', 'abf23400-4843-4f3a-aa22-de3184af318d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a7a1a096-c3a2-4214-b052-5290c0e7db60', '21c36921-6d41-4050-93f4-c03874b434f5', '51ce5795-7077-4e13-a1de-f8e5b76df1c1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a8c0a4ab-44ac-4b7c-9e84-7b68d5de2ede', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'be5a331e-991b-419a-b1e4-6f26eb47fe8e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a913976d-92e0-4b18-be4f-69dec5875e93', '21c36921-6d41-4050-93f4-c03874b434f5', 'dd97f3ab-6789-4c4b-af19-278a3529aaa9', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a9463abd-6edf-44fc-8a32-133c8654a7f2', '21c36921-6d41-4050-93f4-c03874b434f5', 'd26053b7-8461-4336-8336-5dea2ad27581', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('a9ce255b-cf2c-45d6-bf57-406c8b08d7a5', 'a92f3175-8686-4666-afc3-c3c161a53b36', '49923149-9d21-49c4-b0d6-d56c6b6285ee', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('aa5ed458-2415-47d3-b7fc-8cca49751a8e', '7224f683-fdef-4346-975e-a1a8c595a74c', 'b5f0e09b-31bc-403f-8faa-bd21050f88d5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('adb18162-760e-4b1b-8519-be5defecacb1', '21c36921-6d41-4050-93f4-c03874b434f5', 'c93006d7-6264-455d-b9df-afe1c00fec36', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('af49934e-e081-4b88-964f-b23a48b04fde', '7224f683-fdef-4346-975e-a1a8c595a74c', '34b4bb65-fca8-4a8d-8b20-0168cd91a28b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('afdf6bd5-e31e-4d2c-9eb7-240d0b87fc68', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'fa7a526e-1cb9-4b5a-8cf8-0c02c67b637f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b0edfa2a-7880-4092-a7b4-ea401a7f5b3e', 'a92f3175-8686-4666-afc3-c3c161a53b36', '707b3799-9f14-4726-8b47-9425c2da7046', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b134386a-c4aa-48b1-93ca-b8d43c86c0b3', '21c36921-6d41-4050-93f4-c03874b434f5', 'd62d85ee-4240-4a5d-987e-5fdff34ee725', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b1a045d3-8b63-4606-a14b-5ef7ccd8c83b', 'a92f3175-8686-4666-afc3-c3c161a53b36', '682832f3-8d7a-4753-943d-4ebfc1238308', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b1f1e05f-2a0d-4235-80ce-6cdab793a7d8', '21c36921-6d41-4050-93f4-c03874b434f5', 'a67d7e43-1d95-43e6-8a09-6b3bfd31d80d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b2c629bf-a0fc-4a84-93df-4fab6e7eb65f', '21c36921-6d41-4050-93f4-c03874b434f5', '2cd899df-b7dd-4e71-b933-d4a8e767244c', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b3f2dcfe-a469-458f-9c07-f1e5cf891c15', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f05b92c0-194e-485d-ba58-08976df71dd4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b4400c15-255e-496a-aa26-ecf92e65889b', '21c36921-6d41-4050-93f4-c03874b434f5', 'b5f0e09b-31bc-403f-8faa-bd21050f88d5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b5488a80-44ae-4738-b9e2-d1e73ceda6d4', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7e12af84-4ea5-4b19-8384-0bc949c0de77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b5b1a3c8-6bc9-4852-9091-29260e846073', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f2b337a1-7eb6-4ccf-bdd2-facea2cfd289', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b5c0ae61-c571-453e-aad8-5aa41b743c5b', 'a92f3175-8686-4666-afc3-c3c161a53b36', '1782a35f-8a82-4d6d-925f-9024e8c433f3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b65d1231-e5d7-4531-bf2e-a64fd2139193', '21c36921-6d41-4050-93f4-c03874b434f5', '78662adc-53e2-4b90-862c-5564adf8f709', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b7050389-45e0-4f20-802a-1ec18ad1e83a', '21c36921-6d41-4050-93f4-c03874b434f5', 'd8c7a118-bde1-49f8-8d29-40478c545399', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b7194a52-198b-4b97-bb87-3f10d8342d1c', '21c36921-6d41-4050-93f4-c03874b434f5', '1782a35f-8a82-4d6d-925f-9024e8c433f3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b8b01e19-5731-460d-b6c6-d1d8712426c0', 'a92f3175-8686-4666-afc3-c3c161a53b36', '49cfcc24-fd99-46ce-aaa2-5a1a9cb0cb10', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b8f28339-4555-4426-8a0a-43decbd9d87f', 'a92f3175-8686-4666-afc3-c3c161a53b36', '8d8fc2bd-604e-4508-a3c2-414ecd4aafda', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b93973a5-7c58-4b41-b06c-d9a2a615e894', '21c36921-6d41-4050-93f4-c03874b434f5', 'b25fcc7a-502d-43d0-91b9-30f99e9d82ab', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b9b22b88-33c9-44bc-ba89-3d46fde7e4d7', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '3c256c40-a6f7-446c-b72b-827e4b643c4f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('b9b565b4-d7ac-47db-ba7a-9f73bcb3844d', '21c36921-6d41-4050-93f4-c03874b434f5', '7f8473f3-ab74-4dc6-b4d9-0a61c2cc71bb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ba00e8b7-67ab-4593-aefa-f4d0e7a95103', '7224f683-fdef-4346-975e-a1a8c595a74c', '4110e4a3-276b-4073-9187-acb53f7d8c71', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ba3ec350-9207-46c2-b704-ac4183c50c36', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'd3be4d0f-b242-4183-8e3f-b21bc9e7627b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ba6642ac-2d0f-4163-82b7-0b25a4ffe740', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2dc77964-a04e-420f-8280-e5d105934b82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bae63123-9ef4-44f1-9945-fd92c3f022c9', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'e3d3d2e7-76f9-4d61-8733-78caaa672be8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bbf46aea-7616-46cd-ab60-364d6eba3ed4', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '66c3f54a-8ce3-47a7-8531-e78a5d6839de', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bc0f9839-8b57-4e73-bee2-84c919646f87', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7760a715-7fdd-4cdc-b34c-d53658b2d2ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bc93a4de-3aff-4023-ad4f-4c990224e73c', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'c2e058e6-3cd4-4209-acb9-2c6c73b27b77', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bcf6f199-ae74-43fb-a670-2c801930b4da', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'ad7fc495-905f-4b18-9404-09c95a0154df', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bdb2bd6e-3628-4537-a6fc-071fee1314fa', '21c36921-6d41-4050-93f4-c03874b434f5', '5702e6b8-aa5b-47d0-9f33-1d51d775d2fc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('be9fb4c0-c555-4d99-a2a5-d88d8f98741b', '21c36921-6d41-4050-93f4-c03874b434f5', 'ad7fc495-905f-4b18-9404-09c95a0154df', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('bed810ad-592c-4cb4-a37d-ad5c1dec34af', '7224f683-fdef-4346-975e-a1a8c595a74c', '44e58d9a-e0ce-4ad7-8f29-764986d77bbc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c01e1469-a333-4f5a-8764-3f53fb7f8694', '21c36921-6d41-4050-93f4-c03874b434f5', 'ef98bb82-d071-4c8f-8335-8bda9e6e15a8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c0de6ba7-8cf4-467c-8ac4-00af7f6381d8', 'a92f3175-8686-4666-afc3-c3c161a53b36', '78662adc-53e2-4b90-862c-5564adf8f709', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c16761e8-17df-4be8-b425-f4e9bf16d5c0', '21c36921-6d41-4050-93f4-c03874b434f5', 'f98af846-53cc-4b2a-b1b9-6cfa885af9de', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c198d90a-968a-4cb9-afaf-8ab64f070fba', '21c36921-6d41-4050-93f4-c03874b434f5', '6bc79172-e387-4baf-bc96-5f7c13292121', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c21ab699-0584-436c-98c8-9806eb98234a', '21c36921-6d41-4050-93f4-c03874b434f5', '647de2a0-0a54-4381-8616-1a5d31145216', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c2870bdf-1490-4dc4-87ba-e1dfa47e05c2', 'a92f3175-8686-4666-afc3-c3c161a53b36', '5702e6b8-aa5b-47d0-9f33-1d51d775d2fc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c3125fb9-b9ae-4cb4-a3d5-21daaae1f24b', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'db98b0e1-b461-4b18-9f58-e4bc5e6fc0cc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c4444e57-e50b-4239-8d7c-f23bb4541ec1', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f19341f1-4ba1-4ea2-92ec-117059f78c35', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c4c0337d-aebb-4db8-8f12-960a9745095e', '21c36921-6d41-4050-93f4-c03874b434f5', 'b3e94600-d989-4c09-813d-0acf0b9a12e5', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c50589e5-e090-4bcc-b73c-88c4ce8ba0b6', '21c36921-6d41-4050-93f4-c03874b434f5', '7fc4715b-4574-4fbd-9319-a94797b4f72a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c5282367-c8ed-41f9-a70c-83f1112a7fec', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '6dc8a19f-baf8-47ae-96ad-7831353eb6f6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c5dc2890-8384-49d9-a648-957642ccfd11', '21c36921-6d41-4050-93f4-c03874b434f5', 'd1d34d9f-d273-4cb4-ba24-427a523e90f3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c66a0133-b9a1-4d53-b1bc-e7c49c3e8bd0', '7224f683-fdef-4346-975e-a1a8c595a74c', 'be5a331e-991b-419a-b1e4-6f26eb47fe8e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c748175b-4f78-4b75-8a79-4eb66e0f264e', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '91592f4d-a3c5-43b2-b732-98c25756a15e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('c9a64f68-ef79-4050-8517-2918cd72fc94', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'e2d86be6-d9e5-4586-bf41-a0911cd7962b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ca7702dc-5007-4460-b7b4-e45d595ef7c2', 'a92f3175-8686-4666-afc3-c3c161a53b36', '5e3d1b5f-b6fa-4fc8-ac9e-baf8b2a3b502', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cad7e582-2e1a-4629-9073-337153ecfb4a', '21c36921-6d41-4050-93f4-c03874b434f5', '49cfcc24-fd99-46ce-aaa2-5a1a9cb0cb10', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cb935041-7152-4fcf-b513-42c6dbad46a2', 'a92f3175-8686-4666-afc3-c3c161a53b36', '74291a5a-8cf3-49e3-b5d0-8f93c8aa2469', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cba2a819-5ba4-44a4-abf0-4ca4d07be099', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'de77bb8e-8d36-408b-9670-f481dcc1f959', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cc319cb9-904f-4ce6-a60d-0a588beaffec', '7224f683-fdef-4346-975e-a1a8c595a74c', '5d9aacfe-72b5-4237-b334-8a6a267c62ae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cc47898d-3dc3-4e6b-b837-cabbca4923a1', '7224f683-fdef-4346-975e-a1a8c595a74c', '7760a715-7fdd-4cdc-b34c-d53658b2d2ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ccc63b2e-4b9e-4ee5-8019-04182132ee29', '21c36921-6d41-4050-93f4-c03874b434f5', 'e9aa24c2-ea9d-4fd6-b9b8-1bf40eebe256', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('cdc209aa-7a26-417c-9939-d431dc51d12a', '7224f683-fdef-4346-975e-a1a8c595a74c', '3212c9d2-36ab-4c72-b988-a20b46a07c11', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ce6f190b-d9b8-41fa-84ff-7c773a430d78', 'a92f3175-8686-4666-afc3-c3c161a53b36', '6dc8a19f-baf8-47ae-96ad-7831353eb6f6', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d00c41ea-1e94-4ec0-9a51-2ca7f9e8833a', '7224f683-fdef-4346-975e-a1a8c595a74c', '3c256c40-a6f7-446c-b72b-827e4b643c4f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d27792c1-2661-4fef-bda0-4ec57f330265', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'aadde006-8f35-46a3-8cd2-ec0065718a6a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d2829666-04b9-4f00-9521-88aea68143f4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '043106b4-6d16-46da-9c30-00de7133f630', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d4b7a49c-dbe4-4db4-abdb-3e73d50e07d4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7f510271-2c0b-4d96-82ec-bcf69439a646', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d4d514b0-55a0-46a3-916c-fa2241ee1d83', '21c36921-6d41-4050-93f4-c03874b434f5', '92993648-3166-4620-b541-78168740d6b7', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d50db9fe-aa0d-4647-addc-92d0546005b6', '21c36921-6d41-4050-93f4-c03874b434f5', 'f1f05f1f-dd59-4f7e-934e-8a464a2b6699', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d5acc890-145e-41ce-a1c3-d2bec5877e4a', '21c36921-6d41-4050-93f4-c03874b434f5', '49923149-9d21-49c4-b0d6-d56c6b6285ee', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d6465ea3-c05a-4e35-a170-5192a2432777', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '346ce559-c65e-4120-b495-a42ca63b2a03', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d7f3267c-5c90-4a67-a9a3-d07503f92528', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'c93006d7-6264-455d-b9df-afe1c00fec36', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d8895e44-4f22-471d-bd3d-f84ed67850a5', '21c36921-6d41-4050-93f4-c03874b434f5', '1d9b1884-2e26-4ad8-bd7f-12ffb0b7e3db', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d89d9d85-57ce-4e43-b3ce-c1e15698cde1', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '52a79b1a-48f3-4acd-9447-28887e497222', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d902d9f7-a2eb-4f72-becc-2d858baba12f', '21c36921-6d41-4050-93f4-c03874b434f5', '208b8b46-68e5-4679-bd12-7cab64173762', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('d9a6432d-0eac-4031-af43-9678d0e29064', 'a92f3175-8686-4666-afc3-c3c161a53b36', '9a5d98b0-3fad-4bdc-859a-2bfa4cc532ce', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dc430b2f-3788-487b-9745-255ef5f493a5', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'af3f9949-43c8-4172-8727-47b54c719e82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dc969ffe-9f78-4226-a675-5a24b44e8d46', '21c36921-6d41-4050-93f4-c03874b434f5', '4110e4a3-276b-4073-9187-acb53f7d8c71', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dd57e70f-2180-4fff-b912-739211f49a5f', 'a92f3175-8686-4666-afc3-c3c161a53b36', '8e919727-f1c0-4c28-9d81-c5b83f6b8757', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dd7e78b1-bda9-4330-b1c6-c0d165578bd2', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'b25fcc7a-502d-43d0-91b9-30f99e9d82ab', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('dee7e664-45cc-4cd2-89e5-287903d0d517', 'a92f3175-8686-4666-afc3-c3c161a53b36', '4f78b877-d7f4-4cfb-9478-45a78aa88d2d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('def39ebc-0dcc-4623-be9e-e708c48a0830', '21c36921-6d41-4050-93f4-c03874b434f5', '74291a5a-8cf3-49e3-b5d0-8f93c8aa2469', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('df9163bf-8a9d-4c51-a136-11a1716926f3', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'b8bd43fd-fd73-47ef-a519-4bbd17265848', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e140f180-0779-4d5c-ac67-bcfa7849b4ec', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '4c471686-5fb3-4203-9fb3-b9ea66021196', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e1e76d83-6e8f-43b0-b782-a60df2fece24', 'a92f3175-8686-4666-afc3-c3c161a53b36', '921d2642-0c33-47f6-a0f8-2f6de14009ad', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e2624ce3-937a-42e9-a6c2-1dcb474bcf00', '21c36921-6d41-4050-93f4-c03874b434f5', '71e78a86-f165-4636-b2d3-fa8cad0db4e4', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e264d0e4-b6aa-463c-aec6-0a2cc4718108', '21c36921-6d41-4050-93f4-c03874b434f5', 'c811505e-370a-4444-8c36-9c0c998d8e69', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e3087c02-46f4-4141-a106-cd94aea48396', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f97dab72-6e7a-4a3b-bd11-8bcc215ab228', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e330d9d3-e390-419a-8b55-49985fb951fd', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2cd899df-b7dd-4e71-b933-d4a8e767244c', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e3e62a6c-e593-463b-88db-0f69d9bfaaa9', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'c811505e-370a-4444-8c36-9c0c998d8e69', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e51f6fd2-295e-4fee-b4a2-8186f1414406', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'f7825a39-39be-42a6-9584-f43420e95efc', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e5d39a4b-86ad-41b8-9763-68f0ceebd0ed', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'bbde210b-2abd-4685-8c0b-fa937b2549a8', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e6175ee1-ad80-43d8-a5e7-9ae8072ca091', 'a92f3175-8686-4666-afc3-c3c161a53b36', '9e8c070d-ed04-4579-b045-36e822ea9dae', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e6ae2157-678e-44b1-b47a-675c8fc6ed48', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7f8473f3-ab74-4dc6-b4d9-0a61c2cc71bb', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e7691134-a96e-4411-a000-a38e9e349102', 'a92f3175-8686-4666-afc3-c3c161a53b36', '6d9a1bc5-35b9-4293-b0d6-2e11b54d341e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e77c8807-183f-4869-9bff-4c9ce8bba720', '21c36921-6d41-4050-93f4-c03874b434f5', '4c611b36-a6a1-47b6-8cbc-387ec7d86416', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e7ee1180-3182-4486-a25b-ca322c7a9910', '21c36921-6d41-4050-93f4-c03874b434f5', '35700fee-c275-4a0c-bac1-93b5405b46f2', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e7f041c1-e735-4521-9f84-bfd951489d8a', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'e2a2a7ef-4877-4c23-9a8f-e88991ef6494', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e8a4c6c7-e403-4875-845b-068385e53adf', '21c36921-6d41-4050-93f4-c03874b434f5', '355883b4-764e-4de5-8227-c4eb93fbb13a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('e9db3fc9-89f9-49f4-a659-76fec94259b6', '21c36921-6d41-4050-93f4-c03874b434f5', '16afa4bb-c894-407b-b7d3-0191510ae1b3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ea6af7ec-5b8b-42b6-8021-01f336838f7c', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '8442d221-0ae1-4067-9b84-9b1d5353cd05', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ea6b2cd1-03cd-4ac8-9be0-b95523525232', '21c36921-6d41-4050-93f4-c03874b434f5', '5e3d1b5f-b6fa-4fc8-ac9e-baf8b2a3b502', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('eaa25c32-0a2c-4fe1-ac00-5c090cddf48b', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', '7989da4d-60ff-4d53-b54b-4f258ae49645', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('eaa39cc5-a860-4ee7-a64c-6c2b34e266c7', '21c36921-6d41-4050-93f4-c03874b434f5', '86b2c079-9900-4ab7-b7ba-5db0fc1cf7da', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('eac3df71-270c-4715-83f2-785a70a53ed7', '21c36921-6d41-4050-93f4-c03874b434f5', 'b0b648c6-73b5-4013-819d-0f8c956458c0', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('eb17fb93-8dab-49b9-9e9c-9bb9aecb204f', '21c36921-6d41-4050-93f4-c03874b434f5', '48101f93-5447-404b-96ea-18d5c6636620', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ec4334c5-62fe-4d4a-b497-1bd632173e9d', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'c811505e-370a-4444-8c36-9c0c998d8e69', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ed4050b9-ba6b-45df-a2e8-4f2e33da65bd', '21c36921-6d41-4050-93f4-c03874b434f5', '943f6ece-aba0-465f-a987-e5807292675a', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ee783e9f-8dac-4846-879f-395ed16bacc7', '21c36921-6d41-4050-93f4-c03874b434f5', '73822148-fae5-46a7-9342-7a2346fa2806', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ee7a1813-2168-4f74-b6a6-17b0e80c2402', 'a92f3175-8686-4666-afc3-c3c161a53b36', 'a82aac83-7a61-46e7-a39f-d529c4bf6c66', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ee95ba6f-b9d1-4d3b-8e28-814124de5cd6', '21c36921-6d41-4050-93f4-c03874b434f5', '687e6593-d73e-4ac4-99ed-0d6568f3d497', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('ef19deca-f9d3-4a81-8054-6b632cc89586', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'dfa4a032-4ac4-4147-8b36-a7e967e0c01d', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f18b4ad4-cf2d-4210-9f41-ad614844ed97', 'a92f3175-8686-4666-afc3-c3c161a53b36', '235f45f7-cd7f-422a-a155-9bd8a37afa75', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f271048c-78c0-42dc-9abc-17fa3cb6f2cb', '21c36921-6d41-4050-93f4-c03874b434f5', 'af3f9949-43c8-4172-8727-47b54c719e82', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f27cd505-ee71-4be1-bbb0-1cd071200ce8', '21c36921-6d41-4050-93f4-c03874b434f5', '6a1f9f37-4b9f-4510-81d4-195cca3ca4b1', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f27d6d4d-20ad-456a-9574-1646366bdd0d', '21c36921-6d41-4050-93f4-c03874b434f5', '93fcf0bb-928b-4b8c-b73c-36301770be8b', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f2d30ac5-fadf-4c6a-807a-bc86ede222cf', '21c36921-6d41-4050-93f4-c03874b434f5', 'f3535a22-56bd-4061-88fc-ac646e3a790f', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f48ed216-3bfd-40ab-8499-a11b2f637757', '6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'f6933520-ada6-4aa1-9cce-41c4c0f396ba', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f6ef10a1-580a-4e9b-83d5-2749ccd1f992', '21c36921-6d41-4050-93f4-c03874b434f5', '53f9933a-56a9-45fa-b164-77a546cfd7c3', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f842c20a-88dd-43e9-9569-1e1e17052d1c', 'a92f3175-8686-4666-afc3-c3c161a53b36', '92993648-3166-4620-b541-78168740d6b7', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f8d1636f-b3f8-4cd8-b0a3-edfc2c5f16d4', '21c36921-6d41-4050-93f4-c03874b434f5', '7989da4d-60ff-4d53-b54b-4f258ae49645', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f9670144-d1b9-4247-8518-54de1a0196c4', 'a92f3175-8686-4666-afc3-c3c161a53b36', '346ce559-c65e-4120-b495-a42ca63b2a03', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('f9dd87ce-c84a-4451-b728-37bd2c783f62', '21c36921-6d41-4050-93f4-c03874b434f5', '12c48a1d-93ca-457f-a843-a0b4b476ad31', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('fa0fd072-35f9-4ee0-96c4-330945c5743b', 'a92f3175-8686-4666-afc3-c3c161a53b36', '2fc97b3c-db22-4a46-b2b2-14a2a11c626e', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('faa9e1ed-f10c-49ce-9bc2-42648524b696', '21c36921-6d41-4050-93f4-c03874b434f5', '7f510271-2c0b-4d96-82ec-bcf69439a646', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('fac0eda0-8d98-46a7-ba3a-4725310e4f89', 'a92f3175-8686-4666-afc3-c3c161a53b36', '4c471686-5fb3-4203-9fb3-b9ea66021196', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('fb661697-39b6-4f75-8dee-7fd4109e6e22', 'a92f3175-8686-4666-afc3-c3c161a53b36', '687e6593-d73e-4ac4-99ed-0d6568f3d497', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('fcf278c0-cead-4011-a059-7d315e62fc8b', '21c36921-6d41-4050-93f4-c03874b434f5', 'cc9daa0b-e17b-4eda-b054-a6c88dd769b2', '2026-11-23 04:48:12');
INSERT INTO `role_permissions` (`id`, `role_id`, `permission_id`, `created_at`) VALUES ('feb35fee-da01-4775-99ae-346fbb50665d', 'a92f3175-8686-4666-afc3-c3c161a53b36', '7969ae97-3f92-46d2-a2d1-dcd571ce12cc', '2026-11-23 04:48:12');
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
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('21c36921-6d41-4050-93f4-c03874b434f5', 'Admin', 'admin', 'Everything except granting access to others', 90, 1, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('6c8ae77a-22c1-43cc-b5e7-12c5c987fbf2', 'Author', 'author', 'Write content, but not publish or delete it', 30, 1, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('7224f683-fdef-4346-975e-a1a8c595a74c', 'Viewer', 'viewer', 'Read content, change nothing', 10, 1, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('a92f3175-8686-4666-afc3-c3c161a53b36', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, 1, '2026-11-23 04:48:12', '2026-11-23 04:48:12');
INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `is_system`, `created_at`, `updated_at`) VALUES ('d50b40dd-430f-4f35-8c3a-c2a51a838bd8', 'Public', 'public', 'What anyone may do without signing in', 0, 1, '2026-11-23 04:48:13', '2026-11-23 04:48:13');
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
  `layout` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_homepage_slug` (`slug`),
  KEY `idx_single_homepage_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_homepage_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `single_homepage_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `single_homepage` (`id`) ON DELETE CASCADE
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
  `hero` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_single_landing_page_slug` (`slug`),
  KEY `idx_single_landing_page_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE `single_landing_page_locales` (
  `_parent` varchar(36) NOT NULL,
  `_locale` varchar(20) NOT NULL,
  `_updated_at` datetime(3) DEFAULT NULL,
  `_revision` int NOT NULL DEFAULT '1',
  `_changed_by_kind` varchar(16) DEFAULT NULL,
  `_changed_by_id` varchar(255) DEFAULT NULL,
  `_changed_by_principal_kind` varchar(64) DEFAULT NULL,
  `_changed_at` timestamp NULL DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`_parent`,`_locale`),
  CONSTRAINT `single_landing_page_locales_ibfk_1` FOREIGN KEY (`_parent`) REFERENCES `single_landing_page` (`id`) ON DELETE CASCADE
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
  KEY `user_roles_role_id_idx` (`role_id`),
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
