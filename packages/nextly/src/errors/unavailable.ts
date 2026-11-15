/**
 * Whether a failure means Nextly is unavailable, and what a page render does
 * about it: fail in production rather than be served without what Nextly
 * would have given it.
 *
 * A page's head and structured data are asked of Nextly and its plugins while
 * the page renders. A failure there used to cost the page that answer and
 * nothing else, which is right for a failure that is the answer's own (a
 * plugin's bug, an answer of the wrong shape): it fails the same way however
 * often the page is rendered, and the page is better served without it. It
 * is wrong for an outage. Next.js keeps what a render produced: the page
 * rendered while the database was briefly unreachable is cached, or baked
 * into the build, without its SEO, and served that way until it is rendered
 * again. A render that fails instead keeps the page it would have replaced
 * (Next.js serves the last good page when a revalidation throws) and fails a
 * build rather than letting it ship such pages.
 *
 * So in production an unavailable Nextly fails the render, and every other
 * failure falls back as before. In development the fallback stays, with its
 * warning, so a database stopped on a laptop does not take every page down.
 *
 * Generic on purpose: it says nothing about SEO, so any code rendering a page
 * from Nextly, a plugin's included (through `@nextlyhq/plugin-sdk`), asks the
 * same question the same way.
 *
 * @module errors/unavailable
 */
import {
  isDbError,
  isUnreachedDatabaseCode,
  isUnreachedDbErrorKind,
  safeCode,
} from "../database/errors";
import { firstAnswer } from "../database/missing-column";
import { isStartFailure } from "../init/start-failure";
import { isProductionRuntime } from "../shared/builder-refusal";

import { NextlyError } from "./nextly-error";

/**
 * The codes Nextly answers with when it cannot serve right now and trying
 * again shortly is the remedy: the database busy, a rule whose query was
 * given no connection, a service unavailable.
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "DATABASE_BUSY",
  "RULE_COULD_NOT_RUN",
  "SERVICE_UNAVAILABLE",
]);

/**
 * The same, as the adapters' own `DatabaseError` names them
 * (`@nextlyhq/adapter-drizzle`). Read by shape, as `isDbError` reads core's:
 * importing the adapter here would put a database package in every bundle
 * that reaches `NextlyError`.
 */
const UNAVAILABLE_ADAPTER_KINDS: ReadonlySet<string> = new Set([
  "connection",
  "timeout",
]);

/** Whether one level of an error chain, on its own, says Nextly is unavailable. */
function levelIsUnavailable(level: unknown): boolean {
  if (isStartFailure(level)) return true;
  if (NextlyError.is(level)) return UNAVAILABLE_CODES.has(level.code);
  if (isDbError(level) && isUnreachedDbErrorKind(level.kind)) return true;
  if (
    level instanceof Error &&
    level.name === "DatabaseError" &&
    "kind" in level &&
    typeof level.kind === "string" &&
    UNAVAILABLE_ADAPTER_KINDS.has(level.kind)
  ) {
    return true;
  }
  // Otherwise by the driver's code: a driver's own error, which a read through
  // Drizzle directly hands its caller unconverted, or an adapter's or core's
  // error of another kind that kept the code it could not classify.
  return isUnreachedDatabaseCode(safeCode(level));
}

/**
 * Whether `error` means Nextly is unavailable: its start failed, it answered
 * that the database is busy or a service unavailable, or the database could
 * not be reached or did not answer in time, whether an adapter, core or the
 * driver itself (by its code) said so. The error and every cause it carries
 * are read, since a service or Drizzle usually wraps what the driver threw.
 *
 * Anything else, a refusal, a bad answer, a bug, is not: it would fail the
 * same way on the next render.
 *
 * @experimental Settles with the page-metadata contract.
 */
export function isNextlyUnavailable(error: unknown): boolean {
  return (
    firstAnswer(error, level =>
      levelIsUnavailable(level) ? true : undefined
    ) === true
  );
}

/** The phase Next.js sets while `next build` builds and prerenders. */
const PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Whether a page rendered now is rendered for production: by a production
 * server, or by `next build`. `next build` sets `NODE_ENV` to production
 * unless the environment already set it to something else, and sets
 * `NEXT_PHASE` either way, before it starts the workers that prerender, so a
 * build run under another `NODE_ENV` is still one.
 */
function renderingForProduction(): boolean {
  return (
    isProductionRuntime() || process.env.NEXT_PHASE === PRODUCTION_BUILD_PHASE
  );
}

/**
 * Throw when `error` means Nextly is unavailable and the page is rendered for
 * production, so the render fails rather than serving the page without what
 * Nextly would have given it; return otherwise, for the caller's fallback.
 *
 * For a catch around anything a page render asks of Nextly. Called after
 * Next.js's own control-flow signals are rethrown, and before the fallback:
 *
 * ```ts
 * try {
 *   return await askNextly();
 * } catch (error) {
 *   failRenderWhenUnavailable(error);
 *   return fallback;
 * }
 * ```
 *
 * A `NextlyError` that already says so is thrown as it is; anything else is
 * thrown as `SERVICE_UNAVAILABLE`, carrying it as its cause.
 *
 * @experimental Settles with the page-metadata contract.
 */
export function failRenderWhenUnavailable(error: unknown): void {
  if (!renderingForProduction() || !isNextlyUnavailable(error)) return;
  if (NextlyError.is(error) && UNAVAILABLE_CODES.has(error.code)) throw error;
  throw NextlyError.serviceUnavailable({
    logMessage:
      "Nextly is unavailable, so the page is not rendered: in production a page is never served without what Nextly gives it. Next.js keeps serving the page's last good render, and a build fails rather than shipping pages built without it.",
    ...(error instanceof Error ? { cause: error } : { logContext: { error } }),
  });
}
