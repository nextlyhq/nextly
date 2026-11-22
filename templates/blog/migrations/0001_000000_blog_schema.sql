-- Migration: Blog Template Schema
-- Description: Creates collections, singles, and junction tables for blog
-- Dialect: postgres
-- Template: blog
-- Version: 1.0

-- ============================================
-- UP: Create all blog schema
-- ============================================

-- ============ COLLECTIONS ============

-- Posts collection
CREATE TABLE IF NOT EXISTS "dc_posts" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "featured_image" text,
  "author" text,
  "byline" text,
  "categories" jsonb,
  "tags" jsonb,
  "published_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "featured" boolean DEFAULT false,
  "seo" jsonb,
  "reading_time" integer,
  "word_count" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- Categories collection
CREATE TABLE IF NOT EXISTS "dc_categories" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- Tags collection
CREATE TABLE IF NOT EXISTS "dc_tags" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- Authors collection: the public profiles a post's byline credits. A post's
-- "author" is the account that owns it; its "byline" is one of these.
CREATE TABLE IF NOT EXISTS "dc_authors" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "avatar" text,
  "account" text,
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- ============ USER EXTENSION TABLE ============

-- user_ext: extends the built-in users table with blog-specific author fields.
-- Structure mirrors what UserExtSchemaService.generateMigrationSQL() produces
-- at runtime so the migration and the runtime schema stay in lockstep.
-- Column names are snake_case of the camelCase field names defined in
-- codefirst.config.ts: bio → bio, avatarUrl → avatar_url, slug → slug.
CREATE TABLE IF NOT EXISTS "user_ext" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "bio" text,
  "avatar_url" text,
  "slug" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "created_by" text
);

-- Unique: one extension row per user
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_ext_user_id"
  ON "user_ext"("user_id");

-- Fast author lookup by slug (used by /authors/[slug] route)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_ext_slug"
  ON "user_ext"("slug");

-- FK: cascade-delete the extension row when the user is deleted
ALTER TABLE "user_ext"
  ADD CONSTRAINT "fk_user_ext_user_id"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- ============ JUNCTION TABLES ============

-- Posts <-> Categories (many-to-many)
CREATE TABLE IF NOT EXISTS "dc_posts_categories" (
  "post_id" text NOT NULL,
  "category_id" text NOT NULL,
  PRIMARY KEY ("post_id", "category_id"),
  CONSTRAINT "fk_posts_categories_post"
    FOREIGN KEY ("post_id") REFERENCES "dc_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_posts_categories_category"
    FOREIGN KEY ("category_id") REFERENCES "dc_categories"("id") ON DELETE CASCADE
);

-- Posts <-> Tags (many-to-many)
CREATE TABLE IF NOT EXISTS "dc_posts_tags" (
  "post_id" text NOT NULL,
  "tag_id" text NOT NULL,
  PRIMARY KEY ("post_id", "tag_id"),
  CONSTRAINT "fk_posts_tags_post"
    FOREIGN KEY ("post_id") REFERENCES "dc_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_posts_tags_tag"
    FOREIGN KEY ("tag_id") REFERENCES "dc_tags"("id") ON DELETE CASCADE
);

-- ============ SINGLES ============
-- Note: All single tables include system columns (id, title, slug, created_at, updated_at)
-- and use snake_case column names for all fields (e.g., hero_title not heroTitle).

-- Site Settings single
CREATE TABLE "single_site_settings" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "title" text NOT NULL DEFAULT 'Site Settings',
  "slug" text NOT NULL DEFAULT 'site-settings',
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "logo" text,
  "social" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- Navigation single
CREATE TABLE "single_navigation" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "title" text NOT NULL DEFAULT 'Navigation',
  "slug" text NOT NULL DEFAULT 'navigation',
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "header_links" jsonb,
  "footer_read_links" jsonb,
  "show_theme_toggle" boolean DEFAULT true,
  "show_search_icon" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- Homepage single
CREATE TABLE "single_homepage" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "title" text NOT NULL DEFAULT 'Homepage',
  "slug" text NOT NULL DEFAULT 'homepage',
  "status" text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" timestamp with time zone,
  "show_featured_post" boolean DEFAULT true,
  "show_latest_posts" boolean DEFAULT true,
  "latest_posts_count" integer DEFAULT 3,
  "show_category_strip" boolean DEFAULT true,
  "show_newsletter_cta" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" text
);

-- ============ TRANSLATIONS TABLES ============
-- Every installation keeps its translatable fields (text, rich text) per language, each
-- entity's in a `<table>_locales` table: one row per document and language, keyed by
-- `_parent` and `_locale`. The main tables above hold the shared fields only. These
-- statements are the ones `nextly migrate:create` writes for the same fields; a slug is
-- unique within each language. The Navigation single has no translatable field, so it
-- has no translations table.

