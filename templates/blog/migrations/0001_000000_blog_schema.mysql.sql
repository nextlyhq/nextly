-- Migration: Blog Template Schema
-- Description: Creates collections, singles, and junction tables for blog
-- Dialect: mysql
-- Template: blog
-- Version: 1.0
--
-- Every table takes the database's character set and collation, as nextly's
-- own tables do: a foreign key to `users` or `media` needs both sides in one
-- collation. A column that references a row is a varchar, since MySQL keys no
-- TEXT column and indexes every foreign key: varchar(191) for a user, the
-- width nextly gives users.id (an auth adapter's ids can be longer than a
-- UUID), and varchar(36), nextly's id type, for any other row.

-- ============================================
-- UP: Create all blog schema
-- ============================================

-- ============ COLLECTIONS ============

-- Posts collection
CREATE TABLE IF NOT EXISTS `dc_posts` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `featured_image` varchar(36),
  `author` varchar(191),
  `byline` varchar(36),
  `categories` json,
  `tags` json,
  `published_at` timestamp NULL DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `featured` tinyint(1) DEFAULT 0,
  `seo` json,
  `reading_time` integer,
  `word_count` integer,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- Categories collection
CREATE TABLE IF NOT EXISTS `dc_categories` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- Tags collection
CREATE TABLE IF NOT EXISTS `dc_tags` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- Authors collection: the public profiles a post's byline credits. A post's
-- `author` is the account that owns it; its `byline` is one of these.
CREATE TABLE IF NOT EXISTS `dc_authors` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `avatar` varchar(36),
  `account` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- ============ USER EXTENSION TABLE ============

-- user_ext: extends the built-in users table with blog-specific author fields.
-- Structure mirrors what UserExtSchemaService.generateMigrationSQL() produces
-- at runtime so the migration and the runtime schema stay in lockstep.
-- Column names are snake_case of the camelCase field names defined in
-- codefirst.config.ts: bio → bio, avatarUrl → avatar_url, slug → slug.
-- One exception: `slug` is unique here, as in the other dialects' files,
-- because /authors/[slug] finds an author by it. MySQL keys a varchar, not a
-- TEXT column, so it is varchar(255): the length nextly gives a unique text
-- field on MySQL.
CREATE TABLE IF NOT EXISTS `user_ext` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `user_id` varchar(191) NOT NULL,
  `bio` text,
  `avatar_url` text,
  `slug` varchar(255),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text,
  UNIQUE KEY `uq_user_ext_user_id` (`user_id`),
  UNIQUE KEY `uq_user_ext_slug` (`slug`),
  CONSTRAINT `fk_user_ext_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============ JUNCTION TABLES ============

-- Posts <-> Categories (many-to-many)
CREATE TABLE IF NOT EXISTS `dc_posts_categories` (
  `post_id` varchar(36) NOT NULL,
  `category_id` varchar(36) NOT NULL,
  PRIMARY KEY (`post_id`, `category_id`),
  CONSTRAINT `fk_posts_categories_post` FOREIGN KEY (`post_id`) REFERENCES `dc_posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_posts_categories_category` FOREIGN KEY (`category_id`) REFERENCES `dc_categories`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Posts <-> Tags (many-to-many)
CREATE TABLE IF NOT EXISTS `dc_posts_tags` (
  `post_id` varchar(36) NOT NULL,
  `tag_id` varchar(36) NOT NULL,
  PRIMARY KEY (`post_id`, `tag_id`),
  CONSTRAINT `fk_posts_tags_post` FOREIGN KEY (`post_id`) REFERENCES `dc_posts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_posts_tags_tag` FOREIGN KEY (`tag_id`) REFERENCES `dc_tags`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============ SINGLES ============
-- Note: All single tables include system columns (id, title, slug, created_at, updated_at)
-- and use snake_case column names for all fields (e.g., hero_title not heroTitle).

-- Site Settings single
CREATE TABLE `single_site_settings` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `title` varchar(255) NOT NULL DEFAULT 'Site Settings',
  `slug` varchar(255) NOT NULL DEFAULT 'site-settings',
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `logo` varchar(36),
  `social` json,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- Navigation single
CREATE TABLE `single_navigation` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `title` varchar(255) NOT NULL DEFAULT 'Navigation',
  `slug` varchar(255) NOT NULL DEFAULT 'navigation',
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `header_links` json,
  `footer_read_links` json,
  `show_theme_toggle` tinyint(1) DEFAULT 1,
  `show_search_icon` tinyint(1) DEFAULT 1,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- Homepage single
CREATE TABLE `single_homepage` (
  `id` varchar(36) PRIMARY KEY DEFAULT (UUID()),
  `title` varchar(255) NOT NULL DEFAULT 'Homepage',
  `slug` varchar(255) NOT NULL DEFAULT 'homepage',
  `status` varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  `first_published_at` timestamp NULL DEFAULT NULL,
  `show_featured_post` tinyint(1) DEFAULT 1,
  `show_latest_posts` tinyint(1) DEFAULT 1,
  `latest_posts_count` integer DEFAULT 3,
  `show_category_strip` tinyint(1) DEFAULT 1,
  `show_newsletter_cta` tinyint(1) DEFAULT 1,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` text
) ENGINE=InnoDB;

