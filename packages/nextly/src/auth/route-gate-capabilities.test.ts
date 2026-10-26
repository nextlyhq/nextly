/**
 * What `routeGateCapabilities` tells the admin a caller may do, against what
 * the route gate a REST request asks would answer for the same cell.
 *
 * The property that separates it from a plausible broken one is that every
 * cell IS the route gate's answer: one asking the decision alone, or reading
 * the caller's permission slugs as `/me/permissions` does, agrees on most
 * cells and parts on the ones where the gates still keep today's answer (a
 * rule deciding alone for a person, a key judged on its stored slug, no
 * access-control service). The access-control service is the real one; only
 * the role and permission lookups are faked, from one table of who holds what.
 *
 * This is the fast check of how the answer composes the gates, across every
 * rule kind and setup. It asks the gate the REST routes ask rather than making
 * the requests: the access table (`__tests__/access-every-way-in`) makes the
 * real REST request for each cell at its `route` door and the real
 * `GET /me/capabilities` at its `capabilities` door, and holds both to the
 * same decision on every dialect, so a route that came to ask something else
 * shows there.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import { hasPermission } from "../services/lib/permissions";
import type { CollectionAccessControl } from "../shared/types/access";

import { recordingDeviations } from "./access/deviations";
import {
  routeGateCapabilities,
  routeGateVerdict,
  sentParams,
  type GateCaller,
  type RouteCapabilities,
  type SentLanguage,
} from "./access/route-gate-adapters";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
  type GrantedPermission,
} from "./authenticated-scope";
import { requestLanguage, type AuthContext } from "./middleware";

const POSTS = "posts";
const HOME = "home";

const grant = (
  action: string,
  resource: string,
  slug = `${action}-${resource}`
): GrantedPermission => ({ slug, action, resource });

/** Who holds what, as the database would answer it. */
const STORED: Record<string, { roles: string[]; grants: GrantedPermission[] }> =
  {
    editor: {
      roles: ["editor"],
      grants: [
        grant("read", POSTS),
        grant("update", POSTS),
        grant("create", POSTS),
        grant("read", HOME),
        grant("update", HOME),
        grant("read", "media"),
        grant("manage", "media"),
      ],
    },
    viewer: { roles: ["viewer"], grants: [] },
    admin: { roles: ["super-admin"], grants: [] },
    owner: { roles: ["editor"], grants: [grant("read", POSTS)] },
    // May update and publish posts.
    publisher: {
      roles: ["publisher"],
      grants: [
        grant("read", POSTS),
        grant("update", POSTS),
        grant("publish", POSTS),
        grant("unpublish", POSTS),
      ],
    },
    // May publish posts, and holds no update to send the change through.
    "publisher-only": {
      roles: ["publisher"],
      grants: [grant("read", POSTS), grant("publish", POSTS)],
    },
    "grants-unreadable": { roles: ["editor"], grants: [] },
    // A super-admin whose roles cannot be read.
    "roles-unreadable": { roles: ["super-admin"], grants: [] },
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
    isSuperAdminOrRefuse: vi.fn(async (userId: string) => {
      if (userId === "roles-unreadable") throw new Error("roles unreadable");
      return stored(userId).roles.includes("super-admin");
    }),
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
      stored(userId).grants.map(g => `${g.resource}:${g.action}`)
    ),
    listEffectiveGrants: vi.fn(async (userId: string) => {
      if (userId === "grants-unreadable") throw new Error("grants unreadable");
      return [...stored(userId).grants];
    }),
  };
});

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

/** The request as the route gate sees it, and the same caller as a gate caller. */
interface Request {
  readonly auth: AuthContext;
  readonly caller: GateCaller;
}

const session = (userId: string): Request => ({
  auth: { userId, permissions: [], roles: [], authMethod: "session" },
  caller: { userId },
});

