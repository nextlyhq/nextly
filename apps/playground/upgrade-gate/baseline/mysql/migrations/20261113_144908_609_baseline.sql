-- Migration: baseline
-- Collections: authors, block-pages, categories, components, form-submissions, forms, layouts, nx_pb_address_claims, nx_pb_class_usage, nx_pb_component_retired, nx_pb_component_usage, nx_pb_usage_backfill, pages, patterns, posts, tags, templates
-- Singles: announcement, homepage, landing-page, page-builder-settings, page-builder-site-code, site-settings, site-style
-- Field groups: seo
-- Entity scope: touched
-- Settings: authors: added
-- Settings: block-pages: added
-- Settings: categories: added
-- Settings: components: added
-- Settings: form-submissions: added
-- Settings: forms: added
-- Settings: layouts: added
-- Settings: nx_pb_address_claims: added
-- Settings: nx_pb_class_usage: added
-- Settings: nx_pb_component_retired: added
-- Settings: nx_pb_component_usage: added
-- Settings: nx_pb_usage_backfill: added
-- Settings: pages: added
-- Settings: patterns: added
-- Settings: posts: added
-- Settings: tags: added
-- Settings: templates: added
-- Settings: announcement (single): added
-- Settings: homepage (single): added
-- Settings: landing-page (single): added
-- Settings: page-builder-settings (single): added
-- Settings: page-builder-site-code (single): added
-- Settings: site-settings (single): added
-- Settings: site-style (single): added
-- Settings: seo (field group): added
-- Permissions: @nextlyhq/plugin-form-builder: + export-submissions
-- Permissions: @nextlyhq/plugin-page-builder: + lock-page-builder-shared-styles, + manage-page-builder-site, + manage-template-routing
-- Generated at: 2026-11-13T14:49:08.609Z
-- Dialect: MySQL

-- UP
CREATE TABLE `comp_seo` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `_parent_id` varchar(36) NOT NULL,
  `_parent_table` varchar(255) NOT NULL,
  `_parent_field` varchar(255) NOT NULL,
  `_order` int(11) DEFAULT 0,
  `_component_type` varchar(255),
  `og_image` varchar(36),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX `idx_comp_seo_parent` ON `comp_seo` (`_parent_id`, `_parent_table`, `_parent_field`);
CREATE INDEX `idx_comp_seo_created_at` ON `comp_seo` (`created_at`);
CREATE INDEX `idx_comp_seo_og_image` ON `comp_seo` (`og_image`);

CREATE TABLE `dc_authors` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `article_count` int,
  `avatar` varchar(36)
);
CREATE UNIQUE INDEX `idx_dc_authors_slug` ON `dc_authors` (`slug`);
CREATE INDEX `idx_dc_authors_created_by` ON `dc_authors` (`created_by`);
CREATE INDEX `idx_dc_authors_created_at` ON `dc_authors` (`created_at`);
CREATE INDEX `idx_dc_authors_avatar` ON `dc_authors` (`avatar`);

CREATE TABLE `dc_block_pages` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `content` json
);
CREATE UNIQUE INDEX `idx_dc_block_pages_slug` ON `dc_block_pages` (`slug`);
CREATE INDEX `idx_dc_block_pages_created_by` ON `dc_block_pages` (`created_by`);
CREATE INDEX `idx_dc_block_pages_created_at` ON `dc_block_pages` (`created_at`);

CREATE TABLE `dc_categories` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `icon` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_categories_slug` ON `dc_categories` (`slug`);
CREATE INDEX `idx_dc_categories_created_by` ON `dc_categories` (`created_by`);
CREATE INDEX `idx_dc_categories_created_at` ON `dc_categories` (`created_at`);

CREATE TABLE `dc_components` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(255),
  `area` varchar(255),
  `content` json
);
CREATE UNIQUE INDEX `idx_dc_components_slug` ON `dc_components` (`slug`);
CREATE INDEX `idx_dc_components_created_by` ON `dc_components` (`created_by`);
CREATE INDEX `idx_dc_components_created_at` ON `dc_components` (`created_at`);

CREATE TABLE `dc_form_submissions` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `form` varchar(36),
  `data` json NOT NULL,
  `status` varchar(255) NOT NULL,
  `spam_reason` varchar(255),
  `notes` text,
  `ip_address` varchar(255),
  `user_agent` varchar(255),
  `submitted_at` timestamp NOT NULL,
  `edited_at` timestamp,
  `edited_by` varchar(255),
  `response_key` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_form_submissions_slug` ON `dc_form_submissions` (`slug`);
