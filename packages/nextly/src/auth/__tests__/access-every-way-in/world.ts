/**
 * One booted instance holding every target, caller and rule the access table
 * names, shared by all of the table's rows on one dialect.
 *
 * Every caller is real: users and roles in the database, a signed session
 * cookie, API keys minted by the key service, and a plugin-defined person
 * resolved by its plugin. Each way in authenticates them as it would a real
 * request, so a row reaches the decision through the same steps a site's
 * caller does.
 */
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  defineCollection,
  defineSingle,
  relationship,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import type { Principal } from "../../../plugins/principals/types";
import type { PluginRouteContext } from "../../../plugins/routes/route-types";
import { seedAllPermissions } from "../../../init/seed-permissions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { AuthenticatedScope } from "../../authenticated-scope";
import { apiKeyScopeFrom } from "../../authenticated-scope";
import { requireAuthentication } from "../../middleware/index";

import {
  ACTIONS,
  CALLERS,
  RULES,
  type Action,
  type Caller,
  type Rule,
} from "./table";

export const ORIGIN = "http://localhost";

/** The slug of the collection, and of the Single, declaring `rule`. */
export const collectionOf = (rule: Rule) => `c_${rule.replace(/-/g, "_")}`;
export const singleOf = (rule: Rule) => `s_${rule.replace(/-/g, "_")}`;
/** The relationship on `refs` that points at `rule`'s collection. */
export const relationOf = (rule: Rule) => `to_${rule.replace(/-/g, "_")}`;

/**
 * The two kinds of plugin-defined person: the `principal` caller is a member,
 * `principal-other` a guest. Each is resolved from a header of its own.
 */
const PEOPLE = {
  principal: {
    name: "member",
    kind: "members:member",
    header: "x-member",
    id: "m1",
  },
  "principal-other": {
    name: "guest",
    kind: "members:guest",
    header: "x-guest",
    id: "g1",
  },
} as const;
const MEMBER_KIND = PEOPLE.principal.kind;

type RuleContext = {
  roles?: readonly string[];
  permissions?: readonly string[];
  principal?: { kind?: string } | null;
  collection?: string;
  operation?: string;
};
type RuleFn = (ctx: RuleContext) => unknown;

/** The rule each `rule` kind declares, for one action. */
const RULE_BODIES: Record<Rule, boolean | RuleFn | undefined> = {
  none: undefined,
  "other-operation": undefined,
  true: true,
  false: false,
  "returns-true": () => true,
  "returns-false": () => false,
  "returns-null": () => null,
  "returns-undefined": () => undefined,
  throws: () => {
    throw new Error("the rule failed");
  },
  "async-true": async () => true,
  "async-false": async () => false,
  "async-throws": async () => {
    throw new Error("the rule failed");
  },
  "role-name": ({ roles }) => (roles ?? []).includes("editor"),
  "permission-spelling": ({ permissions, collection, operation }) =>
    (permissions ?? []).includes(`${collection}:${operation}`),
  "principal-kind": ({ principal }) => principal?.kind === MEMBER_KIND,
};

const ruleBody = (rule: Rule) => RULE_BODIES[rule];

/**
 * The access object a `rule` kind declares on a target that is asked
 * `operations`.
 *
 * The config validator refuses a boolean for create, read, update and delete,
 * though the rule types and the documentation allow one, so the collection is
 * defined with the rule as a function and the boolean put back afterwards: the
 * table asks what each way in answers once a boolean reaches it.
 */
function accessFor(
  rule: Rule,
  operations: readonly string[]
): Record<string, unknown> | undefined {
  if (rule === "none") return undefined;
  if (rule === "other-operation") return { update: () => false };
  const body = ruleBody(rule);
  return Object.fromEntries(
    operations.map(operation => [
      operation,
      typeof body === "boolean" ? () => body : body,
    ])
  );
}

function restoreBooleans(
  config: { access?: unknown },
  rule: Rule,
  operations: readonly string[]
): void {
  const body = ruleBody(rule);
  if (typeof body !== "boolean") return;
  config.access = Object.fromEntries(operations.map(op => [op, body]));
}

const COLLECTION_OPERATIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;
const SINGLE_OPERATIONS = ["read", "update"] as const;

