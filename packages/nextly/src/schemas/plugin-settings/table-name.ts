/**
 * What the plugin-settings table is called.
 *
 * A leaf on purpose, for the same reason as the RBAC epoch's: the three dialect
 * declarations, the SQLite bootstrap DDL, the core-table manifest and the
 * runtime queries all read the name from here rather than spelling it
 * separately. A name renamed in some of those and not others is not an error —
 * it is a second table that reconciliation creates while every read and write
 * goes to the first.
 *
 * @module schemas/plugin-settings/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const PLUGIN_SETTINGS_TABLE = "nextly_plugin_settings";
