-- Migration: Blog Template Schema
-- Description: Creates collections, singles, and junction tables for blog
-- Dialect: sqlite
-- Template: blog
-- Version: 1.0

-- ============================================
-- UP: Create all blog schema
-- ============================================

-- ============ COLLECTIONS ============

-- Posts collection
CREATE TABLE IF NOT EXISTS "dc_posts" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "featured_image" TEXT,
  "author" TEXT,
  "byline" TEXT,
  "categories" TEXT,
  "tags" TEXT,
  "published_at" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "featured" INTEGER DEFAULT 0,
  "seo" TEXT,
  "reading_time" INTEGER,
  "word_count" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT,
  -- A post whose author profile is deleted keeps no dangling credit.
  CONSTRAINT "fk_posts_byline" FOREIGN KEY ("byline") REFERENCES "dc_authors"("id") ON DELETE SET NULL
);

-- Categories collection
CREATE TABLE IF NOT EXISTS "dc_categories" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Tags collection
CREATE TABLE IF NOT EXISTS "dc_tags" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Authors collection: the public profiles a post's byline credits. A post's
-- "author" is the account that owns it; its "byline" is one of these.
CREATE TABLE IF NOT EXISTS "dc_authors" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "avatar" TEXT,
  "account" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT,
  -- Inline, as SQLite adds a key only when its table is made (text keys:
  -- media.id and users.id are text in the core schema).
  CONSTRAINT "fk_authors_avatar" FOREIGN KEY ("avatar") REFERENCES "media"("id") ON DELETE SET NULL,
  CONSTRAINT "fk_authors_account" FOREIGN KEY ("account") REFERENCES "users"("id") ON DELETE SET NULL
);

-- ============ USER EXTENSION TABLE ============

-- user_ext: extends the built-in users table with blog-specific author fields.
-- Structure mirrors what UserExtSchemaService.generateMigrationSQL() produces
-- at runtime so the migration and the runtime schema stay in lockstep.
-- Column names are snake_case of the camelCase field names defined in
-- codefirst.config.ts: bio → bio, avatarUrl → avatar_url, slug → slug.
CREATE TABLE IF NOT EXISTS "user_ext" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "bio" TEXT,
  "avatar_url" TEXT,
  "slug" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Unique: one extension row per user
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_ext_user_id" ON "user_ext"("user_id");

-- Fast author lookup by slug (used by /authors/[slug] route)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_ext_slug" ON "user_ext"("slug");

-- FK: cascade-delete the extension row when the user is deleted
-- SQLite doesn't support FK constraints in the same statement; add via ALTER TABLE
-- Note: FKs in SQLite require PRAGMA foreign_keys = ON to be enforced

-- ============ JUNCTION TABLES ============

-- Posts <-> Categories (many-to-many)
CREATE TABLE IF NOT EXISTS "dc_posts_categories" (
  "post_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  PRIMARY KEY ("post_id", "category_id"),
  CONSTRAINT "fk_posts_categories_post" FOREIGN KEY ("post_id") REFERENCES "dc_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_posts_categories_category" FOREIGN KEY ("category_id") REFERENCES "dc_categories"("id") ON DELETE CASCADE
);

-- Posts <-> Tags (many-to-many)
CREATE TABLE IF NOT EXISTS "dc_posts_tags" (
  "post_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  PRIMARY KEY ("post_id", "tag_id"),
  CONSTRAINT "fk_posts_tags_post" FOREIGN KEY ("post_id") REFERENCES "dc_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_posts_tags_tag" FOREIGN KEY ("tag_id") REFERENCES "dc_tags"("id") ON DELETE CASCADE
);

-- ============ SINGLES ============
-- Note: All single tables include system columns (id, title, slug, created_at, updated_at)
-- and use snake_case column names for all fields (e.g., hero_title not heroTitle).

-- Site Settings single
CREATE TABLE "single_site_settings" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Site Settings',
  "slug" TEXT NOT NULL DEFAULT 'site-settings',
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "logo" TEXT,
  "social" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Navigation single
CREATE TABLE "single_navigation" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Navigation',
  "slug" TEXT NOT NULL DEFAULT 'navigation',
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "header_links" TEXT,
  "footer_read_links" TEXT,
  "show_theme_toggle" INTEGER DEFAULT 1,
  "show_search_icon" INTEGER DEFAULT 1,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Homepage single
CREATE TABLE "single_homepage" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Homepage',
  "slug" TEXT NOT NULL DEFAULT 'homepage',
  "status" TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "first_published_at" INTEGER,
  "show_featured_post" INTEGER DEFAULT 1,
  "show_latest_posts" INTEGER DEFAULT 1,
  "latest_posts_count" INTEGER DEFAULT 3,
  "show_category_strip" INTEGER DEFAULT 1,
  "show_newsletter_cta" INTEGER DEFAULT 1,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
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
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "slug" TEXT,
  "content" TEXT,
  "excerpt" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_posts" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_posts_locales_slug__locale_1mvq6jl" ON "dc_posts_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';

