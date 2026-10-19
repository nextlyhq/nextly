/**
 * Each way in, asked one row of the access table.
 *
 * Every adapter takes a row and answers in the file's spelling (`table.ts`,
 * `Answer`): what the caller was told, not how the door decided it. An adapter
 * goes through the door the way a site's caller does — an HTTP request through
 * the real catch-all, a Direct API call, a plugin route — and never calls the
 * decision behind it, so a door that stops asking the decision shows up here.
 */
import { isDeepStrictEqual } from "node:util";

import { vi } from "vitest";

import { GET as listCollectionsSchema } from "../../../api/collections-schema";
import { createMediaHandlers } from "../../../api/media-handlers";
import { container } from "../../../di/container";
import { CollectionAccessService } from "../../../domains/collections/services/collection-access-service";
import { checkSingleAccess } from "../../../domains/singles/services/single-query-service";
import { getPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import { runPluginRoute } from "../../../plugins/routes/dispatch";
import { createDynamicHandlers } from "../../../routeHandler";
import { resolveContent } from "../../../runtime/routing/resolve-content";
import { consoleLogger } from "../../../services/shared";
import { canReadEntity, readAccessCaller } from "../../entity-read-access";
import { canReadSystemResource } from "../../resource-readable";

import type { Answer, Door, Row } from "./table";
import {
  MEDIA_MARKER,
  ORIGIN,
  PROBE_WHERE,
  USER_MARKER,
  collectionOf,
  ownKey,
  personRoute,
  pubSingleOf,
  relationOf,
  singleOf,
  type CallerHandle,
  type World,
} from "./world";

const silentLogger = { ...consoleLogger, error() {}, warn() {} };

function fromStatus(status: number): Answer {
  return status >= 200 && status < 300 ? "A" : String(status);
}

function fromBoolean(value: unknown): Answer {
  if (value === true) return "A";
  if (value === false) return "R";
  return `=${String(value)}`;
}

/** A thrown NextlyError's status, or `E` for a failure that carried none. */
function fromError(error: unknown): Answer {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? String(status) : "E";
}

async function settle(work: () => Promise<Answer>): Promise<Answer> {
  try {
    return await work();
  } catch (error) {
    return fromError(error);
  }
}

/** The target's slug, and the row id a collection action names. */
function addressOf(world: World, row: Row, door: string) {
  if (row.target === "single") return { slug: singleOf(row.rule), id: "" };
  if (row.target === "single-pub") {
    return { slug: pubSingleOf(row.rule), id: "" };
  }
  const slug = collectionOf(row.rule);
  const seeded = world.seeded.get(slug);
  if (!seeded) throw new Error(`nothing seeded for ${slug}`);
  const id =
    row.action === "read"
      ? seeded.readId
      : row.action === "update"
        ? seeded.updateId
        : (seeded.own.get(ownKey(door, row.caller, row.action)) ?? "");
  return { slug, id };
}

function request(
  method: Method,
  segments: string[],
  headers: Record<string, string>,
  body?: unknown,
  search = ""
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const init: RequestInit = {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, init);
  const context = { params: Promise.resolve({ params: segments }) };
  return handlers[method](req, context);
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** The REST request each collection action is, against `entries` and `id`. */
const COLLECTION_REQUESTS: Record<
  Exclude<Row["action"], "list" | "count">,
  { method: Method; byId: boolean; body?: Record<string, unknown> }
> = {
  read: { method: "GET", byId: true },
  create: { method: "POST", byId: false, body: { title: "made" } },
  update: { method: "PATCH", byId: true, body: { title: "changed" } },
  delete: { method: "DELETE", byId: true },
  publish: { method: "PATCH", byId: true, body: { status: "published" } },
  unpublish: { method: "PATCH", byId: true, body: { status: "draft" } },
};

/** The admin's media routes are their own handler, mounted gated. */
async function restMedia(headers: Record<string, string>) {
  const res = await createMediaHandlers({ requireAuth: true }).GET(
    new Request(`${ORIGIN}/api/media`, {
      headers: { origin: ORIGIN, ...headers },
    }),
    { params: Promise.resolve({ path: [] }) }
  );
  return fromStatus(res.status);
}

/** The REST request a Single's row is: a read, an edit, or a status change. */
function restSingle(row: Row, slug: string, headers: Record<string, string>) {
  if (row.action === "read") return request("GET", ["singles", slug], headers);
  const body =
    row.target === "single-pub"
      ? { status: row.action === "publish" ? "published" : "draft" }
      : { headline: "edit" };
  return request("PATCH", ["singles", slug], headers, body);
}

async function rest(world: World, row: Row, who: CallerHandle) {
  const h = who.headers;
  if (row.target === "media") return restMedia(h);
  if (row.target === "users") {
    return fromStatus((await request("GET", ["users"], h)).status);
  }
  const { slug, id } = addressOf(world, row, "rest");
  if (row.target === "single" || row.target === "single-pub") {
    return fromStatus((await restSingle(row, slug, h)).status);
  }
  if (row.action === "list" || row.action === "count") {
    return restRead(slug, row.action, h);
  }
  const { method, byId, body } = COLLECTION_REQUESTS[row.action];
  const entries = ["collections", slug, "entries"];
  const res = await request(method, byId ? [...entries, id] : entries, h, body);
  return fromStatus(res.status);
}

/**
 * A REST list or count of the entries `PROBE_WHERE` matches: allowed when the
 * probe row is among what was returned, refused when it was left out.
 */
async function restRead(
  slug: string,
  action: "list" | "count",
  headers: Record<string, string>
): Promise<Answer> {
  const path = ["collections", slug, "entries"];
  const res = await request(
    "GET",
    action === "count" ? [...path, "count"] : path,
    headers,
    undefined,
    "?where[slug][equals]=probe"
  );
  if (res.status !== 200) return fromStatus(res.status);
  const body = (await res.json()) as {
    items?: { slug?: unknown }[];
    total?: unknown;
  };
  if (action === "list") {
    return body.items?.some(item => item.slug === "probe") ? "A" : "R";
  }
  // `total` is the count route's answer; any other shape is recorded as is.
  const total = body.total;
  if (typeof total !== "number") return `=${JSON.stringify(body)}`;
  return total > 0 ? "A" : "R";
}

/** The caller as a Direct API call names it. */
function directCaller(who: CallerHandle) {
  if (who.principal) return { principal: who.principal };
  return {
    overrideAccess: false as const,
    ...(who.user ? { user: who.user } : {}),
    ...(who.actor ? { actor: who.actor } : {}),
  };
}

type Nextly = World["t"]["nextly"];
type DirectCaller = ReturnType<typeof directCaller>;

/** The Direct API call each collection action is, on `collection` and `id`. */
const DIRECT_CALLS: Record<
  Row["action"],
  (
    n: Nextly,
    collection: string,
    id: string,
    as: DirectCaller
  ) => Promise<unknown>
> = {
  read: (n, collection, id, as) => n.findByID({ collection, id, ...as }),
  create: (n, collection, _id, as) =>
    n.create({ collection, data: { title: "made" }, ...as }),
  update: (n, collection, id, as) =>
    n.update({ collection, id, data: { title: "changed" }, ...as }),
  delete: (n, collection, id, as) => n.delete({ collection, id, ...as }),
  publish: (n, collection, id, as) =>
    n.update({ collection, id, data: { status: "published" }, ...as }),
  unpublish: (n, collection, id, as) =>
    n.update({ collection, id, data: { status: "draft" }, ...as }),
  // A list and a count answer whether the probe row was among what they read.
  list: async (n, collection, _id, as) =>
    (await n.find({ collection, where: PROBE_WHERE, ...as })).items.some(
      item => (item as { slug?: unknown }).slug === "probe"
    ),
  count: async (n, collection, _id, as) =>
    (await n.count({ collection, where: PROBE_WHERE, ...as })).total > 0,
};

async function direct(world: World, row: Row, who: CallerHandle) {
  const nextly = world.t.nextly;
  const as = directCaller(who);
  const { slug, id } = addressOf(world, row, "direct");
  if (row.target === "single") {
    if (row.action === "read") await nextly.findSingle({ slug, ...as });
    else await nextly.updateSingle({ slug, data: { headline: "edit" }, ...as });
    return "A";
  }
  if (row.target === "single-pub") {
    const status = row.action === "publish" ? "published" : "draft";
    await nextly.updateSingle({ slug, data: { status }, ...as });
    return "A";
  }
  const found = await DIRECT_CALLS[row.action](nextly, slug, id, as);
  return found === false ? "R" : "A";
}

/**
 * The gate a Direct API read reaches, built with no access-control service.
 *
 * The instance's handlers took the service when they were constructed at boot,
 * so hiding it from the container afterwards would change nothing they
 * decide. The gate is built the way a boot without the service builds it.
 */
async function directWithoutService(world: World, row: Row, who: CallerHandle) {
  const { slug } = addressOf(world, row, "direct");
  const user = who.user;
  if (row.target === "single") {
    const refused = await checkSingleAccess({
      slug,
      operation: "read",
      user,
      overrideAccess: false,
      authenticatedScope: who.actor,
      logger: silentLogger,
    });
    return refused ? fromStatus(refused.statusCode ?? 500) : "A";
  }
  const refused = await new CollectionAccessService(
    world.t.adapter,
    silentLogger
  ).checkCollectionAccess({
    collectionName: slug,
    operation: "read",
    user,
    overrideAccess: false,
    authenticatedScope: who.actor,
  });
  return refused ? fromStatus(refused.statusCode ?? 500) : "A";
}

async function website(world: World, row: Row, who: CallerHandle) {
  const entry = await resolveContent(collectionOf(row.rule), "probe", {
    nextly: world.t.nextly,
    ...(who.user ? { user: who.user } : {}),
  });
  return entry ? "A" : "R";
}

function pluginRequest(
  segments: string[],
  headers: Record<string, string>,
  search = ""
) {
  return request("GET", ["plugins", ...segments], headers, undefined, search);
}

async function route(world: World, row: Row, who: CallerHandle) {
  const { slug } = addressOf(world, row, "route");
  const res = await pluginRequest(
    ["probe", "gate", slug, row.action],
    who.headers
  );
  return fromStatus(res.status);
}

function targetSlug(row: Row): string {
  if (row.target === "collection") return collectionOf(row.rule);
  if (row.target === "single") return singleOf(row.rule);
  if (row.target === "single-pub") return pubSingleOf(row.rule);
  return row.target;
}

async function can(_world: World, row: Row, who: CallerHandle) {
  const res = await pluginRequest(
    ["probe", "can", targetSlug(row), row.action],
    who.headers
  );
  if (res.status !== 200) return String(res.status);
  const { may } = (await res.json()) as { may: unknown };
  return fromBoolean(may);
}

async function service(world: World, row: Row, who: CallerHandle) {
  const { slug, id } = addressOf(world, row, "service");
  const search = `?id=${encodeURIComponent(id)}`;
  const person = personRoute(row.caller);
  const res = person
    ? await runPersonRoute(
        `${person}/${slug}/${row.action}`,
        search,
        who.headers
      )
    : await pluginRequest(
        [
          "probe",
          row.caller === "visitor" ? "public-service" : "service",
          slug,
          row.action,
        ],
        who.headers,
        search
      );
  if (res.status !== 200) return String(res.status);
  const body = (await res.json()) as {
    ok: boolean;
    status: number | null;
    found?: boolean;
  };
  if (body.ok) return body.found === false ? "R" : "A";
  return body.status === null ? "E" : String(body.status);
}

/** A person's route, run as the dispatcher runs one for its person. */
async function runPersonRoute(
  path: string,
  search: string,
  headers: Record<string, string>
) {
  const match = getPluginRouteRegistry().match("GET", path, "plugin");
  if (!match) throw new Error(`no route for ${path}`);
  return runPluginRoute(
    new Request(`${ORIGIN}/api${path}${search}`, { headers }),
    match
  );
}

async function entity(_world: World, row: Row, who: CallerHandle) {
  if (!who.user) throw new Error(`${row.caller} has no user to ask about`);
  const caller = readAccessCaller({
    user: who.user,
    ...(who.actor ? { authenticatedScope: who.actor } : {}),
  });
  return fromBoolean(await canReadEntity(targetSlug(row), caller));
}

const schemaLists = new WeakMap<
  World,
  Map<string, Promise<Answer | string[]>>
>();

/** The collections the schema builder lists for a caller, asked once. */
async function schema(world: World, row: Row, who: CallerHandle) {
  let cache = schemaLists.get(world);
  if (!cache) {
    cache = new Map();
    schemaLists.set(world, cache);
  }
  let listed = cache.get(row.caller);
  if (!listed) {
    listed = (async () => {
      const res = await listCollectionsSchema(
        new Request(`${ORIGIN}/api/collections/schema?limit=500`, {
          headers: who.headers,
        })
      );
      if (res.status !== 200) return String(res.status);
      const body = (await res.json()) as { items: { slug: string }[] };
      return body.items.map(item => item.slug);
    })();
    cache.set(row.caller, listed);
  }
  const answer = await listed;
  if (typeof answer === "string") return answer;
  return answer.includes(collectionOf(row.rule)) ? "A" : "R";
}

/** Reads `refs` with its relationships populated, once per caller. */
async function population(world: World, row: Row, who: CallerHandle) {
  const ref = (await world.t.nextly.findByID({
    collection: "refs",
    id: world.refId,
    depth: 1,
    ...directCaller(who),
  })) as Record<string, unknown> | null;
  if (!ref) return "R";
  const field =
    row.target === "media"
      ? "picture"
      : row.target === "users"
        ? "owner"
        : relationOf(row.rule);
  const marker =
    row.target === "media"
      ? MEDIA_MARKER
      : row.target === "users"
        ? USER_MARKER
        : "probe";
  const value = ref[field];
  const populated =
    typeof value === "object" &&
    value !== null &&
    JSON.stringify(value).includes(marker);
  return populated ? "A" : "R";
}

async function system(_world: World, row: Row, who: CallerHandle) {
  return fromBoolean(
    await canReadSystemResource(row.target, who.user?.id, who.actor)
  );
}

const ADAPTERS: Record<
  Door,
  (world: World, row: Row, who: CallerHandle) => Promise<Answer>
> = {
  rest,
  direct,
  website,
  route,
  can,
  service,
  entity,
  schema,
  population,
  system,
};

/**
 * Hides the access-control service from every lookup that asks the container
 * for it per call, for the length of `work`.
 */
async function withoutService<T>(work: () => Promise<T>): Promise<T> {
  const realHas = container.has.bind(container);
  const has = vi
    .spyOn(container, "has")
    .mockImplementation(
      name => name !== "rbacAccessControlService" && realHas(name)
    );
  try {
    return await work();
  } finally {
    has.mockRestore();
  }
}

/** One door's answer to one row. */
function answer(world: World, row: Row, door: Door): Promise<Answer> {
  const who = world.callers.get(row.caller);
  if (!who) throw new Error(`no caller ${row.caller}`);
  if (row.setup === "no-service") {
    const adapter = door === "direct" ? directWithoutService : ADAPTERS[door];
    return withoutService(() => settle(() => adapter(world, row, who)));
  }
  return settle(() => ADAPTERS[door](world, row, who));
}

/**
 * The doors where asking for a write IS the write. The others only ask a gate
 * (`route`, `can`) or read, so nothing they answer can have been written.
 */
const WRITING_DOORS: ReadonlySet<Door> = new Set<Door>([
  "rest",
  "direct",
  "service",
]);

const READS: ReadonlySet<Row["action"]> = new Set(["read", "list", "count"]);

function writes(row: Row, door: Door): boolean {
  return (
    row.setup === "service" &&
    !READS.has(row.action) &&
    (row.target === "collection" ||
      row.target === "single" ||
      row.target === "single-pub") &&
    WRITING_DOORS.has(door)
  );
}

/** The table a write to the row's target lands in. */
function tableOf(row: Row): string {
  if (row.target === "single") return `single_${singleOf(row.rule)}`;
  if (row.target === "single-pub") return `single_${pubSingleOf(row.rule)}`;
  return `dc_${collectionOf(row.rule)}`;
}

/**
 * Every row of the target's table, read raw and whole, so a write that touched
 * any column of any row, added one or removed one, reads differently.
 */
async function storedTable(world: World, row: Row) {
  const stored = await world.t.adapter.select<Record<string, unknown>>(
    tableOf(row),
    {}
  );
  return stored.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

let marks = 0;

/**
 * Gives the row an update rewrites a value no write sends.
 *
 * Every update sends the same value, so once one lands, a later one that
 * lands too would change nothing an equality can see. Marking the row first
 * means any update that lands, allowed or refused, changes it.
 */
async function markUpdated(world: World, row: Row): Promise<void> {
  if (row.target === "single-pub") return setPubStatus(world, row);
  if (row.action !== "update") return;
  const table = tableOf(row);
  const single = row.target === "single";
  const id = single
    ? (await storedTable(world, row))[0]?.id
    : world.seeded.get(collectionOf(row.rule))?.updateId;
  // A Single's row is made on its first read, which every Single's update
  // follows in the table's order; an update finding none is seen anyway.
  if (id === undefined || id === null) return;
  await world.t.adapter.update(
    table,
    { [single ? "headline" : "title"]: `marked ${++marks}` },
    { and: [{ column: "id", op: "=", value: String(id) }] }
  );
}

/**
 * Puts a Single with a status where its publish or unpublish starts: a draft
 * to publish, published to unpublish. Rows run in order, so each ask finds the
 * Single as the one before it left it otherwise.
 */
async function setPubStatus(world: World, row: Row): Promise<void> {
  await world.t.nextly.updateSingle({
    slug: pubSingleOf(row.rule),
    data: { status: row.action === "publish" ? "draft" : "published" },
  });
}

/** The status a Single's publish or unpublish leaves it in. */
const statusAfter = (row: Row) =>
  row.action === "publish" ? "published" : "draft";

/**
 * A door's answer to one row, and, for a write, what it did to the database:
 * `landed` says it changed the target's table at all, and `done` that it made
 * the change asked for. Both are set only where the door writes.
 */
export async function ask(
  world: World,
  row: Row,
  door: Door
): Promise<{ answer: Answer; landed?: boolean; done?: boolean }> {
  if (!writes(row, door)) return { answer: await answer(world, row, door) };
  await markUpdated(world, row);
  const before = await storedTable(world, row);
  const given = await answer(world, row, door);
  const after = await storedTable(world, row);
  const landed = !isDeepStrictEqual(before, after);
  // A Single's publish or unpublish is done only when its status moved: a
  // save that bumps the row's timestamps but drops the status changes the
  // table without doing what was asked.
  const done =
    row.target === "single-pub"
      ? after[0]?.status === statusAfter(row)
      : landed;
  return { answer: given, landed, done };
}
