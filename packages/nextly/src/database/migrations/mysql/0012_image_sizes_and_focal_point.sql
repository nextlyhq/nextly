-- Migration: Add image_sizes table and focal point / sizes columns to media (MySQL)

-- UP

CREATE TABLE IF NOT EXISTS `image_sizes` (
	`id` varchar(36) NOT NULL,
	`name` varchar(50) NOT NULL,
	`width` int,
	`height` int,
	`fit` varchar(20) NOT NULL DEFAULT 'inside',
	`quality` int NOT NULL DEFAULT 80,
	`format` varchar(10) NOT NULL DEFAULT 'auto',
	`is_default` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`id`),
	UNIQUE KEY `image_sizes_name_unique` (`name`)
);

ALTER TABLE `media` ADD COLUMN `focal_x` int;
ALTER TABLE `media` ADD COLUMN `focal_y` int;
ALTER TABLE `media` ADD COLUMN `sizes` json;

-- DOWN

ALTER TABLE `media` DROP COLUMN `sizes`;
ALTER TABLE `media` DROP COLUMN `focal_y`;
ALTER TABLE `media` DROP COLUMN `focal_x`;
DROP TABLE IF EXISTS `image_sizes`;
