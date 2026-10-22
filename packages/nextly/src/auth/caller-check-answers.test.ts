/**
 * Every answer the two caller checks give, pinned in one file.
 *
 * `callerMayPerform` answers a plugin route's `ctx.caller.can(action,
 * resource)`, and `callerHoldsPermission` whether a caller holds a named
 * permission slug, which decides a dashboard widget's `requiredPermission`
 * and a document lock's release. The integration table asks them through a
 * plugin route and the dashboard on each dialect. This asks them directly,
 * over more callers, rule values and resources than those can name: an entity
 * with a code rule, resources that are not entries, actions no rule can name
 * (`manage`, `export`), an empty action or resource, and keys whose scope
 * carries slugs without grant rows or grants stored under slugs of their own.
 *
 * Each answer is written as the check returned it, so a rule's raw answer
 * (`null`, a truthy string) shows as itself rather than as a yes or no.
 *
 * The access-control service is the real one, with each rule registered as an
 * app registers it. Only the role and permission lookups are faked, from one
 * table of who holds what, so every way a check reads a caller (the
 * super-admin lookup, the permission checks, the rule's context and the
 * caller's roles) reads the same truth.
 *
 * When an answer moves on purpose, rerun with `-u`: the diff of
 * `caller-check-answers.txt` is the record of what moved.
 */
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import type { CollectionAccessControl } from "../shared/types/access";

import { callerMayPerform, schemaListed } from "./access/route-gate-adapters";
import { authorizeCaller, type AuthContext } from "./middleware";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
  type GrantedPermission,
} from "./authenticated-scope";
import { callerHoldsPermission, readAccessCaller } from "./entity-read-access";

const POSTS = "posts";
const OPERATIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;

const grant = (
  action: string,
  resource: string,
  slug = `${action}-${resource}`
): GrantedPermission => ({ slug, action, resource });

const POST_GRANTS = OPERATIONS.map(op => grant(op, POSTS));
const SYSTEM_GRANTS = [
  grant("read", "settings"),
  grant("manage", "settings"),
  grant("manage", "media"),
];

/** Who holds what, as the database would answer it. */
const STORED: Record<string, { roles: string[]; grants: GrantedPermission[] }> =
  {
    editor: { roles: ["editor"], grants: [...POST_GRANTS, ...SYSTEM_GRANTS] },
    viewer: { roles: ["viewer"], grants: [] },
    publisher: {
      roles: ["publisher"],
      grants: [
        grant("read", POSTS),
        grant("publish", POSTS),
        grant("unpublish", POSTS),
        grant("read", "settings"),
      ],
    },
    admin: { roles: ["super-admin"], grants: [] },
    "admin-inherited": { roles: ["chief", "super-admin"], grants: [] },
    owner: { roles: ["editor"], grants: [...POST_GRANTS, ...SYSTEM_GRANTS] },
    // Holds read on posts, but their roles cannot be read.
    "roles-unreadable": { roles: ["editor"], grants: [grant("read", POSTS)] },
  };

const stored = (userId: string) => STORED[userId] ?? { roles: [], grants: [] };

const holds = (userId: string, action: string, resource: string) =>
  stored(userId).roles.includes("super-admin") ||
  stored(userId).grants.some(
    g => g.action === action && g.resource === resource
  );

vi.mock("../services/lib/permissions", async importOriginal => {
  const real =
    await importOriginal<typeof import("../services/lib/permissions")>();
  return {
    ...real,
    isSuperAdmin: vi.fn(async (userId: string) =>
      stored(userId).roles.includes("super-admin")
    ),
    // The real check answers no for a resource named by nothing.
    hasPermission: vi.fn(async (userId: string, action: string, r: string) =>
      r === "" ? false : holds(userId, action, r)
    ),
    listRoleSlugsForUser: vi.fn(async (userId: string) => {
      if (userId === "roles-unreadable") throw new Error("roles unreadable");
      return [...stored(userId).roles];
    }),
    listRoleSlugsForUserStrict: vi.fn(async (userId: string) => [
      ...stored(userId).roles,
    ]),
    listEffectivePermissions: vi.fn(async (userId: string) =>
      stored(userId)
        .grants.map(g => `${g.resource}:${g.action}`)
        .sort()
    ),
    listEffectiveGrants: vi.fn(async (userId: string) => [
      ...stored(userId).grants,
    ]),
  };
});

