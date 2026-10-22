/**
 * A renamed collection or Single keeps its history, on every dialect: its
 * versions and working draft, its version pins, each person's "last looked
 * at" marker, its content events and their parts, its release membership, its
 * schema events, its activity feed and its archived translations all read
 * under the new slug, and nothing is left under the old one. So do who may use
 * it (its permissions, and every role's grants of them) and where its webhooks
 * go (endpoint filters that list it, and its recording choice). Its document
 * locks, preview links and kept permission answers end with the old name, and
 * an entity created later under the old name inherits none of it.
 *
 * The rename either happens whole or not at all: a failure writing any one of
 * the moved tables leaves the registry and every table exactly as they were.
 * And a rename onto a slug that still holds an earlier entity's history is
 * refused, rather than merging two entities' records into one.
 *
 * The entities are defined in code so their content can be written through
 * the ordinary write paths, then handed to the Schema Builder (their registry
 * rows say `ui`, unlocked), since renaming is a Builder operation.
 */
import { randomUUID } from "node:crypto";

import type {
  TransactionContext,
  TransactionOptions,
} from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { container } from "../../../di";
import { ServiceContainer } from "../../../services/index";
import {
  clearInMemoryPermissionTiersForTests,
  hasPermission,
} from "../../../services/lib/permissions";
import { resetEpochForTests } from "../../../services/lib/rbac-epoch";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { entityPermissionSpelling } from "../../auth/services/entity-permission-spelling";
import { PermissionCacheService } from "../../auth/services/permission-cache-service";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { recordContentEvent } from "../../content-events/record";
import { documentLockKey } from "../../document-lock/lock-key";
import { releaseMemberKey } from "../../releases/release-member-key";
import { ReleasesRepository } from "../../releases/releases-repository";
import {
  registerVersionPinHolder,
  versionPinKey,
  versionPins,
} from "../../versions/version-pins";
import {
  markVersionSeen,
  readLastLookedAt,
  VISIT_GAP_MS,
  versionViewKey,
} from "../../versions/version-views";
import { workingDraftKey } from "../../versions/working-draft-key";
import type { WebhookEndpointRegistry } from "../../webhooks/endpoint-registry";
import { fanOutDueEvents, type FanOutDatabase } from "../../webhooks/fan-out";
import { isWebhookRecordingEnabled } from "../../webhooks/recording-policy";
import {
  VersionsRepository,
  type VersionRef,
} from "../../versions/versions-repository";
import {
  jsonSlugColumns,
  renamedSlugColumns,
  SLUG_COLUMNS,
  type RenamedEntityKind,
} from "../slug-columns";

// Webhook signing secrets are encrypted under NEXTLY_SECRET, so creating an
// endpoint needs one; `??=` never replaces a real environment's.
process.env.NEXTLY_SECRET ??= "integration-test-application-secret";

// An address literal, so the endpoint URL check makes no DNS lookup.
const ENDPOINT_URL = "https://93.184.216.34/hooks";

const HOLDER = "rename-test-workflows";
const workflows = registerVersionPinHolder({
  name: HOLDER,
  label: "Rename test workflows",
});

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test", role: "admin" };

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** The test instance, which every helper below reads. */
function t(): TestNextly {
  if (!current) throw new Error("no test instance");
  return current;
}

/** The registry table each kind is stored in. */
const REGISTRY: Record<RenamedEntityKind, string> = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
};

/** A history ref for one document. */
function refOf(kind: RenamedEntityKind, slug: string, entryId: string) {
  return { scopeKind: kind, scopeSlug: slug, entryId } satisfies VersionRef;
}

/** A row of a table, by the property names the adapter reads it with. */
type Row = Record<string, unknown>;

async function rowsOf(table: string): Promise<Row[]> {
  return t().adapter.select<Row>(table);
}

/**
 * How many rows of each declared table name this entity, by kind and slug,
 * read through the declarations themselves so a table added there is counted
 * here too.
 */
async function rowsNaming(
  kind: RenamedEntityKind,
  slug: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const column of renamedSlugColumns()) {
    const rows = await t().adapter.select<Row>(column.table);
    // Rows are read by property name; the declaration names SQL columns.
    const kindColumn = column.kind;
    counts[column.table] = rows.filter(
      row =>
        row[camel(column.slugColumn)] === slug &&
        (column.onlyWhereNull ?? []).every(name => row[camel(name)] == null) &&
        (kindColumn === undefined ||
          kindColumn.values[kind].includes(
            (row[camel(kindColumn.column)] ?? null) as string | null
          ))
    ).length;
  }
  return counts;
}

/**
 * The property name of a snake_case column in these tables, which all follow
 * that spelling. A table that did not would count zero here, and the fixture's
 * "every declared table holds rows" check refuses that before any rename.
 */
function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}

/**
 * Every row of the registries, the role grants and every declared table, in a
 * stable order, to compare a database before and after a refused rename.
 */
