/**
 * The callers and rules each gate's answer file is asked over, and the faked
 * role and permission lookups they read.
 *
 * One table of who holds what (`STORED`) answers every lookup a gate makes:
 * the super-admin lookup, the permission check, the rule's context and the
 * caller's roles. So a gate that reads its caller through any of them reads
 * the same truth, and a gate moved from one to another gives the same answer.
 *
 * A suite fakes the lookups with {@link fakePermissions}:
 *
 * ```ts
 * vi.mock("<path>/services/lib/permissions", async importOriginal =>
 *   (await import("<path>/auth/access/__tests__/gate-answer-fixtures"))
 *     .fakePermissions(await importOriginal())
 * );
 * ```
 */
import { vi } from "vitest";

import type { AccessOperation } from "../../../services/access";
import type { CollectionAccessControl } from "../../../shared/types/access";
import {
  apiKeyScope,
  apiKeyScopeFrom,
  type AuthenticatedScope,
  type GrantedPermission,
} from "../../authenticated-scope";

/** The targets these answer files ask about: a collection and a Single. */
const TARGETS = ["posts", "home"];

const EVERY_ACTION: readonly AccessOperation[] = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];

/** The permission to `action` on `slug`, as its row stores it. */
export const grant = (action: string, slug: string): GrantedPermission => ({
  slug: `${action}-${slug}`,
  action,
  resource: slug,
});

const everyGrant = (slug: string) =>
  EVERY_ACTION.map(action => grant(action, slug));

const onEveryTarget = (actions: readonly string[]) =>
  TARGETS.flatMap(slug => actions.map(action => grant(action, slug)));

/** Who holds what, as the database would answer it. */
const STORED: Record<string, { roles: string[]; grants: GrantedPermission[] }> =
  {
    editor: { roles: ["editor"], grants: onEveryTarget(EVERY_ACTION) },
    viewer: { roles: ["viewer"], grants: [] },
    publisher: {
      roles: ["publisher"],
      grants: onEveryTarget(["read", "publish", "unpublish"]),
    },
    admin: { roles: ["super-admin"], grants: [] },
    "admin-inherited": { roles: ["chief", "super-admin"], grants: [] },
    owner: { roles: ["editor"], grants: onEveryTarget(EVERY_ACTION) },
  };

const stored = (userId: string) => STORED[userId] ?? { roles: [], grants: [] };

/** The permissions module, with every lookup answered from `STORED`. */
export function fakePermissions<T extends object>(real: T): T {
  const superAdmin = (userId: string) =>
    stored(userId).roles.includes("super-admin");
  return {
    ...real,
    isSuperAdmin: vi.fn(async (userId: string) => superAdmin(userId)),
    hasPermission: vi.fn(
      async (userId: string, action: string, resource: string) =>
        superAdmin(userId) ||
        stored(userId).grants.some(
          g => g.action === action && g.resource === resource
        )
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
}

/** A caller as a gate is handed one, and the key scope its request carries. */
export interface GateCaller {
  user?: { id: string; roles?: string[] };
  scope?: AuthenticatedScope;
  /** The key scope of the request the call is made in, not handed over. */
  ambient?: AuthenticatedScope;
}

/** The callers, for a target `slug` asked about these `actions`. */
export function gateCallers(
  slug: string,
  actions: readonly AccessOperation[]
): Record<string, GateCaller> {
  const all = everyGrant(slug).filter(g =>
    actions.includes(g.action as AccessOperation)
  );
  const lifecycleAndRead = [
    grant("read", slug),
    grant("publish", slug),
    grant("unpublish", slug),
  ];
  return {
    visitor: {},
    "user-with": { user: { id: "editor" } },
    "user-without": { user: { id: "viewer" } },
    "user-partial": { user: { id: "publisher" } },
    "super-admin": { user: { id: "admin" } },
    "super-admin-inherited": { user: { id: "admin-inherited" } },
    "super-admin-claimed": { user: { id: "viewer", roles: ["super-admin"] } },
    "super-admin-claimed-key": {
      user: { id: "owner", roles: ["super-admin"] },
      scope: apiKeyScope([grant("read", slug)], ["editor"]),
    },
    "key-with": { user: { id: "owner" }, scope: apiKeyScope(all, ["editor"]) },
    "key-without": {
      user: { id: "owner" },
      scope: apiKeyScope([], ["editor"]),
    },
    "key-partial": {
      user: { id: "owner" },
      scope: apiKeyScope(lifecycleAndRead, ["editor"]),
    },
    "key-slugs-only": {
      user: { id: "owner" },
      scope: apiKeyScopeFrom({
        permissions: actions.map(action => `${action}-${slug}`),
        roles: ["editor"],
      }),
    },
    // A key made by a super-admin carries that role's name, and no authority.
    "key-made-by-super-admin": {
      user: { id: "admin" },
      scope: apiKeyScope([grant("read", slug)], ["super-admin"]),
    },
    // A key whose grants carry slugs of their own: updating as `edit-<slug>`
    // and publishing as `release-<slug>`, not `update-<slug>` and
    // `publish-<slug>`.
    "key-custom-slugs": {
      user: { id: "owner" },
      scope: apiKeyScope(
        [
          grant("read", slug),
          { slug: `edit-${slug}`, action: "update", resource: slug },
          { slug: `release-${slug}`, action: "publish", resource: slug },
        ],
        ["editor"]
      ),
    },
    "key-own-roles": {
      user: { id: "owner", roles: ["owner-role"] },
      scope: apiKeyScopeFrom({ grants: all }),
    },
    // A call that names no scope, made in a request that arrived on a key
    // holding read alone, for an owner who holds everything.
    "key-in-the-request": {
      user: { id: "owner" },
      ambient: apiKeyScope([grant("read", slug)], ["editor"]),
    },
  };
}

export type GateRule = CollectionAccessControl[keyof CollectionAccessControl];

/** The rules, each declared for every action of a target. */
export function gateRules(slug: string): Record<string, GateRule | undefined> {
  return {
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
      permissions.includes(`${slug}:${operation}`),
    "signed-in": ({ user }) => user !== null,
  };
}

export const GATE_SETUPS = [
  "service",
  "no-service",
  "route-authorized",
] as const;
export type GateSetup = (typeof GATE_SETUPS)[number];
