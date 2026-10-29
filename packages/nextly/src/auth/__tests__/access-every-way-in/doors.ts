/**
 * Each way in, asked one row of the access table.
 *
 * Every adapter takes a row and answers in the file's spelling (`table.ts`,
 * `Answer`): what the caller was told, not how the door decided it. An adapter
 * goes through the door the way a site's caller does — an HTTP request through
 * the real catch-all, a Direct API call, a plugin route — and never calls the
 * decision behind it, so a door that stops asking the decision shows up here.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";

import { vi } from "vitest";

import { GET as listCollectionsSchema } from "../../../api/collections-schema";
import { createMediaHandlers } from "../../../api/media-handlers";
import { container } from "../../../di/container";
import { CollectionAccessService } from "../../../domains/collections/services/collection-access-service";
import { checkSingleAccess } from "../../../domains/singles/services/single-query-service";
import { getPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import { runPluginRoute } from "../../../plugins/routes/dispatch";
import type {
  DocumentLockService,
  DocumentRef,
} from "../../../domains/document-lock";
import { widgetAudience } from "../../../domains/widgets/visibility";
import { createDynamicHandlers } from "../../../routeHandler";
import { resolveContent } from "../../../runtime/routing/resolve-content";
import { consoleLogger } from "../../../services/shared";
import {
  DEVIATIONS,
  recordingDeviations,
  type Deviation,
} from "../../access/deviations";
import { runWithAccessMemo } from "../../access/request-memo";
import { canReadEntity, readAccessCaller } from "../../entity-read-access";
import { canReadSystemResource } from "../../resource-readable";

import {
  beginCell,
  noteError,
  noteMissing,
  noteMissingError,
  noteMissingRefusal,
  noteRefusal,
  noteResponse,
  noteUncaught,
  refusalOf,
  takeRefusal,
  type Refusal,
} from "./refusals";
import {
  hasOutsideTwin,
  rowKey,
  verdictOf,
  type Answer,
  type Door,
  type Row,
} from "./table";
import {
  MEDIA_MARKER,
  ORIGIN,
  PROBES_WHERE,
  USER_MARKER,
  collectionOf,
  handleForCell,
  outsideKey,
  ownKey,
  personRoute,
  probesRead,
  pubSingleOf,
  relationOf,
  singleOf,
  widgetFor,
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

async function settle(
  work: () => Promise<Answer | Attributed>
): Promise<Answer | Attributed> {
  try {
    return await work();
  } catch (error) {
    noteUncaught(error);
    return fromError(error);
  }
}

/**
 * Set while a door is asked a filtered write of the entry's twin outside the
 * rule's filter, so the door names that twin rather than the entry inside it.
 */
const askingOutside = new AsyncLocalStorage<true>();

