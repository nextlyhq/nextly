-- Migration: Make media.uploaded_by nullable
-- CLI seeds, data imports, and other system-context uploads may not have a
-- user to attribute the upload to. Dropping NOT NULL lets these operations
-- record media without a synthetic "anonymous" user sentinel (which doesn't
-- exist as a row and broke the foreign-key constraint).

-- UP
-- SQLite doesn't support ALTER COLUMN to change nullability, so rebuild the
-- table. No FK targets media.id anywhere in core tables, so the rebuild
-- doesn't need foreign_keys PRAGMA toggling (the adapter enables FKs at
-- connect; the migration runner wraps this in a transaction and strips
-- PRAGMA statements anyway).

CREATE TABLE `media__new` (
  `id` text PRIMARY KEY NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `width` integer,
  `height` integer,
  `duration` integer,
  `url` text NOT NULL,
  `thumbnail_url` text,
  `focal_x` integer,
  `focal_y` integer,
  `sizes` text,
  `alt_text` text,
  `caption` text,
  `tags` text,
  `folder_id` text REFERENCES `media_folders`(`id`) ON DELETE SET NULL,
  `uploaded_by` text REFERENCES `users`(`id`) ON DELETE CASCADE,
  `uploaded_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

INSERT INTO `media__new`
SELECT
  `id`, `filename`, `mime_type`, `size`, `width`, `height`, `duration`,
  `url`, `thumbnail_url`, `focal_x`, `focal_y`, `sizes`,
  `alt_text`, `caption`, `tags`, `folder_id`, `uploaded_by`,
  `uploaded_at`, `updated_at`
FROM `media`;
--> statement-breakpoint

DROP TABLE `media`;
--> statement-breakpoint

ALTER TABLE `media__new` RENAME TO `media`;
--> statement-breakpoint

CREATE INDEX `media_uploaded_by_idx` ON `media` (`uploaded_by`);
--> statement-breakpoint
CREATE INDEX `media_mime_type_idx` ON `media` (`mime_type`);
--> statement-breakpoint
CREATE INDEX `media_uploaded_at_idx` ON `media` (`uploaded_at`);
--> statement-breakpoint
CREATE INDEX `media_folder_id_idx` ON `media` (`folder_id`);

-- DOWN
-- Reverse: re-add NOT NULL by rebuilding the table again.
-- Rows with NULL uploaded_by are dropped (the WHERE filter) since a NOT NULL
-- column cannot accept them; backfill the DB before running DOWN if retention
-- matters.

CREATE TABLE `media__old` (
  `id` text PRIMARY KEY NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `width` integer,
  `height` integer,
  `duration` integer,
  `url` text NOT NULL,
  `thumbnail_url` text,
  `focal_x` integer,
  `focal_y` integer,
  `sizes` text,
  `alt_text` text,
  `caption` text,
  `tags` text,
  `folder_id` text REFERENCES `media_folders`(`id`) ON DELETE SET NULL,
  `uploaded_by` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `uploaded_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

INSERT INTO `media__old`
SELECT
  `id`, `filename`, `mime_type`, `size`, `width`, `height`, `duration`,
  `url`, `thumbnail_url`, `focal_x`, `focal_y`, `sizes`,
  `alt_text`, `caption`, `tags`, `folder_id`, `uploaded_by`,
  `uploaded_at`, `updated_at`
FROM `media`
WHERE `uploaded_by` IS NOT NULL;
--> statement-breakpoint

DROP TABLE `media`;
--> statement-breakpoint

ALTER TABLE `media__old` RENAME TO `media`;
--> statement-breakpoint

CREATE INDEX `media_uploaded_by_idx` ON `media` (`uploaded_by`);
--> statement-breakpoint
CREATE INDEX `media_mime_type_idx` ON `media` (`mime_type`);
--> statement-breakpoint
CREATE INDEX `media_uploaded_at_idx` ON `media` (`uploaded_at`);
--> statement-breakpoint
CREATE INDEX `media_folder_id_idx` ON `media` (`folder_id`);
