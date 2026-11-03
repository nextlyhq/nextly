/**
 * How a render reads the site's spacing model: through the plugin service
 * the Direct API offers, so a page needs nothing but the instance it already
 * holds. Free of any database import, because the published render reaches it
 * from the package root.
 *
 * @module spacing-mode-reader
 */
import type { SpacingMode } from "@nextlyhq/blocks-engine";

import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";

/** The plugin service a render reads the site's spacing model through. */
export const SPACING_MODE_SERVICE = "spacingMode";

/** What a render needs: the recorded model, or `null` when none is. */
export interface SpacingModeReader {
  read(): Promise<SpacingMode | null>;
}

/**
 * The spacing-model reader a Direct API instance offers, or `undefined` when
 * it offers none: a reader with no plugin services, or an app without this
 * plugin installed. Asked through the services namespace so a render needs
 * nothing but the Direct API it already holds.
 */
export function spacingModeReaderOf(nextly: {
  readonly plugins?: unknown;
}): SpacingModeReader | undefined {
  const service = fieldOf(
    fieldOf(nextly.plugins, PAGE_BUILDER_PLUGIN_NAME),
    SPACING_MODE_SERVICE
  );
  if (typeof service !== "object" || service === null) return undefined;
  const { read } = service as { read?: unknown };
  return typeof read === "function"
    ? { read: () => (read as SpacingModeReader["read"]).call(service) }
    : undefined;
}

/**
 * The reader of the instance this process booted, for a render handed a
 * reader with no plugin services: the documented route wraps the instance in
 * a reader of `find`, `findByID` and `findSingle` alone. `undefined` when the
 * process has booted no instance, or it offers no such service.
 *
 * Imported at call time, as the plugin's own boot reaches the instance: this
 * module is reached from the package root, which a browser bundle imports.
 */
export async function bootedSpacingModeReader(): Promise<
  SpacingModeReader | undefined
> {
  try {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const instance: unknown = await getCachedNextly();
    return spacingModeReaderOf({ plugins: fieldOf(instance, "plugins") });
  } catch {
    // No booted instance: nothing records a model for this render.
    return undefined;
  }
}

/** One field of a value read as an object, or `undefined` when it is not one. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Readonly<Record<string, unknown>>)[key];
}
