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
import type { Principal } from "../../../auth/principal";
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

const MEMBER_KIND = "members:member";
const MEMBER_ID = "m1";

type RuleContext = { roles?: readonly string[] };
type RuleFn = (ctx: RuleContext) => unknown;

/** The rule a `rule` kind declares, for one action. */
function ruleBody(rule: Rule): boolean | RuleFn | undefined {
  switch (rule) {
    case "none":
    case "other-operation":
      return undefined;
    case "true":
      return true;
    case "false":
      return false;
    case "returns-true":
      return () => true;
    case "returns-false":
      return () => false;
    case "returns-null":
      return () => null;
    case "returns-undefined":
      return () => undefined;
    case "throws":
      return () => {
        throw new Error("the rule failed");
      };
    case "async-true":
      return async () => true;
    case "async-false":
      return async () => false;
    case "role-name":
      return ({ roles }) => (roles ?? []).includes("editor");
  }
}

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
  /** A draft row of its own for each door, caller and destructive action. */
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
function serviceCall(
  ctx: PluginRouteContext,
  params: Record<string, string>,
  query: URLSearchParams,
  opts: Record<string, unknown>
): Promise<unknown> {
  const collections = ctx.services.collections;
  const slug = params.slug;
  const id = query.get("id") ?? "";
  switch (params.action as Action) {
    case "read":
      return collections.findEntryById(slug, id, opts);
    case "create":
      return collections.createEntry(slug, { title: "made" }, opts);
    case "update":
      return collections.updateEntry(slug, id, { title: "changed" }, opts);
    case "delete":
      return collections.deleteEntry(slug, id, opts);
    case "publish":
      return collections.updateEntry(slug, id, { status: "published" }, opts);
  }
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

/** The plugin that defines a signed-in person, resolved from a header. */
function membersPlugin() {
  const lookup = async (id: string) =>
    id === MEMBER_ID ? { id, attributes: {} } : null;
  return definePlugin({
    name: "members",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      principals: [
        {
          name: "member",
          attributes: {},
          resolve: async (request: Request) => {
            const id = request.headers.get("x-member");
            return id ? lookup(id) : null;
          },
          lookup,
        },
      ],
      routes: [
        {
          method: "GET" as const,
          path: "/service/:slug/:action",
          principal: { kind: MEMBER_KIND },
          handler: (req: Request, ctx: PluginRouteContext) =>
            outcome(() =>
              serviceCall(ctx, ctx.params, new URL(req.url).searchParams, {
                principal: ctx.principal ?? undefined,
              })
            ),
        },
      ],
    },
  } as never);
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
        (["delete", "publish"] as const).map(action =>
          ownKey(door, caller, action)
        )
      )
    );
    const ids = await inBatches(keys, batch, key =>
      create(slug, "draft", key.replace(/ /g, "-"))
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

async function seedCallers(t: TestNextly): Promise<Map<Caller, CallerHandle>> {
  const services = new ServiceContainer(t.adapter);
  // The permissions and role presets an install seeds at startup, which the
  // harness does not: without them there is no `read-media` to grant.
  await seedAllPermissions();
  // The first user made is the super-admin.
  const rootId = await makeUser(t, "root");
  const superAdminRole = (await services.roles.ensureSuperAdminRole()).id;

  const staffPermissions = await permissionIds(t, heldByStaff);
  const editorRole = await makeRole(t, "editor", staffPermissions);
  const reviewerRole = await makeRole(t, "reviewer", staffPermissions);
  // `chief` inherits super-admin. A role must hold a permission of its own,
  // and `read-refs` is one every caller here can already exercise.
  const chiefRole = await makeRole(
    t,
    "chief",
    await permissionIds(t, slug => slug === "read-refs"),
    [superAdminRole]
  );

  const users: Record<string, { id: string; roleIds: string[] }> = {
    root: { id: rootId, roleIds: [superAdminRole] },
  };
  for (const [name, roleId] of [
    ["with", editorRole],
    ["without", undefined],
    ["custom", reviewerRole],
    ["chief", chiefRole],
  ] as const) {
    const id = await makeUser(t, name);
    if (roleId) await services.userRoles.assignRoleToUser(id, roleId);
    users[name] = { id, roleIds: roleId ? [roleId] : [] };
  }

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
    ["principal", { "x-member": MEMBER_ID }],
  ]);
  const sessions: [Caller, string][] = [
    ["user-with", "with"],
    ["user-without", "without"],
    ["custom-role", "custom"],
    ["super-admin", "root"],
    ["super-admin-inherited", "chief"],
  ];
  for (const [caller, name] of sessions) {
    const { id, roleIds } = users[name];
    headers.set(caller, { cookie: await sessionCookie(id, name, roleIds) });
  }
  headers.set("key-read-only", await mint(users.with.id, "read-only"));
  headers.set("key-full-access", await mint(users.with.id, "full-access"));
  headers.set(
    "key-role-based",
    await mint(users.with.id, "role-based", reviewerRole)
  );
  headers.set("key-super-admin", await mint(rootId, "full-access"));

  const handles = new Map<Caller, CallerHandle>();
  for (const caller of CALLERS) {
    const h = headers.get(caller) ?? {};
    if (caller === "visitor") {
      handles.set(caller, { headers: h });
    } else if (caller === "principal") {
      const principal = await t.nextly.principals.byId(MEMBER_KIND, MEMBER_ID);
      if (!principal) throw new Error("the member did not resolve");
      handles.set(caller, { headers: h, principal });
    } else {
      const auth = await authenticated(h);
      handles.set(caller, {
        headers: h,
        user: { id: auth.userId },
        ...(auth.authMethod === "api-key"
          ? { actor: apiKeyScopeFrom(auth) }
          : {}),
      });
    }
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
  const callers = await seedCallers(t);
  const seeded = await seedCollections(t, dialect === "sqlite" ? 1 : 16);
  const refId = await seedRefs(t, seeded);
  return { t, callers, seeded, refId };
}
