/**
 * Whether the code running now is a page builder named query's `run`.
 *
 * A named query is developer code a published page runs to read its rows. It
 * is handed a reader that reads as an anonymous visitor, and the rest of the
 * page builder's guarantees (only declared reads, rows as visitors see them)
 * rest on that reader being the only way it reads. But `run` is ordinary
 * server code: a closure that imports the trusted Direct API could read with
 * the server's access, and its rows would reach a published page.
 *
 * So the renderer runs `run` inside this frame, and the Direct API refuses
 * every call made inside it that would not read as an anonymous visitor
 * (`assertVisitorCallInsideNamedQuery`). It fails closed: a call that names
 * no access at all defaults to the server's, and is refused.
 *
 * A call that passes runs with the frame cleared, so the collection hooks it
 * reaches are judged as they are for any published list's read, and nothing
 * a hook does is refused for having been reached from a named query.
 *
 * `AsyncLocalStorage`, for the reason every caller scope here uses it: pages
 * render concurrently. The cost is one store lookup per Direct API call.
 *
 * @module auth/named-query-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../errors/nextly-error";

const namedQueryFrame = new AsyncLocalStorage<string>();

/**
 * Run `operation` as the named query `name`: every Direct API call it makes
 * must read as an anonymous visitor.
 *
 * @experimental
 */
export function runInsideNamedQuery<T>(name: string, operation: () => T): T {
  return namedQueryFrame.run(name, operation);
}

/** The named query running now, or `undefined` outside one. */
export function currentNamedQuery(): string | undefined {
  return namedQueryFrame.getStore();
}

/** Run `operation` outside any named query's frame. */
export function outsideNamedQuery<T>(operation: () => T): T {
  return namedQueryFrame.exit(operation);
}

/** A call's access, as it reaches the Direct API, with the instance's defaults applied. */
export interface NamedQueryCallAccess {
  readonly overrideAccess?: boolean;
  readonly user?: unknown;
  readonly principal?: unknown;
  readonly fieldAccessUser?: unknown;
  readonly actor?: unknown;
}

/**
 * Refuse a Direct API call made inside a named query unless it reads as an
 * anonymous visitor: access rules applied, and no user, person, field-rule
 * user or key named. `operation` names the call in the log.
 */
export function refusedInsideNamedQuery(
  access: NamedQueryCallAccess | undefined,
  operation: string
): NextlyError | undefined {
  const query = currentNamedQuery();
  if (query === undefined) return undefined;
  const asVisitor =
    access !== undefined &&
    access.overrideAccess === false &&
    access.user === undefined &&
    access.principal === undefined &&
    access.fieldAccessUser === undefined &&
    access.actor === undefined;
  if (asVisitor) return undefined;
  // The log names the query and the call; a named query reads only through
  // the reader it is given.
  return NextlyError.forbidden({
    logContext: { reason: "named-query-trusted-read", query, operation },
  });
}