/** The target's slug, and the row id a collection action names. */
function addressOf(world: World, row: Row, door: string) {
  if (row.target === "single") return { slug: singleOf(row.rule), id: "" };
  if (row.target === "single-pub") {
    return { slug: pubSingleOf(row.rule), id: "" };
  }
  const slug = collectionOf(row.rule);
  const seeded = world.seeded.get(slug);
  if (!seeded) throw new Error(`nothing seeded for ${slug}`);
  // A filtered write's twin outside the filter first: an update's twin is a
  // row of its own, not the one row every update rewrites.
  const id = askingOutside.getStore()
    ? (seeded.own.get(outsideKey(door, row.caller, row.action)) ?? "")
    : row.action === "read"
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
  "new-pub": {
    method: "POST",
    byId: false,
    body: { title: "made", status: "published" },
  },
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
  await noteResponse(res);
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

/** The REST path of each resource that is not an entry. */
const RESOURCE_PATHS: Partial<Record<Row["target"], string>> = {
  users: "users",
  roles: "roles",
  providers: "email-providers",
};

/**
 * The request each action is on a resource's own routes. A write names an id
 * that does not exist (in the UUID shape the role routes validate first), or
 * sends a body the route refuses, so a caller the gate lets through is
 * answered by the route behind it (a 404 or a 400) and nothing is changed:
 * the table asks the gate, never the resource.
 */
const RESOURCE_REQUESTS: Partial<
  Record<Row["action"], { method: Method; byId: boolean; body?: object }>
> = {
  read: { method: "GET", byId: false },
  // An address no account can have, so a user is never made.
  create: { method: "POST", byId: false, body: { email: "not-an-address" } },
  update: { method: "PATCH", byId: true, body: {} },
  delete: { method: "DELETE", byId: true },
};

const ABSENT_ID = "00000000-0000-4000-8000-00000000abcd";

/**
 * A resource route's answer: its gate's 401 or 403 as is, and `A` for a
 * request the gate let through, whatever the route then said about the
 * absent id or the empty body. A failure (5xx) or a limit (429) is kept.
 */
async function restResource(row: Row, headers: Record<string, string>) {
  const path = RESOURCE_PATHS[row.target];
  const asked = RESOURCE_REQUESTS[row.action];
  if (!path || !asked)
    throw new Error(`no resource request for ${rowKey(row)}`);
  const segments = asked.byId ? [path, ABSENT_ID] : [path];
  const res = await request(asked.method, segments, headers, asked.body);
  const { status } = res;
  await noteResponse(res);
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return String(status);
  }
  return "A";
}

/**
 * The REST answer for a target that is not a rule collection or Single, or
 * nothing for one that is: media and users' read keep the handlers they have
 * always been asked through, and every other resource its own routes.
 */
function restSystem(
  row: Row,
  headers: Record<string, string>
): Promise<Answer> | undefined {
  if (row.target === "media") return restMedia(headers);
  if (row.target === "users" && row.action === "read") {
    return request("GET", ["users"], headers).then(async res => {
      await noteResponse(res);
      return fromStatus(res.status);
    });
  }
  if (RESOURCE_PATHS[row.target]) return restResource(row, headers);
  return undefined;
}

async function rest(world: World, row: Row, who: CallerHandle) {
  const h = who.headers;
  const system = restSystem(row, h);
  if (system) return system;
  const { slug, id } = addressOf(world, row, "rest");
  if (row.target === "single" || row.target === "single-pub") {
    const res = await restSingle(row, slug, h);
    await noteResponse(res);
    return fromStatus(res.status);
  }
  if (row.action === "list" || row.action === "count") {
    return restRead(slug, row.action, h);
  }
  const { method, byId, body } = COLLECTION_REQUESTS[row.action];
  const entries = ["collections", slug, "entries"];
  const res = await request(method, byId ? [...entries, id] : entries, h, body);
  await noteResponse(res);
  // A refused request naming one entry is compared with the same request for
  // an entry that does not exist, so a refusal that tells the two apart shows.
  if (byId && res.status >= 400) {
    await noteMissing(
      res,
      await request(method, [...entries, ABSENT_ID], h, body)
    );
  }
  return fromStatus(res.status);
}

/**
 * A REST list or count of the entries `PROBES_WHERE` matches, answered by
 * which of the two probe rows came back (`probesRead`).
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
    "?where[slug][in]=probe,probe-other"
  );
  if (res.status !== 200) {
    await noteResponse(res);
    return fromStatus(res.status);
  }
  const body = (await res.json()) as {
    items?: { slug?: unknown }[];
    total?: unknown;
  };
  if (action === "list") {
    return probesRead(body.items?.map(item => item.slug) ?? []);
  }
  // `total` is the count route's answer; any other shape is recorded as is.
  const total = body.total;
  if (typeof total !== "number") return `=${JSON.stringify(body)}`;
  return probesRead(total);
}

/** The caller as a checked Direct API call names a person, a key or nobody. */
function checkedCallerOf(who: CallerHandle) {
  return {
    overrideAccess: false as const,
    ...(who.user ? { user: who.user } : {}),
    ...(who.actor ? { actor: who.actor } : {}),
  };
}

