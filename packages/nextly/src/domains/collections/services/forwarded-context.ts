/**
 * Everything the collection facade forwards from a {@link RequestContext} to
 * the entry service, in one object so no field can travel without the others.
 *
 * They are not the same KIND of thing, and the docblocks below say which is
 * which — but they share one failure, which is why they share one function.
 * Each facade method used to rebuild this argument as a hand-written literal,
 * and a literal drops whatever it does not name. That dropped the hook context,
 * so a plugin could not reach a channel core had accepted for months; and it
 * dropped an API key's scope, so a key scoped to read was authorized on its
 * OWNER's roles. Two unrelated defects, one shape, found weeks apart.
 *
 * Spread this rather than listing the fields inline. TypeScript cannot object
 * to the omission: a spread into an object literal is exempt from
 * excess-property checking, and every field here is optional on the
 * destination, so both directions of the mistake compile clean.
 * `forwarded-context-seam.test.ts` fails the build if a facade method
 * hand-writes them instead.
 *
 * The same reasoning and shape as the Direct API's `accessOptions`, which
 * closed the scope half on that transport; this is the seam the facade lacked.
 *
 * @module domains/collections/services/forwarded-context
 */

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { RequestContext } from "../../../shared/types";

/** What the entry service receives about the call it is being asked to make. */
export interface ForwardedContext {
  /** The authenticated ACCOUNT — for an API key, the key's owner. */
  user: RequestContext["user"];
  /** Trusted-server elevation; skips the access check, never validation or hooks. */
  overrideAccess: boolean | undefined;
  /**
   * PERMISSION. The caller's own grants when they arrived on an API key, so the
   * key is judged on what it was stamped with rather than on its owner's roles.
   * Narrows what the caller may do; never widens it.
   */
  authenticatedScope: AuthenticatedScope | undefined;
  /**
   * DATA, not permission. Arbitrary values this operation's hooks receive as
   * `ctx.context` — how a caller tells a hook something about the CALL that the
   * row cannot say. Nothing here bypasses access, validation or any hook.
   */
  context: Record<string, unknown> | undefined;
  /**
   * The HTTP request that produced this operation, when one did. The core
   * resolves it into what hooks read as `ctx.req.http`; its absence is what
   * tells a rule scoped to a visitor that a seed or a job made this write.
   */
  request: Request | undefined;
}

/** Read what the entry service needs off a {@link RequestContext}, whole. */
export function forwardedFromContext(
  context: RequestContext
): ForwardedContext {
  return {
    user: context.user,
    overrideAccess: context.overrideAccess,
    authenticatedScope: context.authenticatedScope,
    context: context.context,
    request: context.request,
  };
}
