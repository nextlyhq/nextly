/**
 * Every write to an entry of a collection or Single removed from code is
 * refused, through every entry point that offers one, with nothing about the
 * entry changed; its reads keep answering; and the same writes to a declared
 * collection and Single still succeed.
 *
 * "Removed from code" is a registry row whose source is the app's code for a
 * slug the configuration no longer declares. Each case boots the app with the
 * entities declared, writes their entries and history, then boots again on
 * the same database with the two removed from the configuration, as a deploy
 * of the edited configuration does.
 *
 * The writes are the operations each entry point offers today, one row each
 * in {@link OPERATIONS}, named by entry point and operation, so a write
 * operation added later joins by adding its row. The entry points:
 *
 * - the admin's and the REST API's mutation endpoints, through the dispatcher
 *   every REST route reaches, called as a signed-in person; and four of them
 *   once more over HTTP, with an API key, for the response a client reads;
 * - the Direct API;
 * - a plugin's content service (`ctx.services.collections`) and its version
 *   history (`ctx.services.versions`, its pins included);
 * - the release engine (`applyDueReleases`), in its own case.
 *
 * The MCP plugin's only tool reads, and nothing imports content, so neither
 * has a write to drive.
 *
 * Each refusal is asserted by its code and the entity it names, so a call
 * refused for any other reason fails here, and by the whole database: every
 * table's rows, read before and after, are equal. That covers the entry's own
 * rows, its versions, labels, autosaves, pins and "seen" markers, its content
 * events and any notice.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchSingleRoute } from "../../../api/singles-detail";
import { runWithRequestCaller } from "../../../auth/caller-scope";
import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import type { PluginVersionPinHolder } from "../../../plugins/plugin-version-pins";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { _resetEnvCache } from "../../../shared/lib/env";
import { applyDueReleases } from "../../releases/apply-due-releases";
import { createReleaseMutations } from "../../releases/release-mutations";
import { ReleasesRepository } from "../../releases/releases-repository";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  lockServerOf,
  scheduleAsItStands,
} from "../../releases/__tests__/helpers/release-writes";

const LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

/**
 * A collection with every kind of record a write can touch: a lifecycle,
 * versions with working drafts and autosave, and translations with a field
 * every language shares.
 */
function articles(slug: string) {
  return defineCollection({
    slug,
    status: true,
    versions: true,
    localized: true,
    fields: [
      text({ name: "title", localized: false }),
      text({ name: "headline" }),
    ],
  });
}

/** A Single shaped like {@link articles}. */
function notice(slug: string) {
  return defineSingle({
    slug,
    status: true,
    versions: true,
    localized: true,
    fields: [
      text({ name: "title", localized: false }),
      text({ name: "headline" }),
    ],
  });
}

/** Removed from code by the second boot. */
const REMOVED = { collection: "rw_posts", single: "rw_banner" } as const;
/**
 * Removed from code too, and never written: a read of a Single with no
 * document creates one, which for a removed Single would be a write.
 */
const REMOVED_EMPTY_SINGLE = "rw_empty";
/** Declared throughout: the same shapes, for the writes that must succeed. */
const DECLARED = {
  collection: "rw_kept_posts",
  single: "rw_kept_banner",
} as const;

const WITH_REMOVED = {
  collections: [articles(REMOVED.collection), articles(DECLARED.collection)],
  singles: [
    notice(REMOVED.single),
    notice(REMOVED_EMPTY_SINGLE),
    notice(DECLARED.single),
  ],
};
const AFTER_REMOVAL = {
  collections: [articles(DECLARED.collection)],
  singles: [notice(DECLARED.single)],
};

/** One entity's document, with what its history writes address. */
interface Target {
  collection: string;
  entryId: string;
  /** A durable version of the entry. */
  versionNo: number;
  single: string;
  singleId: string;
  /** A durable version of the Single's document. */
  singleVersionNo: number;
}

/** The context the probe plugin was given, per boot. */
let plugin: PluginContext["services"] | undefined;
let pinHolder: PluginVersionPinHolder | undefined;
const probe = definePlugin({
  name: "@test/removed-writes",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: ctx => {
    plugin = ctx.services;
    pinHolder = ctx.services.versions.pins.registerHolder({
      name: "rw-hold",
      label: "Removed-writes probe",
    });
  },
});

