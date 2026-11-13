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
import { getNextlyLogger } from "../observability/logger";

import { supportedFrameworkRanges } from "./framework-versions";

/** The `next/*` entries nextly loads. */
export type NextModule =
  | "next/cache"
  | "next/headers"
  | "next/navigation"
  | "next/server";

const nodeRequire = createRequire(import.meta.url);

/**
 * Next's server build of `next/navigation`: what a Server Component's
 * `next/navigation` resolves to under the `react-server` condition. It holds
 * every navigation API nextly calls (`notFound`, `permanentRedirect`,
 * `unstable_rethrow`) and requires only the files that throw and recognise
 * them. `next/navigation` itself is the client entry: on the server it reaches
 * the App Router's React contexts, which Next's require hook sends on to the
 * pages router's compiled runtime, `react-dom`, `styled-jsx` and
 * `client-only`, files a deployment that ships only traced files can lack.
 */
export const NEXT_NAVIGATION_SERVER_ENTRY =
  "next/dist/client/components/navigation.react-server.js";

/**
 * `next/navigation` as nextly loads it on the server: the server build, else
 * the public entry where a Next.js release lays its files out differently.
 * Throws as `require` does, so a caller tells "not installed" (the error
 * names `next/navigation`) from a deployment missing a file further in.
 */
export function requireNextNavigation(): unknown {
  try {
    return nodeRequire(
      "next/dist/client/components/navigation.react-server.js"
    );
  } catch (error) {
    if (!isNotInstalled(error, NEXT_NAVIGATION_SERVER_ENTRY)) throw error;
    return nodeRequire("next/navigation");
  }
}

/**
 * Each entry loaded by its own literal specifier, so a tracer that follows a
 * `createRequire` call with a string can name its files; the variable
 * specifier an earlier loader passed is one no tracer follows.
 */
function requireNextModule(specifier: string): unknown {
  switch (specifier) {
    case "next/navigation":
      return requireNextNavigation();
    case "next/cache":
      return nodeRequire("next/cache");
    case "next/headers":
      return nodeRequire("next/headers");
    case "next/server":
      return nodeRequire("next/server");
    default:
      return nodeRequire(specifier);
  }
}

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
 * True for Node's error for a module `specifier` requires being missing while
 * `specifier` itself was found: a deployment whose trace left part of Next.js
 * out. Not a Next.js version, and not running outside a Next.js app.
 */
export function isMissingFromChain(error: unknown, specifier: string): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" &&
    !isNotInstalled(error, specifier)
  );
}

// The entries an incomplete deployment was named for already: once each is
// enough, and every request after it would repeat the same line.
const reportedIncomplete = new Set<NextModule>();

/**
 * Name, once per entry, a deployment missing a file `specifier` requires, and
 * what Nextly does without it (`instead`). Through nextly's logger, which an
 * app may have replaced.
 */
export function reportMissingFromChain(
  specifier: NextModule,
  error: unknown,
  instead: string
): void {
  if (reportedIncomplete.has(specifier)) return;
  reportedIncomplete.add(specifier);
  const missing =
    error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
  getNextlyLogger().warn({
    kind: "next-module-incomplete",
    message: `${specifier} could not be loaded: the deployment is missing a file it requires (${missing}). Nextly ${instead}. Wrap next.config in withNextly() from nextly/next, or add nextlyTracingIncludes() to outputFileTracingIncludes.`,
    specifier,
  });
}

/**
 * `specifier`'s exports, or null when Next.js is not installed here. Any other
 * failure to load it is a real error, and is rethrown.
 */
export function loadNextModule(
  specifier: NextModule,
  load: (specifier: string) => unknown = requireNextModule
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
  throw NextlyError.configuration({
    logMessage:
      `${specifier} has no ${name}, which nextly uses: install next ` +
      `${supportedFrameworkRanges().next}.`,
    logContext: { specifier, name, supported: supportedFrameworkRanges().next },
  });
}
