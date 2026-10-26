/**
 * The one access decision, over a table of callers, rules and actions.
 *
 * Each block names the property that separates the composition from a
 * plausible broken one: a rule that widens, a truthy answer taken as `true`,
 * super-admin read from role names, a lifecycle change judged without the
 * update rule, a rule asked twice, or a rule handed the wrong context.
 */
import { describe, expect, it, vi } from "vitest";

import { makePrincipal } from "../../plugins/principals/principal";
import { consoleLogger } from "../../shared/types";
import type { Principal } from "../../plugins/principals/types";
import type {
  AccessControlContext,
  AccessControlFunction,
  CollectionAccessControl,
} from "../../shared/types/access";

import {
  holdsPermission,
  keyActor,
  principalActor,
  storedPermissions,
  systemActor,
  userActor,
  visitorActor,
  type AccessAction,
  type Actor,
  type PermissionGrant,
} from "./actor";
import {
  askRule,
  askRules,
  decide,
  decidePermission,
  judge,
  type AccessTarget,
} from "./decide";

const ACTIONS: AccessAction[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];
const grant = (action: string, resource: string): PermissionGrant => ({
  slug: `${action}-${resource}`,
  action,
  resource,
});
const every = (resource: string): PermissionGrant[] =>
  ACTIONS.map(action => grant(action, resource));
const only = (resource: string, actions: AccessAction[]): PermissionGrant[] =>
  actions.map(action => grant(action, resource));

const MEMBER: Principal = makePrincipal("members:member", "m1", {});

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
  }),
  "user-without": userActor({
    userId: "u2",
    roles: ["viewer"],
    permissions: [],
  }),
  "super-admin": userActor({
    userId: "u3",
    roles: ["super-admin"],
    permissions: [],
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

  it("is read from the role set, inherited roles included", () => {
    const inherited = userActor({
      userId: "u9",
      roles: ["chief", "super-admin"],
      permissions: [],
    });
    const editor = userActor({
      userId: "u10",
      roles: ["editor"],
      permissions: [],
    });
    expect(inherited.superAdmin).toBe(true);
    expect(editor.superAdmin).toBe(false);
  });

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

  it("asks its rule with no permissions, whatever the Public role holds", async () => {
    // A rule that reads the permissions refuses the visitor, as it does for an
    // anonymous caller today, though Public holds the permission it names.
    const readersOnly: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: {
        read: ({ permissions }) => permissions.includes("posts:read"),
      },
    };
    expect(
      await decide(callers["visitor-public-read"], "read", readersOnly)
    ).toEqual({ allowed: false, reason: "rule-refused" });
  });

  it("never publishes or unpublishes, even holding the permission", async () => {
    for (const action of ["publish", "unpublish"] as const) {
      expect(
        await decide(callers["visitor-public-read"], action, postsWith("true"))
      ).toEqual({ allowed: false, reason: "visitor-cannot-publish" });
    }
  });
});

describe("a Single", () => {
  const settings: AccessTarget = {
    kind: "single",
    slug: "settings",
    access: { read: true, update: () => false },
  };
  const editor = userActor({
    userId: "u7",
    roles: ["editor"],
    permissions: only("settings", ["read", "update"]),
  });

  it("is judged by its own permission and its own rules", async () => {
    expect((await decide(editor, "read", settings)).allowed).toBe(true);
    expect(await decide(editor, "update", settings)).toEqual({
      allowed: false,
      reason: "rule-refused",
    });
    expect(await decide(callers["user-without"], "read", settings)).toEqual({
      allowed: false,
      reason: "no-permission",
    });
  });
});

describe("an actor's permissions", () => {
  // A permission whose stored slug is not `<action>-<resource>`.
  const manager = userActor({
    userId: "u8",
    roles: ["manager"],
    permissions: [
      { slug: "manage-api-keys", action: "update", resource: "api-keys" },
    ],
  });

  it("keep each permission's stored slug as its row stores it", () => {
    expect(storedPermissions(manager)).toEqual(["manage-api-keys"]);
    expect(holdsPermission(manager, "update", "api-keys")).toBe(true);
  });
});

