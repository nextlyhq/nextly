/**
 * The one access decision, over a table of callers, rules and actions.
 *
 * Each block names the property that separates the composition from a
 * plausible broken one: a rule that widens, a truthy answer taken as `true`,
 * super-admin read from role names, a lifecycle change judged without the
 * update rule, a rule asked twice, or a rule handed the wrong context.
 */
import { describe, expect, it, vi } from "vitest";

import type { Principal } from "../../plugins/principals/types";
import type {
  AccessControlContext,
  AccessControlFunction,
  CollectionAccessControl,
} from "../../shared/types/access";

import {
  keyActor,
  principalActor,
  systemActor,
  userActor,
  visitorActor,
  type AccessAction,
  type Actor,
  type PermissionGrant,
} from "./actor";
import { askRule, decide, type AccessTarget } from "./decide";

const ACTIONS: AccessAction[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];
const every = (resource: string): PermissionGrant[] =>
  ACTIONS.map(action => ({ action, resource }));
const only = (resource: string, actions: AccessAction[]): PermissionGrant[] =>
  actions.map(action => ({ action, resource }));

const MEMBER: Principal = {
  type: "principal",
  kind: "members:member",
  id: "m1",
  attributes: {},
};

const callers = {
  visitor: visitorActor(),
  // Holds read, update, publish and unpublish, so a refused publish or
  // unpublish can only come from the visitor guard, not a missing permission.
  "visitor-public-read": visitorActor(
    only("posts", ["read", "update", "publish", "unpublish"])
  ),
  principal: principalActor(MEMBER),
  "user-with": userActor({
    userId: "u1",
    roles: ["editor"],
    permissions: every("posts"),
    superAdmin: false,
  }),
  "user-without": userActor({
    userId: "u2",
    roles: ["viewer"],
    permissions: [],
    superAdmin: false,
  }),
  "super-admin": userActor({
    userId: "u3",
    roles: ["super-admin"],
    permissions: [],
    superAdmin: true,
  }),
  // A key whose maker is a super-admin carries that role's NAME, and must
  // still get no super-admin authority from it.
  "key-with": keyActor({
    keyId: "k1",
    userId: "u3",
    roles: ["super-admin"],
    permissions: every("posts"),
  }),
  "key-without": keyActor({
    keyId: "k2",
    userId: "u3",
    roles: ["super-admin"],
    permissions: [],
  }),
} satisfies Record<string, Actor>;
type CallerName = keyof typeof callers;

const RULES = {
  absent: undefined,
  true: true,
  false: false,
  "returns-true": () => true,
  "returns-false": () => false,
  "returns-null": () => null,
  "returns-undefined": () => undefined,
  "returns-one": () => 1,
  throws: () => {
    throw new Error("the rule failed");
  },
  "async-true": async () => true,
  "async-false": async () => false,
  "async-rejects": async () => {
    throw new Error("the rule failed");
  },
} as const;
type RuleName = keyof typeof RULES;

/** A collection whose every action declares the same rule. */
function postsWith(rule: RuleName): AccessTarget {
  const body = RULES[rule];
  if (body === undefined) return { kind: "collection", slug: "posts" };
  const access = Object.fromEntries(
    ACTIONS.map(action => [action, body])
  ) as CollectionAccessControl;
  return { kind: "collection", slug: "posts", access };
}

async function allowed(
  caller: CallerName,
  action: AccessAction,
  rule: RuleName
): Promise<boolean> {
  return (await decide(callers[caller], action, postsWith(rule))).allowed;
}

const ALLOWING: RuleName[] = ["absent", "true", "returns-true", "async-true"];
const REFUSING = (Object.keys(RULES) as RuleName[]).filter(
  rule => !ALLOWING.includes(rule)
);