/** The caller as a Direct API call names it. */
function directCaller(who: CallerHandle) {
  if (who.principal) return { principal: who.principal };
  return checkedCallerOf(who);
}

type Nextly = World["t"]["nextly"];
type DirectCaller = ReturnType<typeof directCaller>;
type CheckedCaller = ReturnType<typeof checkedCallerOf>;

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
  "new-pub": (n, collection, _id, as) =>
    n.create({
      collection,
      data: { title: "made", status: "published" },
      ...as,
    }),
  update: (n, collection, id, as) =>
    n.update({ collection, id, data: { title: "changed" }, ...as }),
  delete: (n, collection, id, as) => n.delete({ collection, id, ...as }),
  publish: (n, collection, id, as) =>
    n.update({ collection, id, data: { status: "published" }, ...as }),
  unpublish: (n, collection, id, as) =>
    n.update({ collection, id, data: { status: "draft" }, ...as }),
  // A list and a count answer which probe rows were among what they read.
  list: async (n, collection, _id, as) =>
    probesRead(
      (await n.find({ collection, where: PROBES_WHERE, ...as })).items.map(
        item => (item as { slug?: unknown }).slug
      )
    ),
  count: async (n, collection, _id, as) =>
    probesRead(
      (await n.count({ collection, where: PROBES_WHERE, ...as })).total
    ),
};

/**
 * The Direct API read of a target that is not an entry: a list of media, of
 * users or of roles, as the REST door asks each.
 */
const DIRECT_SYSTEM_READS: Partial<
  Record<Row["target"], (n: Nextly, as: CheckedCaller) => Promise<unknown>>
> = {
  media: (n, as) => n.media.find(as),
  users: (n, as) => n.users.find(as),
  roles: (n, as) => n.roles.find(as),
};

async function direct(world: World, row: Row, who: CallerHandle) {
  const nextly = world.t.nextly;
  const as = directCaller(who);
  const systemRead = DIRECT_SYSTEM_READS[row.target];
  if (systemRead) {
    // Never a principal: the table asks these reads of the callers REST names.
    await systemRead(nextly, checkedCallerOf(who));
    return "A";
  }
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
  const call = DIRECT_CALLS[row.action];
  let found: unknown;
  try {
    found = await call(nextly, slug, id, as);
  } catch (error) {
    noteError(error);
    // As at REST: a refused call naming one entry is compared with the same
    // call for an entry that does not exist.
    if (BY_ID.has(row.action)) await noteDirectMissing(call, nextly, slug, as);
    throw error;
  }
  // A list or a count answers in its own words; any other call that
  // returned allowed.
  return typeof found === "string" ? found : "A";
}

/** The same call made for an entry that does not exist, noted against it. */
async function noteDirectMissing(
  call: (typeof DIRECT_CALLS)[Row["action"]],
  nextly: Nextly,
  slug: string,
  as: DirectCaller
): Promise<void> {
  try {
    await call(nextly, slug, ABSENT_ID, as);
    noteMissingError(undefined);
  } catch (missing) {
    noteMissingError(missing);
  }
}

/** The actions that name one entry. */
const BY_ID: ReadonlySet<Row["action"]> = new Set([
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
]);

/**
 * A refusal the gate itself returned, which no caller reads: its status alone
 * is recorded, with no code or message to stand for one a caller would see.
 */
function gateRefusal(status: number): Answer {
  noteRefusal({ status, code: "-", shape: "other", message: "" });
  return fromStatus(status);
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
    return refused ? gateRefusal(refused.statusCode ?? 500) : "A";
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
  return refused ? gateRefusal(refused.statusCode ?? 500) : "A";
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
  const slug = RESOURCE_PATHS[row.target]
    ? targetSlug(row)
    : addressOf(world, row, "route").slug;
  const res = await pluginRequest(
    ["probe", "gate", slug, row.action],
    who.headers
  );
  await noteResponse(res);
  return fromStatus(res.status);
}

