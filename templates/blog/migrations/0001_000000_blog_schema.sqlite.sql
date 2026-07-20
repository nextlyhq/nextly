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
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "content" TEXT,
  "excerpt" TEXT,
  "featured_image" TEXT,
  "author" TEXT,
  "categories" TEXT,
  "tags" TEXT,
  "published_at" INTEGER,
  "status" TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  "featured" INTEGER DEFAULT 0,
  "seo" TEXT,
  "reading_time" INTEGER,
  "word_count" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Categories collection
CREATE TABLE IF NOT EXISTS "dc_categories" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "icon" TEXT,
  "description" TEXT,
  "status" TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Tags collection
CREATE TABLE IF NOT EXISTS "dc_tags" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
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
CREATE TABLE IF NOT EXISTS "single_site_settings" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Site Settings',
  "slug" TEXT NOT NULL DEFAULT 'site-settings',
  "status" TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "site_name" TEXT NOT NULL DEFAULT 'My Blog',
  "tagline" TEXT DEFAULT 'Thoughts on web development',
  "site_description" TEXT,
  "logo" TEXT,
  "social" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Navigation single
CREATE TABLE IF NOT EXISTS "single_navigation" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Navigation',
  "slug" TEXT NOT NULL DEFAULT 'navigation',
  "status" TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "header_links" TEXT,
  "footer_read_links" TEXT,
  "show_theme_toggle" INTEGER DEFAULT 1,
  "show_search_icon" INTEGER DEFAULT 1,
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- Homepage single
CREATE TABLE IF NOT EXISTS "single_homepage" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  "title" TEXT NOT NULL DEFAULT 'Homepage',
  "slug" TEXT NOT NULL DEFAULT 'homepage',
  "status" TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  "hero_title" TEXT NOT NULL DEFAULT 'Ideas on building, shipping, and surviving software.',
  "hero_subtitle" TEXT DEFAULT 'Essays and notes from our engineering team.',
  "show_featured_post" INTEGER DEFAULT 1,
  "featured_section_title" TEXT DEFAULT 'Featured',
  "show_latest_posts" INTEGER DEFAULT 1,
  "latest_section_title" TEXT DEFAULT 'Latest',
  "latest_posts_count" INTEGER DEFAULT 3,
  "show_category_strip" INTEGER DEFAULT 1,
  "show_newsletter_cta" INTEGER DEFAULT 1,
  "newsletter_heading" TEXT DEFAULT 'Get new posts in your inbox',
  "newsletter_subheading" TEXT DEFAULT 'No spam. Unsubscribe anytime.',
  "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  "created_by" TEXT
);

-- ============ INDEXES ============

-- Posts indexes
CREATE INDEX IF NOT EXISTS "idx_posts_slug" ON "dc_posts"("slug");
CREATE INDEX IF NOT EXISTS "idx_posts_status" ON "dc_posts"("status");
CREATE INDEX IF NOT EXISTS "idx_posts_published" ON "dc_posts"("published_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_posts_featured" ON "dc_posts"("featured") WHERE "featured" = 1;
CREATE INDEX IF NOT EXISTS "idx_posts_author" ON "dc_posts"("author");

-- Categories indexes
CREATE INDEX IF NOT EXISTS "idx_categories_slug" ON "dc_categories"("slug");

-- Tags indexes
CREATE INDEX IF NOT EXISTS "idx_tags_slug" ON "dc_tags"("slug");

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
-- Insert default documents for each single so they're accessible immediately
-- SQLite uses INSERT OR IGNORE instead of ON CONFLICT DO NOTHING
INSERT OR IGNORE INTO "single_site_settings" ("id", "title", "slug", "status", "site_name", "tagline", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Site Settings', 'site-settings', 'published', 'My Blog', 'Thoughts on web development', strftime('%s', 'now'), strftime('%s', 'now'));

INSERT OR IGNORE INTO "single_navigation" ("id", "title", "slug", "status", "show_theme_toggle", "show_search_icon", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Navigation', 'navigation', 'published', 1, 1, strftime('%s', 'now'), strftime('%s', 'now'));

INSERT OR IGNORE INTO "single_homepage" ("id", "title", "slug", "status", "hero_title", "hero_subtitle", "show_featured_post", "featured_section_title", "show_latest_posts", "latest_section_title", "latest_posts_count", "show_category_strip", "show_newsletter_cta", "newsletter_heading", "newsletter_subheading", "created_at", "updated_at")
VALUES (lower(hex(randomblob(16))), 'Homepage', 'homepage', 'published', 'Ideas on building, shipping, and surviving software.', 'Essays and notes from our engineering team.', 1, 'Featured', 1, 'Latest', 3, 1, 1, 'Get new posts in your inbox', 'No spam. Unsubscribe anytime.', strftime('%s', 'now'), strftime('%s', 'now'));

-- ============================================
-- DOWN: Rollback all changes
-- ============================================

-- Drop junction tables first (depend on dc_posts, dc_categories, dc_tags)
DROP TABLE IF EXISTS "dc_posts_categories";
DROP TABLE IF EXISTS "dc_posts_tags";

-- Drop user extension table (depends on users)
DROP TABLE IF EXISTS "user_ext";

-- Drop tables (singles first, then collections)
DROP TABLE IF EXISTS "single_homepage";
DROP TABLE IF EXISTS "single_navigation";
DROP TABLE IF EXISTS "single_site_settings";
DROP TABLE IF EXISTS "dc_tags";
DROP TABLE IF EXISTS "dc_categories";
DROP TABLE IF EXISTS "dc_posts";
