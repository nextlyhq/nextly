/**
 * Which plugin-defined person, if any, the operation running now is made as.
 *
 * A call made as a person reaches the access gate, field rules and hooks
 * through many hops: a service method, a transaction, a relationship
 * expansion, a readback. Threaded as an argument, a hop that forgot to pass it
 * on would leave the person looking like an anonymous caller, and an anonymous
 * caller falls through to a collection's public default where a person must be
 * refused. So the person travels the way an API key's scope does
 * (`caller-scope.ts`): pinned for the length of the call, and read where a
 * decision is made. A hop cannot drop what it never carried.
 *
 * Every Direct API and plugin service call opens its own frame, with its
 * person or with none, so a call naming nobody never inherits the person of
 * the call that set it going: a hook's own Direct API call is judged as what
 * that call says it is.
 *
 * `AsyncLocalStorage` rather than a module variable, for the reason every
 * other caller scope here uses it: requests are served concurrently.
 *
 * @module auth/principal-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Principal } from "../plugins/principals/types";

const principalScope = new AsyncLocalStorage<Principal | null>();

/**
 * Run `operation` made as `principal`, or, given `null`, as no person.
 *
 * `null` is a frame of its own rather than no frame, so it CLEARS a person an
 * enclosing call was made as.
 */
export function runAsPrincipal<T>(
  principal: Principal | null,
  operation: () => T
): T {
  return principalScope.run(principal, operation);
}

/** The person the operation running now is made as, or `null`. */
export function currentPrincipal(): Principal | null {
  return principalScope.getStore() ?? null;
}

/**
 * A hook's context with the person the operation is made as, when it is
 * made as one.
 *
 * The key is added only for a person, so a hook running for anyone else
 * receives exactly the context it received before. Added where handlers are
 * called rather than where contexts are built, because contexts are built in
 * many places and handlers are called in few.
 */
export function withCurrentPrincipal<C extends object>(
  context: C
): C & { principal?: Principal } {
  const principal = currentPrincipal();
  return principal === null ? context : { ...context, principal };
}