export function targetSlug(row: Row): string {
  if (row.target === "collection") return collectionOf(row.rule);
  if (row.target === "single") return singleOf(row.rule);
  if (row.target === "single-pub") return pubSingleOf(row.rule);
  return RESOURCE_PATHS[row.target] ?? row.target;
}

async function can(_world: World, row: Row, who: CallerHandle) {
  const res = await pluginRequest(
    ["probe", "can", targetSlug(row), row.action],
    who.headers
  );
  if (res.status !== 200) {
    await noteResponse(res);
    return String(res.status);
  }
  const { may } = (await res.json()) as { may: unknown };
  return fromBoolean(may);
}

/** The service probe's route, asked to make the row's call on entry `id`. */
function serviceProbe(
  row: Row,
  who: CallerHandle,
  slug: string,
  id: string
): Promise<Response> {
  const search = `?id=${encodeURIComponent(id)}`;
  const person = personRoute(row.caller);
  return person
    ? runPersonRoute(`${person}/${slug}/${row.action}`, search, who.headers)
    : pluginRequest(
        [
          "probe",
          row.caller === "visitor" ? "public-service" : "service",
          slug,
          row.action,
        ],
        who.headers,
        search
      );
}

async function service(world: World, row: Row, who: CallerHandle) {
  const { slug, id } = addressOf(world, row, "service");
  const res = await serviceProbe(row, who, slug, id);
  if (res.status !== 200) {
    await noteResponse(res);
    return String(res.status);
  }
  const reply = (await res.json()) as ProbeReply;
  const answer = fromProbeReply(reply);
  // As at REST and the Direct API: a refused call naming one entry is
  // compared with the same call for an entry that does not exist.
  if (!reply.ok && BY_ID.has(row.action)) {
    await noteServiceMissing(row, who, slug);
  }
  return answer;
}

/** Notes how the service answers the same call for an entry that does not exist. */
async function noteServiceMissing(
  row: Row,
  who: CallerHandle,
  slug: string
): Promise<void> {
  const res = await serviceProbe(row, who, slug, ABSENT_ID);
  if (res.status !== 200) {
    noteMissingRefusal(await refusalOf(res));
    return;
  }
  const reply = (await res.json()) as ProbeReply;
  noteMissingRefusal(reply.ok ? undefined : reply.refusal);
}

/**
 * What the service probe hands back: its call's result, or the refusal it
 * threw, read by `refusalFromError` as every door reads one.
 */
type ProbeReply = { ok: true; read?: string } | { ok: false; refusal: Refusal };

/** The probe's reply as an answer, noting the refusal it reports. */
function fromProbeReply(body: ProbeReply): Answer {
  // A list or a count says which probe rows it read; any other call that
  // returned allowed.
  if (body.ok) return body.read ?? "A";
  noteRefusal(body.refusal);
  // A thrown value that carried no status is a failure, not a refusal.
  return body.refusal.status === 0 ? "E" : String(body.refusal.status);
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
  // Asked inside a request, as every reader behind it is (a route, the
  // Direct API, a plugin service): a read rule's filter is kept for the
  // request there, and outside one the reader refuses it.
  return fromBoolean(
    await runWithAccessMemo(() => canReadEntity(targetSlug(row), caller))
  );
}

/**
 * What a door's one call for a caller answered, with the deviations recorded
 * in deciding each subject of it (a collection, a permission).
 */
interface Observed<T> {
  readonly answer: T;
  readonly bySubject: ReadonlyMap<string, Deviation[]>;
}

/** A row's answer and the deviations its door recorded in deciding it. */
interface Attributed {
  readonly answer: Answer;
  readonly deviations: readonly Deviation[];
}