CREATE TABLE IF NOT EXISTS "dc_posts_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "slug" TEXT,
  "content" TEXT,
  "excerpt" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_posts" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_posts_locales_slug__locale_1mvq6jl" ON "dc_posts_locales" (NULLIF("slug", ''), "_locale");

CREATE TABLE IF NOT EXISTS "dc_categories_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "icon" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_categories" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_categories_locales_slug__locale_1mvq6jl" ON "dc_categories_locales" (NULLIF("slug", ''), "_locale");

CREATE TABLE IF NOT EXISTS "dc_tags_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_tags" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_tags_locales_slug__locale_1mvq6jl" ON "dc_tags_locales" (NULLIF("slug", ''), "_locale");

CREATE TABLE IF NOT EXISTS "dc_authors_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "bio" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_authors" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_authors_locales_slug__locale_1mvq6jl" ON "dc_authors_locales" (NULLIF("slug", ''), "_locale");

CREATE TABLE "single_site_settings_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "site_name" TEXT,
  "tagline" TEXT,
  "site_description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_site_settings" ("id") ON DELETE CASCADE
);

CREATE TABLE "single_homepage_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" TIMESTAMPTZ,
  "_revision" int4 DEFAULT 1 NOT NULL,
  "_changed_by_kind" varchar(16),
  "_changed_by_id" text,
  "_changed_by_principal_kind" varchar(64),
  "_changed_at" timestamp,
  "hero_title" TEXT,
  "hero_subtitle" TEXT,
  "featured_section_title" TEXT,
  "latest_section_title" TEXT,
  "newsletter_heading" TEXT,
  "newsletter_subheading" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_homepage" ("id") ON DELETE CASCADE
);

-- ============ INDEXES ============

