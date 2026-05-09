-- Append-only event store for security-sensitive auth events.
-- See packages/nextly/src/domains/audit/ for the writer service.

-- UP

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `actor_user_id` text,
  `target_user_id` text,
  `ip_address` text,
  `user_agent` text,
  `metadata` text,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `audit_log_kind_idx` ON `audit_log` (`kind`);
CREATE INDEX IF NOT EXISTS `audit_log_actor_user_id_idx` ON `audit_log` (`actor_user_id`);
CREATE INDEX IF NOT EXISTS `audit_log_target_user_id_idx` ON `audit_log` (`target_user_id`);
CREATE INDEX IF NOT EXISTS `audit_log_created_at_idx` ON `audit_log` (`created_at`);

-- DOWN

DROP TABLE IF EXISTS `audit_log`;
