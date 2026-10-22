/**
 * The gate adapter asks what today's gate asks, and no more: a rule function
 * runs once per question even while a test records deviations, and a
 * super-admin is recognised before the caller's whole access is read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callerIsSuperAdmin,
  fakeActorForUser,
  fakeUserIsSuperAdmin,
  resetCallerAccess,
} from "../../domains/collections/__tests__/collection-test-helpers";
import type { CollectionAccessControl } from "../../shared/types/access";
import { apiKeyScope } from "../authenticated-scope";
import { runWithCallerScope } from "../caller-scope";

import type { AccessTarget } from "./decide";
import { recordingDeviations } from "./deviations";
import {
  collectionGateVerdict,
  singleGateVerdict,
  type CollectionQuestion,
} from "./gate-adapters";

vi.mock("./resolve-actor", async importOriginal => {
  const fake = await import(
    "../../domains/collections/__tests__/collection-test-helpers"
  );
  return {
    ...(await importOriginal<object>()),
    actorForUser: fake.fakeActorForUser,
    userHoldsPermission: fake.fakeUserHoldsPermission,
    userIsSuperAdmin: fake.fakeUserIsSuperAdmin,
  };
});

beforeEach(() => {
  resetCallerAccess();
  fakeActorForUser.mockClear();
  fakeUserIsSuperAdmin.mockClear();
});

/** A question about `posts`, which declares `access`. */
function asked(
  access: CollectionAccessControl,
  fields: Partial<CollectionQuestion>
): CollectionQuestion {
  const target: AccessTarget = { kind: "collection", slug: "posts", access };
  return {
    slug: "posts",
    action: "read",
    principal: null,
    rules: { getRegisteredTarget: () => target },
    permissionWithoutService: () => Promise.resolve(false),
    ...fields,
  };
}

describe("a rule function", () => {
  it("is asked once for a signed-in user, even while deviations are recorded", async () => {
    // Truthy but not `true`: today admits on it, the decision does not, so a
    // deviation is recorded, and the comparison must not ask the rule again.
    const rule = vi.fn(() => "yes" as unknown as boolean);
    const { result, deviations } = await recordingDeviations(() =>
      collectionGateVerdict(asked({ read: rule }, { user: { id: "u1" } }))
    );
    expect(result.allowed).toBe(true);
    expect(deviations).toEqual(["rule-alone-for-people"]);
    expect(rule).toHaveBeenCalledTimes(1);
  });

  it("is asked once for a key's publish, even while deviations are recorded", async () => {
    const publish = vi.fn(() => true);
    const grants = ["read", "update", "publish"].map(action => ({
      slug: `${action}-posts`,
      action,
      resource: "posts",
    }));
    const { result } = await recordingDeviations(() =>
      collectionGateVerdict(
        asked(
          { publish },
          {
            action: "publish",
            user: { id: "owner" },
            scope: apiKeyScope(grants, ["editor"]),
          }
        )
      )
    );
    expect(result.allowed).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("a key that lacks the grant", () => {
  it("is refused a publish without its rule being asked", async () => {
    // Today's key check refuses on the missing grant before reading the rule,
    // so a rule an unauthorised key cannot pass never runs for it.
    const publish = vi.fn(() => true);
    const grants = ["read", "update"].map(action => ({
      slug: `${action}-posts`,
      action,
      resource: "posts",
    }));
    const verdict = await collectionGateVerdict(
      asked(
        { publish },
        {
          action: "publish",
          user: { id: "owner" },
          scope: apiKeyScope(grants, ["editor"]),
        }
      )
    );
    expect(verdict.allowed).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("a Single asked inside a key's request, without the key's scope", () => {
  it("is compared with the decision for the key, not with a second run of the gate", async () => {
    // Today the gate judges the user, and the key's publish passes its rule
    // while its update rule refuses: a second run of the gate as the key
    // would take the lifecycle deviation and record it, though the real
    // answer never did.
    const publish = vi.fn(() => true);
    const update = vi.fn(() => false);
    const target: AccessTarget = {
      kind: "single",
      slug: "homepage",
      access: { publish, update },
    };
    const grants = ["read", "update", "publish"].map(action => ({
      slug: `${action}-homepage`,
      action,
      resource: "homepage",
    }));
    const { result, deviations } = await recordingDeviations(() =>
      runWithCallerScope(apiKeyScope(grants), () =>
        singleGateVerdict({
          slug: "homepage",
          action: "publish",
          principal: null,
          user: { id: "owner" },
          rules: { getRegisteredTarget: () => target },
        })
      )
    );
    expect(result.allowed).toBe(true);
    expect(deviations).toEqual([
      "rule-alone-for-people",
      "single-explicit-scope-only",
    ]);
  });
});

describe("a super-admin named only by id", () => {
  it("passes a rule function without the caller's whole access being read", async () => {
    callerIsSuperAdmin();
    const rule = vi.fn(() => false);
    const verdict = await collectionGateVerdict(
      asked({ read: rule }, { user: { id: "admin-1" } })
    );
    expect(verdict.allowed).toBe(true);
    expect(fakeUserIsSuperAdmin).toHaveBeenCalledWith("admin-1", {
      executor: undefined,
    });
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(rule).not.toHaveBeenCalled();
  });
});
