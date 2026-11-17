/**
 * What the builder's start-up read asks and answers, shared by the route and
 * the editor that sends it.
 *
 * The builder opens on several of this plugin's reads at once: the
 * collections a list may show, the custom sources, the component library,
 * what the author may do, the site style, the pages collection and the
 * Layout choices. Sent one by one, each is a request, and on a deployed site
 * each request is a function call. The start-up read asks them in one request
 * and answers each as its own route would have.
 *
 * Its own module, free of server imports, so the admin bundle takes the
 * shapes without the route's reads.
 *
 * @module builder-startup-contract
 */

/** Where the start-up read is asked, under this plugin's own namespace. */
export const BUILDER_STARTUP_ROUTE_PATH = "/builder/startup";

/** The query parameter naming one read, by the path its own route answers at. */
export const BUILDER_STARTUP_READ_PARAM = "read";

/** The most reads one start-up request may name. */
export const BUILDER_STARTUP_MAX_READS = 12;

/** The longest path one read may name, its query included. */
export const BUILDER_STARTUP_PATH_MAX = 600;

/**
 * One read's answer: its route's status, and its body when it answered.
 *
 * A read its route refused, or one that failed, carries its status and no
 * body. The editor then asks that route itself, so the refusal reaches the
 * screen exactly as the route words it.
 */
export interface BuilderStartupAnswer {
  readonly status: number;
  readonly body?: unknown;
}

/** The start-up read's answer: each read it named, by its path. */
export interface BuilderStartupResponse {
  readonly reads: Readonly<Record<string, BuilderStartupAnswer>>;
}

/** The start-up read's path, naming each read by its own route's path. */
export function builderStartupPath(reads: readonly string[]): string {
  const query = new URLSearchParams();
  for (const read of reads) query.append(BUILDER_STARTUP_READ_PARAM, read);
  return `${BUILDER_STARTUP_ROUTE_PATH}?${query.toString()}`;
}
