/**
 * The Lucide set as the Icon control's source.
 *
 * Reached only through the dynamic `import()` below, so the set (its SVG
 * bodies and search words) is a chunk of its own, fetched the first time an
 * Icon control draws an icon or opens its picker, and never part of the
 * editor's own bundle. The set's source object comes from the set itself
 * (`lucideIconSource`), the one the admin's icon field reads too.
 *
 * @module lucide-icon-source
 */
import type { IconSource } from "@nextlyhq/ui";

/**
 * Loads the set. A module-level function, so every Icon control hands the
 * picker the same loader and the set is loaded once per editor.
 */
export async function loadLucideIcons(): Promise<IconSource> {
  return (await import("@nextlyhq/blocks-react/icons/lucide")).lucideIconSource;
}
