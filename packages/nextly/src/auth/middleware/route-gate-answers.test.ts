/**
 * Every answer the REST route gates give, pinned in one file.
 *
 * `requirePermission` (and `requireCollectionAccess`, and a plugin route's
 * `requiredPermission`, which reach the same decision through
 * `authorizeCaller`) judges a caller against one permission;
 * `requireAnyPermission` (`authorizeCallerForAny`) against any of several.
 * The integration table asks them through real routes on each dialect. This
 * asks them directly, over more callers, rule values and resources than a
 * route can name: an entity with a code rule, resources that are not entries,
 * actions no rule can name (`manage`, `export`), a resource named by nothing,
 * and keys whose scope carries slugs without grant rows or grants stored under
 * slugs of their own. Each answer is written with its status and message.
 *
 * The access-control service is the real one, with each rule registered as an
 * app registers it. Only the role and permission lookups are faked, from one
 * table of who holds what, so every way a gate reads a caller (the
 * super-admin lookup, the permission checks, the rule's context and the
 * caller's roles) reads the same truth.
 *
 * When an answer moves on purpose, rerun with `-u`: the diff of
 * `route-gate-answers.txt` is the record of what moved.
 */
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { CollectionAccessControl } from "../../shared/types/access";
import type { GrantedPermission } from "../authenticated-scope";

import { authorizeCaller, authorizeCallerForAny, type AuthContext } from ".";

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
const SETTINGS_GRANTS = [
  grant("read", "settings"),
  grant("manage", "settings"),
];

/** Who holds what, as the database would answer it. */
const STORED: Record<string, { roles: string[]; grants: GrantedPermission[] }> =
  {
    editor: { roles: ["editor"], grants: [...POST_GRANTS, ...SETTINGS_GRANTS] },
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
    owner: { roles: ["editor"], grants: [...POST_GRANTS, ...SETTINGS_GRANTS] },
  };

const stored = (userId: string) => STORED[userId] ?? { roles: [], grants: [] };

const holds = (userId: string, action: string, resource: string) =>
  stored(userId).roles.includes("super-admin") ||
  stored(userId).grants.some(
    g => g.action === action && g.resource === resource
  );

