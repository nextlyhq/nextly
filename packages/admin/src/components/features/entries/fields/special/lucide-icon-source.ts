/**
 * The Lucide set as the icon field's source.
 *
 * The set is roughly 600 KB of SVG bodies and tags, so it is reached only
 * through the dynamic `import()` below: the bundler keeps it in a chunk of its
 * own, fetched the first time an icon field draws an icon or opens its picker,
 * and never part of the admin's main bundle. This is the admin's one path to
 * `@nextlyhq/blocks-react`; `renderer-covers-the-editor.test.ts` holds the
 * admin to it, and `scripts/check-bundle-boundaries.mjs` holds the built
 * chunks to it.
 *
 * @module components/features/entries/fields/special/lucide-icon-source
 */

import type { IconSource } from "@nextlyhq/ui";

/**
 * Loads the Lucide set and answers searches and ids from it.
 *
 * A module-level function, so every icon field on a page hands the picker the
 * same loader and the set is loaded once.
 */
export async function loadLucideIcons(): Promise<IconSource> {
  const lucide = await import("@nextlyhq/blocks-react/icons/lucide");
  return {
    prefix: lucide.LUCIDE_PREFIX,
    label: "Lucide",
    search: query => lucide.searchLucideIcons(query),
    resolve: id => lucide.resolveLucideIcon(id),
  };
}
