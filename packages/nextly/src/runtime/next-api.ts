/**
 * The one way nextly reaches a Next.js API from code bundlers must not follow.
 *
 * `next/*` is loaded through `createRequire` for the reason
 * `api/with-error-handler.ts` documents: a static or dynamic ESM `import` of a
 * Next subpath breaks Node's ESM resolver when nextly is an external under
 * `serverExternalPackages`, and the `.js`-suffixed workaround sends Turbopack
 * into Next internals that are not on disk. Node's CommonJS resolver is opaque
 * to the bundler, so neither complains, and the package root stays importable
 * where Next.js is not installed. Two different absences are told apart here:
 *
 * - The module itself is not installed, so nextly runs outside a Next.js app
 *   (the CLI, a script, a test). That is a context, not a version, and the
 *   caller decides what to do without Next.js.
 * - The module loads but lacks the API. Every API nextly uses exists in the
 *   supported Next.js range, so this is an unsupported Next.js, and it fails
 *   naming the range rather than falling back.
 *
 * @module runtime/next-api
 */
import { createRequire } from "node:module";

import { NextlyError } from "../errors/nextly-error";

import { SUPPORTED_FRAMEWORK_RANGES } from "./framework-versions";

/** The `next/*` entries nextly loads. */
export type NextModule =
  | "next/cache"
  | "next/headers"
  | "next/navigation"
  | "next/server";

const nodeRequire = createRequire(import.meta.url);

/**
 * True for Node's error for `specifier` itself not being installed. A missing
 * module deeper inside it names that other module and is not this case.
 */
function isNotInstalled(error: unknown, specifier: string): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" &&
    error.message.includes(`'${specifier}'`)
  );
}

/**
 * `specifier`'s exports, or null when Next.js is not installed here. Any other
 * failure to load it is a real error, and is rethrown.
 */
export function loadNextModule(
  specifier: NextModule,
  load: (specifier: string) => unknown = nodeRequire
): Record<string, unknown> | null {
  try {
    return load(specifier) as Record<string, unknown>;
  } catch (error) {
    if (isNotInstalled(error, specifier)) return null;
    throw error;
  }
}

/**
 * The function `name` from a loaded `specifier`. Throws, naming the supported
 * Next.js range, when the module lacks it: the installed Next.js is not one
 * nextly supports.
 */
export function requireNextApi<T>(
  module: Record<string, unknown>,
  specifier: NextModule,
  name: string
): T {
  const api = module[name];
  if (typeof api === "function") return api as T;
  throw new NextlyError({
    code: "CONFIGURATION_ERROR",
    statusCode: 500,
    publicMessage: "Server configuration error.",
    logMessage:
      `${specifier} has no ${name}, which nextly uses: install next ` +
      `${SUPPORTED_FRAMEWORK_RANGES.next}.`,
    logContext: { specifier, name, supported: SUPPORTED_FRAMEWORK_RANGES.next },
  });
}
