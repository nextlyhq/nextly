---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

The blog template's migration creates the `first_published_at` column on its posts, categories, tags and Singles. Without it, a blog scaffolded with the visual approach failed every read of those tables ("no such column first_published_at"), so its pages errored. The migration's `status` columns are now `NOT NULL`, and posts' `content` column is `text` on PostgreSQL and MySQL, as nextly builds them.

On MySQL the migration failed part way: MySQL has no `CREATE INDEX IF NOT EXISTS`, keys no TEXT column without a length, and refuses a foreign key between tables of different collations. Its indexes are now plain `CREATE INDEX`; the columns that reference a row (`user_ext`'s ids, posts' `author` and `featured_image`, Site Settings' `logo`) and the author `slug` are varchar columns; and its tables take the database's collation, as nextly's own `users` and `media` do. Author slugs stay unique, as on PostgreSQL and SQLite.

A blog scaffolded with the visual approach before this release keeps the migration it was created with, so it needs the column added once. On PostgreSQL:

```sql
ALTER TABLE "dc_posts" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
ALTER TABLE "dc_categories" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
ALTER TABLE "dc_tags" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
ALTER TABLE "single_site_settings" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
ALTER TABLE "single_navigation" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
ALTER TABLE "single_homepage" ADD COLUMN IF NOT EXISTS "first_published_at" timestamp with time zone;
```

On MySQL:

```sql
ALTER TABLE `dc_posts` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `dc_categories` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `dc_tags` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `single_site_settings` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `single_navigation` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `single_homepage` ADD COLUMN `first_published_at` timestamp NULL DEFAULT NULL;
```

On SQLite:

```sql
ALTER TABLE "dc_posts" ADD COLUMN "first_published_at" INTEGER;
ALTER TABLE "dc_categories" ADD COLUMN "first_published_at" INTEGER;
ALTER TABLE "dc_tags" ADD COLUMN "first_published_at" INTEGER;
ALTER TABLE "single_site_settings" ADD COLUMN "first_published_at" INTEGER;
ALTER TABLE "single_navigation" ADD COLUMN "first_published_at" INTEGER;
ALTER TABLE "single_homepage" ADD COLUMN "first_published_at" INTEGER;
```