function ruleCollections() {
  return RULES.map(rule => {
    const config = defineCollection({
      slug: collectionOf(rule),
      status: true,
      access: accessFor(rule, COLLECTION_OPERATIONS) as never,
      fields: [text({ name: "title" }), text({ name: "slug" })],
    });
    restoreBooleans(config, rule, COLLECTION_OPERATIONS);
    return config;
  });
}

function ruleSingles() {
  return RULES.map(rule => {
    const config = defineSingle({
      slug: singleOf(rule),
      access: accessFor(rule, SINGLE_OPERATIONS) as never,
      fields: [text({ name: "headline" })],
    });
    restoreBooleans(config, rule, SINGLE_OPERATIONS);
    return config;
  });
}

/** Points at one row of every rule collection, one media row and one user. */
function refsCollection() {
  return defineCollection({
    slug: "refs",
    access: { read: () => true },
    fields: [
      text({ name: "name" }),
      ...RULES.map(rule =>
        relationship({ name: relationOf(rule), relationTo: collectionOf(rule) })
      ),
      upload({ name: "picture", relationTo: "media" }),
      relationship({ name: "owner", relationTo: "users" }),
    ],
  });
}

/** What a probe route returns, so the outcome survives the HTTP round trip. */
async function outcome(work: () => Promise<unknown>): Promise<Response> {
  try {
    await work();
    return Response.json({ ok: true });
  } catch (error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    return Response.json({
      ok: false,
      status: typeof status === "number" ? status : null,
    });
  }
}

/** The ids each way in writes to, by collection. */
export interface Seeded {
  /** A published row every read asks for, with slug `probe`. */
  readId: string;
  /** A draft row every update rewrites. */
  updateId: string;
  /**
   * A row of its own for each door, caller and action that consumes one: a
   * delete, a publish (from a draft) and an unpublish (from a published row).
   */
  own: Map<string, string>;
}

export const ownKey = (door: string, caller: Caller, action: Action) =>
  `${door} ${caller} ${action}`;

/**
 * A plugin call as `opts`, for the action a probe route names.
 *
 * Shared by the staff, public and member routes, so the three differ only in
 * who the call is made as.
 */
type Collections = PluginRouteContext["services"]["collections"];
type Opts = Record<string, unknown>;

/** The plugin service call each action is, on `slug` and row `id`. */
const SERVICE_CALLS: Record<
  Action,
  (c: Collections, slug: string, id: string, opts: Opts) => Promise<unknown>
> = {
  read: (c, slug, id, opts) => c.findEntryById(slug, id, opts),
  create: (c, slug, _id, opts) => c.createEntry(slug, { title: "made" }, opts),
  update: (c, slug, id, opts) =>
    c.updateEntry(slug, id, { title: "changed" }, opts),
  delete: (c, slug, id, opts) => c.deleteEntry(slug, id, opts),
  publish: (c, slug, id, opts) =>
    c.updateEntry(slug, id, { status: "published" }, opts),
  unpublish: (c, slug, id, opts) =>
    c.updateEntry(slug, id, { status: "draft" }, opts),
};

/**
 * A plugin call as `opts`, for the action a probe route names.
 *
 * Shared by the staff, public and person routes, so they differ only in who
 * the call is made as.
 */
function serviceCall(
  ctx: PluginRouteContext,
  params: Record<string, string>,
  query: URLSearchParams,
  opts: Opts
): Promise<unknown> {
  const call = SERVICE_CALLS[params.action as Action];
  return call(
    ctx.services.collections,
    params.slug,
    query.get("id") ?? "",
    opts
  );
}