const key = (
  grants: readonly GrantedPermission[],
  options: { slugsOnly?: boolean } = {}
): Request => {
  const auth: AuthContext = {
    userId: "owner",
    permissions: grants.map(g => g.slug),
    ...(options.slugsOnly ? {} : { grants }),
    roles: ["editor"],
    authMethod: "api-key",
    apiKeyId: "key-1",
  };
  const scope: AuthenticatedScope = apiKeyScopeFrom(auth);
  return { auth, caller: { userId: "owner", key: scope, keyId: "key-1" } };
};

const REQUESTS: Record<string, Request> = {
  "user-with": session("editor"),
  "user-without": session("viewer"),
  "user-publish-only": session("publisher-only"),
  "super-admin": session("admin"),
  "key-with": key([grant("read", POSTS), grant("update", POSTS)]),
  "key-slugs-only": key([grant("read", POSTS)], { slugsOnly: true }),
  "key-custom-slug": key([grant("update", POSTS, "edit-posts")]),
};

type Rule = CollectionAccessControl[keyof CollectionAccessControl];

const RULES: Record<string, Rule | undefined> = {
  none: undefined,
  "returns-true": () => true,
  "returns-false": () => false,
  "returns-null": () => null as unknown as boolean,
};

const ENTITIES = new Map<string, "collection" | "single">([
  [POSTS, "collection"],
  [HOME, "single"],
]);

/**
 * The languages each action's REST operation is told, framed by the function
 * that frames a REST request, with no language asked for. The site here
 * configures none, so every cell is judged in the same frame the gate
 * comparison below is asked in.
 */
const LANGUAGE_OF = (operation: string, sent: SentLanguage) =>
  requestLanguage({ method: operation, params: sentParams(sent, "") });

function serviceFor(
  setup: "service" | "no-service",
  rule: Rule | undefined
): RBACAccessControlService | undefined {
  if (setup === "no-service") return undefined;
  const rbac = new RBACAccessControlService();
  if (rule !== undefined) {
    const ops = ["create", "read", "update", "delete", "publish", "unpublish"];
    rbac.registerCollectionAccess(
      POSTS,
      Object.fromEntries(ops.map(op => [op, rule]))
    );
    rbac.registerSingleAccess(
      HOME,
      Object.fromEntries(ops.map(op => [op, rule]))
    );
  }
  return rbac;
}