-- ============ TRANSLATIONS TABLES ============
-- Every installation keeps its translatable fields (text, rich text) per language, each
-- entity's in a `<table>_locales` table: one row per document and language, keyed by
-- `_parent` and `_locale`. The main tables above hold the shared fields only. These
-- statements are the ones `nextly migrate:create` writes for the same fields; a slug is
-- unique within each language. The Navigation single has no translatable field, so it
-- has no translations table.

CREATE TABLE IF NOT EXISTS `dc_posts_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` TEXT,
  `slug` VARCHAR(255),
  `content` TEXT,
  `excerpt` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_posts` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `uq_dc_posts_locales_slug__locale_1mvq6jl` ON `dc_posts_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

CREATE TABLE IF NOT EXISTS `dc_categories_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` TEXT,
  `name` TEXT,
  `slug` VARCHAR(255),
  `icon` TEXT,
  `description` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_categories` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `uq_dc_categories_locales_slug__locale_1mvq6jl` ON `dc_categories_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

CREATE TABLE IF NOT EXISTS `dc_tags_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` TEXT,
  `name` TEXT,
  `slug` VARCHAR(255),
  `description` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_tags` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `uq_dc_tags_locales_slug__locale_1mvq6jl` ON `dc_tags_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

CREATE TABLE IF NOT EXISTS `dc_authors_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `title` TEXT,
  `name` TEXT,
  `slug` VARCHAR(255),
  `bio` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `dc_authors` (`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `uq_dc_authors_locales_slug__locale_1mvq6jl` ON `dc_authors_locales` ((SHA2(WEIGHT_STRING(NULLIF(`slug`, '')), 256)), `_locale`);