function probePlugin() {
  const gates = [
    ...RULES.flatMap(rule =>
      ACTIONS.map(action => ({ slug: collectionOf(rule), action }))
    ),
    ...RULES.flatMap(rule =>
      (["read", "update"] as const).map(action => ({
        slug: singleOf(rule),
        action,
      }))
    ),
  ];
  return definePlugin({
    name: "probe",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      routes: [
        ...gates.map(({ slug, action }) => ({
          method: "GET" as const,
          path: `/gate/${slug}/${action}`,
          requiredPermission: `${action}-${slug}`,
          handler: () => Response.json({ ok: true }),
        })),
        {
          method: "GET" as const,
          path: "/can/:slug/:action",
          handler: async (_req: Request, ctx: PluginRouteContext) => {
            const may: unknown = await ctx.caller?.can(
              ctx.params.action,
              ctx.params.slug
            );
            return Response.json({
              may: may === undefined ? "undefined" : may,
            });
          },
        },
        {
          method: "GET" as const,
          path: "/service/:slug/:action",
          handler: (req: Request, ctx: PluginRouteContext) =>
            outcome(() =>
              serviceCall(ctx, ctx.params, new URL(req.url).searchParams, {
                as: "user",
                user: ctx.user ?? undefined,
              })
            ),
        },
        {
          method: "GET" as const,
          path: "/public-service/:slug/:action",
          public: true,
          handler: (req: Request, ctx: PluginRouteContext) =>
            outcome(() =>
              serviceCall(ctx, ctx.params, new URL(req.url).searchParams, {
                as: "public",
              })
            ),
        },
      ],
    },
  });
}

/**
 * The plugin that defines both kinds of person, and one route for each kind
 * that makes a service call as the person it serves.
 */
function membersPlugin() {
  const people = Object.values(PEOPLE);
  return definePlugin({
    name: "members",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      principals: people.map(person => {
        const lookup = async (id: string) =>
          id === person.id ? { id, attributes: {} } : null;
        return {
          name: person.name,
          attributes: {},
          resolve: async (request: Request) => {
            const id = request.headers.get(person.header);
            return id ? lookup(id) : null;
          },
          lookup,
        };
      }),
      routes: people.map(person => ({
        method: "GET" as const,
        path: `/${person.name}-service/:slug/:action`,
        principal: { kind: person.kind },
        handler: (req: Request, ctx: PluginRouteContext) =>
          outcome(() =>
            serviceCall(ctx, ctx.params, new URL(req.url).searchParams, {
              principal: ctx.principal ?? undefined,
            })
          ),
      })),
    },
  } as never);
}

/** The path of the route that serves a person caller's kind. */
export function personRoute(caller: Caller): string | undefined {
  const person = PEOPLE[caller as keyof typeof PEOPLE];
  return person ? `/plugins/members/${person.name}-service` : undefined;
}

/** How each way in is handed one caller. */
export interface CallerHandle {
  /** REST and plugin route headers: a session cookie, a key, or nothing. */
  headers: Record<string, string>;
  /** The user a Direct API or service call names. */
  user?: { id: string };
  /** An API key's own scope, as REST authentication resolves it. */
  actor?: AuthenticatedScope;
  /** A plugin-defined person. */
  principal?: Principal;
}

export interface World {
  t: TestNextly;
  callers: Map<Caller, CallerHandle>;
  seeded: Map<string, Seeded>;
  refId: string;
}

type Db = {
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
};

/** The ids of every permission `keep` accepts, read page by page. */
async function permissionIds(t: TestNextly, keep: (slug: string) => boolean) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(...found.items.filter(p => keep(p.slug)).map(p => String(p.id)));
    if (!found.meta.hasNext) return ids;
  }
}

/** Every permission `user-with` and `custom-role` hold: all but users'. */
function heldByStaff(slug: string): boolean {
  return (
    /^(create|read|update|delete|publish|unpublish)-(c|s)_/.test(slug) ||
    slug === "read-refs" ||
    slug === "read-media"
  );
}

/** What `user-partial` holds: read, update and publish, and nothing else. */
function heldByPartial(slug: string): boolean {
  return (
    /^(read|update|publish)-(c|s)_/.test(slug) ||
    slug === "read-refs" ||
    slug === "read-media"
  );
}

async function makeRole(
  t: TestNextly,
  slug: string,
  ids: string[],
  childRoleIds: string[] = []
) {
  const existing = (await t.nextly.roles.find({ limit: 100 })).items.find(
    role => role.slug === slug
  );
  if (existing) {
    await t.nextly.roles.setPermissions({
      roleId: String(existing.id),
      permissionIds: ids,
    });
    return String(existing.id);
  }
  const made = await t.nextly.roles.create({
    data: { name: slug, slug, permissionIds: ids, childRoleIds },
  });
  return String(made.item.id);
}

