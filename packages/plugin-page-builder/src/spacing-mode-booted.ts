/**
 * The spacing model of the instance this process booted, read at call time.
 *
 * Server-only: see the reader below for why no browser entry may reach it.
 *
 * @module spacing-mode-booted
 */
import {
  fieldOf,
  spacingModeReaderOf,
  type SpacingModeReader,
} from "./spacing-mode-reader";

/**
 * The reader of the instance this process booted, for a render handed a
 * reader with no plugin services: the documented route wraps the instance in
 * a reader of `find`, `findByID` and `findSingle` alone. `undefined` when the
 * process has booted no instance, or it offers no such service.
 *
 * Kept out of every module a browser entry reaches: a call-time `import()` of
 * the SDK root takes its whole namespace, which reaches Node built-ins, and a
 * browser bundler resolves it like a static import. Only server paths import
 * this module (the published `loadSiteStyle` and the editor's style route).
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
