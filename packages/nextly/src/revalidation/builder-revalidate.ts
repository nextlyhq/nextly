/**
 * The Schema Builder's cache-revalidation switch, as the registry stores it.
 *
 * Every path that persists the switch goes through here so they cannot drift:
 * the builder's create and update handlers, the standalone schema routes, and
 * the `ui-schema.json` metadata upserts. Mirrors `resolveBuilderVersions`.
 *
 * @module revalidation/builder-revalidate
 */

import type { RevalidateConfig } from "./types";

/**
 * Resolve the switch into the config the registry column holds.
 *
 * The switch is a plain on/off, and revalidation is on by default: an entity
 * that never touches the control busts the standard derived `nextly:*` tags on
 * every write. On is therefore stored as null (no override) so the write path
 * computes the derived tags; off is stored as `{ disable: true }` so the
 * collection/single busts nothing. Extra custom tags remain a code-first-only
 * control (`revalidate: { tags: [...] }`), which the Builder does not surface.
 */
export function resolveBuilderRevalidate(
  enabled: boolean | undefined
): RevalidateConfig | null {
  return enabled === false ? { disable: true } : null;
}
