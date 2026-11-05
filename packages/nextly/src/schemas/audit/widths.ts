// The declared widths of the audit trail's bounded columns, shared by each
// dialect's declaration and by the checks that refuse a value too long for
// them. They import nothing, so a check reads a width without loading any
// dialect's tables.

/**
 * `audit_log.kind`, a varchar on PostgreSQL and MySQL; SQLite's text holds
 * anything. Widening it widens the column and loosens the refusal with it.
 */
export const AUDIT_KIND_LENGTH = 64;

/**
 * `audit_log.actor_kind`, a varchar on PostgreSQL and MySQL. Widening it
 * widens the column and loosens the refusal with it.
 */
export const AUDIT_ACTOR_KIND_LENGTH = 191;

/**
 * `audit_log.actor_principal_kind`, a varchar on PostgreSQL and MySQL.
 * Widening it widens the column and loosens the refusal with it.
 */
export const AUDIT_ACTOR_PRINCIPAL_KIND_LENGTH = 191;

/**
 * `audit_log.target_principal_kind`, a varchar on PostgreSQL and MySQL.
 * Widening it widens the column and loosens the refusal with it.
 */
export const AUDIT_TARGET_PRINCIPAL_KIND_LENGTH = 191;
