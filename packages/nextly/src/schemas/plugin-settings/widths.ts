// The declared widths of plugin settings' bounded columns, shared by each
// dialect's declaration and by the checks that refuse a value too long for
// them. They import nothing, so a check reads a width without loading any
// dialect's tables.

/**
 * `plugin_settings.owner`, a varchar on MySQL; PostgreSQL's and SQLite's
 * text holds anything. Widening it widens the column and loosens the refusal
 * with it.
 */
export const PLUGIN_SETTING_OWNER_LENGTH = 191;

/**
 * `plugin_settings.key`, a varchar on MySQL; PostgreSQL's and SQLite's text
 * holds anything. Widening it widens the column and loosens the refusal with
 * it.
 */
export const PLUGIN_SETTING_KEY_LENGTH = 191;