/** Runs one call for many subjects, keeping what deviated for each. */
async function observing<T>(work: () => Promise<T>): Promise<Observed<T>> {
  const { result, bySubject } = await recordingDeviations(work);
  return { answer: result, bySubject };
}

/**
 * What the schema list answered one caller: the slugs it listed, or the
 * status it refused them with and the refusal as that response carried it.
 */
type SchemaList = string[] | { refused: Answer; refusal: Refusal | undefined };

const schemaLists = new WeakMap<
  World,
  Map<string, Promise<Observed<SchemaList>>>
>();

/**
 * Whether the schema builder lists the row's collection to the caller. The
 * list is asked once per caller, as the builder asks it, and the row's
 * deviations are the ones that request recorded in deciding its collection.
 */
async function schema(
  world: World,
  row: Row,
  who: CallerHandle
): Promise<Attributed | Answer> {
  let cache = schemaLists.get(world);
  if (!cache) {
    cache = new Map();
    schemaLists.set(world, cache);
  }
  let listed = cache.get(row.caller);
  if (!listed) {
    listed = observing(async (): Promise<SchemaList> => {
      const res = await listCollectionsSchema(
        new Request(`${ORIGIN}/api/collections/schema?limit=500`, {
          headers: who.headers,
        })
      );
      if (res.status !== 200) {
        return { refused: String(res.status), refusal: await refusalOf(res) };
      }
      const body = (await res.json()) as { items: { slug: string }[] };
      return body.items.map(item => item.slug);
    });
    cache.set(row.caller, listed);
  }
  const { answer, bySubject } = await listed;
  if (!Array.isArray(answer)) {
    // The list is asked once per caller, so every row it answers carries the
    // one refusal that request was answered with.
    if (answer.refusal) noteRefusal(answer.refusal);
    return answer.refused;
  }
  const slug = collectionOf(row.rule);
  return {
    answer: answer.includes(slug) ? "A" : "R",
    deviations: bySubject.get(slug) ?? [],
  };
}

/**
 * A trusted read whose bound reaches only `refs`, the collection it reads,
 * so every target it populates is read as the caller would read it.
 */
function boundCaller(who: CallerHandle) {
  return {
    overrideAccess: true as const,
    trusted: (collection: string) => collection === "refs",
    ...(who.user ? { user: who.user } : {}),
    ...(who.actor ? { actor: who.actor } : {}),
  };
}

/** The field of `refs` that points at a row's target, and what a populated one carries. */
function populatedField(row: Row): { field: string; marker: string } {
  if (row.target === "media") return { field: "picture", marker: MEDIA_MARKER };
  if (row.target === "users") return { field: "owner", marker: USER_MARKER };
  return { field: relationOf(row.rule), marker: "probe" };
}

/**
 * What a populated field says: `R` when its target was withheld, `S` when a
 * media row came without who filed it, a refusal presented as the file
 * alone, and `A` when the whole row came.
 */
function populationAnswer(value: unknown, row: Row, marker: string): Answer {
  if (typeof value !== "object" || value === null) return "R";
  if (!JSON.stringify(value).includes(marker)) return "R";
  if (row.target !== "media") return "A";
  return "uploadedBy" in value || "uploaded_by" in value ? "A" : "S";
}

/** Reads `refs` with its relationships populated, once per caller. */
async function population(world: World, row: Row, who: CallerHandle) {
  const ref = (await world.t.nextly.findByID({
    collection: "refs",
    id: world.refId,
    depth: 1,
    ...(row.setup === "bound" ? boundCaller(who) : directCaller(who)),
  })) as Record<string, unknown> | null;
  if (!ref) return "R";
  const { field, marker } = populatedField(row);
  return populationAnswer(ref[field], row, marker);
}

async function system(_world: World, row: Row, who: CallerHandle) {
  return fromBoolean(
    await canReadSystemResource(row.target, who.user?.id, who.actor)
  );
}

