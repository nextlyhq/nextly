/**
 * Turning the caller a resolver is handed into the options a read takes.
 *
 * 🔴 The two shapes do not meet, and a plugin cannot bridge them. A resolver
 * receives `ReadCaller`, whose `user` is a `UserContext` -- a plain string id
 * and an OPTIONAL email. `ServiceOpts.user`, which the managed collection and
 * single services take, is an `AuthUser`: a BRANDED id and a required email.
 * So the caller-scoped read the contract tells a plugin to make did not
 * type-check, and the only way through was an assertion in every plugin.
 *
 * One assertion in the host is better than one in each plugin, and this is the
 * place that can justify it: the `ReadCaller` was built by the host from a
 * request it authenticated, so its id IS an authenticated user's id. A plugin
 * has no standing to make that claim about a value it was handed.
 *
 * It also carries the half an author would most easily forget.
 * `authenticatedScope` is what makes an API key judged on the scope stamped
 * into it rather than on the roles of whoever minted it -- omit it and a
 * read-only key inherits its owner's reach. Building the options here means it
 * cannot be left out by accident.
 *
 * @module domains/widgets/caller-read-options
 */

import type { ServiceOpts } from "../../plugins/service-opts";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { AuthUser } from "../../types/auth";

/**
 * The `ServiceOpts` a resolver should pass to read as its caller.
 *
 * `as: "user"` rather than `"system"`, always: a widget answers what THIS
 * reader may see, and a resolver that read as the system would answer every
 * reader with the whole install.
 *
 * @example
 * ```ts
 * const rows = await ctx.services.collections.count(
 *   "posts",
 *   { where: { status: { equals: "draft" } } },
 *   callerReadOptions(caller)
 * );
 * ```
 */
export function callerReadOptions(caller: ReadCaller): ServiceOpts {
  return {
    as: "user",
    // The one assertion, and the reason it is sound is above: this identity
    // came from a request the host authenticated. `email` is absent from a
    // `UserContext` and unused by the access decision, which reads the id and
    // the roles -- so widening it here would add a field no caller supplies
    // and nothing consults.
    user: caller.user as unknown as AuthUser,
    ...(caller.authenticatedScope
      ? { authenticatedScope: caller.authenticatedScope }
      : {}),
  };
}
