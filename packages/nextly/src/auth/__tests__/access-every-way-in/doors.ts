/**
 * Each way in, asked one row of the access table.
 *
 * Every adapter takes a row and answers in the file's spelling (`table.ts`,
 * `Answer`): what the caller was told, not how the door decided it. An adapter
 * goes through the door the way a site's caller does — an HTTP request through
 * the real catch-all, a Direct API call, a plugin route — and never calls the
 * decision behind it, so a door that stops asking the decision shows up here.
 */
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
  USER_MARKER,
  collectionOf,
  ownKey,
  personRoute,
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
  Row["action"],
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

async function rest(world: World, row: Row, who: CallerHandle) {
  const h = who.headers;
  if (row.target === "media") return restMedia(h);
  if (row.target === "users") {
    return fromStatus((await request("GET", ["users"], h)).status);
  }
  const { slug, id } = addressOf(world, row, "rest");
  if (row.target === "single") {
    const res =
      row.action === "read"
        ? await request("GET", ["singles", slug], h)
        : await request("PATCH", ["singles", slug], h, { headline: "edit" });
    return fromStatus(res.status);
  }
  const { method, byId, body } = COLLECTION_REQUESTS[row.action];
  const entries = ["collections", slug, "entries"];
  const res = await request(method, byId ? [...entries, id] : entries, h, body);
  return fromStatus(res.status);
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
  await DIRECT_CALLS[row.action](nextly, slug, id, as);
  return "A";
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
  const body = (await res.json()) as { ok: boolean; status: number | null };
  if (body.ok) return "A";
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
export function ask(world: World, row: Row, door: Door): Promise<Answer> {
  const who = world.callers.get(row.caller);
  if (!who) throw new Error(`no caller ${row.caller}`);
  if (row.setup === "no-service") {
    const adapter = door === "direct" ? directWithoutService : ADAPTERS[door];
    return withoutService(() => settle(() => adapter(world, row, who)));
  }
  return settle(() => ADAPTERS[door](world, row, who));
}
