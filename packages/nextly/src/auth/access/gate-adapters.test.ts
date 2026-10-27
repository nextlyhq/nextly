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

/** What the Public role grants in a test, and so what a visitor holds. */
const publicRole = vi.hoisted(() => ({
  grants: [] as { slug: string; action: string; resource: string }[],
}));

vi.mock("./resolve-actor", async importOriginal => {
  const fake = await import(
    "../../domains/collections/__tests__/collection-test-helpers"
  );
  const { visitorActor } = await import("./actor");
  return {
    ...(await importOriginal<object>()),
    actorForUser: fake.fakeActorForUser,
    actorForVisitor: async () => visitorActor(publicRole.grants),
    userHoldsPermission: fake.fakeUserHoldsPermission,
    userIsSuperAdmin: fake.fakeUserIsSuperAdmin,
  };
});

/** The Public role grants `actions` on `posts`. */
function publicHolds(...actions: string[]): void {
  publicRole.grants = actions.map(action => ({
    slug: `${action}-posts`,
    action,
    resource: "posts",
  }));
}

beforeEach(() => {
  resetCallerAccess();
  fakeActorForUser.mockClear();
  fakeUserIsSuperAdmin.mockClear();
  publicRole.grants = [];
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
    const rule = vi.fn(() => true);
    const { result, deviations } = await recordingDeviations(() =>
      collectionGateVerdict(asked({ read: rule }, { user: { id: "u1" } }))
    );
    expect(result.allowed).toBe(true);
    expect(deviations).toEqual([]);
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
    // Public holds the read, so only the rule can refuse.
    publicHolds("read");
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
    publicHolds("read");
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

describe("a visitor's write", () => {
  const WRITES = ["create", "update", "delete"] as const;

  it("is refused as needing a signed-in caller where the Public role does not hold it", async () => {
    // `read: true` is declared so the target has an access object: only the
    // write's own rule is missing, which is the case the public default used
    // to let through. Public holds the read alone.
    publicHolds("read");
    for (const action of WRITES) {
      const verdict = await collectionGateVerdict(
        asked({ read: true }, { action })
      );
      expect(verdict, action).toEqual({
        allowed: false,
        refusal: "unauthenticated",
      });
    }
  });

  it("is refused at a Single where no rule names the update", async () => {
    const target: AccessTarget = { kind: "single", slug: "site", access: {} };
    const verdict = await singleGateVerdict({
      slug: "site",
      action: "update",
      principal: null,
      rules: { getRegisteredTarget: () => target },
    });
    expect(verdict.allowed).toBe(false);
  });

  it("is refused where the target's rule answers true but the Public role does not hold it", async () => {
    for (const action of WRITES) {
      const verdict = await collectionGateVerdict(
        asked({ [action]: () => true }, { action })
      );
      expect(verdict, action).toEqual({
        allowed: false,
        refusal: "unauthenticated",
      });
    }
  });

  it("is allowed where the Public role holds it and the rule answers true, plain or as a function", async () => {
    publicHolds(...WRITES);
    for (const action of WRITES) {
      const plain = await collectionGateVerdict(
        asked({ [action]: true }, { action })
      );
      expect(plain.allowed, `${action}: true`).toBe(true);
      const fn = await collectionGateVerdict(
        asked({ [action]: () => true }, { action })
      );
      expect(fn.allowed, `${action}: () => true`).toBe(true);
    }
  });

  it("is allowed where the Public role holds it and no rule names it", async () => {
    publicHolds(...WRITES);
    for (const action of WRITES) {
      const verdict = await collectionGateVerdict(
        asked({ read: true }, { action })
      );
      expect(verdict.allowed, action).toBe(true);
    }
  });

  it("judges a visitor's read with no rule by the Public role's read alone", async () => {
    // No public default: without Public's read the visitor is refused, and
    // with it let through.
    const refused = await collectionGateVerdict(asked({}, { action: "read" }));
    expect(refused).toEqual({ allowed: false, refusal: "unauthenticated" });
    publicHolds("read");
    const verdict = await collectionGateVerdict(asked({}, { action: "read" }));
    expect(verdict.allowed).toBe(true);
  });
});

describe("a visitor the Public role does not grant the action", () => {
  it("is refused as needing a signed-in caller, and its rule is not asked", async () => {
    // The permission comes before the rule, as for a signed-in user: a rule
    // is application code, and one that refuses or throws must not turn the
    // permission's refusal into the rule's.
    for (const rule of [
      vi.fn(() => true),
      vi.fn(() => false),
      vi.fn(() => {
        throw new Error("the rule ran");
      }),
    ]) {
      const verdict = await collectionGateVerdict(asked({ read: rule }, {}));
      expect(verdict).toEqual({ allowed: false, refusal: "unauthenticated" });
      expect(rule).not.toHaveBeenCalled();
    }
  });

  it("is refused by the rule once Public holds the action", async () => {
    // The control: with the permission held, the same rule is asked and its
    // refusal is the rule's.
    publicHolds("read");
    const rule = vi.fn(() => false);
    const verdict = await collectionGateVerdict(asked({ read: rule }, {}));
    expect(verdict).toEqual({ allowed: false, refusal: "insufficient" });
    expect(rule).toHaveBeenCalledTimes(1);
  });
});

describe("a signed-in user without the permission", () => {
  it("is refused whatever the rule says, and a rule function is not asked", async () => {
    callerMayNot("read");
    const rule = vi.fn(() => true);
    const user = { user: { id: "u1" } };
    expect(
      (await collectionGateVerdict(asked({ read: rule }, user))).allowed
    ).toBe(false);
    expect(rule).not.toHaveBeenCalled();
    expect(
      (await collectionGateVerdict(asked({ read: true }, user))).allowed
    ).toBe(false);
  });

  it("is let through by the rule once they hold the permission", async () => {
    // The control: the refusal above is the permission's.
    const user = { user: { id: "u1" } };
    expect(
      (await collectionGateVerdict(asked({ read: () => true }, user))).allowed
    ).toBe(true);
    expect(
      (await collectionGateVerdict(asked({ read: true }, user))).allowed
    ).toBe(true);
  });

  it("is not named as newly refused where the rule is a plain false", async () => {
    // A rule of `false` refused this caller before too.
    clearRuleAnswerNotices();
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    callerMayNot("read");
    const user = { user: { id: "u1" } };
    await collectionGateVerdict(asked({ read: false }, user));
    expect(warn).not.toHaveBeenCalled();
    // The control: a rule of `true` let this caller in before, and is named.
    await collectionGateVerdict(asked({ read: true }, user));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("a signed-in user's publish", () => {
  const publish = { action: "publish" as const, user: { id: "u1" } };

  it("is allowed by its own permission and rule without update, as the decision allows it", async () => {
    // The user holds publish and not update: a publish is judged by its own
    // permission and rule, at the gate and in the decision alike.
    callerMayNot("update");
    for (const access of [{ publish: true }, { publish: () => true }]) {
      const { result, deviations } = await recordingDeviations(() =>
        collectionGateVerdict(asked(access, publish))
      );
      expect(result.allowed).toBe(true);
      expect(deviations).toEqual([]);
    }
  });

  it("is allowed alike where the user holds update too", async () => {
    // The control: holding update changes nothing.
    for (const access of [{ publish: true }, { publish: () => true }]) {
      const { result, deviations } = await recordingDeviations(() =>
        collectionGateVerdict(asked(access, publish))
      );
      expect(result.allowed).toBe(true);
      expect(deviations).toEqual([]);
    }
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

describe("a user handed in naming the super-admin role", () => {
  // The role names a caller hands in say nothing the lookup does not: the
  // user is judged by the roles they hold, so only holding super-admin passes.
  const named = { id: "u1", role: "super-admin", roles: ["super-admin"] };
  const single: AccessTarget = { kind: "single", slug: "site-settings" };
  const atCollection = () =>
    collectionGateVerdict(asked({ read: () => true }, { user: named }));
  const atSingle = () =>
    singleGateVerdict({
      slug: "site-settings",
      action: "update",
      principal: null,
      user: named,
      rules: { getRegisteredTarget: () => single },
    });

  it("is refused at a collection and a Single where they hold neither the role nor the permission", async () => {
    callerMayNot("read", "update");
    expect((await atCollection()).allowed).toBe(false);
    expect((await atSingle()).allowed).toBe(false);
  });

  it("passes at both once they hold the role", async () => {
    // The control: the same caller, holding super-admin, is let through, so
    // the refusals above are the lookup's answer and not the gate refusing
    // everyone.
    callerMayNot("read", "update");
    callerIsSuperAdmin();
    expect((await atCollection()).allowed).toBe(true);
    expect((await atSingle()).allowed).toBe(true);
  });
});
