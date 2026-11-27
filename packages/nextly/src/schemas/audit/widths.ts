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

/**
 * An agent's name, and a deployment's host or machine, on the activity and
 * audit rows: varchar on PostgreSQL and MySQL. Widening it widens the columns
 * and loosens the refusal with it.
 */
export const ATTRIBUTION_NAME_LENGTH = 191;

/**
 * An attribution id on the activity and audit rows (session, credential,
 * approval request, approver, grant): varchar on PostgreSQL and MySQL. A uuid
 * and a key's own id both fit; a whole key or a signed token is longer and is
 * refused before it reaches the column.
 */
export const ATTRIBUTION_ID_LENGTH = 64;

/** A door or an approval place on the activity and audit rows. */
export const ATTRIBUTION_WORD_LENGTH = 16;

/** A deployment's commit: a full SHA-1 hash at most. */
export const ATTRIBUTION_COMMIT_LENGTH = 40;
