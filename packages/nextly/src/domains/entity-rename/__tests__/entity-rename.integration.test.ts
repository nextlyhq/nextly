/**
 * A renamed collection or Single keeps its history, on every dialect: its
 * versions and working draft, its version pins, each person's "last looked
 * at" marker, its content events and their parts, its release membership, its
 * schema events, its activity feed and its archived translations all read
 * under the new slug, and nothing is left under the old one. Its document
 * locks and preview links end with the old name.
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
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
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
import {
  VersionsRepository,
  type VersionRef,
} from "../../versions/versions-repository";
import {
  renamedSlugColumns,
  SLUG_COLUMNS,
  type RenamedEntityKind,
} from "../slug-columns";

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
    const kindProperty = camel(column.kindColumn);
    const slugProperty = camel(column.slugColumn);
    counts[column.table] = rows.filter(
      row =>
        row[slugProperty] === slug &&
        column.kinds[kind].includes(
          (row[kindProperty] ?? null) as string | null
        )
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
 * Every row of the registries and of every declared table, in a stable order,
 * to compare a database before and after a refused rename.
 */
async function snapshot(): Promise<string> {
  const tables = [
    ...Object.values(REGISTRY),
    ...renamedSlugColumns().map(column => column.table),
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
 * schema event, an
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

    it("fails the whole rename when any table's move fails, collection or Single", async () => {
      await boot(dialect);
      const noteId = await writeNote();
      await seedHistory("collection", "notes", noteId);
      const mastheadId = await writeMasthead();
      await seedHistory("single", "masthead", mastheadId);
      const unchanged = await snapshot();

      const renames = [
        ["collection", "notes", "journal"],
        ["single", "masthead", "header"],
      ] as const;
      for (const column of renamedSlugColumns()) {
        for (const [kind, from, to] of renames) {
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