/** The access-control service the checks find, or none. */
const registered: { rbac: RBACAccessControlService | undefined } = {
  rbac: undefined,
};

vi.mock("../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "rbacAccessControlService" && registered.rbac !== undefined,
    get: () => registered.rbac,
  },
}));

/**
 * A caller as a plugin route resolves it: the user it names, with their role
 * slugs, and the key's own scope when a key made the request.
 */
interface Caller {
  readonly user: { id: string; roles: string[] };
  readonly scope?: AuthenticatedScope;
}

const session = (userId: string): Caller => ({
  user: { id: userId, roles: [...stored(userId).roles] },
});

const key = (
  grants: readonly GrantedPermission[],
  options: { userId?: string; roles?: string[]; slugsOnly?: boolean } = {}
): Caller => {
  const userId = options.userId ?? "owner";
  return {
    user: { id: userId, roles: [...stored(userId).roles] },
    scope: apiKeyScopeFrom({
      permissions: grants.map(g => g.slug),
      ...(options.slugsOnly ? {} : { grants }),
      roles: options.roles ?? ["editor"],
    }),
  };
};

const CALLERS: Record<string, Caller> = {
  "user-with": session("editor"),
  "user-without": session("viewer"),
  "user-partial": session("publisher"),
  "super-admin": session("admin"),
  "super-admin-inherited": session("admin-inherited"),
  "key-with": key([...POST_GRANTS, ...SYSTEM_GRANTS]),
  "key-without": key([]),
  "key-partial": key([
    grant("read", POSTS),
    grant("publish", POSTS),
    grant("unpublish", POSTS),
  ]),
  "key-slugs-only": key([...POST_GRANTS, ...SYSTEM_GRANTS], {
    slugsOnly: true,
  }),
  // A key made by a super-admin carries that role's name, and no authority.
  "key-made-by-super-admin": key([grant("read", POSTS)], {
    userId: "admin",
    roles: ["super-admin"],
  }),
  // Grants stored under slugs of their own.
  "key-custom-slugs": key([
    grant("read", POSTS),
    grant("update", POSTS, "edit-posts"),
    grant("update", "email-providers", "manage-email-providers"),
  ]),
  "key-manage": key([grant("manage", "email-providers")]),
};

type Rule = CollectionAccessControl[keyof CollectionAccessControl];

const RULES: Record<string, Rule | undefined> = {
  none: undefined,
  true: true,
  false: false,
  "returns-true": () => true,
  "returns-false": () => false,
  "returns-null": () => null as unknown as boolean,
  "returns-undefined": () => undefined as unknown as boolean,
  "returns-truthy": () => "yes" as unknown as boolean,
  throws: () => {
    throw new Error("rule failed");
  },
  "role-name": ({ roles }) => roles.includes("editor"),
  "permission-spelling": ({ permissions, operation }) =>
    permissions.includes(`${POSTS}:${operation}`),
};

/** What `can` is asked: an action on a resource. */
const CAN: readonly [string, string][] = [
  ...OPERATIONS.map(op => [op, POSTS] as [string, string]),
  ["export", POSTS],
  ["read", "settings"],
  ["manage", "settings"],
  ["read", "media"],
  ["update", "email-providers"],
  ["manage", "email-providers"],
  ["manage", ""],
  ["", POSTS],
];

/** What `callerHoldsPermission` is asked: a permission slug. */
const HOLDS: readonly string[] = [
  ...OPERATIONS.map(op => `${op}-${POSTS}`),
  "export-posts",
  "edit-posts",
  "read-settings",
  "manage-settings",
  "read-media",
  "update-email-providers",
  "manage-email-providers",
  "manage",
  "",
];

const SETUPS = ["service", "no-service"] as const;

function serviceFor(
  setup: (typeof SETUPS)[number],
  rule: Rule | undefined
): RBACAccessControlService | undefined {
  if (setup === "no-service") return undefined;
  const rbac = new RBACAccessControlService();
  if (rule !== undefined) {
    // The same rule for every action, so each action is asked of it.
    rbac.registerCollectionAccess(
      POSTS,
      Object.fromEntries(OPERATIONS.map(op => [op, rule]))
    );
  }
  return rbac;
}