const audiences = new WeakMap<
  World,
  Map<string, Promise<Observed<ReadonlySet<string>>>>
>();

/**
 * Whether the dashboard offers the caller the widget that requires the row's
 * permission. What a caller is offered is worked out once per caller and
 * setup, as the layout endpoint works it out once per request.
 */
async function widget(
  world: World,
  row: Row,
  who: CallerHandle
): Promise<Attributed> {
  if (!who.user) throw new Error(`${row.caller} has no user to ask about`);
  let cache = audiences.get(world);
  if (!cache) {
    cache = new Map();
    audiences.set(world, cache);
  }
  const key = `${row.setup} ${row.caller}`;
  const caller = readAccessCaller({
    user: who.user,
    ...(who.actor ? { authenticatedScope: who.actor } : {}),
  });
  let offered = cache.get(key);
  if (!offered) {
    // Every widget is decided at once, as the dashboard decides them, and
    // each permission's deviations are kept apart.
    offered = observing(() =>
      widgetAudience(caller).then(
        ({ visible }) => new Set(visible.map(card => card.id))
      )
    );
    cache.set(key, offered);
  }
  const slug = targetSlug(row);
  const { answer, bySubject } = await offered;
  return {
    answer: answer.has(widgetFor(slug, row.action)) ? "A" : "R",
    deviations: bySubject.get(`${row.action}-${slug}`) ?? [],
  };
}

const capabilityAnswers = new WeakMap<
  World,
  Map<string, Promise<Observed<Answer | CapabilitiesBody>>>
>();

/** What `GET /me/capabilities` answers, as the admin reads it. */
interface CapabilitiesBody {
  entities: Record<string, Record<string, unknown>>;
}

/**
 * What the admin is told this caller may do with the row's target, from one
 * `GET /me/capabilities`. The endpoint answers about every entity at once, as the admin asks it once per sign-in, so it is asked
 * once per caller and setup and each row reads its own cell; the row's
 * deviations are the ones that request recorded in deciding that cell.
 *
 * A target the answer never names is `=absent` rather than `R`. The answer
 * leaves out what the caller may not read, so absence is how it refuses
 * every action on such a target, and the verdict counts it as a refusal; the
 * file keeps it apart from a named `false`, so a change in which entities are
 * named shows in the diff as itself.
 */
async function capabilities(
  world: World,
  row: Row,
  who: CallerHandle
): Promise<Attributed | Answer> {
  let cache = capabilityAnswers.get(world);
  if (!cache) {
    cache = new Map();
    capabilityAnswers.set(world, cache);
  }
  const key = `${row.setup} ${row.caller}`;
  let asked = cache.get(key);
  if (!asked) {
    asked = observing(async (): Promise<Answer | CapabilitiesBody> => {
      const res = await request("GET", ["me", "capabilities"], who.headers);
      if (res.status !== 200) return String(res.status);
      return (await res.json()) as CapabilitiesBody;
    });
    cache.set(key, asked);
  }
  const { answer, bySubject } = await asked;
  if (typeof answer === "string") return answer;
  const slug = targetSlug(row);
  const cell = answer.entities[slug];
  const deviations = bySubject.get(`${row.action}-${slug}`) ?? [];
  if (cell === undefined || !(row.action in cell)) {
    // An entity is left out where the caller may not read it, so its read's
    // deviations are the ones that decided every action's absence.
    const read = bySubject.get(`read-${slug}`) ?? [];
    return {
      answer: "=absent",
      deviations: DEVIATIONS.filter(
        deviation => deviations.includes(deviation) || read.includes(deviation)
      ),
    };
  }
  return { answer: fromBoolean(cell[row.action]), deviations };
}

