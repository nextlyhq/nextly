/**
 * The one way a deprecated surface tells its user so: a notice naming what is
 * deprecated and what replaces it, said once per process.
 *
 * Every deprecation says it through this rather than keeping its own set of
 * what it already said, so none repeats itself on every call and each is said
 * once however many copies of this module a bundle carries. Importing nothing,
 * it is safe in the admin's browser code as in the server's, which is why it
 * is its own entry: the admin reaches it through `nextly/deprecation-notice`
 * and takes nothing more.
 *
 * @experimental
 * @module shared/lib/deprecation-notice
 */

/**
 * What a deprecated surface's user is told.
 *
 * @experimental
 */
export interface DeprecationNotice {
  /**
   * What is deprecated, written as its user writes it, such as
   * `registerKnownPlugin()`. It is also what the notice is said once for, so
   * two uses that should each be told name two surfaces.
   */
  surface: string;
  /** What to use instead, written the same way. */
  replacement: string;
  /** The release the surface is removed in, when that is known. */
  removedIn?: string;
  /**
   * The caller's own words, said in place of the standard sentence, for a
   * notice the sentence does not fit, such as a deprecated value that cannot
   * be carried over and so does nothing. It should still name the surface and
   * what to do instead.
   */
  message?: string;
}

/**
 * Where a notice is written, always the caller's to name: on the server a
 * masked logger, such as a service's logger or `consoleLogger`, and in the
 * admin's browser code the console. This module names none of its own, so it
 * imports nothing and never writes past a logger the server would mask.
 *
 * @experimental
 */
export type DeprecationSink = (message: string) => void;

/**
 * The surfaces already told about in this process, kept on `globalThis` so
 * every copy of this module shares them. A bundle can carry two copies, and a
 * set of each copy's own would say the notice once per copy.
 */
const NOTICED = Symbol.for("nextly/deprecation-noticed");

function noticedSurfaces(): Set<string> {
  const holder = globalThis as unknown as Record<symbol, Set<string>>;
  holder[NOTICED] ??= new Set();
  return holder[NOTICED];
}

/** The words of a notice, the same whichever sink writes them. */
function deprecationMessage(notice: DeprecationNotice): string {
  if (notice.message !== undefined) return `[nextly] ${notice.message}`;
  const said = `[nextly] ${notice.surface} is deprecated: use ${notice.replacement} instead.`;
  return notice.removedIn === undefined
    ? said
    : `${said} It is removed in ${notice.removedIn}.`;
}

/**
 * Tell the user of a deprecated surface, through `sink`, the first time it is
 * used in this process, and say nothing on every later use.
 *
 * @experimental
 */
export function noticeDeprecation(
  notice: DeprecationNotice,
  sink: DeprecationSink
): void {
  const noticed = noticedSurfaces();
  if (noticed.has(notice.surface)) return;
  noticed.add(notice.surface);
  sink(deprecationMessage(notice));
}
