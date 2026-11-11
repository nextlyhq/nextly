-- Migration: card
-- Field groups: card
-- Entity scope: touched
-- Generated at: 2026-10-01T12:00:00.000Z
-- Dialect: MySQL

-- UP
CREATE TABLE `comp_card` (
  `id` varchar(36) PRIMARY KEY NOT NULL,
  `_parent_id` varchar(36) NOT NULL,
  `_parent_table` varchar(255) NOT NULL,
  `_parent_field` varchar(255) NOT NULL,
  `_order` int(11),
  `_component_type` varchar(255),
  `heading` varchar(255),
  `views` int,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL
);
CREATE INDEX `idx_comp_card_parent` ON `comp_card` (`_parent_id`, `_parent_table`, `_parent_field`);
CREATE INDEX `idx_comp_card_created_at` ON `comp_card` (`created_at`);

-- DOWN
DROP TABLE `comp_card`;