describe("a code rule can only narrow the permission", () => {
  it.each(ALLOWING)(
    "lets a caller holding the permission in (%s)",
    async rule => {
      for (const action of ["read", "create", "update", "delete"] as const) {
        expect(await allowed("user-with", action, rule)).toBe(true);
        expect(await allowed("key-with", action, rule)).toBe(true);
      }
    }
  );

  it.each(REFUSING)(
    "refuses a caller holding the permission when the rule answers anything but true (%s)",
    async rule => {
      expect(await allowed("user-with", "read", rule)).toBe(false);
      expect(await allowed("key-with", "read", rule)).toBe(false);
    }
  );

  it.each(ALLOWING)(
    "refuses a caller without the permission, however the rule answers (%s)",
    async rule => {
      const decision = await decide(
        callers["user-without"],
        "read",
        postsWith(rule)
      );
      expect(decision).toEqual({ allowed: false, reason: "no-permission" });
      expect(await allowed("key-without", "read", rule)).toBe(false);
    }
  );

  it("names a rule that threw, or whose promise rejected, apart from one that refused", async () => {
    for (const rule of ["throws", "async-rejects"] as const) {
      expect(
        await decide(callers["user-with"], "read", postsWith(rule))
      ).toEqual({ allowed: false, reason: "rule-threw" });
    }
    expect(
      await decide(callers["user-with"], "read", postsWith("returns-false"))
    ).toEqual({ allowed: false, reason: "rule-refused" });
  });
});

describe("super-admin authority", () => {
  it.each(Object.keys(RULES) as RuleName[])(
    "passes every rule for a super-admin user (%s)",
    async rule => {
      for (const action of ACTIONS) {
        expect(await allowed("super-admin", action, rule)).toBe(true);
      }
    }
  );

  it("is never a key's, whatever role names the key carries", async () => {
    // A decision that read super-admin from role names would allow both.
    expect(await allowed("key-without", "read", "true")).toBe(false);
    expect(await allowed("key-with", "read", "false")).toBe(false);
  });
});

describe("a visitor", () => {
  it("holds only what the Public role grants, which is nothing by default", async () => {
    expect(await decide(callers.visitor, "read", postsWith("true"))).toEqual({
      allowed: false,
      reason: "no-permission",
    });
    expect(await allowed("visitor-public-read", "read", "true")).toBe(true);
    expect(await allowed("visitor-public-read", "read", "false")).toBe(false);
  });

  it("never publishes or unpublishes, even holding the permission", async () => {
    for (const action of ["publish", "unpublish"] as const) {
      expect(
        await decide(callers["visitor-public-read"], action, postsWith("true"))
      ).toEqual({ allowed: false, reason: "visitor-cannot-publish" });
    }
  });
});

describe("a plugin's person", () => {
  const forMembers: AccessTarget = {
    kind: "collection",
    slug: "posts",
    access: {
      read: ({ principal }) => principal?.kind === "members:member",
      create: ({ principal }) => principal?.kind === "members:guest",
      publish: () => true,
    },
  };

  it("is judged by the rule alone, holding no permission", async () => {
    expect((await decide(callers.principal, "read", forMembers)).allowed).toBe(
      true
    );
    expect(
      (await decide(callers.principal, "create", forMembers)).allowed
    ).toBe(false);
  });

  it("is refused where the target declares no rule", async () => {
    expect(await decide(callers.principal, "update", forMembers)).toEqual({
      allowed: false,
      reason: "principal-without-rule",
    });
  });

  it("never publishes, whatever the rule says", async () => {
    expect(await decide(callers.principal, "publish", forMembers)).toEqual({
      allowed: false,
      reason: "principal-cannot-publish",
    });
  });
});