CREATE INDEX `idx_dc_form_submissions_created_by` ON `dc_form_submissions` (`created_by`);
CREATE INDEX `idx_dc_form_submissions_created_at` ON `dc_form_submissions` (`created_at`);
CREATE INDEX `idx_dc_form_submissions_form` ON `dc_form_submissions` (`form`);
CREATE INDEX `idx_dc_form_submissions_status` ON `dc_form_submissions` (`status`);
CREATE INDEX `idx_dc_form_submissions_submitted_at` ON `dc_form_submissions` (`submitted_at`);
CREATE UNIQUE INDEX `uq_dc_form_submissions_form_response_key_1ak966i` ON `dc_form_submissions` (`form`, `response_key`);

CREATE TABLE `dc_forms` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `fields` json NOT NULL,
  `settings` json,
  `notifications` json,
  `status` varchar(255) NOT NULL,
  `went_live_at` timestamp,
  `closed_message` text
);
CREATE UNIQUE INDEX `idx_dc_forms_slug` ON `dc_forms` (`slug`);
CREATE INDEX `idx_dc_forms_created_by` ON `dc_forms` (`created_by`);
CREATE INDEX `idx_dc_forms_created_at` ON `dc_forms` (`created_at`);

CREATE TABLE `dc_layouts` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `areas` json
);
CREATE UNIQUE INDEX `idx_dc_layouts_slug` ON `dc_layouts` (`slug`);
CREATE INDEX `idx_dc_layouts_created_by` ON `dc_layouts` (`created_by`);
CREATE INDEX `idx_dc_layouts_created_at` ON `dc_layouts` (`created_at`);

