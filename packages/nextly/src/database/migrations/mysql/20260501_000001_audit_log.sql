-- Append-only event store for security-sensitive auth events.
-- See packages/nextly/src/domains/audit/ for the writer service.

-- UP

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` varchar(191) PRIMARY KEY NOT NULL,
  `kind` varchar(64) NOT NULL,
  `actor_user_id` varchar(191),
  `target_user_id` varchar(191),
  `ip_address` varchar(45),
  `user_agent` text,
  `metadata` json,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `audit_log_kind_idx` ON `audit_log` (`kind`);
CREATE INDEX `audit_log_actor_user_id_idx` ON `audit_log` (`actor_user_id`);
CREATE INDEX `audit_log_target_user_id_idx` ON `audit_log` (`target_user_id`);
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);

-- DOWN

DROP TABLE IF EXISTS `audit_log`;