async function makeUser(t: TestNextly, name: string) {
  const made = await t.nextly.users.create({
    email: `${name}@access.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  return String((made.item as { id: string | number }).id);
}

async function sessionCookie(userId: string, name: string, roleIds: string[]) {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${name}@access.test`,
      name,
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** Authenticates `headers` exactly as a REST request would. */
async function authenticated(headers: Record<string, string>) {
  const auth = await requireAuthentication(
    new Request(`${ORIGIN}/api/me`, { headers })
  );
  if (auth instanceof Response || !("userId" in auth)) {
    throw new Error(`the caller did not authenticate: ${JSON.stringify(auth)}`);
  }
  return auth;
}

/**
 * `work` over `items`, `size` at a time, in order.
 *
 * In-memory SQLite has one connection, so its writes go one at a time; a
 * server takes several at once, which keeps the seeding of a few hundred rows
 * from dominating the run.
 */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}

async function seedCollections(
  t: TestNextly,
  batch: number
): Promise<Map<string, Seeded>> {
  const seeded = new Map<string, Seeded>();
  const create = async (collection: string, status: string, n: string) => {
    const made = await t.nextly.create({
      collection,
      data: { title: n, slug: n, status },
    });
    return String((made.item as { id: string | number }).id);
  };
  for (const rule of RULES) {
    const slug = collectionOf(rule);
    const keys = ["rest", "direct", "service"].flatMap(door =>
      CALLERS.flatMap(caller =>
        (["delete", "publish", "unpublish"] as const).map(action =>
          ownKey(door, caller, action)
        )
      )
    );
    // An unpublish takes a published row back to a draft; the rest start as one.
    const ids = await inBatches(keys, batch, key =>
      create(
        slug,
        key.endsWith(" unpublish") ? "published" : "draft",
        key.replace(/ /g, "-")
      )
    );
    const own = new Map(keys.map((key, i) => [key, ids[i]]));
    seeded.set(slug, {
      readId: await create(slug, "published", "probe"),
      updateId: await create(slug, "draft", "edited"),
      own,
    });
  }
  for (const rule of RULES) {
    await t.nextly.updateSingle({
      slug: singleOf(rule),
      data: { headline: "probe" },
    });
  }
  return seeded;
}

interface SeededUser {
  id: string;
  roleIds: string[];
}

/**
 * The roles and users the callers are made from: the super-admin first (the
 * first user made is one), a role named `editor` and one named `reviewer`
 * holding the same permissions, and `chief`, which inherits super-admin.
 */
async function seedUsers(t: TestNextly) {
  const services = new ServiceContainer(t.adapter);
  // The permissions and role presets an install seeds at startup, which the
  // harness does not: without them there is no `read-media` to grant.
  await seedAllPermissions();
  const rootId = await makeUser(t, "root");
  const superAdminRole = (await services.roles.ensureSuperAdminRole()).id;

  const staffPermissions = await permissionIds(t, heldByStaff);
  const editorRole = await makeRole(t, "editor", staffPermissions);
  const reviewerRole = await makeRole(t, "reviewer", staffPermissions);
  const partialRole = await makeRole(
    t,
    "partial",
    await permissionIds(t, heldByPartial)
  );
  // A role must hold a permission of its own, and `read-refs` is one every
  // caller here can already exercise.
  const chiefRole = await makeRole(
    t,
    "chief",
    await permissionIds(t, slug => slug === "read-refs"),
    [superAdminRole]
  );

  const users: Record<string, SeededUser> = {
    root: { id: rootId, roleIds: [superAdminRole] },
  };
  for (const [name, roleId] of [
    ["with", editorRole],
    ["without", undefined],
    ["custom", reviewerRole],
    ["chief", chiefRole],
    ["partial", partialRole],
  ] as const) {
    const id = await makeUser(t, name);
    if (roleId) await services.userRoles.assignRoleToUser(id, roleId);
    users[name] = { id, roleIds: roleId ? [roleId] : [] };
  }
  return { users, reviewerRole, partialRole };
}

const SESSIONS: [Caller, string][] = [
  ["user-with", "with"],
  ["user-without", "without"],
  ["custom-role", "custom"],
  ["super-admin", "root"],
  ["super-admin-inherited", "chief"],
  ["user-partial", "partial"],
];

/** The headers each caller sends: a session cookie, a key, or neither. */
async function callerHeaders(t: TestNextly) {
  const { users, reviewerRole, partialRole } = await seedUsers(t);
  const keys = t.getService("apiKeyService");
  const mint = async (
    owner: string,
    tokenType: "read-only" | "full-access" | "role-based",
    roleId?: string
  ) => {
    const made = await keys.createApiKey(owner, {
      name: `${tokenType} key`,
      tokenType,
      ...(roleId ? { roleId } : {}),
      expiresIn: "unlimited",
    });
    return { authorization: `Bearer ${made.key}` };
  };

  const headers = new Map<Caller, Record<string, string>>([
    ["visitor", {}],
    ...Object.entries(PEOPLE).map(
      ([caller, person]) =>
        [caller as Caller, { [person.header]: person.id }] as const
    ),
  ]);
  for (const [caller, name] of SESSIONS) {
    const { id, roleIds } = users[name];
    headers.set(caller, { cookie: await sessionCookie(id, name, roleIds) });
  }
  headers.set("key-read-only", await mint(users.with.id, "read-only"));
  headers.set("key-full-access", await mint(users.with.id, "full-access"));
  headers.set(
    "key-role-based",
    await mint(users.with.id, "role-based", reviewerRole)
  );
  headers.set("key-super-admin", await mint(users.root.id, "full-access"));
  headers.set(
    "key-partial",
    await mint(users.with.id, "role-based", partialRole)
  );
  return headers;
}

/** One caller as each way in is handed it. */
async function handleFor(
  t: TestNextly,
  caller: Caller,
  headers: Record<string, string>
): Promise<CallerHandle> {
  if (caller === "visitor") return { headers };
  const person = PEOPLE[caller as keyof typeof PEOPLE];
  if (person) {
    const principal = await t.nextly.principals.byId(person.kind, person.id);
    if (!principal) throw new Error(`the ${person.name} did not resolve`);
    return { headers, principal };
  }
  const auth = await authenticated(headers);
  return {
    headers,
    user: { id: auth.userId },
    ...(auth.authMethod === "api-key" ? { actor: apiKeyScopeFrom(auth) } : {}),
  };
}

async function seedCallers(t: TestNextly): Promise<Map<Caller, CallerHandle>> {
  const headers = await callerHeaders(t);
  const handles = new Map<Caller, CallerHandle>();
  for (const caller of CALLERS) {
    handles.set(caller, await handleFor(t, caller, headers.get(caller) ?? {}));
  }
  return handles;
}

/** What a populated media row and user carry, and a withheld one does not. */
export const MEDIA_MARKER = "probe-image.png";
export const USER_MARKER = "root@access.test";

async function seedRefs(t: TestNextly, seeded: Map<string, Seeded>) {
  const db = t.adapter.getDrizzle() as unknown as Db;
  await db.insert(getDialectTables().media).values({
    id: "media-probe",
    filename: MEDIA_MARKER,
    originalFilename: MEDIA_MARKER,
    mimeType: "image/png",
    size: 1,
    url: `/uploads/${MEDIA_MARKER}`,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  });
  const owner = (
    await t.adapter.select<{ id: string; email: string }>("users", {})
  ).find(user => user.email === USER_MARKER)?.id;
  const made = await t.nextly.create({
    collection: "refs",
    data: {
      name: "refs",
      ...Object.fromEntries(
        RULES.map(rule => [
          relationOf(rule),
          seeded.get(collectionOf(rule))?.readId,
        ])
      ),
      picture: "media-probe",
      owner,
    },
  });
  return String((made.item as { id: string | number }).id);
}

export async function boot(dialect: TestDialect): Promise<World> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [...ruleCollections(), refsCollection()],
    singles: ruleSingles(),
    plugins: [probePlugin(), membersPlugin()],
  });
  // The suite only learns of the instance once this returns, so a seeding
  // failure takes it down here; otherwise its connections and its PostgreSQL
  // or MySQL database would outlive the failed run.
  try {
    const callers = await seedCallers(t);
    const seeded = await seedCollections(t, dialect === "sqlite" ? 1 : 16);
    const refId = await seedRefs(t, seeded);
    return { t, callers, seeded, refId };
  } catch (error) {
    await t.destroy();
    throw error;
  }
}
