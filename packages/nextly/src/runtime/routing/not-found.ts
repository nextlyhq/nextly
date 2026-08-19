/**
 * The App Router's not-found boundary, reached without importing `next` at load.
 *
 * `next/navigation` is resolved lazily and opaquely to bundlers, so a module
 * that only MIGHT trigger a 404 does not drag Next into a non-Next consumer.
 *
 * Shared by every route helper rather than copied into each. Two helpers that
 * each decide how to reach `notFound()` agree on the day they are written and
 * drift afterwards, and the drift is invisible: both still 404 in a Next app,
 * and they disagree only about what happens OUTSIDE one, which is exactly the
 * case nobody exercises.
 *
 * @module runtime/routing/not-found
 */
import { createRequire } from "node:module";

import { NextlyError } from "../../errors/nextly-error";

let cachedNotFound: (() => never) | null | undefined;

function loadNotFound(): () => never {
  if (cachedNotFound === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("next/navigation") as { notFound?: () => never };
      cachedNotFound = typeof mod.notFound === "function" ? mod.notFound : null;
    } catch {
      cachedNotFound = null;
    }
  }
  if (!cachedNotFound) {
    // Outside a Next runtime there is no not-found boundary to trigger, so
    // there is nothing to degrade to: returning would hand the caller a page
    // it believes is a 404.
    throw NextlyError.internal({
      logContext: {
        reason:
          "a Nextly route helper requires next/navigation (use it inside a Next.js app)",
      },
    });
  }
  return cachedNotFound;
}

/** Trigger the App Router's not-found boundary; never returns (narrows callers). */
export function triggerNotFound(): never {
  return loadNotFound()();
}