/** The answer as the check returned it, or that it threw. */
async function said(answer: () => Promise<unknown>): Promise<string> {
  try {
    const value = await answer();
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch {
    return "threw";
  }
}

/** Each caller's answers for one setup and rule. */
async function answersFor(
  setup: (typeof SETUPS)[number],
  ruleName: string,
  rule: Rule | undefined
): Promise<string[]> {
  registered.rbac = serviceFor(setup, rule);
  const lines: string[] = [];
  for (const [callerName, { user, scope }] of Object.entries(CALLERS)) {
    lines.push(`${setup} ${ruleName} ${callerName}`);
    // As a plugin route asks it: the caller its read endpoints resolve.
    const caller = readAccessCaller({
      user,
      ...(scope ? { authenticatedScope: scope } : {}),
    });
    for (const [action, resource] of CAN) {
      const answer = await said(() =>
        callerMayPerform(scope, action, resource, {
          id: caller.userId,
          roles: caller.roles,
        })
      );
      lines.push(`  can(${action},${resource}):${answer}`);
    }
    for (const slug of HOLDS) {
      const answer = await said(() => callerHoldsPermission(slug, caller));
      lines.push(`  holds(${slug}):${answer}`);
    }
  }
  return lines;
}

describe("the caller checks' answers", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("are the answers the file records, for every case", async () => {
    // A rule that throws is reported by the check that catches it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lines: string[] = [];
    for (const setup of SETUPS) {
      for (const [ruleName, rule] of Object.entries(RULES)) {
        // Without the service no rule is registered, so one row says it all.
        if (setup === "no-service" && ruleName !== "none") continue;
        lines.push(...(await answersFor(setup, ruleName, rule)));
      }
    }
    // POPULATION CONTROL: both answers, from both checks, and a rule's raw
    // answer, were reached.
    const text = lines.join("\n");
    expect(text).toMatch(/can\([a-z]+,posts\):true/);
    expect(text).toMatch(/can\([a-z]+,posts\):false/);
    expect(text).toMatch(/can\([a-z]+,posts\):null/);
    expect(text).toMatch(/holds\([a-z-]+\):true/);
    expect(text).toMatch(/holds\([a-z-]+\):false/);
    await expect(`${text}\n`).toMatchFileSnapshot(
      join(__dirname, "caller-check-answers.txt")
    );
  });
});

describe("an entity that registered a rule under a system resource's name", () => {
  it("is asked with its rule, before any `manage-` permission counts", async () => {
    // Config validation reserves these names, so only a rule registered
    // directly reaches here; the rule must still be read wherever it is.
    const rbac = new RBACAccessControlService();
    rbac.registerCollectionAccess("settings", { read: () => false });
    registered.rbac = rbac;
    const editor = session("editor");
    const caller = readAccessCaller({ user: editor.user });
    const auth: AuthContext = {
      userId: "editor",
      permissions: [],
      roles: [],
      authMethod: "session",
    };

    // POPULATION CONTROL: the editor holds read-settings and manage-settings,
    // so a check that skipped the rule would allow.
    expect(holds("editor", "read", "settings")).toBe(true);
    await expect(
      callerMayPerform(undefined, "read", "settings", editor.user)
    ).resolves.toBe(false);
    await expect(callerHoldsPermission("read-settings", caller)).resolves.toBe(
      false
    );
    const gate = await authorizeCaller(auth, "read", "settings");
    expect("statusCode" in gate && gate.statusCode).toBe(403);
  });
});

describe("the schema list for a session whose roles cannot be read", () => {
  it("still shows the collections the grants it read allow", async () => {
    registered.rbac = new RBACAccessControlService();
    // A failed lookup is reported as it happens.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const auth: AuthContext = {
      userId: "roles-unreadable",
      permissions: [],
      roles: [],
      authMethod: "session",
    };
    const listed = await schemaListed(
      auth,
      [{ slug: POSTS }, { slug: "pages" }],
      registered.rbac
    );
    // The grant to read posts was read; nothing grants pages.
    expect(listed.map(c => c.slug)).toEqual([POSTS]);
  });
});
