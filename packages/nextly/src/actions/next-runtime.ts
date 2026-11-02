/**
 * The Next.js runtime pieces a Server Action needs, behind one seam.
 *
 * WHY A MODULE RATHER THAN A DIRECT IMPORT. Next must not be an import-time
 * dependency of this package — it is loaded lazily through `createRequire` so
 * that importing anything from `nextly` outside a Next app does not fail. That
 * requirement is real and unchanged; what changes is where the requirement is
 * satisfied.
 *
 * A `createRequire` call is invisible to `vi.mock`, which resolves ESM
 * specifiers. So while the require sat inline in `with-action.ts`, the
 * upstream-request-id path could not be exercised by any test: the mock applied
 * to `next/headers` and the code loaded the real module, which throws outside a
 * request scope. The catch then returned a generated id, and the test asserting
 * an upstream header could never reach its assertion — it was skipped rather
 * than deleted, precisely so that absence stayed on the record.
 *
 * WHY `createRequire`. A static `import "next/navigation"` breaks Node's strict
 * ESM resolver when this package is loaded as an external
 * (`serverExternalPackages`), since Next 16 lists no `./navigation` export.
 * The `.js`-suffixed specifier fixes Node but makes Turbopack descend into
 * Next internals that are not on disk, and `await import()` only moves the
 * ESM failure to call time. Node's CommonJS resolver finds
 * `node_modules/next/navigation.js` directly, and bundlers treat the call as
 * opaque.
 *
 * Putting the lazy require behind a module of our own means callers import a
 * specifier tests CAN substitute, while Next is still only touched when one of
 * these functions is called. The resolution is memoised here rather than at the
 * call site so a test that mocks this module bypasses the cache entirely — a
 * cache in the consumer would have leaked the first resolution across a file.
 *
 * @module actions/next-runtime
 */
import { createRequire } from "node:module";

import { requireNextApi } from "../runtime/next-api";

export type HeadersFn = () => Promise<{ get(name: string): string | null }>;
export type UnstableRethrow = (err: unknown) => void;

let cachedHeaders: HeadersFn | null = null;
let cachedUnstableRethrow: UnstableRethrow | null = null;

/** Next's request-scoped `headers()`. The only path a Server Action has to request headers. */
export function getHeaders(): HeadersFn {
  if (cachedHeaders) return cachedHeaders;
  const require = createRequire(import.meta.url);
  const mod = require("next/headers") as { headers: HeadersFn };
  cachedHeaders = mod.headers;
  return cachedHeaders;
}

/**
 * Next's `unstable_rethrow`, which lets framework control-flow errors pass
 * through untouched. The one implementation both the route-handler and the
 * Server Action wrappers use.
 */
export function getUnstableRethrow(): UnstableRethrow {
  if (cachedUnstableRethrow) return cachedUnstableRethrow;
  cachedUnstableRethrow = unstableRethrowFrom(() =>
    createRequire(import.meta.url)("next/navigation")
  );
  return cachedUnstableRethrow;
}

/**
 * Next's own `unstable_rethrow`, else the same check made from the errors'
 * digests when a module `next/navigation` needs is missing.
 *
 * The `createRequire` call is opaque to file tracing, so a host that bundles
 * each function from a trace (Vercel) can ship a bundle in which
 * `next/navigation` loads but a module it requires is missing. That is a
 * deployment's context, not a Next.js version, and only that failure falls back:
 * this runs after a handler has caught an error, so a failing lookup here used to
 * turn that error into a crash of its own. Any other failure is rethrown.
 */
export function unstableRethrowFrom(load: () => unknown): UnstableRethrow {
  let mod: Record<string, unknown>;
  try {
    mod = load() as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "MODULE_NOT_FOUND") {
      return rethrowNextControlFlow;
    }
    throw error;
  }
  return requireNextApi<UnstableRethrow>(
    mod,
    "next/navigation",
    "unstable_rethrow"
  );
}

/**
 * The digests Next gives the errors `unstable_rethrow` passes through: a
 * redirect, a not-found or other HTTP fallback, a bail-out to client
 * rendering, dynamic server usage, a hanging promise and an interrupted
 * prerender (next 16.4, `client/components/unstable-rethrow.js`).
 */
const CONTROL_FLOW_DIGESTS = new Set([
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "DYNAMIC_SERVER_USAGE",
  "HANGING_PROMISE_REJECTION",
  "NEXT_PRERENDER_INTERRUPTED",
]);
const CONTROL_FLOW_DIGEST_PREFIXES = [
  "NEXT_REDIRECT;",
  "NEXT_HTTP_ERROR_FALLBACK;",
];

/**
 * Re-throw a Next control-flow error, or one carried as another error's
 * cause, as `unstable_rethrow` does; return for anything else.
 */
function rethrowNextControlFlow(error: unknown): void {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? error.digest
      : undefined;
  if (
    typeof digest === "string" &&
    (CONTROL_FLOW_DIGESTS.has(digest) ||
      CONTROL_FLOW_DIGEST_PREFIXES.some(prefix => digest.startsWith(prefix)))
  ) {
    throw error;
  }
  if (error instanceof Error && "cause" in error) {
    rethrowNextControlFlow(error.cause);
  }
}