-- Posts indexes
CREATE INDEX IF NOT EXISTS "idx_posts_status" ON "dc_posts"("status");
CREATE INDEX IF NOT EXISTS "idx_posts_published" ON "dc_posts"("published_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_posts_featured" ON "dc_posts"("featured") WHERE "featured" = true;
CREATE INDEX IF NOT EXISTS "idx_posts_author" ON "dc_posts"("author");
CREATE INDEX IF NOT EXISTS "idx_posts_byline" ON "dc_posts"("byline");

-- Categories indexes

-- Tags indexes

-- Authors indexes
-- One profile per account: a new post is credited to its writer's profile.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_authors_account" ON "dc_authors"("account");

-- Junction table indexes (FK columns not covered by composite PK)
CREATE INDEX IF NOT EXISTS "idx_posts_categories_category" ON "dc_posts_categories"("category_id");
CREATE INDEX IF NOT EXISTS "idx_posts_tags_tag" ON "dc_posts_tags"("tag_id");

-- Singles indexes (slug columns)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_single_site_settings_slug" ON "single_site_settings"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_single_navigation_slug" ON "single_navigation"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_single_homepage_slug" ON "single_homepage"("slug");

-- ============ FOREIGN KEY RELATIONSHIPS ============

-- Posts featured_image -> media (text FK — media.id is text in the core schema)
ALTER TABLE "dc_posts"
ADD CONSTRAINT "fk_posts_featured_image"
FOREIGN KEY ("featured_image") REFERENCES "media"("id") ON DELETE SET NULL;

-- Posts author -> users (text FK — users.id is text in the core schema)
ALTER TABLE "dc_posts"
ADD CONSTRAINT "fk_posts_author"
FOREIGN KEY ("author") REFERENCES "users"("id") ON DELETE SET NULL;

-- Posts byline -> authors: a post whose profile is deleted keeps no dangling credit
ALTER TABLE "dc_posts"
ADD CONSTRAINT "fk_posts_byline"
FOREIGN KEY ("byline") REFERENCES "dc_authors"("id") ON DELETE SET NULL;

-- Authors avatar -> media, and account -> users, as posts' own
ALTER TABLE "dc_authors"
ADD CONSTRAINT "fk_authors_avatar"
FOREIGN KEY ("avatar") REFERENCES "media"("id") ON DELETE SET NULL;

ALTER TABLE "dc_authors"
ADD CONSTRAINT "fk_authors_account"
FOREIGN KEY ("account") REFERENCES "users"("id") ON DELETE SET NULL;

-- Site Settings logo -> media (text FK — media.id is text in the core schema)
ALTER TABLE "single_site_settings"
ADD CONSTRAINT "fk_site_settings_logo"
FOREIGN KEY ("logo") REFERENCES "media"("id") ON DELETE SET NULL;

-- ============ SINGLES DATA DEFAULTS ============
-- The tables above are created without IF NOT EXISTS: this file made them, so the
-- rows written here reach no table that was already there, and `nextly migrate`
-- does not have to ask for consent before writing them.
-- Insert default documents for each single so they're accessible immediately
INSERT INTO "single_site_settings" ("id", "title", "slug", "status", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Site Settings', 'site-settings', 'published', now(), now()) ON CONFLICT DO NOTHING;
INSERT INTO "single_site_settings_locales" ("_parent", "_locale", "site_name", "tagline")
SELECT "id", 'en', 'My Blog', 'Thoughts on web development' FROM "single_site_settings" WHERE "slug" = 'site-settings' ON CONFLICT DO NOTHING;

INSERT INTO "single_navigation" ("id", "title", "slug", "status", "show_theme_toggle", "show_search_icon", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Navigation', 'navigation', 'published', true, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "single_homepage" ("id", "title", "slug", "status", "show_featured_post", "show_latest_posts", "latest_posts_count", "show_category_strip", "show_newsletter_cta", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Homepage', 'homepage', 'published', true, true, 3, true, true, now(), now()) ON CONFLICT DO NOTHING;
INSERT INTO "single_homepage_locales" ("_parent", "_locale", "hero_title", "hero_subtitle", "featured_section_title", "latest_section_title", "newsletter_heading", "newsletter_subheading")
SELECT "id", 'en', 'Ideas on building, shipping, and surviving software.', 'Essays and notes from our engineering team.', 'Featured', 'Latest', 'Get new posts in your inbox', 'No spam. Unsubscribe anytime.' FROM "single_homepage" WHERE "slug" = 'homepage' ON CONFLICT DO NOTHING;

-- ============================================
-- DOWN: Rollback all changes
-- ============================================

-- Drop foreign keys first
ALTER TABLE "dc_posts" DROP CONSTRAINT IF EXISTS "fk_posts_author";
ALTER TABLE "dc_posts" DROP CONSTRAINT IF EXISTS "fk_posts_featured_image";
ALTER TABLE "dc_posts" DROP CONSTRAINT IF EXISTS "fk_posts_byline";
ALTER TABLE "dc_authors" DROP CONSTRAINT IF EXISTS "fk_authors_avatar";
ALTER TABLE "dc_authors" DROP CONSTRAINT IF EXISTS "fk_authors_account";
ALTER TABLE "single_site_settings" DROP CONSTRAINT IF EXISTS "fk_site_settings_logo";
ALTER TABLE "user_ext" DROP CONSTRAINT IF EXISTS "fk_user_ext_user_id";

-- Drop indexes
DROP INDEX IF EXISTS "idx_posts_slug";
DROP INDEX IF EXISTS "idx_posts_status";
DROP INDEX IF EXISTS "idx_posts_published";
DROP INDEX IF EXISTS "idx_posts_featured";
DROP INDEX IF EXISTS "idx_posts_author";
DROP INDEX IF EXISTS "idx_posts_byline";
DROP INDEX IF EXISTS "idx_authors_slug";
DROP INDEX IF EXISTS "uq_authors_account";
DROP INDEX IF EXISTS "idx_categories_slug";
DROP INDEX IF EXISTS "idx_tags_slug";
DROP INDEX IF EXISTS "idx_posts_categories_category";
DROP INDEX IF EXISTS "idx_posts_tags_tag";
DROP INDEX IF EXISTS "uq_user_ext_user_id";
DROP INDEX IF EXISTS "uq_user_ext_slug";
DROP INDEX IF EXISTS "uq_single_site_settings_slug";
DROP INDEX IF EXISTS "uq_single_navigation_slug";
DROP INDEX IF EXISTS "uq_single_homepage_slug";

-- Drop junction tables first (depend on dc_posts, dc_categories, dc_tags)
DROP TABLE IF EXISTS "dc_posts_categories" CASCADE;
DROP TABLE IF EXISTS "dc_posts_tags" CASCADE;

-- Drop user extension table (depends on users)
DROP TABLE IF EXISTS "user_ext" CASCADE;

-- Drop tables (singles first, then collections)
-- Drop the translations tables (depend on their main tables)
DROP TABLE IF EXISTS "single_homepage_locales";
DROP TABLE IF EXISTS "single_site_settings_locales";
DROP TABLE IF EXISTS "dc_tags_locales";
DROP TABLE IF EXISTS "dc_authors_locales";
DROP TABLE IF EXISTS "dc_categories_locales";
DROP TABLE IF EXISTS "dc_posts_locales";

DROP TABLE IF EXISTS "single_homepage" CASCADE;
DROP TABLE IF EXISTS "single_navigation" CASCADE;
DROP TABLE IF EXISTS "single_site_settings" CASCADE;
DROP TABLE IF EXISTS "dc_tags" CASCADE;
DROP TABLE IF EXISTS "dc_authors" CASCADE;
DROP TABLE IF EXISTS "dc_categories" CASCADE;
DROP TABLE IF EXISTS "dc_posts" CASCADE;