describe("a plugin's person", () => {
  it("is an actor only for a principal core made, not a copy of one", () => {
    // The shape is public, so a forged or copied principal must not become a
    // person whose rules then decide alone.
    expect(() => principalActor({ ...MEMBER })).toThrow();
    expect(principalActor(MEMBER).principal).toBe(MEMBER);
  });

  const forMembers: AccessTarget = {
    kind: "collection",
    slug: "posts",
    access: {
      read: ({ principal }) => principal?.kind === "members:member",
      create: ({ principal }) => principal?.kind === "members:guest",
      publish: () => true,
      unpublish: () => true,
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

  it("never publishes or unpublishes, whatever the rule says", async () => {
    for (const action of ["publish", "unpublish"] as const) {
      expect(await decide(callers.principal, action, forMembers)).toEqual({
        allowed: false,
        reason: "principal-cannot-publish",
      });
    }
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
  it("is allowed every action without asking any rule", async () => {
    const rule = vi.fn(() => false);
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: Object.fromEntries(ACTIONS.map(action => [action, rule])),
    };
    for (const action of ACTIONS) {
      expect((await decide(systemActor(), action, target)).allowed).toBe(true);
    }
    expect(rule).not.toHaveBeenCalled();
  });
});

describe("what a rule is handed", () => {
  async function contextFor(
    actor: Actor,
    action: AccessAction = "read",
    slug = "posts"
  ): Promise<AccessControlContext> {
    const rule = vi.fn((_ctx: AccessControlContext) => true);
    await decide(actor, action, {
      kind: "collection",
      slug,
      access: { [action]: rule },
    });
    expect(rule).toHaveBeenCalledTimes(1);
    return rule.mock.calls[0][0];
  }

  it("is asked about the action and the target being decided", async () => {
    const editor = userActor({
      userId: "u6",
      roles: ["editor"],
      permissions: every("pages"),
    });
    const ctx = await contextFor(editor, "delete", "pages");
    expect(ctx.operation).toBe("delete");
    expect(ctx.target).toEqual({ kind: "collection", slug: "pages" });
    expect(ctx.collection).toBe("pages");
  });

  it("is the role screen's permission spelling, with the earlier one after it for one release", async () => {
    const ctx = await contextFor(callers["user-with"]);
    const stored = ACTIONS.map(action => `${action}-posts`);
    const earlier = ACTIONS.map(action => `posts:${action}`);
    expect([...ctx.permissions]).toEqual([...stored, ...earlier]);
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
    // What the Public role grants is not handed to the rule, as an anonymous
    // caller's rule has always been asked with no permissions.
    expect(visitor.permissions).toEqual([]);
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

/**
 * The decision's expected answer, written out from the composition apart
 * from the code: what each caller holds is stated here by hand rather than
 * read off its actor, so a judgement that slipped would disagree with it.
 */
const HOLDS: Record<CallerName, "principal" | "super-admin" | AccessAction[]> =
  {
    visitor: [],
    "visitor-public-read": ["read", "update", "publish", "unpublish"],
    principal: "principal",
    "user-with": [...ACTIONS],
    "user-without": [],
    "super-admin": "super-admin",
    "key-with": [...ACTIONS],
    "key-without": [],
  };

const changesState = (action: AccessAction) =>
  action === "publish" || action === "unpublish";

/** Holds the action, and update as well for a publish or an unpublish. */
const holdsFor = (held: AccessAction[], action: AccessAction) =>
  held.includes(action) && (!changesState(action) || held.includes("update"));

/** The same rule answers every action, the update rule included. */
function expected(
  caller: CallerName,
  action: AccessAction,
  rule: RuleName
): boolean {
  const ruleAllows = ALLOWING.includes(rule);
  const held = HOLDS[caller];
  if (held === "principal") {
    return !changesState(action) && rule !== "absent" && ruleAllows;
  }
  if (caller.startsWith("visitor") && changesState(action)) return false;
  if (held === "super-admin") return true;
  return holdsFor(held, action) && ruleAllows;
}

describe("the judge seam", () => {
  it("judges the outcomes it is handed as the decision's composition says", async () => {
    for (const caller of Object.keys(callers) as CallerName[]) {
      for (const action of ACTIONS) {
        for (const rule of Object.keys(RULES) as RuleName[]) {
          const target = postsWith(rule);
          const actor = callers[caller];
          const outcomes = await askRules(actor, action, target);
          expect(
            judge(actor, action, target, outcomes).allowed,
            `${caller} ${action} ${rule}`
          ).toBe(expected(caller, action, rule));
        }
      }
    }
  });

  it("asks no rule where the answer is reached without one", async () => {
    const rule = vi.fn(() => true);
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: { read: rule, publish: rule, update: rule },
    };
    expect(await askRules(systemActor(), "read", target)).toBeNull();
    expect(await askRules(callers["super-admin"], "read", target)).toBeNull();
    expect(await askRules(callers["user-without"], "read", target)).toBeNull();
    expect(await askRules(callers.visitor, "publish", target)).toBeNull();
    expect(rule).not.toHaveBeenCalled();
  });

  it("asks each rule once, and the update rule only after the action's own allows", async () => {
    const publish = vi.fn(() => false);
    const update = vi.fn(() => true);
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: { publish, update },
    };
    const refused = await askRules(callers["user-with"], "publish", target);
    expect(refused).toEqual({ action: { declared: true, value: false } });
    expect(update).not.toHaveBeenCalled();
    publish.mockReturnValue(true);
    expect(await askRules(callers["user-with"], "publish", target)).toEqual({
      action: { declared: true, value: true },
      update: { declared: true, value: true },
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("refuses to judge a publish whose update rule was not asked", () => {
    // The update rule may refuse the change; judging without it would allow
    // a publish it never saw.
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: { publish: () => true, update: () => false },
    };
    expect(() =>
      judge(callers["user-with"], "publish", target, {
        action: { declared: true, value: true },
      })
    ).toThrow();
  });

  it("refuses to judge a question whose rules were not asked", () => {
    expect(() =>
      judge(callers["user-with"], "read", postsWith("true"), null)
    ).toThrow();
  });
});

describe("a rule that fails", () => {
  it("is logged once, with what it was asked, and refuses", async () => {
    const logged = vi
      .spyOn(consoleLogger, "error")
      .mockImplementation(() => {});
    const failure = new Error("the rule failed");
    try {
      const outcome = await askRule(callers["user-with"], "read", {
        kind: "collection",
        slug: "posts",
        access: {
          read: () => {
            throw failure;
          },
        },
      });
      expect(outcome).toEqual({ declared: true, threw: true });
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(
        "[rbac] Code access function for read:posts threw",
        { error: failure }
      );
    } finally {
      logged.mockRestore();
    }
  });
});

describe("something no rule can name", () => {
  // Settings is no entry, and `manage` no operation a rule declares, so the
  // permission alone answers.
  const settingsGrant = {
    slug: "manage-settings",
    action: "manage",
    resource: "settings",
  };
  const manager = userActor({
    userId: "u10",
    roles: ["manager"],
    permissions: [settingsGrant],
  });

  it("is allowed to whoever holds the permission, and refused to whoever does not", () => {
    expect(decidePermission(manager, "manage", "settings").allowed).toBe(true);
    // `export` is no action a `manage-` permission counts as.
    expect(decidePermission(manager, "export", "settings")).toEqual({
      allowed: false,
      reason: "no-permission",
    });
  });

  it("is allowed to trusted work and a super-admin, holding nothing", () => {
    const admin = userActor({
      userId: "u11",
      roles: ["super-admin"],
      permissions: [],
    });
    expect(decidePermission(systemActor(), "manage", "").allowed).toBe(true);
    expect(decidePermission(admin, "manage", "").allowed).toBe(true);
  });

  it("is judged on a key's grants, and gives a key no super-admin authority", () => {
    const key = keyActor({
      keyId: "k3",
      userId: "u11",
      roles: ["super-admin"],
      permissions: [settingsGrant],
    });
    expect(decidePermission(key, "manage", "settings").allowed).toBe(true);
    expect(decidePermission(key, "export", "settings").allowed).toBe(false);
  });

  it("counts a system resource's manage permission as its read, create, update and delete, and nothing else", () => {
    const holder = (resource: string) =>
      userActor({
        userId: "u12",
        roles: ["holder"],
        permissions: [
          { slug: `manage-${resource}`, action: "manage", resource },
        ],
      });
    for (const resource of [
      "media",
      "settings",
      "email-providers",
      "email-templates",
    ]) {
      for (const action of ["read", "create", "update", "delete"]) {
        expect(
          decidePermission(holder(resource), action, resource).allowed,
          `${action} ${resource}`
        ).toBe(true);
      }
      // Never a publish or an unpublish, nor another resource's actions.
      expect(
        decidePermission(holder(resource), "publish", resource).allowed
      ).toBe(false);
      expect(decidePermission(holder(resource), "read", "roles").allowed).toBe(
        false
      );
    }
    // A resource outside the four, and a collection, get nothing from it.
    expect(
      decidePermission(holder("background-jobs"), "read", "background-jobs")
        .allowed
    ).toBe(false);
    expect(decidePermission(holder("posts"), "read", "posts").allowed).toBe(
      false
    );
  });

  it("is refused to a visitor and a plugin's person, who hold no permission", () => {
    const person = principalActor(MEMBER);
    expect(decidePermission(visitorActor(), "read", "settings")).toEqual({
      allowed: false,
      reason: "no-permission",
    });
    expect(decidePermission(person, "read", "settings")).toEqual({
      allowed: false,
      reason: "principal-without-rule",
    });
  });
});

describe("a rule that answers with a filter", () => {
  const OWN = { author: { equals: "u1" } };
  const TEAM = { team: { equals: "t1" } };
  /** `posts` declaring `rule` for every action. */
  const postsAnswering = (rule: unknown): AccessTarget => ({
    kind: "collection",
    slug: "posts",
    access: Object.fromEntries(
      ACTIONS.map(action => [action, () => rule])
    ) as CollectionAccessControl,
  });

  it.each(["read", "update", "delete"] as const)(
    "allows only the entries it matches on a collection's %s, and nothing for every entry",
    async action => {
      const decision = await decide(
        callers["user-with"],
        action,
        postsAnswering(OWN)
      );
      // POPULATION CONTROL: not `allowed`, so a way in reading `allowed`
      // alone refuses it.
      expect(decision.allowed).toBe(false);
      expect(decision).toEqual({
        allowed: false,
        reason: "only-matching-entries",
        filter: OWN,
      });
    }
  );

  it("answers the same from a promise, for a key as for a user", async () => {
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: { read: untypedRule(async () => OWN) },
    };
    expect(await decide(callers["key-with"], "read", target)).toEqual({
      allowed: false,
      reason: "only-matching-entries",
      filter: OWN,
    });
  });

  it("limits a publish by both its own rule's filter and the update rule's", async () => {
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: {
        publish: untypedRule(() => OWN),
        update: untypedRule(() => TEAM),
      },
    };
    expect(await decide(callers["user-with"], "publish", target)).toEqual({
      allowed: false,
      reason: "only-matching-entries",
      filter: { and: [OWN, TEAM] },
    });
  });

  it("is still refused where the caller lacks the permission", async () => {
    expect(
      await decide(callers["user-without"], "read", postsAnswering(OWN))
    ).toEqual({ allowed: false, reason: "no-permission" });
  });

  it("is never applied to a super-admin or trusted work, which pass every rule", async () => {
    const target = postsAnswering(OWN);
    expect(await decide(callers["super-admin"], "read", target)).toEqual({
      allowed: true,
    });
    expect(await decide(systemActor(), "read", target)).toEqual({
      allowed: true,
    });
  });

  it("limits a plugin's person to the matching entries too", async () => {
    expect(
      await decide(callers.principal, "read", postsAnswering(OWN))
    ).toEqual({ allowed: false, reason: "only-matching-entries", filter: OWN });
  });

  it("is refused from a create rule, which has no entries to match", async () => {
    expect(
      await decide(callers["user-with"], "create", postsAnswering(OWN))
    ).toEqual({ allowed: false, reason: "rule-filter-misplaced" });
  });

  it("is refused from a Single's rule, which is one entry", async () => {
    const settings: AccessTarget = {
      kind: "single",
      slug: "settings",
      access: { read: untypedRule(() => OWN) },
    };
    const editor = userActor({
      userId: "u7",
      roles: ["editor"],
      permissions: only("settings", ["read"]),
    });
    expect(await decide(editor, "read", settings)).toEqual({
      allowed: false,
      reason: "rule-filter-misplaced",
    });
  });

  it.each([
    ["an unknown operator", { slug: { resembles: "probe" } }],
    ["an empty in", { slug: { in: [] } }],
    ["an and that is not a list", { and: { slug: { equals: "x" } } }],
  ])("is refused when it is not well formed: %s", async (_name, filter) => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
    expect(
      await decide(callers["user-with"], "read", postsAnswering(filter))
    ).toEqual({ allowed: false, reason: "rule-filter-malformed" });
  });

  it("refuses a publish whose update rule answers a filter that is not well formed", async () => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
    const target: AccessTarget = {
      kind: "collection",
      slug: "posts",
      access: {
        publish: () => true,
        update: untypedRule(() => ({ and: "x" })),
      },
    };
    expect(await decide(callers["user-with"], "publish", target)).toEqual({
      allowed: false,
      reason: "rule-filter-malformed",
    });
  });

  it("is not mistaken for a filter when the answer is a list or a class instance", async () => {
    for (const answer of [[OWN], new Date()]) {
      expect(
        await decide(callers["user-with"], "read", postsAnswering(answer))
      ).toEqual({ allowed: false, reason: "rule-refused" });
    }
  });
});
