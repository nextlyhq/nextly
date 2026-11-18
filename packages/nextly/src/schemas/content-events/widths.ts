// The declared widths of the content events table's bounded columns, shared by
// each dialect's declaration and by the checks that refuse a value too long
// for them. They import nothing, so a check reads a width without loading any
// dialect's tables.

/**
 * `nextly_content_events.actor_principal_kind`, a varchar on PostgreSQL and
 * MySQL: the kind of a plugin-defined person who acted. Widening it widens the
 * column, the refusal of a longer kind when an event is recorded, and the
 * longest kind a plugin may register.
 */
export const CONTENT_EVENT_ACTOR_PRINCIPAL_KIND_LENGTH = 64;
