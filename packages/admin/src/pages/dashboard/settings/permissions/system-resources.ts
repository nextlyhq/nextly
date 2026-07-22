/**
 * Which resources the permissions page treats as built into Nextly rather than
 * as dynamic collections, and the order it shows them in.
 *
 * Kept as data in its own module rather than inline in the page so the parity
 * test that holds it against core's `SYSTEM_RESOURCES` does not have to import
 * a React page and everything it pulls in.
 *
 * Both lists must name every core system resource. A resource missing from the
 * set is filed under Collections; a resource missing from the order is filed
 * correctly but never rendered in the system group.
 */

/** Resources that are built-in to Nextly (not dynamic collections). */
export const SYSTEM_RESOURCES = new Set([
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
  "webhooks",
]);

/** Display order for the system group; collections follow alphabetically. */
export const SYSTEM_ORDER = [
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
  "webhooks",
];
