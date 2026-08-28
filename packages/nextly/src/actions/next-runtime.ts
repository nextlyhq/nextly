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
 * Putting the lazy require behind a module of our own means callers import a
 * specifier tests CAN substitute, while Next is still only touched when one of
 * these functions is called. The resolution is memoised here rather than at the
 * call site so a test that mocks this module bypasses the cache entirely — a
 * cache in the consumer would have leaked the first resolution across a file.
 *
 * @module actions/next-runtime
 */
import { createRequire } from "node:module";

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

/** Next's `unstable_rethrow`, which lets framework control-flow errors pass through untouched. */
export function getUnstableRethrow(): UnstableRethrow {
  if (cachedUnstableRethrow) return cachedUnstableRethrow;
  const require = createRequire(import.meta.url);
  const mod = require("next/navigation") as {
    unstable_rethrow: UnstableRethrow;
  };
  cachedUnstableRethrow = mod.unstable_rethrow;
  return cachedUnstableRethrow;
}