vi.mock("../../services/lib/permissions", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../services/lib/permissions")>();
  return {
    ...real,
    isSuperAdmin: vi.fn(async (userId: string) =>
      stored(userId).roles.includes("super-admin")
    ),
    // The real check answers no for a resource named by nothing.
    hasPermission: vi.fn(async (userId: string, action: string, r: string) =>
      r === "" ? false : holds(userId, action, r)
    ),
    hasAnyPermission: vi.fn(
      async (
        userId: string,
        permissions: Array<{ action: string; resource: string }>
      ) =>
        permissions.some(
          p => p.resource !== "" && holds(userId, p.action, p.resource)
        )
    ),
    // The role read refuses for one caller, as it does when the database
    // cannot be read.
    listRoleSlugsForUser: vi.fn(async (userId: string) => {
      if (userId === "unreadable") throw new Error("roles unreadable");
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

/** The access-control service the gates find, or none. */
const registered: { rbac: RBACAccessControlService | undefined } = {
  rbac: undefined,
};

vi.mock("../../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "rbacAccessControlService" && registered.rbac !== undefined,
    get: () => registered.rbac,
  },
}));

const session = (userId: string): AuthContext => ({
  userId,
  permissions: [],
  roles: [],
  authMethod: "session",
});

const key = (
  grants: readonly GrantedPermission[],
  options: { userId?: string; roles?: string[]; slugsOnly?: boolean } = {}
): AuthContext => ({
  userId: options.userId ?? "owner",
  permissions: grants.map(g => g.slug),
  ...(options.slugsOnly ? {} : { grants }),
  roles: options.roles ?? ["editor"],
  authMethod: "api-key",
  apiKeyId: "key-1",
});

const CALLERS: Record<string, AuthContext> = {
  "user-with": session("editor"),
  "user-without": session("viewer"),
  "user-partial": session("publisher"),
  "super-admin": session("admin"),
  "super-admin-inherited": session("admin-inherited"),
  "key-with": key([...POST_GRANTS, ...SETTINGS_GRANTS]),
  "key-without": key([]),
  "key-partial": key([
    grant("read", POSTS),
    grant("publish", POSTS),
    grant("unpublish", POSTS),
  ]),
  "key-slugs-only": key([...POST_GRANTS, ...SETTINGS_GRANTS], {
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
  "returns-truthy": () => "yes" as unknown as boolean,
  throws: () => {
    throw new Error("rule failed");
  },
  "role-name": ({ roles }) => roles.includes("editor"),
  "permission-spelling": ({ permissions, operation }) =>
    permissions.includes(`${POSTS}:${operation}`),
};

/** One permission asked of `requirePermission`: an action on a resource. */
const ONE: readonly [string, string][] = [
  ...OPERATIONS.map(op => [op, POSTS] as [string, string]),
  ["export", POSTS],
  ["read", "settings"],
  ["manage", "settings"],
  ["update", "email-providers"],
  ["manage", ""],
];

/** Several asked of `requireAnyPermission`, as the routes list them. */
const ANY: readonly (readonly { action: string; resource: string }[])[] = [
  [
    { action: "update", resource: "email-providers" },
    { action: "manage", resource: "email-providers" },
  ],
  [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ],
  [
    { action: "read", resource: POSTS },
    { action: "update", resource: POSTS },
  ],
  [{ action: "delete", resource: POSTS }],
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

const said = (result: Awaited<ReturnType<typeof authorizeCaller>>) =>
  "statusCode" in result ? `${result.statusCode} ${result.error}` : "A";

/** Each caller's answers for one setup and rule. */
async function answersFor(
  setup: (typeof SETUPS)[number],
  ruleName: string,
  rule: Rule | undefined
): Promise<string[]> {
  registered.rbac = serviceFor(setup, rule);
  const lines: string[] = [];
  for (const [callerName, auth] of Object.entries(CALLERS)) {
    lines.push(`${setup} ${ruleName} ${callerName}`);
    for (const [action, resource] of ONE) {
      const answer = said(await authorizeCaller(auth, action, resource));
      lines.push(`  ${action}-${resource}:${answer}`);
    }
    for (const permissions of ANY) {
      const answer = said(await authorizeCallerForAny(auth, [...permissions]));
      const named = permissions.map(p => `${p.action}-${p.resource}`).join("|");
      lines.push(`  any(${named}):${answer}`);
    }
  }
  return lines;
}

describe("the REST route gates' answers", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("are the answers the file records, for every case", async () => {
    // A rule that throws is reported by the gate that catches it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lines: string[] = [];
    for (const setup of SETUPS) {
      for (const [ruleName, rule] of Object.entries(RULES)) {
        // Without the service no rule is registered, so one row says it all.
        if (setup === "no-service" && ruleName !== "none") continue;
        lines.push(...(await answersFor(setup, ruleName, rule)));
      }
    }
    // POPULATION CONTROL: both answers, from both gates, were reached.
    const text = lines.join("\n");
    expect(text).toMatch(/-posts:A/);
    expect(text).toMatch(/-posts:403 /);
    expect(text).toMatch(/any\([^)]*\):A/);
    expect(text).toMatch(/any\([^)]*\):403 /);
    await expect(`${text}\n`).toMatchFileSnapshot(
      join(__dirname, "route-gate-answers.txt")
    );
  });
});

describe("a session whose access cannot be read", () => {
  it("fails the gate with the read's error, rather than answering 403", async () => {
    // A rule handed the caller's roles, so they must be read to ask it.
    registered.rbac = serviceFor("service", RULES["role-name"]);
    // POPULATION CONTROL: a caller whose roles are read reaches the rule.
    expect(said(await authorizeCaller(session("editor"), "read", POSTS))).toBe(
      "A"
    );
    await expect(
      authorizeCaller(session("unreadable"), "read", POSTS)
    ).rejects.toThrow("roles unreadable");
  });
});
