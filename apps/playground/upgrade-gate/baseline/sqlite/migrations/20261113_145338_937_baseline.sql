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
-- Generated at: 2026-11-13T14:53:38.937Z
-- Dialect: SQLite

-- UP
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
CREATE INDEX IF NOT EXISTS "idx_comp_seo_parent" ON "comp_seo" ("_parent_id", "_parent_table", "_parent_field");
CREATE INDEX IF NOT EXISTS "idx_comp_seo_created_at" ON "comp_seo" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_comp_seo_og_image" ON "comp_seo" ("og_image");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_authors_slug" ON "dc_authors" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_authors_created_by" ON "dc_authors" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_authors_created_at" ON "dc_authors" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_authors_avatar" ON "dc_authors" ("avatar");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_block_pages_slug" ON "dc_block_pages" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_block_pages_created_by" ON "dc_block_pages" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_block_pages_created_at" ON "dc_block_pages" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_categories_slug" ON "dc_categories" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_categories_created_by" ON "dc_categories" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_categories_created_at" ON "dc_categories" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_components_slug" ON "dc_components" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_components_created_by" ON "dc_components" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_components_created_at" ON "dc_components" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_form_submissions_slug" ON "dc_form_submissions" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_form_submissions_created_by" ON "dc_form_submissions" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_form_submissions_created_at" ON "dc_form_submissions" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_form_submissions_form" ON "dc_form_submissions" ("form");
CREATE INDEX IF NOT EXISTS "idx_dc_form_submissions_status" ON "dc_form_submissions" ("status");
CREATE INDEX IF NOT EXISTS "idx_dc_form_submissions_submitted_at" ON "dc_form_submissions" ("submitted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_form_submissions_form_response_key_1ak966i" ON "dc_form_submissions" ("form", "response_key");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_forms_slug" ON "dc_forms" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_forms_created_by" ON "dc_forms" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_forms_created_at" ON "dc_forms" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_layouts_slug" ON "dc_layouts" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_layouts_created_by" ON "dc_layouts" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_layouts_created_at" ON "dc_layouts" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_slug" ON "dc_nx_pb_address_claims" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_created_by" ON "dc_nx_pb_address_claims" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_created_at" ON "dc_nx_pb_address_claims" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_nx_pb_address_claims_claim_key" ON "dc_nx_pb_address_claims" ("claim_key");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_kind" ON "dc_nx_pb_address_claims" ("kind");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_holder_collection" ON "dc_nx_pb_address_claims" ("holder_collection");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_holder_id" ON "dc_nx_pb_address_claims" ("holder_id");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_space" ON "dc_nx_pb_address_claims" ("space");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_address_claims_blocked_by" ON "dc_nx_pb_address_claims" ("blocked_by");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_nx_pb_class_usage_slug" ON "dc_nx_pb_class_usage" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_class_usage_created_by" ON "dc_nx_pb_class_usage" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_class_usage_created_at" ON "dc_nx_pb_class_usage" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_class_usage_entity_key" ON "dc_nx_pb_class_usage" ("entity_key");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_class_usage_class_id" ON "dc_nx_pb_class_usage" ("class_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_retired_slug" ON "dc_nx_pb_component_retired" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_retired_created_by" ON "dc_nx_pb_component_retired" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_retired_created_at" ON "dc_nx_pb_component_retired" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_nx_pb_component_retired_identity" ON "dc_nx_pb_component_retired" ("identity");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_retired_component_id" ON "dc_nx_pb_component_retired" ("component_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_usage_slug" ON "dc_nx_pb_component_usage" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_usage_created_by" ON "dc_nx_pb_component_usage" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_usage_created_at" ON "dc_nx_pb_component_usage" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_usage_entity_key" ON "dc_nx_pb_component_usage" ("entity_key");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_component_usage_component_id" ON "dc_nx_pb_component_usage" ("component_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_nx_pb_usage_backfill_slug" ON "dc_nx_pb_usage_backfill" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_usage_backfill_created_by" ON "dc_nx_pb_usage_backfill" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_usage_backfill_created_at" ON "dc_nx_pb_usage_backfill" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_usage_backfill_scope_key" ON "dc_nx_pb_usage_backfill" ("scope_key");
CREATE INDEX IF NOT EXISTS "idx_dc_nx_pb_usage_backfill_generation" ON "dc_nx_pb_usage_backfill" ("generation");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_pages_slug" ON "dc_pages" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_pages_created_by" ON "dc_pages" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_pages_created_at" ON "dc_pages" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_pages_layout" ON "dc_pages" ("layout");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_patterns_slug" ON "dc_patterns" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_patterns_created_by" ON "dc_patterns" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_patterns_created_at" ON "dc_patterns" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_posts_slug" ON "dc_posts" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_posts_created_by" ON "dc_posts" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_posts_created_at" ON "dc_posts" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_dc_posts_featured_image" ON "dc_posts" ("featured_image");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_tags_slug" ON "dc_tags" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_tags_created_by" ON "dc_tags" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_tags_created_at" ON "dc_tags" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dc_templates_slug" ON "dc_templates" ("slug");
CREATE INDEX IF NOT EXISTS "idx_dc_templates_created_by" ON "dc_templates" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_dc_templates_created_at" ON "dc_templates" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_templates_collection" ON "dc_templates" ("collection");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_templates_entry" ON "dc_templates" ("entry");
CREATE INDEX IF NOT EXISTS "idx_dc_templates_entry_collection" ON "dc_templates" ("entry_collection");
CREATE INDEX IF NOT EXISTS "idx_dc_templates_forked_from" ON "dc_templates" ("forked_from");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_templates_address" ON "dc_templates" ("address");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_announcement_slug" ON "single_announcement" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_announcement_created_at" ON "single_announcement" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_homepage_slug" ON "single_homepage" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_homepage_created_at" ON "single_homepage" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_landing_page_slug" ON "single_landing_page" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_landing_page_created_at" ON "single_landing_page" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_page_builder_settings_slug" ON "single_page_builder_settings" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_page_builder_settings_created_at" ON "single_page_builder_settings" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_single_page_builder_settings_default_layout" ON "single_page_builder_settings" ("default_layout");
CREATE INDEX IF NOT EXISTS "idx_single_page_builder_settings_seeded_layout" ON "single_page_builder_settings" ("seeded_layout");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_page_builder_site_code_slug" ON "single_page_builder_site_code" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_page_builder_site_code_created_at" ON "single_page_builder_site_code" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_site_settings_slug" ON "single_site_settings" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_site_settings_created_at" ON "single_site_settings" ("created_at");

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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_single_site_style_slug" ON "single_site_style" ("slug");
CREATE INDEX IF NOT EXISTS "idx_single_site_style_created_at" ON "single_site_style" ("created_at");

-- DOWN
DROP TABLE "single_site_style";

DROP TABLE "single_site_settings";

DROP TABLE "single_page_builder_site_code";

DROP TABLE "single_page_builder_settings";

DROP TABLE "single_landing_page";

DROP TABLE "single_homepage";

DROP TABLE "single_announcement";

DROP TABLE "dc_templates";

DROP TABLE "dc_tags";

DROP TABLE "dc_posts";

DROP TABLE "dc_patterns";

DROP TABLE "dc_pages";

DROP TABLE "dc_nx_pb_usage_backfill";

DROP TABLE "dc_nx_pb_component_usage";

DROP TABLE "dc_nx_pb_component_retired";

DROP TABLE "dc_nx_pb_class_usage";

DROP TABLE "dc_nx_pb_address_claims";

DROP TABLE "dc_layouts";

DROP TABLE "dc_forms";

DROP TABLE "dc_form_submissions";

DROP TABLE "dc_components";

DROP TABLE "dc_categories";

DROP TABLE "dc_block_pages";

DROP TABLE "dc_authors";

DROP TABLE "comp_seo";
