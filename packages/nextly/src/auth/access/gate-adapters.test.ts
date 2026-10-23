/**
 * The gate adapter asks what today's gate asks, and no more: a rule function
 * runs once per question even while a test records deviations, and a
 * super-admin is recognised before the caller's whole access is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callerIsSuperAdmin,
  callerMay,
  callerMayNot,
  fakeActorForUser,
  fakeUserIsSuperAdmin,
  resetCallerAccess,
} from "../../domains/collections/__tests__/collection-test-helpers";
import { consoleLogger } from "../../shared/types";
import type { CollectionAccessControl } from "../../shared/types/access";
import { apiKeyScope } from "../authenticated-scope";
import { runWithCallerScope } from "../caller-scope";

import type { AccessTarget } from "./decide";
import { recordingDeviations } from "./deviations";
import { clearRuleAnswerNotices } from "./rule-answer-log";
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
    // The rule admits a user who lacks the permission: today admits on it,
    // the decision does not, so a deviation is recorded, and the comparison
    // must not ask the rule again.
    callerMayNot("read");
    const rule = vi.fn(() => true);
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

describe("a rule's answer, at the collection gate", () => {
  beforeEach(() => {
    clearRuleAnswerNotices();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const answer = (value: unknown, user?: { id: string }) =>
    collectionGateVerdict(
      asked({ read: () => value as boolean }, user ? { user } : {})
    );

  it("lets a visitor through only on true: null, undefined and a truthy value refuse", async () => {
    for (const value of [null, undefined, "yes"]) {
      expect((await answer(value)).allowed).toBe(false);
    }
    // The control: `true` still lets a visitor through.
    expect((await answer(true)).allowed).toBe(true);
  });

  it("lets a signed-in user through only on true: a truthy value refuses", async () => {
    // The user holds the permission, so only the rule can refuse.
    expect((await answer("yes", { id: "u1" })).allowed).toBe(false);
    expect((await answer(true, { id: "u1" })).allowed).toBe(true);
  });

  it("names a refusal once where the answer let the caller in before, and not where it did not", async () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    // A visitor was refused before only by `false`, so `null` let it in.
    await answer(null);
    await answer(null);
    // A signed-in user was judged truthy, so `null` refused it already, and
    // `"yes"` let it in.
    await answer(null, { id: "u1" });
    await answer("yes", { id: "u1" });
    const named = warn.mock.calls.map(([message]) => String(message));
    expect(named).toHaveLength(2);
    expect(named[0]).toContain("answered null, so a visitor is now refused");
    expect(named[1]).toContain(
      "answered a string, so a signed-in user is now refused"
    );
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
  const target: AccessTarget = { kind: "single", slug: "site-settings" };
  const read = () =>
    singleGateVerdict({
      slug: "site-settings",
      action: "read",
      principal: null,
      user: { id: "owner" },
      rules: { getRegisteredTarget: () => target },
    });
  const keyHolding = (actions: string[]) =>
    apiKeyScope(
      actions.map(action => ({
        slug: `${action}-site-settings`,
        action,
        resource: "site-settings",
      }))
    );

  beforeEach(() => {
    // The key's maker may read the Single; only the key can be refused.
    callerMay("read");
  });

  it("judges the key in force, not the person who made it", async () => {
    const { result, deviations } = await recordingDeviations(() =>
      runWithCallerScope(keyHolding(["update"]), read)
    );
    expect(result.allowed).toBe(false);
    expect(deviations).toEqual([]);
  });

  it("allows the key in force where it holds the grant, and the maker outside a key's request", async () => {
    // The controls: the refusal above is the key's own.
    expect((await runWithCallerScope(keyHolding(["read"]), read)).allowed).toBe(
      true
    );
    expect((await read()).allowed).toBe(true);
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
