/**
 * Pinning the HTTP request that produced an operation, for the length of it.
 *
 * Hooks are told about the request through `ctx.req.http`, and an operation can
 * be handed one explicitly. Availability is not enough. A service call names
 * its own arguments, so an opt-in field is carried only by the call paths that
 * name it, and a path that does not is not silent: it reports background work
 * for browser traffic, which is the answer a request-scoped rule acts on. The
 * paths are many and indirect -- a version restore reaches an update through a
 * read gate, a Direct API write reads its own result back, a form submission
 * looks up its form first -- so an omission is invisible at the call site and
 * wrong several layers away.
 *
 * So the HTTP boundary pins the request, and `resolveRequestFacts` reads it
 * when the caller named none. An explicit request still wins, so a caller that
 * knows better than the ambient value keeps saying so, and every call site that
 * names one keeps meaning what it says.
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
