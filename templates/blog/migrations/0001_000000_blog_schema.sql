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
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "content" jsonb,
  "excerpt" text,
  "featured_image" text,
  "author" text,
  "categories" jsonb,
  "tags" jsonb,
  "published_at" timestamp with time zone,
  "status" text DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  "featured" boolean DEFAULT false,
  "seo" jsonb,
  "reading_time" integer,
  "word_count" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Categories collection
CREATE TABLE IF NOT EXISTS "dc_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "icon" text,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Tags collection
CREATE TABLE IF NOT EXISTS "dc_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
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
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
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
  "post_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  PRIMARY KEY ("post_id", "category_id"),
  CONSTRAINT "fk_posts_categories_post"
    FOREIGN KEY ("post_id") REFERENCES "dc_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_posts_categories_category"
    FOREIGN KEY ("category_id") REFERENCES "dc_categories"("id") ON DELETE CASCADE
);

-- Posts <-> Tags (many-to-many)
CREATE TABLE IF NOT EXISTS "dc_posts_tags" (
  "post_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
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
CREATE TABLE IF NOT EXISTS "single_site_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL DEFAULT 'Site Settings',
  "slug" text NOT NULL DEFAULT 'site-settings',
  "site_name" text NOT NULL DEFAULT 'My Blog',
  "tagline" text DEFAULT 'Thoughts on web development',
  "site_description" text,
  "logo" text,
  "social" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Navigation single
CREATE TABLE IF NOT EXISTS "single_navigation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL DEFAULT 'Navigation',
  "slug" text NOT NULL DEFAULT 'navigation',
  "header_links" jsonb,
  "footer_read_links" jsonb,
  "show_theme_toggle" boolean DEFAULT true,
  "show_search_icon" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Homepage single
CREATE TABLE IF NOT EXISTS "single_homepage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL DEFAULT 'Homepage',
  "slug" text NOT NULL DEFAULT 'homepage',
  "hero_title" text NOT NULL DEFAULT 'Ideas on building, shipping, and surviving software.',
  "hero_subtitle" text DEFAULT 'Essays and notes from our engineering team.',
  "show_featured_post" boolean DEFAULT true,
  "featured_section_title" text DEFAULT 'Featured',
  "show_latest_posts" boolean DEFAULT true,
  "latest_section_title" text DEFAULT 'Latest',
  "latest_posts_count" integer DEFAULT 3,
  "show_category_strip" boolean DEFAULT true,
  "show_newsletter_cta" boolean DEFAULT true,
  "newsletter_heading" text DEFAULT 'Get new posts in your inbox',
  "newsletter_subheading" text DEFAULT 'No spam. Unsubscribe anytime.',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- ============ INDEXES ============

-- Posts indexes
CREATE INDEX IF NOT EXISTS "idx_posts_slug" ON "dc_posts"("slug");
CREATE INDEX IF NOT EXISTS "idx_posts_status" ON "dc_posts"("status");
CREATE INDEX IF NOT EXISTS "idx_posts_published" ON "dc_posts"("published_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_posts_featured" ON "dc_posts"("featured") WHERE "featured" = true;
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
ALTER TABLE "dc_posts"
ADD CONSTRAINT "fk_posts_featured_image"
FOREIGN KEY ("featured_image") REFERENCES "media"("id") ON DELETE SET NULL;

-- Posts author -> users (text FK — users.id is text in the core schema)
ALTER TABLE "dc_posts"
ADD CONSTRAINT "fk_posts_author"
FOREIGN KEY ("author") REFERENCES "users"("id") ON DELETE SET NULL;

-- Site Settings logo -> media (text FK — media.id is text in the core schema)
ALTER TABLE "single_site_settings"
ADD CONSTRAINT "fk_site_settings_logo"
FOREIGN KEY ("logo") REFERENCES "media"("id") ON DELETE SET NULL;

-- ============ SINGLES DATA DEFAULTS ============
-- Insert default documents for each single so they're accessible immediately
INSERT INTO "single_site_settings" ("id", "title", "slug", "site_name", "tagline", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Site Settings', 'site-settings', 'My Blog', 'Thoughts on web development', now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "single_navigation" ("id", "title", "slug", "show_theme_toggle", "show_search_icon", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Navigation', 'navigation', true, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "single_homepage" ("id", "title", "slug", "hero_title", "hero_subtitle", "show_featured_post", "featured_section_title", "show_latest_posts", "latest_section_title", "latest_posts_count", "show_category_strip", "show_newsletter_cta", "newsletter_heading", "newsletter_subheading", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'Homepage', 'homepage', 'Ideas on building, shipping, and surviving software.', 'Essays and notes from our engineering team.', true, 'Featured', true, 'Latest', 3, true, true, 'Get new posts in your inbox', 'No spam. Unsubscribe anytime.', now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ============================================
-- DOWN: Rollback all changes
-- ============================================

-- Drop foreign keys first
ALTER TABLE "dc_posts" DROP CONSTRAINT IF EXISTS "fk_posts_author";
ALTER TABLE "dc_posts" DROP CONSTRAINT IF EXISTS "fk_posts_featured_image";
ALTER TABLE "single_site_settings" DROP CONSTRAINT IF EXISTS "fk_site_settings_logo";
ALTER TABLE "user_ext" DROP CONSTRAINT IF EXISTS "fk_user_ext_user_id";

-- Drop indexes
DROP INDEX IF EXISTS "idx_posts_slug";
DROP INDEX IF EXISTS "idx_posts_status";
DROP INDEX IF EXISTS "idx_posts_published";
DROP INDEX IF EXISTS "idx_posts_featured";
DROP INDEX IF EXISTS "idx_posts_author";
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
DROP TABLE IF EXISTS "single_homepage" CASCADE;
DROP TABLE IF EXISTS "single_navigation" CASCADE;
DROP TABLE IF EXISTS "single_site_settings" CASCADE;
DROP TABLE IF EXISTS "dc_tags" CASCADE;
DROP TABLE IF EXISTS "dc_categories" CASCADE;
DROP TABLE IF EXISTS "dc_posts" CASCADE;