CREATE TABLE `dc_nx_pb_address_claims` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `claim_key` varchar(255) NOT NULL,
  `kind` varchar(255) NOT NULL,
  `locale` varchar(255),
  `path` text,
  `holder_collection` varchar(255),
  `holder_id` varchar(255),
  `space` varchar(255),
  `blocked_by` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_nx_pb_address_claims_slug` ON `dc_nx_pb_address_claims` (`slug`);
CREATE INDEX `idx_dc_nx_pb_address_claims_created_by` ON `dc_nx_pb_address_claims` (`created_by`);
CREATE INDEX `idx_dc_nx_pb_address_claims_created_at` ON `dc_nx_pb_address_claims` (`created_at`);
CREATE UNIQUE INDEX `uq_dc_nx_pb_address_claims_claim_key` ON `dc_nx_pb_address_claims` (`claim_key`);
CREATE INDEX `idx_dc_nx_pb_address_claims_kind` ON `dc_nx_pb_address_claims` (`kind`);
CREATE INDEX `idx_dc_nx_pb_address_claims_holder_collection` ON `dc_nx_pb_address_claims` (`holder_collection`);
CREATE INDEX `idx_dc_nx_pb_address_claims_holder_id` ON `dc_nx_pb_address_claims` (`holder_id`);
CREATE INDEX `idx_dc_nx_pb_address_claims_space` ON `dc_nx_pb_address_claims` (`space`);
CREATE INDEX `idx_dc_nx_pb_address_claims_blocked_by` ON `dc_nx_pb_address_claims` (`blocked_by`);

CREATE TABLE `dc_nx_pb_class_usage` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope` varchar(255),
  `entity` varchar(255),
  `entity_key` varchar(255),
  `field` varchar(255),
  `locale` varchar(255),
  `variant` varchar(255),
  `class_id` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_nx_pb_class_usage_slug` ON `dc_nx_pb_class_usage` (`slug`);
CREATE INDEX `idx_dc_nx_pb_class_usage_created_by` ON `dc_nx_pb_class_usage` (`created_by`);
CREATE INDEX `idx_dc_nx_pb_class_usage_created_at` ON `dc_nx_pb_class_usage` (`created_at`);
CREATE INDEX `idx_dc_nx_pb_class_usage_entity_key` ON `dc_nx_pb_class_usage` (`entity_key`);
CREATE INDEX `idx_dc_nx_pb_class_usage_class_id` ON `dc_nx_pb_class_usage` (`class_id`);

CREATE TABLE `dc_nx_pb_component_retired` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `identity` varchar(255) NOT NULL,
  `component_id` varchar(255) NOT NULL,
  `kind` varchar(255) NOT NULL,
  `exposure_id` text NOT NULL
);
CREATE UNIQUE INDEX `idx_dc_nx_pb_component_retired_slug` ON `dc_nx_pb_component_retired` (`slug`);
CREATE INDEX `idx_dc_nx_pb_component_retired_created_by` ON `dc_nx_pb_component_retired` (`created_by`);
CREATE INDEX `idx_dc_nx_pb_component_retired_created_at` ON `dc_nx_pb_component_retired` (`created_at`);
CREATE UNIQUE INDEX `uq_dc_nx_pb_component_retired_identity` ON `dc_nx_pb_component_retired` (`identity`);
CREATE INDEX `idx_dc_nx_pb_component_retired_component_id` ON `dc_nx_pb_component_retired` (`component_id`);

CREATE TABLE `dc_nx_pb_component_usage` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope` varchar(255),
  `entity` varchar(255),
  `entity_key` varchar(255),
  `field` varchar(255),
  `locale` varchar(255),
  `variant` varchar(255),
  `kind` varchar(255),
  `component_id` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_nx_pb_component_usage_slug` ON `dc_nx_pb_component_usage` (`slug`);
CREATE INDEX `idx_dc_nx_pb_component_usage_created_by` ON `dc_nx_pb_component_usage` (`created_by`);
CREATE INDEX `idx_dc_nx_pb_component_usage_created_at` ON `dc_nx_pb_component_usage` (`created_at`);
CREATE INDEX `idx_dc_nx_pb_component_usage_entity_key` ON `dc_nx_pb_component_usage` (`entity_key`);
CREATE INDEX `idx_dc_nx_pb_component_usage_component_id` ON `dc_nx_pb_component_usage` (`component_id`);

CREATE TABLE `dc_nx_pb_usage_backfill` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `scope_key` varchar(255),
  `generation` varchar(255)
);
CREATE UNIQUE INDEX `idx_dc_nx_pb_usage_backfill_slug` ON `dc_nx_pb_usage_backfill` (`slug`);
CREATE INDEX `idx_dc_nx_pb_usage_backfill_created_by` ON `dc_nx_pb_usage_backfill` (`created_by`);
CREATE INDEX `idx_dc_nx_pb_usage_backfill_created_at` ON `dc_nx_pb_usage_backfill` (`created_at`);
CREATE INDEX `idx_dc_nx_pb_usage_backfill_scope_key` ON `dc_nx_pb_usage_backfill` (`scope_key`);
CREATE INDEX `idx_dc_nx_pb_usage_backfill_generation` ON `dc_nx_pb_usage_backfill` (`generation`);

CREATE TABLE `dc_pages` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `content` json,
  `layout` varchar(36),
  `no_header_footer` tinyint(1)
);
CREATE UNIQUE INDEX `idx_dc_pages_slug` ON `dc_pages` (`slug`);
CREATE INDEX `idx_dc_pages_created_by` ON `dc_pages` (`created_by`);
CREATE INDEX `idx_dc_pages_created_at` ON `dc_pages` (`created_at`);
CREATE INDEX `idx_dc_pages_layout` ON `dc_pages` (`layout`);

CREATE TABLE `dc_patterns` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(255),
  `keywords` varchar(255),
  `granularity` varchar(255) NOT NULL,
  `content` json
);
CREATE UNIQUE INDEX `idx_dc_patterns_slug` ON `dc_patterns` (`slug`);
CREATE INDEX `idx_dc_patterns_created_by` ON `dc_patterns` (`created_by`);
CREATE INDEX `idx_dc_patterns_created_at` ON `dc_patterns` (`created_at`);

CREATE TABLE `dc_posts` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `excerpt` text,
  `meta_title` varchar(255),
  `meta_description` varchar(255),
  `editor_mode` varchar(255),
  `content` text,
  `custom_script` text,
  `settings` json,
  `sections` json,
  `categories` json,
  `tags` json,
  `featured_image` varchar(36),
  `published_at` timestamp
);
CREATE UNIQUE INDEX `idx_dc_posts_slug` ON `dc_posts` (`slug`);
CREATE INDEX `idx_dc_posts_created_by` ON `dc_posts` (`created_by`);
CREATE INDEX `idx_dc_posts_created_at` ON `dc_posts` (`created_at`);
CREATE INDEX `idx_dc_posts_featured_image` ON `dc_posts` (`featured_image`);

CREATE TABLE `dc_tags` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `description` text
);
CREATE UNIQUE INDEX `idx_dc_tags_slug` ON `dc_tags` (`slug`);
CREATE INDEX `idx_dc_tags_created_by` ON `dc_tags` (`created_by`);
CREATE INDEX `idx_dc_tags_created_at` ON `dc_tags` (`created_at`);

CREATE TABLE `dc_templates` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `created_by` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `collection` varchar(255),
  `entry` varchar(255),
  `entry_collection` varchar(255),
  `entry_id` varchar(255),
  `forked_from` varchar(255),
  `address` varchar(255),
  `content` json
);
CREATE UNIQUE INDEX `idx_dc_templates_slug` ON `dc_templates` (`slug`);
CREATE INDEX `idx_dc_templates_created_by` ON `dc_templates` (`created_by`);
CREATE INDEX `idx_dc_templates_created_at` ON `dc_templates` (`created_at`);
CREATE UNIQUE INDEX `uq_dc_templates_collection` ON `dc_templates` (`collection`);
CREATE UNIQUE INDEX `uq_dc_templates_entry` ON `dc_templates` (`entry`);
CREATE INDEX `idx_dc_templates_entry_collection` ON `dc_templates` (`entry_collection`);
CREATE INDEX `idx_dc_templates_forked_from` ON `dc_templates` (`forked_from`);
CREATE UNIQUE INDEX `uq_dc_templates_address` ON `dc_templates` (`address`);

CREATE TABLE `single_announcement` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `campaign` varchar(255)
);
CREATE UNIQUE INDEX `idx_single_announcement_slug` ON `single_announcement` (`slug`);
CREATE INDEX `idx_single_announcement_created_at` ON `single_announcement` (`created_at`);

CREATE TABLE `single_homepage` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255),
  `layout` json
);
CREATE UNIQUE INDEX `idx_single_homepage_slug` ON `single_homepage` (`slug`);
CREATE INDEX `idx_single_homepage_created_at` ON `single_homepage` (`created_at`);

CREATE TABLE `single_landing_page` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `first_published_at` timestamp,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `slug` varchar(255) NOT NULL,
  `title` varchar(255),
  `hero` json
);
CREATE UNIQUE INDEX `idx_single_landing_page_slug` ON `single_landing_page` (`slug`);
CREATE INDEX `idx_single_landing_page_created_at` ON `single_landing_page` (`created_at`);

CREATE TABLE `single_page_builder_settings` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `default_layout` varchar(36),
  `seeded_layout` varchar(36),
  `default_layout_changed_by` varchar(255)
);
CREATE UNIQUE INDEX `idx_single_page_builder_settings_slug` ON `single_page_builder_settings` (`slug`);
CREATE INDEX `idx_single_page_builder_settings_created_at` ON `single_page_builder_settings` (`created_at`);
CREATE INDEX `idx_single_page_builder_settings_default_layout` ON `single_page_builder_settings` (`default_layout`);
CREATE INDEX `idx_single_page_builder_settings_seeded_layout` ON `single_page_builder_settings` (`seeded_layout`);

CREATE TABLE `single_page_builder_site_code` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `head_source` text,
  `body_source` text,
  `head` json,
  `body` json,
  `changed_by` varchar(255)
);
CREATE UNIQUE INDEX `idx_single_page_builder_site_code_slug` ON `single_page_builder_site_code` (`slug`);
CREATE INDEX `idx_single_page_builder_site_code_created_at` ON `single_page_builder_site_code` (`created_at`);

CREATE TABLE `single_site_settings` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `site_name` varchar(255) NOT NULL
);
CREATE UNIQUE INDEX `idx_single_site_settings_slug` ON `single_site_settings` (`slug`);
CREATE INDEX `idx_single_site_settings_created_at` ON `single_site_settings` (`created_at`);

CREATE TABLE `single_site_style` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `_revision` int NOT NULL DEFAULT 1,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `tokens` json,
  `fonts` json,
  `classes` json,
  `breakpoints` json
);
CREATE UNIQUE INDEX `idx_single_site_style_slug` ON `single_site_style` (`slug`);
CREATE INDEX `idx_single_site_style_created_at` ON `single_site_style` (`created_at`);

-- DOWN
DROP TABLE `single_site_style`;

DROP TABLE `single_site_settings`;

DROP TABLE `single_page_builder_site_code`;

DROP TABLE `single_page_builder_settings`;

DROP TABLE `single_landing_page`;

DROP TABLE `single_homepage`;

DROP TABLE `single_announcement`;

DROP TABLE `dc_templates`;

DROP TABLE `dc_tags`;

DROP TABLE `dc_posts`;

DROP TABLE `dc_patterns`;

DROP TABLE `dc_pages`;

DROP TABLE `dc_nx_pb_usage_backfill`;

DROP TABLE `dc_nx_pb_component_usage`;

DROP TABLE `dc_nx_pb_component_retired`;

DROP TABLE `dc_nx_pb_class_usage`;

DROP TABLE `dc_nx_pb_address_claims`;

DROP TABLE `dc_layouts`;

DROP TABLE `dc_forms`;

DROP TABLE `dc_form_submissions`;

DROP TABLE `dc_components`;

DROP TABLE `dc_categories`;

DROP TABLE `dc_block_pages`;

DROP TABLE `dc_authors`;

DROP TABLE `comp_seo`;