async function snapshot(): Promise<string> {
  // The permission cache is left out: every permission write retires it,
  // committed or not, by design, and a retired answer is recomputed rather
  // than lost.
  const tables = [
    ...Object.values(REGISTRY),
    "role_permissions",
    ...renamedSlugColumns()
      .map(column => column.table)
      .filter(table => table !== "user_permission_cache"),
    ...jsonSlugColumns().map(column => column.table),
  ];
  const out: Record<string, string[]> = {};
  for (const table of tables) {
    out[table] = (await rowsOf(table))
      .map(row =>
        JSON.stringify(Object.fromEntries(Object.entries(row).sort()))
      )
      .sort();
  }
  return JSON.stringify(out);
}

/** Boot with one versioned collection and one versioned Single. */
async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "masthead",
        versions: true,
        fields: [text({ name: "heading" })],
      }),
    ],
  });
  const now = new Date();
  await t().adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // Handed to the Schema Builder: renaming is a Builder operation, and a
  // code-first Single refuses a Builder update while it is locked.
  for (const [table, slug] of [
    [REGISTRY.collection, "notes"],
    [REGISTRY.single, "masthead"],
  ] as const) {
    await t().adapter.update(
      table,
      { source: "ui", locked: false },
      { and: [{ column: "slug", op: "=", value: slug }] }
    );
  }
}

/** A collection entry with three saves, made by Ana. */
async function writeNote(): Promise<string> {
  const handler = t().getService("collectionsHandler");
  const as = { collectionName: "notes", overrideAccess: true, user: ANA };
  const created = await handler.createEntry(as, { title: "v1" });
  const entryId = (created.data as { id: string }).id;
  for (const title of ["v2", "v3"]) {
    await handler.updateEntry({ ...as, entryId }, { title });
  }
  return entryId;
}

/** The Single's document after three saves by Ana, and its entry id. */
async function writeMasthead(): Promise<string> {
  const singles = t().getService("singleEntryService");
  for (const heading of ["a", "b", "c"]) {
    await singles.update(
      "masthead",
      { heading },
      { overrideAccess: true, user: ANA }
    );
  }
  const [row] = (await rowsOf("nextly_versions")).filter(
    version =>
      version.scopeKind === "single" && version.scopeSlug === "masthead"
  );
  return String(row?.entryId);
}

/**
 * Everything else a document's history holds, through the writers that write
 * it where one exists, and as rows where the writer needs a running request:
 * a working draft, a pin, a marker, an event with parts, a release member, a
 * schema event, a kept permission answer, an
 * activity row (and, for a collection, one from before kinds were recorded),
 * an archived translation, a lock and a preview link.
 */
