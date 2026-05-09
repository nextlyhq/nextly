-- Migration 0012: Add media folder support for MySQL.
--
-- Adds media_folders hierarchy and media.folder_id linkage so folder APIs
-- work consistently across PostgreSQL/MySQL/SQLite.

CREATE TABLE IF NOT EXISTS `media_folders` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `parent_id` varchar(255),
  `created_by` varchar(191) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `media_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

ALTER TABLE `media_folders`
  ADD CONSTRAINT `media_folders_parent_id_media_folders_id_fk`
  FOREIGN KEY (`parent_id`) REFERENCES `media_folders`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE `media_folders`
  ADD CONSTRAINT `media_folders_created_by_users_id_fk`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX `media_folders_parent_id_idx` ON `media_folders` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `media_folders_created_by_idx` ON `media_folders` (`created_by`);
--> statement-breakpoint
CREATE INDEX `media_folders_created_at_idx` ON `media_folders` (`created_at`);
--> statement-breakpoint

ALTER TABLE `media` ADD COLUMN `folder_id` varchar(255);
--> statement-breakpoint

ALTER TABLE `media`
  ADD CONSTRAINT `media_folder_id_media_folders_id_fk`
  FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX `media_folder_id_idx` ON `media` (`folder_id`);
