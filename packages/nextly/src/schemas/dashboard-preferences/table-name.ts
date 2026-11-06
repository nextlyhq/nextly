/**
 * The dashboard preferences table's physical name.
 *
 * @module schemas/dashboard-preferences/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const DASHBOARD_PREFERENCES_TABLE = "nextly_dashboard_preferences";

/**
 * The most a preference's value may hold: a short text, such as a collection
 * slug or a flag, never a document.
 */
export const DASHBOARD_PREFERENCE_VALUE_MAX = 255;