beforeEach(() => {
  registered.rbac = undefined;
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** One cell of an answer: what the caller may do with one resource. */
type Cell = { resource: string; action: string; answer: boolean };

/** Every cell of one answer, one per entity and action. */
function cellsOf(capabilities: RouteCapabilities): Cell[] {
  const entities = Object.entries(capabilities.entities).map(
    ([resource, { kind: _kind, ...actions }]) =>
      [resource, actions] as [string, Record<string, boolean>]
  );
  return entities.flatMap(([resource, actions]) =>
    Object.entries(actions).map(([action, answer]) => ({
      resource,
      action,
      answer,
    }))
  );
}

/**
 * What a REST request for `action` meets: its route's gate, and for a publish
 * or an unpublish, which is sent as an update, the update route's gate first.
 */
async function restAllows(
  auth: AuthContext,
  action: string,
  resource: string,
  rbac: RBACAccessControlService | undefined
): Promise<boolean> {
  const asked = REQUEST_OF_CELL[action];
  if (asked !== undefined) {
    const verdicts = await Promise.all(
      asked.map(a => routeGateVerdict(auth, a, resource, rbac))
    );
    return verdicts.every(verdict => verdict.allowed);
  }
  const own = await routeGateVerdict(auth, action, resource, rbac);
  if (action !== "publish" && action !== "unpublish") return own.allowed;
  const update = await routeGateVerdict(auth, "update", resource, rbac);
  return update.allowed && own.allowed;
}

/**
 * The gates the request behind each operation-level cell asks: its route's
 * action, and for publishing every language the update route and then the
 * publish check. The site here configures no language, so each is judged in
 * the frame its action's own cell is.
 */
const REQUEST_OF_CELL: Readonly<Record<string, readonly string[]>> = {
  readTranslations: ["read"],
  readHistory: ["read"],
  createInDefaultLanguage: ["create"],
  updateInDefaultLanguage: ["update"],
  publishEveryLanguage: ["update", "publish"],
};

/** Each setup and rule the comparison is made under, and its service. */
function setups(): {
  name: string;
  rbac: RBACAccessControlService | undefined;
}[] {
  const made: { name: string; rbac: RBACAccessControlService | undefined }[] =
    [];
  for (const [ruleName, rule] of Object.entries(RULES)) {
    made.push({
      name: `service ${ruleName}`,
      rbac: serviceFor("service", rule),
    });
  }
  // Without the service no rule is read, so one setup covers every rule.
  made.push({ name: "no-service", rbac: serviceFor("no-service", undefined) });
  return made;
}

describe("routeGateCapabilities", () => {
  it("answers every cell as the REST request for it is answered, in every setup", async () => {
    let compared = 0;
    let allowed = 0;
    let refused = 0;
    for (const setup of setups()) {
      registered.rbac = setup.rbac;
      for (const [who, { auth, caller }] of Object.entries(REQUESTS)) {
        const capabilities = await routeGateCapabilities(
          caller,
          ENTITIES,
          registered.rbac,
          LANGUAGE_OF
        );
        for (const { resource, action, answer } of cellsOf(capabilities)) {
          const rest = await restAllows(
            auth,
            action,
            resource,
            registered.rbac
          );
          expect(answer, `${setup.name} ${who} ${action}-${resource}`).toBe(
            rest
          );
          compared += 1;
          if (answer) allowed += 1;
          else refused += 1;
        }
      }
    }
    // POPULATION CONTROL: both answers were compared, over every cell, and
    // the comparison saw each verdict, so it is not agreeing on one of them.
    expect(compared).toBeGreaterThan(300);
    expect(allowed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it("gives a collection six actions and a Single four, each with its requests judged across languages", async () => {
    registered.rbac = new RBACAccessControlService();
    const { entities } = await routeGateCapabilities(
      { userId: "editor" },
      ENTITIES,
      registered.rbac,
      LANGUAGE_OF
    );
    expect(Object.keys(entities[POSTS] ?? {}).sort()).toEqual([
      "create",
      "createInDefaultLanguage",
      "delete",
      "kind",
      "publish",
      "publishEveryLanguage",
      "read",
      "readHistory",
      "readTranslations",
      "unpublish",
      "update",
      "updateInDefaultLanguage",
    ]);
    // A Single is never created, so it has no create in any language.
    expect(Object.keys(entities[HOME] ?? {}).sort()).toEqual([
      "kind",
      "publish",
      "publishEveryLanguage",
      "read",
      "readHistory",
      "readTranslations",
      "unpublish",
      "update",
      "updateInDefaultLanguage",
    ]);
    // The editor reads and edits posts but holds no delete or publish.
    expect(entities[POSTS]).toMatchObject({
      kind: "collection",
      read: true,
      update: true,
      delete: false,
      publish: false,
    });
  });

  it("refuses a publish to a caller who may publish but not update", async () => {
    // A REST publish is a status change sent through the entry's update
    // route, which refuses this caller before the publish is checked.
    registered.rbac = new RBACAccessControlService();
    const { entities } = await routeGateCapabilities(
      { userId: "publisher-only" },
      ENTITIES,
      registered.rbac,
      LANGUAGE_OF
    );
    expect(entities[POSTS]).toMatchObject({ publish: false, update: false });
    // POPULATION CONTROL: the publish gate alone allows this caller.
    const alone = await routeGateVerdict(
      session("publisher-only").auth,
      "publish",
      POSTS,
      registered.rbac
    );
    expect(alone.allowed).toBe(true);
  });

  it("asks no publish check, and runs no publish rule, once the update it goes through is refused", async () => {
    const publishRule = vi.fn(() => true);
    const rbac = new RBACAccessControlService();
    rbac.registerCollectionAccess(POSTS, {
      publish: publishRule,
      unpublish: publishRule,
    });
    registered.rbac = rbac;

    const { entities } = await routeGateCapabilities(
      { userId: "viewer" },
      ENTITIES,
      rbac,
      LANGUAGE_OF
    );
    expect(entities[POSTS]).toMatchObject({
      update: false,
      publish: false,
      unpublish: false,
    });
    expect(publishRule).not.toHaveBeenCalled();

    // POPULATION CONTROL: for a caller who may update and publish, the rule
    // is asked.
    await routeGateCapabilities(
      { userId: "publisher" },
      ENTITIES,
      rbac,
      LANGUAGE_OF
    );
    expect(publishRule).toHaveBeenCalled();
  });

  it("records each cell's deviation under that cell's own subject", async () => {
    // Posts declare a refusing rule, which a gate without the access-control
    // service does not read: the editor reads posts today, where the
    // decision, reading the declared rule, refuses.
    serviceFor("service", RULES["returns-false"]);
    registered.rbac = undefined;
    const { bySubject } = await recordingDeviations(() =>
      routeGateCapabilities(
        { userId: "editor" },
        ENTITIES,
        registered.rbac,
        LANGUAGE_OF
      )
    );
    expect(bySubject.get(`read-${POSTS}`)).toContain("no-service");
    // POPULATION CONTROL: only the entities' own cells are subjects.
    expect(bySubject.has("read-media")).toBe(false);
  });

  it("fails, as the route gate does, when the caller's access cannot be read", async () => {
    // A rule that is a function needs the user's whole actor, whose grants
    // cannot be read here.
    registered.rbac = serviceFor("service", RULES["returns-true"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = await routeGateVerdict(
      session("grants-unreadable").auth,
      "read",
      POSTS,
      registered.rbac
    );
    // POPULATION CONTROL: the gate itself could not read this caller.
    expect(gate.allowed === false && gate.refusal).toBe("failed");
    await expect(
      routeGateCapabilities(
        { userId: "grants-unreadable" },
        ENTITIES,
        registered.rbac,
        LANGUAGE_OF
      )
    ).rejects.toThrow("grants unreadable");
  });

  it("refuses, without asking cell by cell, when the caller's permissions cannot be read at once", async () => {
    // No rule anywhere: every cell is a permission check alone, which is
    // what a failed read would otherwise be answered by, one query each.
    registered.rbac = serviceFor("service", RULES.none);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(hasPermission).mockClear();

    await expect(
      routeGateCapabilities(
        { userId: "grants-unreadable" },
        ENTITIES,
        registered.rbac,
        LANGUAGE_OF
      )
    ).rejects.toThrow("grants unreadable");
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("states super-admin authority from the read its cells were answered from", async () => {
    registered.rbac = serviceFor("service", RULES.none);
    const admin = await routeGateCapabilities(
      { userId: "admin" },
      ENTITIES,
      registered.rbac,
      LANGUAGE_OF
    );
    expect(admin.isSuperAdmin).toBe(true);
    expect(admin.entities[POSTS]).toMatchObject({ read: true, delete: true });

    // A key never carries the authority, whoever made it.
    const keyed = await routeGateCapabilities(
      REQUESTS["key-with"].caller,
      ENTITIES,
      registered.rbac,
      LANGUAGE_OF
    );
    expect(keyed.isSuperAdmin).toBe(false);

    // A super-admin whose roles cannot be read is refused, not answered as a
    // non-admin beside cells that say otherwise.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      routeGateCapabilities(
        { userId: "roles-unreadable" },
        ENTITIES,
        registered.rbac,
        LANGUAGE_OF
      )
    ).rejects.toThrow("roles unreadable");
  });
});
