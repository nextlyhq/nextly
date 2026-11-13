/**
 * Which responses already carry their dates in the configured timezone, so a
 * second formatting pass passes them on as they are.
 *
 * A handler that can be mounted on a route of its own (`/singles`, a Single,
 * `/general-settings`) formats its answer itself (`withTimezoneFormatting`),
 * and the admin's catch-all route formats every answer it passes on. Without
 * this, an answer from such a handler through the catch-all was parsed,
 * rewritten and serialized twice, the second time to no effect.
 *
 * Held as a set of the response objects themselves, never as a header, so
 * nothing internal reaches a client whichever route answered. A step that
 * answers with a copy of a response (adding a header to it) carries the
 * mark to the copy ({@link carryDatesFormatted}).
 *
 * On `globalThis`: a Next.js server holds several copies of a package's
 * modules, and a handler and the route that answers for it may each reach a
 * different one. The name carries the shape's version (`_v1`), raised with
 * any change to it: a dev server keeps `globalThis` across a module reload,
 * and must not hand reloaded code what an older build left.
 *
 * @module shared/lib/dates-formatted
 */

const globalForFormatting = globalThis as unknown as {
  __nextly_datesFormatted_v1?: WeakSet<Response>;
};

function formattedResponses(): WeakSet<Response> {
  globalForFormatting.__nextly_datesFormatted_v1 ??= new WeakSet();
  return globalForFormatting.__nextly_datesFormatted_v1;
}

/** Say `response`'s dates read in the configured timezone. */
export function markDatesFormatted(response: Response): Response {
  formattedResponses().add(response);
  return response;
}

/** Whether `response`'s dates already read in the configured timezone. */
export function datesFormatted(response: Response): boolean {
  return formattedResponses().has(response);
}

/** `copy`, marked as `original` is: for a step answering with a copy of it. */
export function carryDatesFormatted(
  original: Response,
  copy: Response
): Response {
  return datesFormatted(original) ? markDatesFormatted(copy) : copy;
}
