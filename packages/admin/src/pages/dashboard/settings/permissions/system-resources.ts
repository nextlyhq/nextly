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
  // NOT "releases". The name is `content-releases` because registering a system
  // resource RESERVES its name against collections and Singles, and a
  // press-releases collection is one of the most common on a corporate site.
  // See the note beside SYSTEM_RESOURCES in
  // packages/nextly/src/schemas/_zod/rbac.ts before renaming it here.
  "content-releases",
]);

/** Display order for the system group; collections follow alphabetically. */
export const SYSTEM_ORDER = [
  "users",
  "roles",
  "permissions",
  "media",
  // Placed with `media` rather than appended after `webhooks`, because the order
  // groups by what an administrator is doing: people and access first, then the
  // EDITORIAL surfaces, then delivery and integration plumbing. Content releases
  // are an editorial tool an editor reaches daily, not infrastructure.
  "content-releases",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
  "webhooks",
];
