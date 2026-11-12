/**
 * The primary-rail sections a route can belong to.
 *
 * Declared here rather than beside the sidebar components because the ROUTE
 * registry names these values, and a page registry that imported a component's
 * types would invert the dependency. Both the registry and the sidebar read
 * this module, so there is one vocabulary rather than two that agree today.
 *
 * `standalone-<slug>` is deliberately NOT a member. A standalone rail entry
 * exists only for a plugin that is currently mounted, so it cannot be written
 * as a literal in a static declaration — permitting it here would admit a
 * fabricated id that matches no plugin and silently selects nothing.
 *
 * @module constants/nav-sections
 */
export const NAV_SECTIONS = [
  "dashboard",
  "collections",
  "singles",
  "media",
  "releases",
  "translations",
  "plugins",
  "settings",
  "builders",
] as const;

/** A rail section nameable by a static declaration. */
export type NavSection = (typeof NAV_SECTIONS)[number];

/**
 * Any rail entry that can be ACTIVE, including a mounted standalone plugin's.
 *
 * Wider than `NavSection` on purpose: a standalone id is resolvable at runtime
 * but not declarable, so the two types are not interchangeable and the compiler
 * should say so.
 */
export type ActiveNavSection = NavSection | `standalone-${string}`;

/** Whether a string is one of the declarable rail sections. */
export function isNavSection(value: string): value is NavSection {
  return (NAV_SECTIONS as readonly string[]).includes(value);
}
