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
import {
  forgetRequestAccess,
  rememberRouteVerdict,
  runWithAccessMemo,
} from "./request-memo";
import type { RuleFilter } from "./rule-answer";
import { ruleLanguageKey, withRuleLanguage } from "./rule-language";
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

describe("a visitor's write", () => {
  const WRITES = ["create", "update", "delete"] as const;

  it("is refused as needing a signed-in caller where no rule names it", async () => {
    // `read: true` is declared so the target has an access object: only the
    // write's own rule is missing, which is the case the public default used
    // to let through.
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

  it("is allowed where the target's rule answers true, plain or as a function", async () => {
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

  it("leaves a visitor's read with no rule on the public default", async () => {
    // The control for the refusals above: the same target with no rule at
    // all still admits a visitor's read, so only writes changed.
    const verdict = await collectionGateVerdict(asked({}, { action: "read" }));
    expect(verdict.allowed).toBe(true);
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

  it("is recorded where the gate judges it alone and the decision also asks update", async () => {
    // The user holds publish and not update: the gate allows, the decision
    // refuses.
    callerMayNot("update");
    for (const access of [{ publish: true }, { publish: () => true }]) {
      const { result, deviations } = await recordingDeviations(() =>
        collectionGateVerdict(asked(access, publish))
      );
      expect(result.allowed).toBe(true);
      expect(deviations).toEqual(["lifecycle-judged-alone"]);
    }
  });

  it("is recorded as nothing where the user holds update too", async () => {
    // The control: the two agree.
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

describe("a read whose route already authorized it", () => {
  const OWN = { author: { equals: "u1" } };
  const filtering = () => vi.fn(() => OWN as unknown as boolean);

  beforeEach(() => {
    callerMay("read");
  });

  /** A route's verdict kept for `userId`, on `slug`, in the language now. */
  const kept = (userId: string, filter: unknown, slug = "posts") =>
    rememberRouteVerdict(
      { userId, slug, action: "read", language: ruleLanguageKey() },
      { filter: filter as RuleFilter }
    );
  const routeRead = (userId = "u1", read: unknown = filtering()) =>
    collectionGateVerdict(
      asked(
        { read: read as CollectionAccessControl["read"] },
        { user: { id: userId }, routeAuthorized: true, appliesFilter: true }
      )
    );

  it("answers the filter the route let the caller through on, asking no rule", async () => {
    const rule = filtering();
    const verdict = await runWithAccessMemo(async () => {
      kept("u1", OWN);
      return collectionGateVerdict(
        asked(
          { read: rule },
          { user: { id: "u1" }, routeAuthorized: true, appliesFilter: true }
        )
      );
    });
    // Not `allowed`, which would read every entry: the route's allow was for
    // the entries the filter matches.
    expect(verdict).toEqual({
      allowed: false,
      refusal: "only-matching-entries",
      filter: OWN,
    });
    // The route asked the rule; a rule may call a service, and is not asked
    // twice.
    expect(rule).not.toHaveBeenCalled();
  });

  it("allows every entry where the route kept that verdict", async () => {
    const verdict = await runWithAccessMemo(async () => {
      rememberRouteVerdict(
        {
          userId: "u1",
          slug: "posts",
          action: "read",
          language: ruleLanguageKey(),
        },
        { all: true }
      );
      return routeRead();
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it("does not apply a filter the route kept for another collection", async () => {
    // The route never judged this collection, so its read is judged as a
    // route-authorized read with no kept verdict is.
    const verdict = await runWithAccessMemo(async () => {
      kept("u1", OWN, "pages");
      return routeRead();
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it("refuses a read in a language the route did not judge it in", async () => {
    const verdict = await runWithAccessMemo(async () => {
      kept("u1", OWN);
      return withRuleLanguage({ locale: "fr", locales: ["fr"] }, () =>
        routeRead()
      );
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict).not.toMatchObject({ filter: OWN });
  });

  it("allows every entry, asking no rule nor the permission, where no route kept a verdict", async () => {
    // The route's allow was for every entry, and the permission is the
    // route's to settle.
    callerMayNot("read");
    const rule = filtering();
    const verdict = await runWithAccessMemo(() =>
      collectionGateVerdict(
        asked(
          { read: rule },
          { user: { id: "u1" }, routeAuthorized: true, appliesFilter: true }
        )
      )
    );
    expect(verdict.allowed).toBe(true);
    expect(rule).not.toHaveBeenCalled();
  });

  it("keeps the route's filter through a write that clears the request's lookups", async () => {
    const verdict = await runWithAccessMemo(async () => {
      kept("u1", OWN);
      forgetRequestAccess();
      return collectionGateVerdict(
        asked(
          { read: filtering() },
          { user: { id: "u1" }, routeAuthorized: true, appliesFilter: true }
        )
      );
    });
    expect(verdict).toMatchObject({ filter: OWN });
  });

  it("does not hand one caller's route filter to another", async () => {
    const verdict = await runWithAccessMemo(async () => {
      kept("u1", OWN);
      return collectionGateVerdict(
        asked(
          { read: filtering() },
          { user: { id: "u2" }, routeAuthorized: true, appliesFilter: true }
        )
      );
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it("cannot keep a route's filter outside a request", () => {
    // So the route refuses the caller rather than let the read run unfiltered.
    expect(kept("u1", OWN)).toBe(false);
  });

  it("asks a rule again for another caller in the same request", async () => {
    const rule = filtering();
    await runWithAccessMemo(async () => {
      await collectionGateVerdict(
        asked({ read: rule }, { user: { id: "u1" }, appliesFilter: true })
      );
      await collectionGateVerdict(
        asked({ read: rule }, { user: { id: "u2" }, appliesFilter: true })
      );
    });
    expect(rule).toHaveBeenCalledTimes(2);
  });

  it("asks a rule again for the same key owner under a narrower scope", async () => {
    // The rule reads the key's grants: a scope that drops one is a different
    // question, even for the same key owner.
    const rule = vi.fn(({ permissions }: { permissions: readonly string[] }) =>
      permissions.includes("read-secrets")
        ? (OWN as unknown as boolean)
        : ({ author: { equals: "nobody" } } as unknown as boolean)
    );
    const grant = (resource: string) => ({
      slug: `read-${resource}`,
      action: "read",
      resource,
    });
    const wide = apiKeyScope([grant("posts"), grant("secrets")], ["editor"]);
    const narrow = apiKeyScope([grant("posts")], ["editor"]);
    const [first, second] = await runWithAccessMemo(async () => [
      await collectionGateVerdict(
        asked(
          { read: rule },
          { user: { id: "u1" }, scope: wide, appliesFilter: true }
        )
      ),
      await collectionGateVerdict(
        asked(
          { read: rule },
          { user: { id: "u1" }, scope: narrow, appliesFilter: true }
        )
      ),
    ]);
    expect(first).toMatchObject({ filter: OWN });
    expect(second).toMatchObject({ filter: { author: { equals: "nobody" } } });
    expect(rule).toHaveBeenCalledTimes(2);
  });

  it("is allowed as before, asking no rule, where the asker applies no filter", async () => {
    // The control: only an asker that applies a filter has it asked again.
    const rule = filtering();
    const verdict = await collectionGateVerdict(
      asked({ read: rule }, { user: { id: "u1" }, routeAuthorized: true })
    );
    expect(verdict.allowed).toBe(true);
    expect(rule).not.toHaveBeenCalled();
  });
});
