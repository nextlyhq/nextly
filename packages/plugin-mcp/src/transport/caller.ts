/**
 * Who is asking, for the length of one request.
 *
 * The protocol library builds its server through a factory it calls per
 * request, and hands that factory its own context: an era, the `Request`, and
 * an optional `authInfo`. None of those is Nextly's caller. `authInfo` is an
 * OAuth shape, a token with a flat list of scope strings, and Nextly decides
 * access from the services facade with the caller's user and the grants stamped
 * on the key they arrived with. Flattening one into the other would answer the
 * authorization question a second time, beside the routes the rest of this CMS
 * is reached through, and the two would drift while both looked correct.
 *
 * So the route context travels as itself.
 *
 * ## Only the CONTEXT travels here, not the authorization
 *
 * A key's own grants are already ambient: the plugin dispatcher runs every
 * handler inside `runWithCallerScope`, so a service call made anywhere in the
 * request, however deeply awaited, is judged on the grants the key carries
 * rather than on its owner's roles. Nothing here repeats that, and nothing here
 * should: it is the same question, and it already has one implementation.
 *
 * What is missing without this module is the context object itself. `services`
 * and `user` are values on `ctx`, and a handler that declares only `request`
 * discards them before the protocol layer can see them.
 *
 * ## Why a scope rather than a parameter
 *
 * The handler is built once, deliberately, because rebuilding it per request
 * would discard the change-event bus every open subscription stream is attached
 * to. So the factory closes over the endpoint's options and cannot close over a
 * caller who did not exist when it was built, and the library offers no seam to
 * pass one but `authInfo`.
 *
 * `AsyncLocalStorage` rather than a module variable, for the reason core's
 * `auth/caller-scope.ts` gives: requests are served concurrently, and a shared
 * variable hands one request's caller to another.
 *
 * @module transport/caller
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";

const asking = new AsyncLocalStorage<PluginRouteContext>();

/**
 * Serve `operation` with `ctx` as the caller everything inside it can read.
 *
 * The window is one request. It opens after core has authenticated, so a caller
 * that reaches here has already been identified, and closes when the response
 * resolves.
 */
export function whileServing<T>(
  ctx: PluginRouteContext,
  operation: () => Promise<T>
): Promise<T> {
  return asking.run(ctx, operation);
}

/**
 * The caller this request belongs to.
 *
 * Throws rather than answering `undefined`, and that is the whole of its value.
 * The alternative is a server built for nobody: a tool would then read and
 * write with no user and no grants attached, which is not a narrower answer
 * than the caller deserves but an unscoped one. Refusing the request is the
 * direction to fail in, and it fails at construction rather than at the first
 * read, so the refusal names its cause.
 *
 * Reachable only where something outside {@link whileServing} builds a server:
 * a caller added to this package that serves without opening the window. That
 * is a defect in this package rather than anything a client can provoke, so the
 * message is written for whoever added it.
 */
export function callerNow(): PluginRouteContext {
  const ctx = asking.getStore();
  if (ctx === undefined) {
    throw new Error(
      "@nextlyhq/plugin-mcp: no caller is in scope. A protocol server may " +
        "only be built inside `whileServing`, which the endpoint opens once " +
        "core has authenticated the request."
    );
  }
  return ctx;
}