async function seedHistory(
  kind: RenamedEntityKind,
  slug: string,
  entryId: string
): Promise<{ releaseId: string }> {
  const adapter = t().adapter;
  const ref = refOf(kind, slug, entryId);
  const now = new Date();
  await new VersionsRepository(adapter).upsertWorkingDraft({
    ref,
    locale: null,
    snapshot: { pending: true },
    createdBy: ANA.id,
  });
  await adapter.transaction(async tx => {
    await workflows.pin(tx, { ref, slot: "approved", versionNo: 1 });
    await markVersionSeen(tx, { userId: ANA.id, ref, part: null }, 2, now);
    // A save involving a language and the shared fields: the ordinary saves
    // above involve no parts, since the document has no languages.
    await recordContentEvent(tx, {
      subject: { kind, slug, id: entryId },
      parts: { locales: ["es"], shared: true },
      kind: "saved",
      actor: { kind: "person", id: ANA.id, name: ANA.name },
    });
  });
  const releases = new ReleasesRepository(adapter);
  const release = await releases.createRelease({ title: `Launch ${kind}` });
  await releases.addMember(
    {
      releaseId: release.id,
      action: "publish",
      scopeKind: kind,
      scopeSlug: slug,
      entryId,
      locale: null,
    },
    ["draft"]
  );
  await adapter.insert("nextly_schema_events", {
    id: randomUUID(),
    eventType: "ui_save",
    status: "applied",
    source: "admin-ui",
    scopeKind: kind,
    scopeSlug: slug,
    startedAt: now,
  });
  const activity = (subjectKind: string | null) => ({
    id: randomUUID(),
    userId: ANA.id,
    actorType: "user",
    action: "update",
    collection: slug,
    entryId,
    subjectKind,
    createdAt: now,
  });
  await adapter.insert("activity_log", activity(kind));
  if (kind === "collection") {
    await adapter.insert("activity_log", activity(null));
  }
  await adapter.insert("nextly_i18n_archive", {
    collection: slug,
    entityKind: kind,
    entryId,
    locale: "es",
    field: "title",
    value: "hola",
    archivedAt: now,
  });
  await adapter.insert("nextly_document_lock", {
    id: documentLockKey(kind, slug, entryId),
    scopeKind: kind,
    slug,
    entryId,
    ownerId: ANA.id,
    claimToken: randomUUID(),
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  // A kept answer about the entity, written by the cache's own writer.
  await new PermissionCacheService(adapter, silentLogger).setCachedPermission(
    ANA.id,
    "read",
    slug,
    true,
    []
  );
  await adapter.insert("nextly_preview_links", {
    id: randomUUID().replace(/-/g, ""),
    documentKind: kind === "collection" ? "entry" : "single",
    documentSlug: slug,
    entryId: kind === "collection" ? entryId : null,
    createdBy: ANA.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    generation: 0,
  });
  return { releaseId: release.id };
}

/**
 * A document lock, a preview link and a kept permission answer under `slug`,
 * as an entity of that name leaves them when it is deleted.
 */
async function seedEphemeral(
  kind: RenamedEntityKind,
  slug: string
): Promise<{ lockId: string; linkId: string }> {
  const adapter = t().adapter;
  const now = new Date();
  const entryId = randomUUID();
  const lockId = documentLockKey(kind, slug, entryId);
  await adapter.insert("nextly_document_lock", {
    id: lockId,
    scopeKind: kind,
    slug,
    entryId,
    ownerId: ANA.id,
    claimToken: randomUUID(),
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const linkId = randomUUID().replace(/-/g, "");
  await adapter.insert("nextly_preview_links", {
    id: linkId,
    documentKind: kind === "collection" ? "entry" : "single",
    documentSlug: slug,
    entryId: kind === "collection" ? entryId : null,
    createdBy: ANA.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    generation: 0,
  });
  await new PermissionCacheService(adapter, silentLogger).setCachedPermission(
    ANA.id,
    "read",
    slug,
    true,
    []
  );
  return { lockId, linkId };
}

/** Rename through the Builder's registry services. */
function rename(kind: RenamedEntityKind, from: string, to: string) {
  if (kind === "collection") {
    return new DynamicCollectionRegistryService(
      t().adapter,
      silentLogger
    ).updateCollectionMetadata(from, { slug: to });
  }
  return t()
    .getService("singleRegistryService")
    .updateSingle(from, { slug: to }, { source: "ui" });
}

/** What the rename should have done, read under both names. */
async function expectMoved(
  kind: RenamedEntityKind,
  names: { from: string; to: string },
  entryId: string,
  releaseId: string,
  before: Record<string, number>
) {
  const adapter = t().adapter;
  const oldRef = refOf(kind, names.from, entryId);
  const ref = refOf(kind, names.to, entryId);

  // Nothing at all is left under the old name, in any declared table.
  const left = await rowsNaming(kind, names.from);
  expect(left).toEqual(
    Object.fromEntries(Object.keys(left).map(table => [table, 0]))
  );

  // Every row that followed is under the new name, as many as there were.
  const moved = await rowsNaming(kind, names.to);
  for (const column of SLUG_COLUMNS) {
    if (column.onRename === "follow") {
      expect([column.table, moved[column.table]]).toEqual([
        column.table,
        before[column.table],
      ]);
    }
    if (column.onRename === "end") {
      expect([column.table, moved[column.table]]).toEqual([column.table, 0]);
    }
  }

  // Every activity row of the document, including one written before rows
  // recorded their kind, is under the new name. Read by the document rather
  // than through the declarations, whose kinds are what this checks.
  const activity = (await rowsOf("activity_log")).filter(
    row => row.entryId === entryId
  );
  expect(activity.length).toBeGreaterThan(0);
  expect(activity.map(row => row.collection)).toEqual(
    activity.map(() => names.to)
  );
  if (kind === "collection") {
    expect(activity.filter(row => row.subjectKind === null)).toEqual([
      expect.objectContaining({ collection: names.to }),
    ]);
  }

  // Versions read under the new name, and the working draft's key is the one
  // its writer computes for the new name.
  const versions = new VersionsRepository(adapter);
  expect(await versions.listByDoc(ref)).toHaveLength(3);
  expect(await versions.listByDoc(oldRef)).toHaveLength(0);
  const draft = await versions.findWorkingDraft(ref, null);
  expect((draft as { draftKey?: unknown } | undefined)?.draftKey).toBe(
    workingDraftKey(ref, null)
  );

  // The pin is found by its key: moving the slot again updates the one pin
  // rather than adding a second beside a stale key.
  await adapter.transaction(tx =>
    workflows.pin(tx, { ref, slot: "approved", versionNo: 2 })
  );
  expect(await versionPins.list(adapter, ref)).toEqual([
    { holder: HOLDER, slot: "approved", versionNo: 2 },
  ]);
  const [pin] = (await rowsOf("nextly_version_pins")).filter(
    row => row.entryId === entryId && row.scopeKind === kind
  );
  expect(pin?.pinKey).toBe(versionPinKey(ref, HOLDER, "approved"));

  // The marker is read by its key, so it answers only if the key moved too.
  // Read once the visit is over: during it, "last looked at" is the visit
  // before, which this person does not have.
  const marker = { userId: ANA.id, ref, part: null };
  const afterTheVisit = new Date(Date.now() + VISIT_GAP_MS + 60_000);
  expect(await readLastLookedAt(adapter, marker, afterTheVisit)).toBe(2);
  const [view] = (await rowsOf("nextly_version_views")).filter(
    row => row.entryId === entryId && row.scopeKind === kind
  );
  expect(view?.viewKey).toBe(versionViewKey(marker));

  // Content events, and each one's parts, which are keyed by the event.
  const events = (await rowsOf("nextly_content_events")).filter(
    row => row.subjectKind === kind && row.subjectId === entryId
  );
  expect(events.length).toBeGreaterThan(0);
  expect(events.every(row => row.subjectSlug === names.to)).toBe(true);
  const parts = (await rowsOf("nextly_content_event_parts")).filter(row =>
    events.some(event => event.id === row.eventId)
  );
  expect(parts.length).toBeGreaterThan(0);

  // The release still holds the document, by the key its writer computes.
  const members = await new ReleasesRepository(adapter).listMembers(releaseId);
  expect(members).toEqual([
    expect.objectContaining({ scopeSlug: names.to, entryId }),
  ]);
  const [member] = (await rowsOf("nextly_release_members")).filter(
    row => row.releaseId === releaseId
  );
  expect(member?.memberKey).toBe(
    releaseMemberKey(releaseId, { ...ref, locale: null })
  );
}

/**
 * The adapter's transactions, with every write to `table` failing: the
 * rename's own transaction, handed a context whose writes to that one table
 * throw. `hits` counts the failures, so a test can tell the write was reached.
 */
function failWritesTo(table: string, hits: { count: number }) {
  const adapter = t().adapter;
  const original = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation(
    <T>(
      work: (tx: TransactionContext) => Promise<T>,
      options?: TransactionOptions
    ) => original(tx => work(failingOn(tx, table, hits)), options)
  );
}

function failingOn(
  tx: TransactionContext,
  table: string,
  hits: { count: number }
): TransactionContext {
  return new Proxy(tx, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== "function") return value;
      if (name === "update" || name === "updateCount" || name === "delete") {
        return (written: unknown, ...rest: unknown[]) => {
          if (written === table) {
            hits.count += 1;
            throw new Error(`injected: writing ${table} failed`);
          }
          return Reflect.apply(value, target, [written, ...rest]);
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * An endpoint row whose filter lists `collections`, written as a row so a
 * test that only needs the filter does not depend on endpoint creation.
 */
async function endpointFiltering(collections: string[]): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await t().adapter.insert("nextly_webhooks", {
    id,
    name: "Filtered",
    url: ENDPOINT_URL,
    enabled: true,
    eventTypes: ["*"],
    filter: { version: 1, collections },
    secretHash: [],
    secretPrefix: "whsec_test",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Endpoint filters, by endpoint id. */
async function filters(): Promise<Map<string, unknown>> {
  return new Map(
    (await rowsOf("nextly_webhooks")).map(row => [String(row.id), row.filter])
  );
}

/**
 * A person, made the way an install makes one. The first account an install
 * provisions is its super-admin, which every check lets through, so each test
 * makes a founder first.
 */
async function makeUser(email: string): Promise<string> {
  const created = await new ServiceContainer(t().adapter).users.createLocalUser(
    {
      email,
      name: email,
      password: "Str0ng-P@ssw0rd!",
      isActive: true,
      emailVerification: "admin-vouched",
    }
  );
  return String(created.id);
}

/**
 * A role holding the framework's permissions for these actions on these
 * entities, given to `userId`. Grants point at the permissions the boot
 * seeded, by id, as an administrator's grant does.
 */
async function grant(
  roleId: string,
  userId: string,
  grants: readonly (readonly [string, string])[]
): Promise<void> {
  const adapter = t().adapter;
  const now = new Date();
  await adapter.insert("roles", {
    id: roleId,
    name: roleId,
    slug: roleId,
    level: 10,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  });
  const permissions = await rowsOf("permissions");
  for (const [action, resource] of grants) {
    const permission = permissions.find(
      row =>
        row.action === action && row.resource === resource && row.owner == null
    );
    expect([action, resource, permission !== undefined]).toEqual([
      action,
      resource,
      true,
    ]);
    await adapter.insert("role_permissions", {
      id: randomUUID(),
      roleId,
      permissionId: permission?.id,
    });
  }
  await adapter.insert("user_roles", {
    id: randomUUID(),
    userId,
    roleId,
    expiresAt: null,
    createdAt: now,
  });
}

/** What each action answers for this person on this entity, asked for real. */
async function mayDo(
  userId: string,
  actions: readonly string[],
  resource: string
): Promise<Record<string, boolean>> {
  const answers: Record<string, boolean> = {};
  for (const action of actions) {
    answers[action] = await hasPermission(userId, action, resource);
  }
  return answers;
}

/** Every action answered the same way. */
function all(
  actions: readonly string[],
  answer: boolean
): Record<string, boolean> {
  return Object.fromEntries(actions.map(action => [action, answer]));
}

const COLLECTION_ACTIONS = ["read", "create", "update", "publish"] as const;
const SINGLE_ACTIONS = ["read", "update", "publish"] as const;

/** Boot with access state that starts clean for this instance. */
async function bootForAccess(dialect: TestDialect): Promise<void> {
  // Started afresh, so an earlier instance in this process leaves no
  // permission answer or revision for this one to read.
  resetEpochForTests();
  clearInMemoryPermissionTiersForTests();
  await boot(dialect);
}

describe.each(getConfiguredTestDialects())(
  "renaming a collection or Single (integration, %s)",
  dialect => {
    it("moves a collection's history to its new slug", async () => {
      await boot(dialect);
      const entryId = await writeNote();
      const { releaseId } = await seedHistory("collection", "notes", entryId);
      const before = await rowsNaming("collection", "notes");
      // The fixture reaches every declared table, so a table the rename
      // skipped could not pass as one that had nothing to move.
      expect(Object.entries(before).filter(([, count]) => count === 0)).toEqual(
        []
      );

      const renamed = await rename("collection", "notes", "journal");

      expect(renamed).toMatchObject({ slug: "journal" });
      await expectMoved(
        "collection",
        { from: "notes", to: "journal" },
        entryId,
        releaseId,
        before
      );
    }, 120_000);

    it("moves a Single's history to its new slug", async () => {
      await boot(dialect);
      const entryId = await writeMasthead();
      const { releaseId } = await seedHistory("single", "masthead", entryId);
      const before = await rowsNaming("single", "masthead");
      expect(Object.entries(before).filter(([, count]) => count === 0)).toEqual(
        []
      );

      const renamed = await rename("single", "masthead", "header");

      expect(renamed).toMatchObject({ slug: "header" });
      await expectMoved(
        "single",
        { from: "masthead", to: "header" },
        entryId,
        releaseId,
        before
      );
    }, 120_000);

    it("refuses a rename onto a slug still holding an earlier collection's history, changing nothing", async () => {
      await boot(dialect);
      const entryId = await writeNote();
      await seedHistory("collection", "notes", entryId);
      // What a deleted collection named `journal` leaves behind: its record
      // of events is kept after it is gone.
      await t().adapter.insert("nextly_content_events", {
        id: randomUUID(),
        subjectKind: "collection",
        subjectSlug: "journal",
        subjectId: randomUUID(),
        kind: "saved",
        endsSubject: false,
        actorKind: "system",
        occurredAt: new Date(),
      });
      const unchanged = await snapshot();

      await expect(
        rename("collection", "notes", "journal")
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await snapshot()).toBe(unchanged);
    }, 120_000);

    it("lets a collection take a slug only a Single's history holds", async () => {
      await boot(dialect);
      const entryId = await writeNote();
      // Another kind's rows under the same name are another entity's, and do
      // not collide: every history key starts with the kind.
      await t().adapter.insert("nextly_content_events", {
        id: randomUUID(),
        subjectKind: "single",
        subjectSlug: "journal",
        subjectId: randomUUID(),
        kind: "saved",
        endsSubject: false,
        actorKind: "system",
        occurredAt: new Date(),
      });

      await rename("collection", "notes", "journal");

      const versions = new VersionsRepository(t().adapter);
      expect(
        await versions.listByDoc(refOf("collection", "journal", entryId))
      ).toHaveLength(3);
    }, 120_000);

    it("keeps who may use a renamed collection or Single, and changes no other role", async () => {
      await bootForAccess(dialect);
      await makeUser("founder@x.test");
      const editor = await makeUser("editor@x.test");
      const other = await makeUser("other@x.test");
      await grant("role-rename-editor", editor, [
        ...COLLECTION_ACTIONS.map(action => [action, "notes"] as const),
        ...SINGLE_ACTIONS.map(action => [action, "masthead"] as const),
      ]);
      await grant("role-rename-other", other, [["read", "masthead"]]);
      // A plugin's own permission on the collection, declared by the plugin
      // under the slug its code names.
      const now = new Date();
      await t().adapter.insert("permissions", {
        id: "perm-plugin-export-notes",
        name: "Export Notes",
        slug: "export-notes",
        action: "export",
        resource: "notes",
        owner: "plugin-exporter",
        createdAt: now,
        updatedAt: now,
      });
      // Asked once before, so a kept answer about the old names exists for
      // the rename to retire.
      expect(await mayDo(editor, COLLECTION_ACTIONS, "notes")).toEqual(
        all(COLLECTION_ACTIONS, true)
      );
      expect(await mayDo(editor, SINGLE_ACTIONS, "masthead")).toEqual(
        all(SINGLE_ACTIONS, true)
      );

      await rename("collection", "notes", "journal");
      await rename("single", "masthead", "header");

      expect(await mayDo(editor, COLLECTION_ACTIONS, "journal")).toEqual(
        all(COLLECTION_ACTIONS, true)
      );
      expect(await mayDo(editor, COLLECTION_ACTIONS, "notes")).toEqual(
        all(COLLECTION_ACTIONS, false)
      );
      expect(await mayDo(editor, SINGLE_ACTIONS, "header")).toEqual(
        all(SINGLE_ACTIONS, true)
      );
      expect(await mayDo(editor, SINGLE_ACTIONS, "masthead")).toEqual(
        all(SINGLE_ACTIONS, false)
      );
      // The other role holds what it held, under the new name, and nothing
      // the rename could have handed it.
      expect(await mayDo(other, ["read", "update"], "header")).toEqual({
        read: true,
        update: false,
      });
      expect(await mayDo(other, ["read"], "journal")).toEqual({ read: false });

      // The plugin's permission stays with the plugin's declaration.
      expect(
        (await rowsOf("permissions")).find(
          row => row.id === "perm-plugin-export-notes"
        )
      ).toMatchObject({ resource: "notes", slug: "export-notes" });

      // The moved permissions are spelled as the seeder spells a new one.
      const moved = (await rowsOf("permissions")).filter(
        row => row.resource === "journal" && row.owner == null
      );
      expect(moved.length).toBeGreaterThanOrEqual(COLLECTION_ACTIONS.length);
      for (const row of moved) {
        const spelled = entityPermissionSpelling(String(row.action), "journal");
        expect(row).toMatchObject({
          slug: spelled.slug,
          name: spelled.name,
          description: spelled.description,
        });
      }
    }, 120_000);

    it("delivers a renamed collection's events to the endpoints that filtered on it, and keeps a Single's recording choice", async () => {
      await boot(dialect);
      const founder = await makeUser("founder@x.test");
      const created = (await t()
        .getService("webhookEndpointService")
        .createEndpoint(
          { name: "Notes", url: ENDPOINT_URL, eventTypes: ["*"] },
          founder
        )) as { endpoint: { id: string } };
      const endpointId = created.endpoint.id;
      // Created a minute ago: an endpoint receives only events after it, and
      // MySQL keeps this column to the second, rounding up, so an event in the
      // same second would read as earlier than the endpoint.
      await t().adapter.update(
        "nextly_webhooks",
        {
          filter: { version: 1, collections: ["notes"] },
          createdAt: new Date(Date.now() - 60_000),
        },
        { and: [{ column: "id", op: "=", value: endpointId }] }
      );
      await t()
        .getService("singleRegistryService")
        .updateSingle(
          "masthead",
          { webhooks: { record: false } },
          { source: "ui" }
        );
      expect(isWebhookRecordingEnabled("single", "masthead")).toBe(false);
      // Loaded before the rename with the filter naming the old slug, so the
      // delivery below reads a list the rename had to drop. Creating the
      // endpoint loaded it with no filter yet, which matches every event, so
      // that list is dropped first.
      const endpoints = container.get<WebhookEndpointRegistry>(
        "webhookEndpointRegistry"
      );
      endpoints.invalidate();
      expect(
        (await endpoints.getEnabledEndpoints()).find(
          endpoint => endpoint.id === endpointId
        )?.filter
      ).toMatchObject({ version: 1, collections: ["notes"] });

      await rename("collection", "notes", "journal");
      await rename("single", "masthead", "header");

      expect((await filters()).get(endpointId)).toEqual({
        version: 1,
        collections: ["journal"],
      });
      expect(isWebhookRecordingEnabled("single", "header")).toBe(false);
      expect(isWebhookRecordingEnabled("single", "masthead")).toBe(true);

      await t()
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "journal", overrideAccess: true },
          { title: "after the rename" }
        );
      expect(
        (await rowsOf("nextly_events")).filter(
          row => row.resourceCollection === "journal"
        ).length
      ).toBeGreaterThan(0);
      await fanOutDueEvents({
        // The adapter as the delivery job resolves it: by the port it needs.
        db: container.get<FanOutDatabase>("adapter"),
        loadEndpoints: () => endpoints.getEnabledEndpoints(),
      });
      expect(
        (await rowsOf("nextly_webhook_deliveries")).filter(
          row => row.webhookId === endpointId
        ).length
      ).toBeGreaterThan(0);
    }, 120_000);

    it("gives a collection created under the old slug none of the renamed one's grants, webhooks or history", async () => {
      await bootForAccess(dialect);
      await makeUser("founder@x.test");
      const editor = await makeUser("editor@x.test");
      await grant(
        "role-rename-editor",
        editor,
        COLLECTION_ACTIONS.map(action => [action, "notes"] as const)
      );
      const endpointId = await endpointFiltering(["notes"]);
      await new DynamicCollectionRegistryService(
        t().adapter,
        silentLogger
      ).updateCollectionMetadata("notes", { webhooks: { record: false } });
      const entryId = await writeNote();
      await seedHistory("collection", "notes", entryId);

      await rename("collection", "notes", "journal");
      // A new collection under the old slug, made by the two calls a create
      // makes: the registry row, and the permissions seeded for it. Its own
      // table name, because the renamed collection keeps `dc_notes`, the name
      // the Builder would give a new `notes`.
      await new DynamicCollectionRegistryService(
        t().adapter,
        silentLogger
      ).registerCollection({
        id: randomUUID(),
        slug: "notes",
        tableName: "dc_notes_again",
        labels: { singular: "Note", plural: "Notes" },
        fields: [],
        schemaHash: "new-notes",
        source: "ui",
      });
      await t()
        .getService("permissionSeedService")
        .seedCollectionPermissions("notes");

      // Asked through the real access decision: the editor's grants were of
      // the renamed collection's permissions, so the new one answers no.
      expect(await mayDo(editor, COLLECTION_ACTIONS, "notes")).toEqual(
        all(COLLECTION_ACTIONS, false)
      );
      expect(await mayDo(editor, COLLECTION_ACTIONS, "journal")).toEqual(
        all(COLLECTION_ACTIONS, true)
      );
      // No kept answer says yes about the old name: the ones the questions
      // above just kept say no, and any yes could only be the old entity's.
      expect(
        (await rowsOf("user_permission_cache")).filter(
          row =>
            row.resource === "notes" &&
            (row.hasPermission === true || row.hasPermission === 1)
        )
      ).toEqual([]);
      expect((await filters()).get(endpointId)).toEqual({
        version: 1,
        collections: ["journal"],
      });
      expect(isWebhookRecordingEnabled("collection", "notes")).toBe(true);
      expect(isWebhookRecordingEnabled("collection", "journal")).toBe(false);
      const history = await rowsNaming("collection", "notes");
      for (const table of [
        "nextly_versions",
        "nextly_version_pins",
        "nextly_version_views",
        "nextly_content_events",
        "nextly_release_members",
        "nextly_i18n_archive",
        "nextly_document_lock",
        "nextly_preview_links",
      ]) {
        expect([table, history[table]]).toEqual([table, 0]);
      }
    }, 120_000);

    it("delivers an event recorded before the rename and not yet fanned out, and leaves fanned-out events as they were sent", async () => {
      await boot(dialect);
      const endpointId = await endpointFiltering(["notes"]);
      // An endpoint receives only events after it was created; MySQL keeps
      // this column to the second, rounding up.
      await t().adapter.update(
        "nextly_webhooks",
        { createdAt: new Date(Date.now() - 60_000) },
        { and: [{ column: "id", op: "=", value: endpointId }] }
      );
      const endpoints = container.get<WebhookEndpointRegistry>(
        "webhookEndpointRegistry"
      );
      endpoints.invalidate();
      const fanOut = () =>
        fanOutDueEvents({
          db: container.get<FanOutDatabase>("adapter"),
          loadEndpoints: () => endpoints.getEnabledEndpoints(),
        });
      const handler = t().getService("collectionsHandler");
      await handler.createEntry(
        { collectionName: "notes", overrideAccess: true },
        { title: "sent before the rename" }
      );
      await fanOut();
      const sent = new Set(
        (await rowsOf("nextly_events")).map(row => String(row.id))
      );
      expect(sent.size).toBeGreaterThan(0);
      await handler.createEntry(
        { collectionName: "notes", overrideAccess: true },
        { title: "waiting when the rename happens" }
      );
      const waiting = (await rowsOf("nextly_events")).filter(
        row => !sent.has(String(row.id))
      );
      expect(waiting.length).toBeGreaterThan(0);
      expect(waiting.every(row => row.fannedOutAt == null)).toBe(true);

      await rename("collection", "notes", "journal");
      await fanOut();

      // The waiting events reach the endpoint whose filter the rename moved,
      // and say the collection's new name, as an event written now would.
      const deliveries = (await rowsOf("nextly_webhook_deliveries")).filter(
        row => row.webhookId === endpointId
      );
      for (const event of waiting) {
        expect([
          event.id,
          deliveries.some(row => row.eventId === event.id),
        ]).toEqual([event.id, true]);
      }
      const events = new Map(
        (await rowsOf("nextly_events")).map(row => [String(row.id), row])
      );
      const collectionOf = (row: Row | undefined) => {
        const payload: unknown =
          typeof row?.payload === "string"
            ? JSON.parse(row.payload)
            : row?.payload;
        return (payload as { resource: { collection?: string } }).resource
          .collection;
      };
      for (const event of waiting) {
        const row = events.get(String(event.id));
        expect([row?.resourceCollection, collectionOf(row)]).toEqual([
          "journal",
          "journal",
        ]);
      }
      // An event already fanned out is a message receivers were given: it
      // keeps the name it was sent under.
      for (const id of sent) {
        const row = events.get(id);
        expect([row?.resourceCollection, collectionOf(row)]).toEqual([
          "notes",
          "notes",
        ]);
      }
    }, 120_000);

    it("ends locks, preview links and kept answers an earlier entity left under the new name", async () => {
      await bootForAccess(dialect);
      for (const [kind, from, to] of [
        ["collection", "notes", "journal"],
        ["single", "masthead", "header"],
      ] as const) {
        // What a deleted entity under the new name leaves behind: a lease on
        // one of its documents, a preview link to it, a kept "yes".
        const earlier = await seedEphemeral(kind, to);

        await rename(kind, from, to);

        expect(
          (await rowsOf("nextly_document_lock")).filter(
            row => row.id === earlier.lockId
          )
        ).toEqual([]);
        expect(
          (await rowsOf("nextly_preview_links")).filter(
            row => row.id === earlier.linkId
          )
        ).toEqual([]);
        expect(
          (await rowsOf("user_permission_cache")).filter(
            row => row.resource === to
          )
        ).toEqual([]);
      }
    }, 120_000);

    it("refuses a collection rename whose registry row is gone by the time it is written, moving nothing", async () => {
      await boot(dialect);
      const entryId = await writeNote();
      await seedHistory("collection", "notes", entryId);
      const before = await rowsNaming("collection", "notes");
      // The collection is deleted after the rename has looked it up and
      // before its transaction writes the row.
      const adapter = t().adapter;
      const original = adapter.transaction.bind(adapter);
      vi.spyOn(adapter, "transaction").mockImplementationOnce(
        <T>(
          work: (tx: TransactionContext) => Promise<T>,
          options?: TransactionOptions
        ) =>
          original(async tx => {
            await tx.delete(REGISTRY.collection, {
              and: [{ column: "slug", op: "=", value: "notes" }],
            });
            return work(tx);
          }, options)
      );

      await expect(
        rename("collection", "notes", "journal")
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      vi.restoreAllMocks();
      expect(await rowsNaming("collection", "notes")).toEqual(before);
      expect(
        Object.values(await rowsNaming("collection", "journal")).every(
          count => count === 0
        )
      ).toBe(true);
    }, 120_000);

    it("moves a custom permission's resource without respelling it, and keeps a name an administrator chose", async () => {
      await boot(dialect);
      const now = new Date();
      // A permission an application created for the collection, with no
      // plugin owner and a spelling of its own.
      await t().adapter.insert("permissions", {
        id: "perm-approve-editorial",
        name: "Approve Editorial",
        slug: "approve-editorial",
        description: "May approve editorial copy",
        action: "approve",
        resource: "notes",
        owner: null,
        createdAt: now,
        updatedAt: now,
      });
      const read = (await rowsOf("permissions")).find(
        row =>
          row.action === "read" && row.resource === "notes" && row.owner == null
      );
      expect(read).toBeDefined();
      await t().adapter.update(
        "permissions",
        { name: "Read the notebook" },
        { and: [{ column: "id", op: "=", value: read?.id as string }] }
      );

      await rename("collection", "notes", "journal");

      const rows = new Map(
        (await rowsOf("permissions")).map(row => [String(row.id), row])
      );
      expect(rows.get("perm-approve-editorial")).toMatchObject({
        resource: "journal",
        slug: "approve-editorial",
        name: "Approve Editorial",
        description: "May approve editorial copy",
      });
      // The framework's own slug and description follow the new name, which
      // every check spells; the name an administrator gave it stays.
      const spelled = entityPermissionSpelling("read", "journal");
      expect(rows.get(String(read?.id))).toMatchObject({
        resource: "journal",
        slug: spelled.slug,
        name: "Read the notebook",
        description: spelled.description,
      });
    }, 120_000);

    it("ignores deleted webhook endpoints, neither refusing on their filters nor rewriting them", async () => {
      await boot(dialect);
      const naming = await endpointFiltering(["journal"]);
      const listing = await endpointFiltering(["notes"]);
      const live = await endpointFiltering(["notes"]);
      for (const id of [naming, listing]) {
        await t().adapter.update(
          "nextly_webhooks",
          { deletedAt: new Date() },
          { and: [{ column: "id", op: "=", value: id }] }
        );
      }

      await rename("collection", "notes", "journal");

      const after = await filters();
      expect(after.get(live)).toEqual({ version: 1, collections: ["journal"] });
      expect(after.get(listing)).toEqual({
        version: 1,
        collections: ["notes"],
      });
      expect(after.get(naming)).toEqual({
        version: 1,
        collections: ["journal"],
      });
    }, 120_000);

    it("fails the whole rename when any table's move fails, collection or Single", async () => {
      await boot(dialect);
      const noteId = await writeNote();
      await seedHistory("collection", "notes", noteId);
      const mastheadId = await writeMasthead();
      await seedHistory("single", "masthead", mastheadId);
      await endpointFiltering(["notes"]);
      const unchanged = await snapshot();

      const renames = [
        ["collection", "notes", "journal"],
        ["single", "masthead", "header"],
      ] as const;
      const declared = [
        ...renamedSlugColumns().map(column => ({
          table: column.table,
          kinds: ["collection", "single"] as readonly RenamedEntityKind[],
        })),
        ...jsonSlugColumns().map(column => ({
          table: column.table,
          kinds: column.renames,
        })),
      ];
      for (const column of declared) {
        for (const [kind, from, to] of renames) {
          if (!column.kinds.includes(kind)) continue;
          const hits = { count: 0 };
          failWritesTo(column.table, hits);

          await expect(rename(kind, from, to)).rejects.toBeDefined();

          vi.restoreAllMocks();
          // The failure came from this table's write, not from anything
          // before it, and it took the registry and every table back.
          expect([column.table, kind, hits.count > 0]).toEqual([
            column.table,
            kind,
            true,
          ]);
          expect(await snapshot()).toBe(unchanged);
        }
      }
    }, 240_000);
  }
);