CREATE TABLE `single_site_settings_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `site_name` TEXT,
  `tagline` TEXT,
  `site_description` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `single_site_settings` (`id`) ON DELETE CASCADE
);

CREATE TABLE `single_homepage_locales` (
  `_parent` VARCHAR(36) NOT NULL,
  `_locale` VARCHAR(20) NOT NULL,
  `_updated_at` DATETIME(3),
  `_revision` int DEFAULT 1 NOT NULL,
  `_changed_by_kind` varchar(16),
  `_changed_by_id` varchar(255),
  `_changed_by_principal_kind` varchar(64),
  `_changed_at` timestamp,
  `hero_title` TEXT,
  `hero_subtitle` TEXT,
  `featured_section_title` TEXT,
  `latest_section_title` TEXT,
  `newsletter_heading` TEXT,
  `newsletter_subheading` TEXT,
  PRIMARY KEY (`_parent`, `_locale`),
  FOREIGN KEY (`_parent`) REFERENCES `single_homepage` (`id`) ON DELETE CASCADE
);

-- ============ INDEXES ============

-- Posts indexes
CREATE INDEX `idx_posts_status` ON `dc_posts`(`status`);
CREATE INDEX `idx_posts_published` ON `dc_posts`(`published_at` DESC);
CREATE INDEX `idx_posts_featured` ON `dc_posts`(`featured`);
CREATE INDEX `idx_posts_author` ON `dc_posts`(`author`);
CREATE INDEX `idx_posts_byline` ON `dc_posts`(`byline`);

-- Categories indexes

-- Tags indexes

-- Authors indexes
-- One profile per account: a new post is credited to its writer's profile.
CREATE UNIQUE INDEX `uq_authors_account` ON `dc_authors`(`account`);

-- Junction table indexes (FK columns not covered by composite PK)
CREATE INDEX `idx_posts_categories_category` ON `dc_posts_categories`(`category_id`);
CREATE INDEX `idx_posts_tags_tag` ON `dc_posts_tags`(`tag_id`);

-- Singles indexes (slug columns)
CREATE UNIQUE INDEX `uq_single_site_settings_slug` ON `single_site_settings`(`slug`);
CREATE UNIQUE INDEX `uq_single_navigation_slug` ON `single_navigation`(`slug`);
CREATE UNIQUE INDEX `uq_single_homepage_slug` ON `single_homepage`(`slug`);

-- ============ FOREIGN KEY RELATIONSHIPS ============

-- Posts featured_image -> media (text FK — media.id is text in the core schema)
ALTER TABLE `dc_posts`
ADD CONSTRAINT `fk_posts_featured_image`
FOREIGN KEY (`featured_image`) REFERENCES `media`(`id`) ON DELETE SET NULL;

-- Posts author -> users (varchar(191), as users.id in the core schema)
ALTER TABLE `dc_posts`
ADD CONSTRAINT `fk_posts_author`
FOREIGN KEY (`author`) REFERENCES `users`(`id`) ON DELETE SET NULL;

-- Posts byline -> authors: a post whose profile is deleted keeps no dangling credit
ALTER TABLE `dc_posts`
ADD CONSTRAINT `fk_posts_byline`
FOREIGN KEY (`byline`) REFERENCES `dc_authors`(`id`) ON DELETE SET NULL;

-- Authors avatar -> media, and account -> users, as posts' own
ALTER TABLE `dc_authors`
ADD CONSTRAINT `fk_authors_avatar`
FOREIGN KEY (`avatar`) REFERENCES `media`(`id`) ON DELETE SET NULL;

ALTER TABLE `dc_authors`
ADD CONSTRAINT `fk_authors_account`
FOREIGN KEY (`account`) REFERENCES `users`(`id`) ON DELETE SET NULL;

-- Site Settings logo -> media (text FK — media.id is text in the core schema)
ALTER TABLE `single_site_settings`
ADD CONSTRAINT `fk_site_settings_logo`
FOREIGN KEY (`logo`) REFERENCES `media`(`id`) ON DELETE SET NULL;

-- ============ SINGLES DATA DEFAULTS ============
-- The tables above are created without IF NOT EXISTS: this file made them, so the
-- rows written here reach no table that was already there, and `nextly migrate`
-- does not have to ask for consent before writing them.
-- Insert default documents for each single so they're accessible immediately
-- MySQL uses INSERT IGNORE instead of ON CONFLICT DO NOTHING
INSERT IGNORE INTO `single_site_settings` (`id`, `title`, `slug`, `status`, `created_at`, `updated_at`)
VALUES (UUID(), 'Site Settings', 'site-settings', 'published', NOW(), NOW());
INSERT IGNORE INTO `single_site_settings_locales` (`_parent`, `_locale`, `site_name`, `tagline`)
SELECT `id`, 'en', 'My Blog', 'Thoughts on web development' FROM `single_site_settings` WHERE `slug` = 'site-settings';

INSERT IGNORE INTO `single_navigation` (`id`, `title`, `slug`, `status`, `show_theme_toggle`, `show_search_icon`, `created_at`, `updated_at`)
VALUES (UUID(), 'Navigation', 'navigation', 'published', 1, 1, NOW(), NOW());

INSERT IGNORE INTO `single_homepage` (`id`, `title`, `slug`, `status`, `show_featured_post`, `show_latest_posts`, `latest_posts_count`, `show_category_strip`, `show_newsletter_cta`, `created_at`, `updated_at`)
VALUES (UUID(), 'Homepage', 'homepage', 'published', 1, 1, 3, 1, 1, NOW(), NOW());
INSERT IGNORE INTO `single_homepage_locales` (`_parent`, `_locale`, `hero_title`, `hero_subtitle`, `featured_section_title`, `latest_section_title`, `newsletter_heading`, `newsletter_subheading`)
SELECT `id`, 'en', 'Ideas on building, shipping, and surviving software.', 'Essays and notes from our engineering team.', 'Featured', 'Latest', 'Get new posts in your inbox', 'No spam. Unsubscribe anytime.' FROM `single_homepage` WHERE `slug` = 'homepage';

-- ============================================
-- DOWN: Rollback all changes
-- ============================================

-- Drop foreign keys first
ALTER TABLE `dc_posts` DROP CONSTRAINT IF EXISTS `fk_posts_author`;
ALTER TABLE `dc_posts` DROP CONSTRAINT IF EXISTS `fk_posts_featured_image`;
ALTER TABLE `dc_posts` DROP CONSTRAINT IF EXISTS `fk_posts_byline`;
ALTER TABLE `dc_authors` DROP CONSTRAINT IF EXISTS `fk_authors_avatar`;
ALTER TABLE `dc_authors` DROP CONSTRAINT IF EXISTS `fk_authors_account`;
ALTER TABLE `single_site_settings` DROP CONSTRAINT IF EXISTS `fk_site_settings_logo`;
ALTER TABLE `user_ext` DROP CONSTRAINT IF EXISTS `fk_user_ext_user_id`;

-- Drop indexes
DROP INDEX IF EXISTS `uq_posts_slug` ON `dc_posts`;
DROP INDEX IF EXISTS `uq_categories_slug` ON `dc_categories`;
DROP INDEX IF EXISTS `uq_tags_slug` ON `dc_tags`;
DROP INDEX IF EXISTS `idx_posts_status` ON `dc_posts`;
DROP INDEX IF EXISTS `idx_posts_published` ON `dc_posts`;
DROP INDEX IF EXISTS `idx_posts_featured` ON `dc_posts`;
DROP INDEX IF EXISTS `idx_posts_author` ON `dc_posts`;
DROP INDEX IF EXISTS `idx_posts_byline` ON `dc_posts`;
DROP INDEX IF EXISTS `idx_authors_slug` ON `dc_authors`;
DROP INDEX IF EXISTS `uq_authors_account` ON `dc_authors`;
DROP INDEX IF EXISTS `uq_authors_slug` ON `dc_authors`;
DROP INDEX IF EXISTS `idx_posts_categories_category` ON `dc_posts_categories`;
DROP INDEX IF EXISTS `idx_posts_tags_tag` ON `dc_posts_tags`;
DROP INDEX IF EXISTS `uq_user_ext_user_id` ON `user_ext`;
DROP INDEX IF EXISTS `uq_user_ext_slug` ON `user_ext`;
DROP INDEX IF EXISTS `uq_single_site_settings_slug` ON `single_site_settings`;
DROP INDEX IF EXISTS `uq_single_navigation_slug` ON `single_navigation`;
DROP INDEX IF EXISTS `uq_single_homepage_slug` ON `single_homepage`;

-- Drop junction tables first (depend on dc_posts, dc_categories, dc_tags)
DROP TABLE IF EXISTS `dc_posts_categories`;
DROP TABLE IF EXISTS `dc_posts_tags`;

-- Drop user extension table (depends on users)
DROP TABLE IF EXISTS `user_ext`;

-- Drop tables (singles first, then collections)
-- Drop the translations tables (depend on their main tables)
DROP TABLE IF EXISTS `single_homepage_locales`;
DROP TABLE IF EXISTS `single_site_settings_locales`;
DROP TABLE IF EXISTS `dc_tags_locales`;
DROP TABLE IF EXISTS `dc_authors_locales`;
DROP TABLE IF EXISTS `dc_categories_locales`;
DROP TABLE IF EXISTS `dc_posts_locales`;

DROP TABLE IF EXISTS `single_homepage`;
DROP TABLE IF EXISTS `single_navigation`;
DROP TABLE IF EXISTS `single_site_settings`;
DROP TABLE IF EXISTS `dc_tags`;
DROP TABLE IF EXISTS `dc_authors`;
DROP TABLE IF EXISTS `dc_categories`;
DROP TABLE IF EXISTS `dc_posts`;
