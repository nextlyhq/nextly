/**
 * Who is making a role change, and whether they may change who is a
 * super-admin.
 *
 * Giving someone super-admin authority and taking it away are a super-admin
 * person's acts, never an API key's, whoever made it. Work with no request
 * caller, which is trusted server code such as the Direct API, a seed or the
 * CLI, keeps being allowed.
 *
 * The caller is the one the transport resolved, pinned for the request by
 * {@link runAsRoleChangeCaller}. A request reaches the services carrying it
 * whether or not a route thought to pass it on, so a route that forgets
 * cannot be read as trusted.
 *
 * @module domains/auth/services/role-change-caller
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { AuthContext } from "../../../auth/middleware";
import { NextlyError } from "../../../errors";
import { isSuperAdminOrThrow } from "../../../services/lib/permissions";

/**
 * Who is making a role change, as the transport resolved them. `visitor` is a
 * request that arrived with no credentials at all.
 */
export type RoleChangeCaller =
  | { kind: "person"; userId: string }
  | { kind: "key" }
  | { kind: "visitor" };

const roleChangeCaller = new AsyncLocalStorage<RoleChangeCaller>();

/**
 * The caller a request's authentication describes, for the role changes it
 * makes: a person for a session, a key for an API key, a visitor with none.
 * The one mapping, for every transport that resolved an `AuthContext`.
 */
export function roleChangeCallerFor(
  authorizedUser: Pick<AuthContext, "authMethod" | "userId"> | undefined
): RoleChangeCaller {
  if (!authorizedUser) return { kind: "visitor" };
  if (authorizedUser.authMethod === "api-key") return { kind: "key" };
  return { kind: "person", userId: authorizedUser.userId };
}

/**
 * Run `operation` with `caller` as the one every role change inside it is
 * judged for. The transport pins it once per request, around the dispatch.
 */
export function runAsRoleChangeCaller<T>(
  caller: RoleChangeCaller,
  operation: () => T
): T {
  return roleChangeCaller.run(caller, operation);
}

/**
 * Refuse the change unless its caller may change who is a super-admin: no
 * request caller (trusted server code), or a super-admin person, judged on
 * their roles as stored, inheritance included, read through `tx`, the
 * change's own transaction. A key is refused whoever made it, as is a request
 * with no credentials.
 *
 * @throws {NextlyError} `forbidden` when the caller may not, with `logContext`
 *   and the caller's kind in its log context. A failure to read the caller's
 *   roles propagates, which refuses the change too.
 */
export async function refuseUnlessSuperAdminCaller(
  tx: unknown,
  logContext: Record<string, unknown>
): Promise<void> {
  const caller = roleChangeCaller.getStore();
  // No request caller: trusted server code, which decides for itself.
  if (caller === undefined) return;
  if (
    caller.kind === "person" &&
    (await isSuperAdminOrThrow(caller.userId, tx))
  ) {
    return;
  }

  throw NextlyError.forbidden({
    logContext: { ...logContext, caller: caller.kind },
  });
}