CREATE TABLE IF NOT EXISTS "dc_categories_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "icon" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_categories" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_categories_locales_slug__locale_1mvq6jl" ON "dc_categories_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';

CREATE TABLE IF NOT EXISTS "dc_tags_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_tags" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_tags_locales_slug__locale_1mvq6jl" ON "dc_tags_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';

CREATE TABLE IF NOT EXISTS "dc_authors_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "title" TEXT,
  "name" TEXT,
  "slug" TEXT,
  "bio" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "dc_authors" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_authors_locales_slug__locale_1mvq6jl" ON "dc_authors_locales" ("slug", "_locale") WHERE "slug" IS NOT NULL AND "slug" <> '';

CREATE TABLE "single_site_settings_locales" (
  "_parent" TEXT NOT NULL,
  "_locale" VARCHAR(20) NOT NULL,
  "_updated_at" INTEGER,
  "_revision" integer DEFAULT 1 NOT NULL,
  "_changed_by_kind" text,
  "_changed_by_id" text,
  "_changed_by_principal_kind" text,
  "_changed_at" integer,
  "site_name" TEXT,
  "tagline" TEXT,
  "site_description" TEXT,
  PRIMARY KEY ("_parent", "_locale"),
  FOREIGN KEY ("_parent") REFERENCES "single_site_settings" ("id") ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS "idx_posts_featured" ON "dc_posts"("featured") WHERE "featured" = 1;
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
-- SQLite requires ALTER TABLE to add FKs after table creation
-- Note: FKs in SQLite require PRAGMA foreign_keys = ON to be enforced

-- Posts author -> users (text FK — users.id is text in the core schema)
-- Note: Adding FKs to existing columns in SQLite requires recreating the table
-- For simplicity, we rely on application-level constraints for SQLite

-- Site Settings logo -> media (text FK — media.id is text in the core schema)
-- Note: Same as above, application-level constraints for SQLite

-- Note: Foreign keys are added at runtime for SQLite via the adapter
-- The core schema handles FK creation automatically

-- ============ SINGLES DATA DEFAULTS ============
-- The tables above are created without IF NOT EXISTS: this file made them, so the
-- rows written here reach no table that was already there, and `nextly migrate`
-- does not have to ask for consent before writing them.
-- Insert default documents for each single so they're accessible immediately
-- SQLite uses INSERT OR IGNORE instead of ON CONFLICT DO NOTHING
INSERT OR IGNORE INTO "single_site_settings" ("id", "title", "slug", "status", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Site Settings', 'site-settings', 'published', strftime('%s', 'now'), strftime('%s', 'now'));
INSERT OR IGNORE INTO "single_site_settings_locales" ("_parent", "_locale", "site_name", "tagline")
SELECT "id", 'en', 'My Blog', 'Thoughts on web development' FROM "single_site_settings" WHERE "slug" = 'site-settings';

INSERT OR IGNORE INTO "single_navigation" ("id", "title", "slug", "status", "show_theme_toggle", "show_search_icon", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Navigation', 'navigation', 'published', 1, 1, strftime('%s', 'now'), strftime('%s', 'now'));

INSERT OR IGNORE INTO "single_homepage" ("id", "title", "slug", "status", "show_featured_post", "show_latest_posts", "latest_posts_count", "show_category_strip", "show_newsletter_cta", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Homepage', 'homepage', 'published', 1, 1, 3, 1, 1, strftime('%s', 'now'), strftime('%s', 'now'));
INSERT OR IGNORE INTO "single_homepage_locales" ("_parent", "_locale", "hero_title", "hero_subtitle", "featured_section_title", "latest_section_title", "newsletter_heading", "newsletter_subheading")
SELECT "id", 'en', 'Ideas on building, shipping, and surviving software.', 'Essays and notes from our engineering team.', 'Featured', 'Latest', 'Get new posts in your inbox', 'No spam. Unsubscribe anytime.' FROM "single_homepage" WHERE "slug" = 'homepage';

-- ============================================
-- DOWN: Rollback all changes
-- ============================================

-- Drop junction tables first (depend on dc_posts, dc_categories, dc_tags)
DROP TABLE IF EXISTS "dc_posts_categories";
DROP TABLE IF EXISTS "dc_posts_tags";

-- Drop user extension table (depends on users)
DROP TABLE IF EXISTS "user_ext";

-- Drop tables (singles first, then collections)
-- Drop the translations tables (depend on their main tables)
DROP TABLE IF EXISTS "single_homepage_locales";
DROP TABLE IF EXISTS "single_site_settings_locales";
DROP TABLE IF EXISTS "dc_tags_locales";
DROP TABLE IF EXISTS "dc_authors_locales";
DROP TABLE IF EXISTS "dc_categories_locales";
DROP TABLE IF EXISTS "dc_posts_locales";

DROP TABLE IF EXISTS "single_homepage";
DROP TABLE IF EXISTS "single_navigation";
DROP TABLE IF EXISTS "single_site_settings";
DROP TABLE IF EXISTS "dc_tags";
DROP TABLE IF EXISTS "dc_authors";
DROP TABLE IF EXISTS "dc_categories";
DROP TABLE IF EXISTS "dc_posts";
