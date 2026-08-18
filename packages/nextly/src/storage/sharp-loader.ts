/**
 * The one place this package reaches for sharp.
 *
 * sharp is an optional peer dependency: its native libvips binaries are around
 * 17 MB per platform, and an install that never uploads an image does not
 * execute a line of it. Keeping it out of the hard dependency graph is the
 * difference between every install paying for image processing and only the
 * ones that use it paying.
 *
 * Returns `null` instead of throwing, which is the deliberate difference from
 * the nodemailer loader beside it. An SMTP send has nothing to fall back to, so
 * throwing there is right. An upload has a good degraded outcome -- store the
 * file, skip the derived data -- so the decision belongs to each caller rather
 * than to this module.
 *
 * @module storage/sharp-loader
 */

import { createRequire } from "node:module";

import type { default as SharpDefault } from "sharp";

/** The command reported to an install that wants image processing. */
export const SHARP_INSTALL_COMMAND = "npm install sharp";

/**
 * The callable this package uses. Imported as a TYPE only, which is erased at
 * compile time, so type-checking never requires the package to be installed.
 */
type SharpModule = typeof SharpDefault;

const requireFrom = createRequire(import.meta.url);

/**
 * A module supplied by the host rather than resolved from disk.
 *
 * Payload requires this and resolves nothing, which costs its users an install
 * AND a config edit. Here it is the escape hatch instead: automatic resolution
 * keeps the ordinary case to a single command, and this covers a bundler that
 * cannot resolve a native module on its own.
 */
let injected: SharpModule | null = null;

/** Supply sharp explicitly. Pass `null` to clear. */
export function setSharp(module: SharpModule | null): void {
  injected = module;
}

/**
 * Whether the library can be found, without executing it.
 *
 * Resolution rather than import, because this answers a synchronous question
 * asked while deciding what to tell an operator, and finding out whether
 * something is installed should not run its module initialisation.
 */
export function isSharpAvailable(): boolean {
  if (injected) return true;

  try {
    requireFrom.resolve("sharp");
    return true;
  } catch {
    return false;
  }
}

/** The value, if it can actually produce an image pipeline. */
function imageFactoryOf(value: unknown): SharpModule | undefined {
  return typeof value === "function" ? (value as SharpModule) : undefined;
}

/**
 * Load sharp, or report that this install does not have it.
 *
 * `resolver` exists so a test can model an absent or hostile module without
 * touching the filesystem. Production callers pass nothing.
 */
export async function loadSharp(options?: {
  // Returns `unknown` rather than a union with a promise: `unknown` already
  // covers both, and `await` resolves a thenable or passes a plain value
  // through unchanged.
  resolver?: () => unknown;
}): Promise<SharpModule | null> {
  if (injected) return injected;

  try {
    const loaded = await (options?.resolver
      ? options.resolver()
      : import("sharp"));

    if (loaded === null || loaded === undefined) return null;

    // Published as CommonJS, so an ESM host may receive the module namespace
    // with the real export on `default`. Both shapes are handled rather than
    // one assumed, because which arrives depends on the host's bundler.
    //
    // Order is NOT load-bearing here, unlike a loader that probes a NAMED
    // export: `imageFactoryOf` asks only `typeof value === "function"`, and a
    // namespace object fails that without any property being read. A namespace
    // that throws on unknown names therefore cannot be tripped by this probe.
    // `default` is still read first because a CommonJS module is the common
    // case and finding it immediately avoids a second check.
    return (
      imageFactoryOf((loaded as { default?: unknown }).default) ??
      imageFactoryOf(loaded) ??
      null
    );
  } catch {
    // Absent, or present and unloadable. Both mean this install cannot process
    // images and both have the same remedy, so they are one outcome here.
    return null;
  }
}
