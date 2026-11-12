/**
 * The App Router's not-found boundary, reached without importing `next` at load.
 *
 * `next/navigation` is loaded through {@link loadNextModule}, so a module that
 * only MIGHT trigger a 404 does not drag Next into a non-Next consumer.
 *
 * Shared by every route helper rather than copied into each. Two helpers that
 * each decide how to reach `notFound()` agree on the day they are written and
 * drift afterwards, and the drift is invisible: both still 404 in a Next app,
 * and they disagree only about what happens OUTSIDE one, which is exactly the
 * case nobody exercises.
 *
 * @module runtime/routing/not-found
 */
import { NextlyError } from "../../errors/nextly-error";
import {
  isMissingFromChain,
  loadNextModule,
  reportMissingFromChain,
  requireNextApi,
} from "../next-api";
import { notFoundError, permanentRedirectError } from "../next-control-flow";

/** Loads a module by specifier, as `require` does; replaced in tests. */
type Load = (specifier: string) => unknown;

/**
 * Where Next.js is not installed there is no not-found boundary to trigger and
 * no response to redirect, so there is nothing to degrade to: returning would
 * hand the caller a page it believes was answered.
 */
function outsideNextApp(): NextlyError {
  return NextlyError.internal({
    logContext: {
      reason:
        "a Nextly route helper requires next/navigation (use it inside a Next.js app)",
    },
  });
}

/**
 * `name` from `next/navigation`, else `fallback` when `next/navigation` was
 * found but a module it requires was not. A host that deploys each function
 * with only its traced files (Vercel) can ship that bundle: Nextly's require
 * of `next/navigation` is opaque to the trace, and Next's require hook sends
 * it on to files no trace names. The fallback throws the same error, by
 * digest, as Next's own helper, so the visitor gets the 404 or the redirect
 * rather than a 500. Not installed at all: {@link outsideNextApp}.
 */
function navigationApi<A extends unknown[]>(
  name: string,
  fallback: (...args: A) => never,
  load: Load | undefined
): (...args: A) => never {
  let mod: Record<string, unknown> | null;
  try {
    mod = loadNextModule("next/navigation", load);
  } catch (error) {
    if (!isMissingFromChain(error, "next/navigation")) throw error;
    reportMissingFromChain(
      "next/navigation",
      error,
      "answers its not-found pages and redirects with Next.js's errors built by digest"
    );
    return fallback;
  }
  if (!mod) {
    return () => {
      throw outsideNextApp();
    };
  }
  return requireNextApi<(...args: A) => never>(mod, "next/navigation", name);
}

/** Next's `notFound`, or its error by digest when `next/navigation` is incomplete. */
export function notFoundFrom(load?: Load): () => never {
  return navigationApi(
    "notFound",
    () => {
      throw notFoundError();
    },
    load
  );
}

/** Next's `permanentRedirect`, or its error by digest when `next/navigation` is incomplete. */
export function permanentRedirectFrom(load?: Load): (path: string) => never {
  return navigationApi(
    "permanentRedirect",
    (path: string) => {
      throw permanentRedirectError(path);
    },
    load
  );
}

let cachedNotFound: (() => never) | undefined;

/** Trigger the App Router's not-found boundary; never returns (narrows callers). */
export function triggerNotFound(): never {
  cachedNotFound ??= notFoundFrom();
  return cachedNotFound();
}

let cachedPermanentRedirect: ((path: string) => never) | undefined;

/**
 * Answer with a permanent redirect to `path`; never returns.
 *
 * Reached the way {@link triggerNotFound} reaches its boundary, and for the
 * same reason: a module that only MIGHT redirect does not drag Next into a
 * non-Next consumer. Permanent, because a page reached by a second spelling
 * of its address (a list's `/page/1`) should be indexed under its first.
 */
export function triggerPermanentRedirect(path: string): never {
  cachedPermanentRedirect ??= permanentRedirectFrom();
  return cachedPermanentRedirect(path);
}
