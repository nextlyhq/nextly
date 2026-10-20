/**
 * Every answer the collection gate gives, pinned in one file.
 *
 * The gate decides by caller, rule, action and setup, and the integration
 * table asks it through real ways in on each dialect. This asks it directly,
 * over more callers and rule values than a way in can name: a role claimed on
 * the `user` object that the database does not confirm, a key whose scope
 * carries slugs without grant rows, a key holding publish without update, and
 * a rule answering a truthy value that is not `true`. Each answer is written
 * with its status and message, so a change in what a refusal says is seen as
 * well as a change in whether it refuses.
 *
 * The access-control service is the real one, with each rule registered as an
 * app registers it. Only the role and permission lookups are faked, from one
 * table of who holds what, so every way the gate reads a caller (the
 * super-admin lookup, the permission check, the rule's context and the
 * caller's roles) reads the same truth.
 *
 * When an answer moves on purpose, rerun with `-u`: the diff of
 * `collection-gate-answers.txt` is the record of what moved.
 */
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  apiKeyScope,
  apiKeyScopeFrom,
  type AuthenticatedScope,
  type GrantedPermission,
} from "../../../auth/authenticated-scope";
import type { AccessOperation } from "../../../services/access";
import type { CollectionAccessControl } from "../../../shared/types/access";
import { RBACAccessControlService } from "../../auth/services/rbac-access-control-service";
import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../__tests__/collection-test-helpers";

import { CollectionAccessService } from "./collection-access-service";

const SLUG = "posts";

const OPERATIONS: readonly AccessOperation[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];

const grant = (action: string): GrantedPermission => ({
  slug: `${action}-${SLUG}`,
  action,
  resource: SLUG,
});

const ALL_GRANTS = OPERATIONS.map(grant);

/** Who holds what, as the database would answer it. */
const STORED: Record<string, { roles: string[]; grants: GrantedPermission[] }> =
  {
    editor: { roles: ["editor"], grants: ALL_GRANTS },
    viewer: { roles: ["viewer"], grants: [] },
    publisher: {
      roles: ["publisher"],
      grants: [grant("read"), grant("publish"), grant("unpublish")],
    },
    admin: { roles: ["super-admin"], grants: [] },
    "admin-inherited": { roles: ["chief", "super-admin"], grants: [] },
    owner: { roles: ["editor"], grants: ALL_GRANTS },
  };

const stored = (userId: string) => STORED[userId] ?? { roles: [], grants: [] };

vi.mock("../../../services/lib/permissions", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../../services/lib/permissions")>();
  const holds = (userId: string, action: string, resource: string) =>
    stored(userId).roles.includes("super-admin") ||
    stored(userId).grants.some(
      g => g.action === action && g.resource === resource
    );
  return {
    ...real,
    isSuperAdmin: vi.fn(async (userId: string) =>
      stored(userId).roles.includes("super-admin")
    ),
    hasPermission: vi.fn(async (userId: string, action: string, r: string) =>
      holds(userId, action, r)
    ),
    listRoleSlugsForUser: vi.fn(async (userId: string) => [
      ...stored(userId).roles,
    ]),
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

interface Caller {
  user?: { id: string; roles?: string[] };
  scope?: AuthenticatedScope;
}

const CALLERS: Record<string, Caller> = {
  visitor: {},
  "user-with": { user: { id: "editor" } },
  "user-without": { user: { id: "viewer" } },
  "user-partial": { user: { id: "publisher" } },
  "super-admin": { user: { id: "admin" } },
  "super-admin-inherited": { user: { id: "admin-inherited" } },
  "super-admin-claimed": { user: { id: "viewer", roles: ["super-admin"] } },
  "super-admin-claimed-key": {
    user: { id: "owner", roles: ["super-admin"] },
    scope: apiKeyScope([grant("read")], ["editor"]),
  },
  "key-with": {
    user: { id: "owner" },
    scope: apiKeyScope(ALL_GRANTS, ["editor"]),
  },
  "key-without": { user: { id: "owner" }, scope: apiKeyScope([], ["editor"]) },
  "key-partial": {
    user: { id: "owner" },
    scope: apiKeyScope(
      [grant("read"), grant("publish"), grant("unpublish")],
      ["editor"]
    ),
  },
  "key-slugs-only": {
    user: { id: "owner" },
    scope: apiKeyScopeFrom({
      permissions: OPERATIONS.map(op => `${op}-${SLUG}`),
      roles: ["editor"],
    }),
  },
  // A key made by a super-admin carries that role's name, and no authority.
  "key-made-by-super-admin": {
    user: { id: "admin" },
    scope: apiKeyScope([grant("read")], ["super-admin"]),
  },
  "key-own-roles": {
    user: { id: "owner", roles: ["owner-role"] },
    scope: apiKeyScopeFrom({ grants: ALL_GRANTS }),
  },
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
  "async-true": async () => true,
  "role-name": ({ roles }) => roles.includes("editor"),
  "permission-spelling": ({ permissions, operation }) =>
    permissions.includes(`${SLUG}:${operation}`),
  "signed-in": ({ user }) => user !== null,
};

const SETUPS = ["service", "no-service", "route-authorized"] as const;

function gateFor(setup: (typeof SETUPS)[number], rule: Rule | undefined) {
  if (setup === "no-service") {
    return new CollectionAccessService(
      createMockAdapter(createMockDb({ rows: [] })) as never,
      silentLogger as never
    );
  }
  const rbac = new RBACAccessControlService();
  if (rule !== undefined) {
    // The same rule for every action, so each action is asked of it.
    rbac.registerCollectionAccess(
      SLUG,
      Object.fromEntries(OPERATIONS.map(op => [op, rule]))
    );
  }
  return new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    rbac
  );
}

/** Each caller's answers for one setup and rule, one line per action. */
async function answersFor(
  setup: (typeof SETUPS)[number],
  ruleName: string,
  rule: Rule | undefined
): Promise<string[]> {
  const gate = gateFor(setup, rule);
  const lines: string[] = [];
  for (const [callerName, caller] of Object.entries(CALLERS)) {
    lines.push(`${setup} ${ruleName} ${callerName}`);
    for (const operation of OPERATIONS) {
      const refused = await gate.checkCollectionAccess({
        collectionName: SLUG,
        operation,
        user: caller.user,
        authenticatedScope: caller.scope,
        routeAuthorized: setup === "route-authorized",
      });
      lines.push(
        refused === null
          ? `  ${operation}:A`
          : `  ${operation}:${refused.statusCode} ${refused.message}`
      );
    }
  }
  return lines;
}

describe("the collection gate's answers", () => {
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
    // POPULATION CONTROL: every kind of answer was reached.
    const text = lines.join("\n");
    expect(text).toContain(":A");
    expect(text).toContain(":403 Access denied: insufficient permissions");
    expect(text).toContain(":403 Access denied: publish on posts requires");
    await expect(`${text}\n`).toMatchFileSnapshot(
      join(__dirname, "collection-gate-answers.txt")
    );
  });
});
