/**
 * Admin Placement Constants
 *
 * Typed constants for valid admin sidebar placement sections.
 * Plugin developers use these to declare where their plugin
 * renders in the admin sidebar with full TypeScript autocomplete.
 *
 * @module plugins/admin-placement
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { definePlugin, AdminPlacement } from "@revnixhq/nextly";
 *
 * export const analyticsPlugin = definePlugin({
 *   name: "Analytics Dashboard",
 *   admin: {
 *     placement: AdminPlacement.USERS,
 *     order: 60,
 *     description: "User analytics and insights",
 *   },
 * });
 * ```
 */

/**
 * Valid sidebar placement sections for plugins.
 *
 * Use these constants when specifying `admin.placement` in a plugin definition.
 * Each value maps to a built-in sidebar section in the admin UI.
 *
 * @example
 * ```typescript
 * // Place plugin items alongside collections
 * admin: { placement: AdminPlacement.COLLECTIONS }
 *
 * // Place plugin items in the Users inner sidebar
 * admin: { placement: AdminPlacement.USERS }
 * ```
 */
export const AdminPlacement = {
  /** Plugin items appear in the Collections sidebar section */
  COLLECTIONS: "collections",
  /** Plugin items appear in the Singles sidebar section */
  SINGLES: "singles",
  /** Plugin items appear in the Users inner sidebar (alongside Users, User Fields, Roles) */
  USERS: "users",
  /** Plugin items appear in the Settings inner sidebar (alongside General, API Keys, etc.) */
  SETTINGS: "settings",
  /** Plugin items appear in the dedicated Plugins sidebar section (default) */
  PLUGINS: "plugins",
  /** Plugin gets its own top-level icon in the sidebar (requires appearance.icon) */
  STANDALONE: "standalone",
} as const;

/**
 * Type representing valid admin sidebar placement values.
 *
 * Derived from the `AdminPlacement` constants object.
 * Accepts: `"collections"` | `"singles"` | `"users"` | `"settings"` | `"plugins"` | `"standalone"`
 */
export type AdminPlacement =
  (typeof AdminPlacement)[keyof typeof AdminPlacement];