describe("a publish or an unpublish", () => {
  const updateRefuses: AccessTarget = {
    kind: "collection",
    slug: "posts",
    access: { update: () => false },
  };

  it("must also satisfy the update rule", async () => {
    for (const action of ["publish", "unpublish"] as const) {
      expect(await decide(callers["user-with"], action, updateRefuses)).toEqual(
        { allowed: false, reason: "update-rule-refused" }
      );
    }
    // The control: the same target lets the caller read and create.
    expect(
      (await decide(callers["user-with"], "read", updateRefuses)).allowed
    ).toBe(true);
  });

  it("needs its own permission, not update's", async () => {
    const partial = userActor({
      userId: "u4",
      roles: ["partial"],
      permissions: only("posts", ["read", "update", "publish"]),
      superAdmin: false,
    });
    const posts = postsWith("absent");
    expect((await decide(partial, "publish", posts)).allowed).toBe(true);
    expect((await decide(partial, "unpublish", posts)).allowed).toBe(false);
  });

  it("is refused by its own rule even where the update rule allows", async () => {
    // A decision that judged a publish by the update rule alone would allow.
    const lifecycleRefuses: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: {
        update: () => true,
        publish: () => false,
        unpublish: () => false,
      },
    };
    for (const action of ["publish", "unpublish"] as const) {
      expect(
        await decide(callers["user-with"], action, lifecycleRefuses)
      ).toEqual({ allowed: false, reason: "rule-refused" });
      expect(
        (await decide(callers["key-with"], action, lifecycleRefuses)).allowed
      ).toBe(false);
    }
  });

  it("names an update rule that failed apart from one that refused", async () => {
    for (const rule of ["throws", "async-rejects"] as const) {
      const updateFails: AccessTarget = {
        kind: "collection",
        slug: "posts",
        access: { update: RULES[rule] },
      };
      expect(
        await decide(callers["user-with"], "publish", updateFails)
      ).toEqual({ allowed: false, reason: "update-rule-threw" });
    }
  });

  it("needs the update permission as well, since it changes the entry", async () => {
    const publisher = userActor({
      userId: "u5",
      roles: ["publisher"],
      permissions: only("posts", ["read", "publish", "unpublish"]),
      superAdmin: false,
    });
    const posts = postsWith("absent");
    for (const action of ["publish", "unpublish"] as const) {
      expect(await decide(publisher, action, posts)).toEqual({
        allowed: false,
        reason: "no-permission",
      });
    }
  });
});

describe("trusted server work", () => {
  it("is allowed without asking any rule", async () => {
    const rule = vi.fn(() => false);
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: { read: rule },
    };
    expect((await decide(systemActor(), "read", target)).allowed).toBe(true);
    expect(rule).not.toHaveBeenCalled();
  });
});

describe("what a rule is handed", () => {
  async function contextFor(actor: Actor): Promise<AccessControlContext> {
    const rule = vi.fn((_ctx: AccessControlContext) => true);
    await decide(actor, "read", {
      kind: "collection",
      slug: "posts",
      access: { read: rule },
    });
    expect(rule).toHaveBeenCalledTimes(1);
    return rule.mock.calls[0][0];
  }

  it("is the rule-facing permission spelling, never the stored one", async () => {
    const ctx = await contextFor(callers["user-with"]);
    expect(ctx.permissions).toContain("posts:read");
    expect(ctx.permissions).not.toContain("read-posts");
  });

  it("names a key's maker as the user, with the key's own roles", async () => {
    const ctx = await contextFor(callers["key-with"]);
    expect(ctx.user).toEqual({ id: "u3" });
    expect(ctx.roles).toEqual(["super-admin"]);
    expect(ctx.principal).toBeNull();
  });

  it("names no user for a visitor or a plugin's person, and the person only for the latter", async () => {
    const visitor = await contextFor(callers["visitor-public-read"]);
    expect(visitor.user).toBeNull();
    expect(visitor.principal).toBeNull();
    const person = await contextFor(callers.principal);
    expect(person.user).toBeNull();
    expect(person.principal).toBe(MEMBER);
    expect(person.permissions).toEqual([]);
  });
});

/**
 * A rule as a site may write it in plain JavaScript, answering something the
 * rule type does not allow. The decision has to judge such an answer, so the
 * test hands one over as the type the config carries.
 */
const untypedRule = (rule: (ctx: AccessControlContext) => unknown) =>
  rule as AccessControlFunction;

describe("askRule", () => {
  it("reports what the rule answered, as it answered it, from one call", async () => {
    const rule = vi.fn(() => null);
    const outcome = await askRule(callers["user-with"], "read", {
      kind: "collection",
      slug: "posts",
      access: { read: untypedRule(rule) },
    });
    expect(outcome).toEqual({ declared: true, value: null });
    expect(rule).toHaveBeenCalledTimes(1);
  });

  it("says when the target declares no rule for the action", async () => {
    expect(
      await askRule(callers["user-with"], "delete", {
        kind: "collection",
        slug: "posts",
        access: { read: () => true },
      })
    ).toEqual({ declared: false });
  });
});
