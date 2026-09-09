/**
 * Pinning the HTTP request that produced an operation, for the length of it.
 *
 * Hooks are told about the request through `ctx.req.http`, and an operation can
 * be handed one explicitly. Availability is not enough. Every service call
 * already written names its own arguments, so an opt-in field leaves each of
 * them reporting background work for browser traffic, and every call path
 * written next has to remember. Threading it by hand was tried first, and four
 * rounds of review found paths that had not been threaded: a version restore,
 * a Direct API read, a form lookup, a bulk readback. The shape of that finding
 * is the design telling you where the boundary belongs.
 *
 * So the HTTP boundary pins the request instead, and `resolveRequestFacts`
 * reads it when the caller named none. An explicit request still wins, so a
 * caller that knows better than the ambient value keeps saying so, and the
 * existing explicit call sites keep meaning what they say.
 *
 * `AsyncLocalStorage` rather than a module variable: requests are served
 * concurrently, and a shared variable would hand one request's address to
 * another. The same reason `caller-scope.ts` uses it to pin an API key's
 * grants, which is the same problem one field over.
 *
 * @module hooks/request-scope
 */

import { AsyncLocalStorage } from "node:async_hooks";

const requestScope = new AsyncLocalStorage<Request | undefined>();

/**
 * Run `operation` with `request` as the one every call inside it inherits.
 *
 * Passing `undefined` CLEARS an enclosing scope rather than leaving it in
 * place, which is what a job started from inside a request needs: it runs on
 * nobody's request even though a request is what set it going.
 */
export function runWithRequestScope<T>(
  request: Request | undefined,
  operation: () => T
): T {
  return requestScope.run(request, operation);
}

/**
 * The request pinned for the operation currently running, if any.
 *
 * `undefined` outside an HTTP boundary -- a job, the CLI, a seed, a direct
 * service call -- so nothing acquires a request it was never given.
 */
export function currentRequest(): Request | undefined {
  return requestScope.getStore();
}