/** The id of a Single's one document, made by the reads that came before. */
async function singleDocumentId(world: World, slug: string): Promise<string> {
  const [row] = await world.t.adapter.select<{ id: unknown }>(
    `single_${slug}`,
    {}
  );
  if (!row) throw new Error(`single_${slug} holds no row`);
  return String(row.id);
}

/**
 * Claims the entry's or Single's document lock through REST, as an editor
 * opening it does. Only an `acquired` claim is an `A`: a claim answered
 * `held` was never this caller's, so it is recorded as such rather than as an
 * answer about this caller.
 *
 * Every acquired claim is given straight back through the lock service with
 * its token, never through the route: a caller a rule lets claim may hold no
 * grant to release with, and a claim it left behind would answer every caller
 * after it `held`.
 */
/**
 * Notes how a refused claim compares with the same claim on `absent`. A claim
 * that one is granted is given straight back, as every acquired claim is.
 */
async function noteLockMissing(
  refused: Response,
  absent: DocumentRef,
  who: CallerHandle
): Promise<void> {
  const res = await request("POST", ["document-lock"], who.headers, absent);
  await noteMissing(refused, res);
  if (res.status !== 200) return;
  const body = (await res.json()) as { item?: { claimToken?: unknown } };
  const claimToken = body.item?.claimToken;
  if (typeof claimToken === "string") {
    await container
      .get<DocumentLockService>("documentLockService")
      .release(absent, claimToken);
  }
}

async function lock(world: World, row: Row, who: CallerHandle) {
  const ref: DocumentRef =
    row.target === "single"
      ? {
          scopeKind: "single",
          slug: singleOf(row.rule),
          entryId: await singleDocumentId(world, singleOf(row.rule)),
        }
      : {
          scopeKind: "collection",
          slug: collectionOf(row.rule),
          entryId: addressOf(world, row, "lock").id,
        };
  const res = await request("POST", ["document-lock"], who.headers, ref);
  if (res.status !== 200) {
    await noteResponse(res);
    // A claim names one document, so a refused one is compared with the same
    // claim on a document that does not exist.
    await noteLockMissing(res, { ...ref, entryId: ABSENT_ID }, who);
    return fromStatus(res.status);
  }
  const body = (await res.json()) as {
    item?: { status?: unknown; claimToken?: unknown };
  };
  const { status, claimToken } = body.item ?? {};
  if (typeof claimToken === "string") {
    await container
      .get<DocumentLockService>("documentLockService")
      .release(ref, claimToken);
  }
  return status === "acquired" ? "A" : `=${String(status)}`;
}

const ADAPTERS: Record<
  Door,
  (world: World, row: Row, who: CallerHandle) => Promise<Answer | Attributed>
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
  widget,
  lock,
  capabilities,
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

/**
 * One door's answer to one row, and each deviation from the one decision that
 * changed an answer on the way (`auth/access/deviations`).
 */