let current: TestNextly | undefined;
/** The install's first account, its administrator. */
let founder = "";

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** Run `work` as the founder, signed in, as a REST dispatch is. */
function asFounder<T>(work: () => Promise<T>): Promise<T> {
  return runWithRequestCaller(
    {
      userId: founder,
      actor: { type: "user", id: founder },
      roles: ["super-admin"],
    },
    work
  );
}

const restCollection = (
  method: string,
  params: Record<string, unknown>,
  body?: unknown
) =>
  asFounder(() =>
    dispatchCollections(
      new ServiceContainer(t().adapter),
      method,
      params as never,
      body
    )
  );

const restSingle = (
  method: string,
  params: Record<string, unknown>,
  body?: unknown
) => asFounder(() => dispatchSingles(method, params as never, body));

/** A full-access API key the founder holds, minted once per case. */
let apiKey = "";

/** One HTTP request to `/api/<path>` with the key, as status and body. */
async function http(
  method: "POST" | "PATCH",
  path: string[],
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** A refused HTTP write: thrown, so the operations table reads one way. */
async function httpWrite(
  method: "POST" | "PATCH",
  path: string[],
  body: unknown
): Promise<unknown> {
  const answer = await http(method, path, body);
  if (answer.status >= 400) throw new HttpRefusal(answer);
  return answer;
}

class HttpRefusal extends Error {
  constructor(readonly answer: { status: number; json: unknown }) {
    super(`HTTP ${answer.status}`);
  }
}

/** The standalone Single route (`nextly/api/singles-detail`), with the key. */
async function patchSingleStandalone(
  slug: string,
  body: unknown
): Promise<unknown> {
  const res = await patchSingleRoute(
    new Request(`http://localhost/api/singles/${slug}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) }
  );
  const answer = { status: res.status, json: await res.json() };
  if (res.status >= 400) throw new HttpRefusal(answer);
  return answer;
}

const SYSTEM = { as: "system" } as const;

function collectionRef(target: Target) {
  return {
    scopeKind: "collection" as const,
    scopeSlug: target.collection,
    entryId: target.entryId,
  };
}

function singleRef(target: Target) {
  return {
    scopeKind: "single" as const,
    scopeSlug: target.single,
    entryId: target.singleId,
  };
}

/** The plugin's pin holder, on one of its transactions. */
function pinning(
  work: (
    holder: PluginVersionPinHolder,
    opts: { tx: never }
  ) => Promise<unknown>
): Promise<unknown> {
  const holder = pinHolder;
  if (!holder || !plugin) throw new Error("the probe plugin did not init");
  return plugin.collections.withTransaction(tx =>
    work(holder, { tx: tx as never })
  );
}

interface Operation {
  /** Entry point, then operation: how a later write operation is named too. */
  name: string;
  kind: "collection" | "single";
  run(target: Target): Promise<unknown>;
}

/**
 * Every write operation each entry point offers, today. A write operation
 * added later joins as a row here.
 */
const OPERATIONS: Operation[] = [
  // The admin's and the REST API's endpoints, through the dispatcher.
  {
    name: "REST createEntry",
    kind: "collection",
    run: x =>
      restCollection(
        "createEntry",
        { collectionName: x.collection },
        { title: "New", headline: "New" }
      ),
  },
  {
    name: "REST updateEntry",
    kind: "collection",
    run: x =>
      restCollection(
        "updateEntry",
        { collectionName: x.collection, entryId: x.entryId },
        { headline: "Changed" }
      ),
  },
  {
    name: "REST publishAllLocales",
    kind: "collection",
    run: x =>
      restCollection("publishAllLocales", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST unpublishAllLocales",
    kind: "collection",
    run: x =>
      restCollection("unpublishAllLocales", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST deleteEntry",
    kind: "collection",
    run: x =>
      restCollection("deleteEntry", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST bulkUpdateEntries",
    kind: "collection",
    run: x =>
      restCollection(
        "bulkUpdateEntries",
        { collectionName: x.collection },
        { ids: [x.entryId], data: { headline: "Bulk" } }
      ),
  },
  {
    name: "REST bulkDeleteEntries",
    kind: "collection",
    run: x =>
      restCollection(
        "bulkDeleteEntries",
        { collectionName: x.collection },
        { ids: [x.entryId] }
      ),
  },
  {
    name: "REST bulkUpdateByQuery",
    kind: "collection",
    run: x =>
      restCollection(
        "bulkUpdateByQuery",
        { collectionName: x.collection },
        { where: { id: { equals: x.entryId } }, data: { headline: "Query" } }
      ),
  },
  {
    name: "REST duplicateEntry",
    kind: "collection",
    run: x =>
      restCollection("duplicateEntry", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST setEntryVersionLabel",
    kind: "collection",
    run: x =>
      restCollection(
        "setEntryVersionLabel",
        {
          collectionName: x.collection,
          entryId: x.entryId,
          versionNo: String(x.versionNo),
        },
        { label: "Named" }
      ),
  },
  {
    name: "REST markEntryVersionSeen",
    kind: "collection",
    run: x =>
      restCollection("markEntryVersionSeen", {
        collectionName: x.collection,
        entryId: x.entryId,
        versionNo: String(x.versionNo),
      }),
  },
  {
    name: "REST restoreEntryVersion",
    kind: "collection",
    run: x =>
      restCollection("restoreEntryVersion", {
        collectionName: x.collection,
        entryId: x.entryId,
        versionNo: String(x.versionNo),
      }),
  },
  {
    name: "REST discardWorkingDraft",
    kind: "collection",
    run: x =>
      restCollection("discardWorkingDraft", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST takeLiveSharedValues",
    kind: "collection",
    run: x =>
      restCollection("takeLiveSharedValues", {
        collectionName: x.collection,
        entryId: x.entryId,
      }),
  },
  {
    name: "REST autosaveEntry",
    kind: "collection",
    run: x =>
      restCollection(
        "autosaveEntry",
        { collectionName: x.collection, entryId: x.entryId },
        { title: "Shared", headline: "Autosaved" }
      ),
  },
  {
    name: "REST updateSingleDocument",
    kind: "single",
    run: x =>
      restSingle(
        "updateSingleDocument",
        { slug: x.single },
        { headline: "Changed" }
      ),
  },
  {
    name: "REST publishAllSingleLocales",
    kind: "single",
    run: x => restSingle("publishAllSingleLocales", { slug: x.single }),
  },
  {
    name: "REST setSingleVersionLabel",
    kind: "single",
    run: x =>
      restSingle(
        "setSingleVersionLabel",
        { slug: x.single, versionNo: String(x.singleVersionNo) },
        { label: "Named" }
      ),
  },
  {
    name: "REST markSingleVersionSeen",
    kind: "single",
    run: x =>
      restSingle("markSingleVersionSeen", {
        slug: x.single,
        versionNo: String(x.singleVersionNo),
      }),
  },
  {
    name: "REST restoreSingleVersion",
    kind: "single",
    run: x =>
      restSingle("restoreSingleVersion", {
        slug: x.single,
        versionNo: String(x.singleVersionNo),
      }),
  },
  {
    name: "REST discardSingleWorkingDraft",
    kind: "single",
    run: x => restSingle("discardSingleWorkingDraft", { slug: x.single }),
  },
  {
    name: "REST takeLiveSingleSharedValues",
    kind: "single",
    run: x => restSingle("takeLiveSingleSharedValues", { slug: x.single }),
  },
  {
    name: "REST autosaveSingle",
    kind: "single",
    run: x =>
      restSingle(
        "autosaveSingle",
        { slug: x.single },
        { title: "Shared", headline: "Autosaved" }
      ),
  },
  // Over HTTP with an API key, for the response a client reads.
  {
    name: "HTTP POST /collections/:slug/entries",
    kind: "collection",
    run: x =>
      httpWrite("POST", ["collections", x.collection, "entries"], {
        title: "New",
        headline: "New",
      }),
  },
  {
    name: "HTTP PATCH /collections/:slug/entries/:id",
    kind: "collection",
    run: x =>
      httpWrite("PATCH", ["collections", x.collection, "entries", x.entryId], {
        headline: "Changed",
      }),
  },
  {
    name: "HTTP PATCH /singles/:slug",
    kind: "single",
    run: x =>
      httpWrite("PATCH", ["singles", x.single], { headline: "Changed" }),
  },
  {
    name: "HTTP PATCH nextly/api/singles-detail",
    kind: "single",
    run: x => patchSingleStandalone(x.single, { headline: "Changed" }),
  },
  // The Direct API.
  {
    name: "Direct create",
    kind: "collection",
    run: x =>
      t().nextly.create({
        collection: x.collection as never,
        data: { title: "New", headline: "New" } as never,
      }),
  },
  {
    name: "Direct update by id",
    kind: "collection",
    run: x =>
      t().nextly.update({
        collection: x.collection as never,
        id: x.entryId,
        data: { headline: "Changed" } as never,
      }),
  },
  {
    name: "Direct update by where",
    kind: "collection",
    run: x =>
      t().nextly.update({
        collection: x.collection as never,
        where: { id: { equals: x.entryId } } as never,
        data: { headline: "Changed" } as never,
      }),
  },
  {
    name: "Direct delete by id",
    kind: "collection",
    run: x =>
      t().nextly.delete({ collection: x.collection as never, id: x.entryId }),
  },
  {
    name: "Direct delete by where",
    kind: "collection",
    run: x =>
      t().nextly.delete({
        collection: x.collection as never,
        where: { id: { equals: x.entryId } } as never,
      }),
  },
  {
    name: "Direct bulkDelete",
    kind: "collection",
    run: x =>
      t().nextly.bulkDelete({
        collection: x.collection as never,
        ids: [x.entryId],
      }),
  },
  {
    name: "Direct duplicate",
    kind: "collection",
    run: x =>
      t().nextly.duplicate({
        collection: x.collection as never,
        id: x.entryId,
      }),
  },
  {
    name: "Direct updateSingle",
    kind: "single",
    run: x =>
      t().nextly.updateSingle({
        slug: x.single as never,
        data: { headline: "Changed" } as never,
      }),
  },
  // A plugin's content service and version history.
  {
    name: "Plugin collections.createEntry",
    kind: "collection",
    run: x =>
      plugin!.collections.createEntry(
        x.collection,
        { title: "New", headline: "New" },
        SYSTEM
      ),
  },
  {
    name: "Plugin collections.createMany",
    kind: "collection",
    run: x =>
      plugin!.collections.createMany(
        x.collection,
        [{ title: "New", headline: "New" }],
        SYSTEM
      ),
  },
  {
    name: "Plugin collections.updateEntry",
    kind: "collection",
    run: x =>
      plugin!.collections.updateEntry(
        x.collection,
        x.entryId,
        { headline: "Changed" },
        SYSTEM
      ),
  },
  {
    name: "Plugin collections.updateMany",
    kind: "collection",
    run: x =>
      plugin!.collections.updateMany(
        x.collection,
        [{ id: x.entryId, data: { headline: "Changed" } }],
        SYSTEM
      ),
  },
  {
    name: "Plugin collections.deleteEntry",
    kind: "collection",
    run: x => plugin!.collections.deleteEntry(x.collection, x.entryId, SYSTEM),
  },
  {
    name: "Plugin collections.createEntryInTransaction",
    kind: "collection",
    run: x =>
      plugin!.collections.withTransaction(tx =>
        plugin!.collections.createEntryInTransaction(
          tx,
          x.collection,
          { title: "New", headline: "New" },
          SYSTEM
        )
      ),
  },
  {
    name: "Plugin collections.updateEntryInTransaction",
    kind: "collection",
    run: x =>
      plugin!.collections.withTransaction(tx =>
        plugin!.collections.updateEntryInTransaction(
          tx,
          x.collection,
          x.entryId,
          { headline: "Changed" },
          SYSTEM
        )
      ),
  },
  {
    name: "Plugin collections.deleteEntryInTransaction",
    kind: "collection",
    run: x =>
      plugin!.collections.withTransaction(tx =>
        plugin!.collections.deleteEntryInTransaction(
          tx,
          x.collection,
          x.entryId,
          SYSTEM
        )
      ),
  },
  {
    name: "Plugin versions.setLabel (collection)",
    kind: "collection",
    run: x => plugin!.versions.setLabel(collectionRef(x), x.versionNo, "Named"),
  },
  {
    name: "Plugin versions.deleteWorkingDraft (collection)",
    kind: "collection",
    run: x => plugin!.versions.deleteWorkingDraft(collectionRef(x), null),
  },
  {
    name: "Plugin versions.autosave (collection)",
    kind: "collection",
    run: x =>
      plugin!.versions.autosave({
        ref: collectionRef(x),
        status: "draft",
        snapshot: { title: "Shared", headline: "Autosaved" },
      }),
  },
  {
    name: "Plugin versions.pins pin (collection)",
    kind: "collection",
    run: x =>
      pinning((holder, opts) =>
        holder.pin(
          collectionRef(x),
          { slot: "probe", versionNo: x.versionNo },
          opts
        )
      ),
  },
  {
    name: "Plugin versions.pins release (collection)",
    kind: "collection",
    run: x =>
      pinning((holder, opts) =>
        holder.release(collectionRef(x), { slot: "held" }, opts)
      ),
  },
  {
    name: "Plugin versions.pins releaseAll (collection)",
    kind: "collection",
    run: x =>
      pinning((holder, opts) => holder.releaseAll(collectionRef(x), opts)),
  },
  {
    name: "Plugin versions.setLabel (Single)",
    kind: "single",
    run: x =>
      plugin!.versions.setLabel(singleRef(x), x.singleVersionNo, "Named"),
  },
  {
    name: "Plugin versions.deleteWorkingDraft (Single)",
    kind: "single",
    run: x => plugin!.versions.deleteWorkingDraft(singleRef(x), null),
  },
  {
    name: "Plugin versions.autosave (Single)",
    kind: "single",
    run: x =>
      plugin!.versions.autosave({
        ref: singleRef(x),
        status: "draft",
        snapshot: { title: "Shared", headline: "Autosaved" },
      }),
  },
  {
    name: "Plugin versions.pins pin (Single)",
    kind: "single",
    run: x =>
      pinning((holder, opts) =>
        holder.pin(
          singleRef(x),
          { slot: "probe", versionNo: x.singleVersionNo },
          opts
        )
      ),
  },
  {
    name: "Plugin versions.pins release (Single)",
    kind: "single",
    run: x =>
      pinning((holder, opts) =>
        holder.release(singleRef(x), { slot: "held" }, opts)
      ),
  },
  {
    name: "Plugin versions.pins releaseAll (Single)",
    kind: "single",
    run: x => pinning((holder, opts) => holder.releaseAll(singleRef(x), opts)),
  },
];

// --- The database each case owns, across its two boots ---------------------

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/**
 * A database both boots of a case connect to: a throwaway one on PostgreSQL
 * and MySQL, and one in-memory SQLite connection. The harness's own
 * provisioning drops its database at the next boot, and the second boot has to
 * find what the first wrote.
 */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_rw_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DB_DIALECT", dialect);
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/**
 * The one column a refused request may change: an API key's last use, which
 * authenticating the HTTP request records whatever the request then asks.
 * Nothing about any entry.
 */
const SET_ASIDE: Record<string, readonly string[]> = {
  api_keys: ["last_used_at", "lastUsedAt"],
};

/**
 * Every row of every table, each table's rows serialized and sorted, so two
 * reads compare equal exactly when nothing in the database changed, but for
 * the column {@link SET_ASIDE} names.
 */
async function everyRow(
  adapter: DrizzleAdapter
): Promise<Record<string, string[]>> {
  const tables: Record<string, string[]> = {};
  for (const table of [...(await adapter.listTables())].sort()) {
    const rows = await adapter.select<Record<string, unknown>>(table, {});
    tables[table] = rows
      .map(row =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row)
              .filter(([column]) => !SET_ASIDE[table]?.includes(column))
              .sort(([a], [b]) => (a < b ? -1 : 1))
          )
        )
      )
      .sort();
  }
  return tables;
}

/** The tables whose rows differ between two {@link everyRow} reads. */
function changedTables(
  before: Record<string, string[]>,
  after: Record<string, string[]>
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter(
      name =>
        JSON.stringify(before[name] ?? null) !==
        JSON.stringify(after[name] ?? null)
    )
    .sort();
}

// --- Seeding ----------------------------------------------------------------

/** The durable version numbers of a document, oldest first. */
async function durableVersions(ref: {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
}): Promise<number[]> {
  const rows = await t().getService("versionsService").list(ref, { limit: 50 });
  // A working draft and an autosave carry no number: they are not versions.
  return rows
    .flatMap(row => (row.versionNo === null ? [] : [row.versionNo]))
    .sort((a, b) => a - b);
}

/**
 * An entry with history: published twice, then given a working draft, with a
 * second language, a label, a "seen" marker, an autosave and a plugin pin.
 */
async function seedEntry(collection: string): Promise<{
  entryId: string;
  versionNo: number;
}> {
  const nextly = t().nextly;
  const created = (await nextly.create({
    collection: collection as never,
    data: { title: "Shared", headline: "First", status: "published" } as never,
  })) as unknown as { item: { id: string } };
  const entryId = String(created.item.id);
  await nextly.update({
    collection: collection as never,
    id: entryId,
    locale: "de",
    data: { headline: "Erste", status: "published" } as never,
  });
  await nextly.update({
    collection: collection as never,
    id: entryId,
    data: { headline: "Second", status: "published" } as never,
  });
  await nextly.update({
    collection: collection as never,
    id: entryId,
    // In a named language and naming no status, so the published document
    // holds the edit as a working draft rather than writing it live.
    locale: "en",
    data: { title: "Shared draft", headline: "Draft" } as never,
  });
  const ref = {
    scopeKind: "collection" as const,
    scopeSlug: collection,
    entryId,
  };
  const [versionNo] = await durableVersions(ref);
  await seedHistory(ref, versionNo!);
  return { entryId, versionNo: versionNo! };
}

/** The Single's document, with the same history as {@link seedEntry}'s. */
async function seedSingle(single: string): Promise<{
  singleId: string;
  singleVersionNo: number;
}> {
  const nextly = t().nextly;
  await nextly.updateSingle({
    slug: single as never,
    data: { title: "Shared", headline: "First", status: "published" } as never,
  });
  await nextly.updateSingle({
    slug: single as never,
    locale: "de",
    data: { headline: "Erste", status: "published" } as never,
  });
  await nextly.updateSingle({
    slug: single as never,
    data: { headline: "Second", status: "published" } as never,
  });
  const updated = (await nextly.updateSingle({
    slug: single as never,
    locale: "en",
    data: { title: "Shared draft", headline: "Draft" } as never,
  })) as unknown as { item: { id: string } };
  const singleId = String(updated.item.id);
  const ref = {
    scopeKind: "single" as const,
    scopeSlug: single,
    entryId: singleId,
  };
  const [singleVersionNo] = await durableVersions(ref);
  await seedHistory(ref, singleVersionNo!);
  return { singleId, singleVersionNo: singleVersionNo! };
}

/** A label, a "seen" marker, an autosave and a pin on one document. */
async function seedHistory(
  ref: {
    scopeKind: "collection" | "single";
    scopeSlug: string;
    entryId: string;
  },
  versionNo: number
): Promise<void> {
  await plugin!.versions.setLabel(ref, versionNo, "Launch");
  await plugin!.versions.autosave({
    ref,
    status: "draft",
    snapshot: { title: "Shared draft", headline: "Autosaved earlier" },
  });
  await pinning((holder, opts) =>
    holder.pin(ref, { slot: "held", versionNo }, opts)
  );
  if (ref.scopeKind === "collection") {
    await restCollection("markEntryVersionSeen", {
      collectionName: ref.scopeSlug,
      entryId: ref.entryId,
      versionNo: String(versionNo),
    });
  } else {
    await restSingle("markSingleVersionSeen", {
      slug: ref.scopeSlug,
      versionNo: String(versionNo),
    });
  }
}

/** Boot with `declared` as the configuration's entities, on the case database. */
async function boot(
  database: CaseDatabase,
  declared: typeof WITH_REMOVED
): Promise<void> {
  clearServices();
  current = await createTestNextly({
    adapter: database.adapter as never,
    collections: declared.collections,
    singles: declared.singles,
    localization: LOCALIZATION,
    plugins: [probe],
  });
}

/** Seed the founder, the key, both entities' documents and their history. */
async function seedBoth(): Promise<{ removed: Target; declared: Target }> {
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(t());
  const apiKeys = t().getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ): Promise<{ key: string }>;
  };
  apiKey = (
    await apiKeys.createApiKey(founder, {
      name: "removed-writes",
      tokenType: "full-access",
      expiresIn: "unlimited",
    })
  ).key;
  const target = async (names: {
    collection: string;
    single: string;
  }): Promise<Target> => ({
    ...names,
    ...(await seedEntry(names.collection)),
    ...(await seedSingle(names.single)),
  });
  return { removed: await target(REMOVED), declared: await target(DECLARED) };
}

/** What a refusal names: the stable code and the entity. */
function refusalOf(error: unknown): {
  code: unknown;
  data: unknown;
  status: unknown;
  message: unknown;
} {
  if (error instanceof HttpRefusal) {
    const body = error.answer.json as {
      error?: { code?: unknown; data?: unknown; message?: unknown };
    };
    return {
      code: body.error?.code,
      data: body.error?.data,
      status: error.answer.status,
      message: body.error?.message,
    };
  }
  if (error === undefined) {
    return {
      code: "none: the write succeeded",
      data: undefined,
      status: undefined,
      message: undefined,
    };
  }
  const e = error as {
    code?: unknown;
    publicData?: unknown;
    statusCode?: unknown;
    publicMessage?: unknown;
  };
  return {
    code: e.code,
    data: e.publicData,
    status: e.statusCode,
    message: e.publicMessage,
  };
}

async function refusedWith(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.each(getConfiguredTestDialects())(
  "writes to a collection and a Single removed from code (%s)",
  dialect => {
    let database: CaseDatabase;
    let removed: Target;
    let declared: Target;

    beforeEach(async () => {
      database = await openDatabase(dialect);
      await boot(database, WITH_REMOVED);
      ({ removed, declared } = await seedBoth());
      // The deploy of the configuration without them.
      await boot(database, AFTER_REMOVAL);
    }, 120_000);

    afterEach(async () => {
      clearServices();
      current = undefined;
      plugin = undefined;
      pinHolder = undefined;
      await database.close();
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    it("refuses every write operation with nothing in the database changed, and still serves reads", async () => {
      const before = await everyRow(database.adapter);
      const outcomes: string[] = [];
      for (const operation of OPERATIONS) {
        const error = await refusedWith(operation.run(removed));
        const refusal = refusalOf(error);
        const slug =
          operation.kind === "single" ? removed.single : removed.collection;
        outcomes.push(
          `${operation.name}: ${String(refusal.code)} ${JSON.stringify(refusal.data)} ${String(refusal.status)}`
        );
        outcomes.push(
          `${operation.name} changed: ${changedTables(before, await everyRow(database.adapter)).join(", ") || "nothing"}`
        );
        // Soft, so one run reports every operation rather than the first.
        expect
          .soft(refusal, `${operation.name} is refused as removed from code`)
          .toMatchObject({
            code: "ENTITY_REMOVED_FROM_CODE",
            data: { kind: operation.kind, slug },
            status: 409,
          });
      }
      expect(
        changedTables(before, await everyRow(database.adapter)),
        outcomes.join("\n")
      ).toEqual([]);

      // The refusal says what happened and both ways out.
      const sample = refusalOf(await refusedWith(OPERATIONS[1]!.run(removed)));
      expect(sample.message).toContain(`"${REMOVED.collection}"`);
      expect(sample.message).toContain("removed from code");
      expect(sample.message).toContain("nextly migrate:create");
      expect(sample.message).toContain("declare it again");

      // Reads keep answering, with the entry and its history as they were.
      const entry = (await t().nextly.findByID({
        collection: REMOVED.collection as never,
        id: removed.entryId,
      })) as unknown as { title?: string } | null;
      expect(entry?.title).toBe("Shared");
      const list = (await t().nextly.find({
        collection: REMOVED.collection as never,
      })) as unknown as { items: unknown[] };
      expect(list.items).toHaveLength(1);
      const single = (await t().nextly.findSingle({
        slug: REMOVED.single as never,
      })) as unknown as { title?: string };
      expect(single.title).toBe("Shared");
      expect(await durableVersions(collectionRef(removed))).toContain(
        removed.versionNo
      );
      expect(await durableVersions(singleRef(removed))).toContain(
        removed.singleVersionNo
      );
      // A removed Single with no document is read as holding none, rather
      // than given one.
      await expect(
        t().nextly.findSingle({ slug: REMOVED_EMPTY_SINGLE as never })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // And no read wrote anything.
      expect(changedTables(before, await everyRow(database.adapter))).toEqual(
        []
      );
    }, 300_000);

    it("refuses the release engine's write, leaving the entry as it was", async () => {
      // A release holding the removed collection's entry and the removed
      // Single, due now, run by the engine under the configuration that
      // removed them. The release's own records are its own and change; the
      // entities' do not.
      const repo = new ReleasesRepository(database.adapter as never);
      const release = await repo.createRelease({ title: "Go live" });
      for (const member of [
        {
          scopeKind: "collection" as const,
          scopeSlug: REMOVED.collection,
          entryId: removed.entryId,
        },
        {
          scopeKind: "single" as const,
          scopeSlug: REMOVED.single,
          entryId: removed.singleId,
        },
      ]) {
        await repo.addMember(
          {
            releaseId: release.id,
            ...member,
            locale: null,
            action: "publish",
            createdBy: founder,
          },
          ANY_EDITABLE_STATE
        );
      }
      expect(
        await scheduleAsItStands(
          repo,
          release.id,
          new Date("2020-01-01T00:00:00Z"),
          "UTC"
        )
      ).toBe(true);

      const before = await everyRow(database.adapter);
      const mutations = createReleaseMutations({
        contentApi: t().nextly,
        lockServer: lockServerOf(t()),
      });
      const refusals: unknown[] = [];
      await applyDueReleases({
        repository: repo,
        mutations: {
          publish: async input => {
            try {
              await mutations.publish(input);
            } catch (error) {
              refusals.push(refusalOf(error));
              throw error;
            }
          },
          unpublish: input => mutations.unpublish(input),
        },
        runAs: {
          findUser: async id => ({ id, isActive: true }),
          listRoleSlugs: async () => [],
        },
      }).catch(() => undefined);

      expect(refusals).toEqual([
        expect.objectContaining({
          code: "ENTITY_REMOVED_FROM_CODE",
          data: { kind: "collection", slug: REMOVED.collection },
        }),
        expect.objectContaining({
          code: "ENTITY_REMOVED_FROM_CODE",
          data: { kind: "single", slug: REMOVED.single },
        }),
      ]);
      const changed = changedTables(before, await everyRow(database.adapter));
      // Only the release's own bookkeeping: none of the entities' tables and
      // none of the history or content-event tables.
      expect(changed.filter(table => !/release/i.test(table))).toEqual([]);
    }, 300_000);

    it("lets every one of those write operations through to a declared collection and Single", async () => {
      // Each on a fresh declared document with the same history, since some
      // of them (a delete, a discard) use up what the next one needs.
      for (const operation of OPERATIONS) {
        const target: Target = {
          ...declared,
          ...(operation.kind === "collection"
            ? await seedEntry(DECLARED.collection)
            : await seedSingle(DECLARED.single)),
        };
        const error = await refusedWith(operation.run(target));
        expect
          .soft(
            error === undefined ? "succeeded" : refusalOf(error),
            `${operation.name} succeeds on a declared ${operation.kind}`
          )
          .toBe("succeeded");
      }
    }, 600_000);
  }
);
