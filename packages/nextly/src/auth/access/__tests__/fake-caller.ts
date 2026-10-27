/**
 * A faked caller lookup for suites that drive a gate: what `actorForUser`
 * (`auth/access/resolve-actor`) answers, set per test.
 *
 * A signed-in user holds the actions set with {@link callerMay} on every
 * target these suites use, or the lookup fails ({@link callerLookupFails}).
 * Every test should start from {@link resetCallerAccess}: a user holding
 * every action.
 *
 * Mock the module with it in each suite:
 *
 * ```ts
 * vi.mock("<path>/auth/access/resolve-actor", async importOriginal => {
 *   const fake = await import("<path>/auth/access/__tests__/fake-caller");
 *   return {
 *     ...(await importOriginal<object>()),
 *     actorForUser: fake.fakeActorForUser,
 *     userHoldsPermission: fake.fakeUserHoldsPermission,
 *     userIsSuperAdmin: fake.fakeUserIsSuperAdmin,
 *   };
 * });
 * ```
 */
import { vi } from "vitest";

import type { AccessOperation } from "../../../services/access";
import { userActor, type UserActor } from "../actor";

const EVERY_ACTION: readonly AccessOperation[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];

/** The collections and Singles the suites that use this fake ask about. */
const SUITE_TARGETS = ["posts", "site-settings"];

const callerAccess = {
  actions: new Set<AccessOperation>(EVERY_ACTION),
  failure: undefined as Error | undefined,
  superAdmin: false,
};

/** A signed-in user holds only these actions. */
export function callerMay(...actions: AccessOperation[]): void {
  callerAccess.actions = new Set(actions);
}

/** A signed-in user holds every action but these. */
export function callerMayNot(...actions: AccessOperation[]): void {
  callerAccess.actions = new Set(
    EVERY_ACTION.filter(action => !actions.includes(action))
  );
}

/** Looking a signed-in user up fails with `error`. */
export function callerLookupFails(error: Error): void {
  callerAccess.failure = error;
}

/** A signed-in user holds super-admin authority. */
export function callerIsSuperAdmin(): void {
  callerAccess.superAdmin = true;
}

export function resetCallerAccess(): void {
  callerAccess.actions = new Set(EVERY_ACTION);
  callerAccess.failure = undefined;
  callerAccess.superAdmin = false;
}

/** Stands in for `actorForUser`: the user's actor from the faked lookup. */
export const fakeActorForUser = vi.fn(
  async (userId: string): Promise<UserActor> => {
    if (callerAccess.failure) throw callerAccess.failure;
    return userActor({
      userId,
      roles: callerAccess.superAdmin ? ["super-admin"] : [],
      permissions: SUITE_TARGETS.flatMap(resource =>
        [...callerAccess.actions].map(action => ({
          slug: `${action}-${resource}`,
          action,
          resource,
        }))
      ),
    });
  }
);

/**
 * Stands in for `userHoldsPermission`: whether the user holds the action, from
 * the same faked lookup, super-admin authority included as the real check
 * counts it. Mock it beside {@link fakeActorForUser}.
 */
export const fakeUserHoldsPermission = vi.fn(
  async (_userId: string, action: string, resource: string) => {
    if (callerAccess.failure) throw callerAccess.failure;
    if (callerAccess.superAdmin) return true;
    return (
      SUITE_TARGETS.includes(resource) &&
      callerAccess.actions.has(action as AccessOperation)
    );
  }
);

/**
 * Stands in for `userIsSuperAdmin`: whether the user holds super-admin
 * authority, set with {@link callerIsSuperAdmin}. Mock it beside
 * {@link fakeActorForUser}.
 */
export const fakeUserIsSuperAdmin = vi.fn(async (_userId: string) => {
  if (callerAccess.failure) throw callerAccess.failure;
  return callerAccess.superAdmin;
});
