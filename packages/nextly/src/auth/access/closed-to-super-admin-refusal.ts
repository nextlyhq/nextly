/**
 * The question every way in asks before its super-admin shortcut: is this
 * collection closed to super-admin, and does this caller hold super-admin
 * authority? Apart from `./closed-to-super-admin` so that module stays free
 * of the actor lookups and the access decision can import it without a cycle.
 *
 * @module auth/access/closed-to-super-admin-refusal
 */

import {
  scopeHoldsSuperAdmin,
  type AuthenticatedScope,
} from "../authenticated-scope";

import {
  isClosedToSuperAdmin,
  refreshStoredClosedMarks,
} from "./closed-to-super-admin";
import { userIsSuperAdmin } from "./resolve-actor";

/** The caller a way in asks about, as it holds them. */
export interface SuperAdminCaller {
  /** The signed-in user, or the user a key acts for. */
  readonly userId?: string;
  /** The key scope in force, where the call is made with an API key. */
  readonly scope?: AuthenticatedScope;
  /**
   * Whether the key carries its maker's super-admin authority, where the way
   * in already resolved it; set for a key, absent for a person.
   */
  readonly keyHoldsSuperAdmin?: boolean;
  /** The caller's transaction, when asked inside one. */
  readonly executor?: unknown;
}

/**
 * Whether `slug` is refused to `caller` because it is closed to super-admin
 * and the caller holds super-admin authority: a super-admin person, or a key
 * carrying its maker's super-admin authority. Reads nothing more for a
 * collection that is not closed, so an open collection costs no query.
 */
export async function superAdminRefusedOn(
  slug: string,
  caller: SuperAdminCaller
): Promise<boolean> {
  await refreshStoredClosedMarks(
    caller.executor === undefined ? {} : { executor: caller.executor }
  );
  if (!isClosedToSuperAdmin(slug)) return false;
  if (caller.keyHoldsSuperAdmin !== undefined) {
    return caller.keyHoldsSuperAdmin;
  }
  if (caller.scope?.actorType === "apiKey") {
    return scopeHoldsSuperAdmin(caller.scope);
  }
  if (!caller.userId) return false;
  return userIsSuperAdmin(caller.userId, { executor: caller.executor });
}