async function answer(
  world: World,
  row: Row,
  door: Door
): Promise<{
  answer: Answer;
  deviations: Deviation[];
  refusal?: Refusal;
}> {
  const seeded = world.callers.get(row.caller);
  if (!seeded) throw new Error(`no caller ${row.caller}`);
  const who = await handleForCell(seeded);
  const adapter =
    row.setup === "no-service" && door === "direct"
      ? directWithoutService
      : ADAPTERS[door];
  const asked = () => settle(() => adapter(world, row, who));
  beginCell();
  const { result, deviations } = await recordingDeviations(() =>
    row.setup === "no-service" ? withoutService(asked) : asked()
  );
  const refusal = takeRefusal();
  // A door that decides many subjects in one call hands back the deviations
  // that call recorded for this row's subject.
  return typeof result === "string"
    ? { answer: result, deviations, refusal }
    : { answer: result.answer, deviations: [...result.deviations], refusal };
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
 *
 * Written to its row directly and read back, never through a way in the
 * table asks: a door that dropped the status would otherwise prepare its own
 * starting point, and an ask that changed nothing would look done.
 */
async function setPubStatus(world: World, row: Row): Promise<void> {
  const before = row.action === "publish" ? "draft" : "published";
  const [single] = await storedTable(world, row);
  if (!single) throw new Error(`${tableOf(row)} holds no row`);
  await world.t.adapter.update(
    tableOf(row),
    { status: before },
    { and: [{ column: "id", op: "=", value: String(single.id) }] }
  );
  const [set] = await storedTable(world, row);
  if (set?.status !== before) {
    throw new Error(`${tableOf(row)} did not take status ${before}`);
  }
}

/** Whether `after` holds a row `before` did not, stored as published. */
function addedPublished(
  before: readonly Record<string, unknown>[],
  after: readonly Record<string, unknown>[]
): boolean {
  const existing = new Set(before.map(stored => String(stored.id)));
  return after.some(
    stored => !existing.has(String(stored.id)) && stored.status === "published"
  );
}

/** The status a Single's publish or unpublish leaves it in. */
const statusAfter = (row: Row) =>
  row.action === "publish" ? "published" : "draft";

/**
 * A door's answer to one row, and, for a write, what it did to the database:
 * `landed` says it changed the target's table at all, and `done` that it made
 * the change asked for. Both are set only where the door writes. A filtered
 * write is asked of the entry inside the rule's filter and then of its twin
 * outside it; `outsideKept` says the twin's ask left the table as it found
 * it.
 */
export async function ask(
  world: World,
  row: Row,
  door: Door
): Promise<{
  answer: Answer;
  deviations: Deviation[];
  refusal?: Refusal;
  landed?: boolean;
  done?: boolean;
  outsideKept?: boolean;
  outside?: { answer: Answer; refusal?: Refusal };
}> {
  if (!writes(row, door)) return answer(world, row, door);
  await markUpdated(world, row);
  const before = await storedTable(world, row);
  const inside = await answer(world, row, door);
  const after = await storedTable(world, row);
  const landed = !isDeepStrictEqual(before, after);
  // A Single's publish or unpublish is done only when its status moved, and
  // a create sent as published only when the row it added is published: a
  // write that drops the status changes the table without doing what was
  // asked.
  const done =
    row.target === "single-pub"
      ? after[0]?.status === statusAfter(row)
      : row.action === "new-pub"
        ? addedPublished(before, after)
        : landed;
  if (!hasOutsideTwin(row)) return { ...inside, landed, done };
  // The twin, compared with the table as the first ask left it: an ask
  // answered as refused that wrote all the same is caught here.
  const outside = await askingOutside.run(true, () => answer(world, row, door));
  const outsideKept = isDeepStrictEqual(after, await storedTable(world, row));
  return {
    ...filteredAnswer(inside, outside),
    landed,
    done,
    outsideKept,
    // The twin's own answer, kept apart from the cell's: an `M` says it was
    // refused, and this says how, so a 403 where the twin is unreadable shows.
    outside: { answer: outside.answer, refusal: outside.refusal },
  };
}

/**
 * One answer to a filtered write from its two asks: `M` where the entry inside
 * the filter was let through and its twin refused, `A` where both were, which
 * is a filter not applied, and the inside entry's own answer where it was
 * refused. The deviations either ask recorded are the cell's.
 */
function filteredAnswer(
  inside: { answer: Answer; deviations: Deviation[]; refusal?: Refusal },
  outside: { answer: Answer; deviations: Deviation[]; refusal?: Refusal }
): { answer: Answer; deviations: Deviation[]; refusal?: Refusal } {
  const deviations = DEVIATIONS.filter(
    deviation =>
      inside.deviations.includes(deviation) ||
      outside.deviations.includes(deviation)
  );
  if (inside.answer !== "A") return { ...inside, deviations };
  return {
    answer: verdictOf(outside.answer) === "refuse" ? "M" : "A",
    deviations,
  };
}
