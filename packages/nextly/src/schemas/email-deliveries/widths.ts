// The declared widths of the email delivery log's bounded columns, shared by
// each dialect's declaration and by the checks that refuse a value too long
// for them. They import nothing, so a check reads a width without loading any
// dialect's tables.

/**
 * `email_deliveries.principal_kind`, a varchar on PostgreSQL and MySQL.
 * Widening it widens the column and loosens the refusal with it.
 */
export const EMAIL_DELIVERY_PRINCIPAL_KIND_LENGTH = 191;

/**
 * `email_deliveries.principal_id`, a varchar on PostgreSQL and MySQL.
 * Widening it widens the column and loosens the refusal with it.
 */
export const EMAIL_DELIVERY_PRINCIPAL_ID_LENGTH = 191;
