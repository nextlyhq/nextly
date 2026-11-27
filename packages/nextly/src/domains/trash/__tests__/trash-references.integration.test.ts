/**
 * What a restore puts back beside the entry's own row, and what the trash
 * keeps out of sight.
 *
 * - Its field-group rows come back. A hidden field-group value is kept out
 *   of the trash's copy of the document, so the restore's webhook delivery
 *   never carries it. The deleted event is delivered at the delete, and the
 *   created event, marked as a restore, at the restore.
 * - Its pending edits (a working draft) and recovery points come back.
 * - A slug taken since is asked for again, whether or not its field says
 *   `unique`: the slug column is unique either way.
 * - A relation of its own whose target was deleted since comes back empty,
 *   and the restore says so, rather than failing on the target.
 * - Other entries' relations to it come back where they still hold nothing,
 *   never over a later edit.
 * - A title, or a taken value, of a field with its own read rule is never
 *   shown in the list or in a conflict.
 *
 * @module domains/trash/__tests__/trash-references.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors/nextly-error";
import { DASHBOARD_PINS_TABLE } from "../../../schemas/dashboard-pins/table-name";
import { TRASH_TABLE, type TrashedEntry } from "../../../schemas/trash";
import { VERSION_VIEWS_TABLE } from "../../../schemas/version-views";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { languageRevisionTable } from "../../schema/services/runtime-schema-generator";
import { runWebhookDrain } from "../../webhooks/drain-runner";
import type { WebhookEndpointRegistry } from "../../webhooks/endpoint-registry";
import {
  refreshEndpointPresence,
  resetWebhookActivation,
} from "../../webhooks/recording-activation";
import type { WebhookEvent } from "../../webhooks/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

perLanguageStorageSuite();

/** A restore's result, unwrapped from its mutation envelope. */
const restoreOf = async (
  t: TestNextly,
  args: Parameters<TestNextly["nextly"]["trash"]["restore"]>[0]
) => (await t.nextly.trash.restore(args)).item;

/** An emptying's result, unwrapped from its mutation envelope. */
const emptyOf = async (
  t: TestNextly,
  args?: Parameters<TestNextly["nextly"]["trash"]["empty"]>[0]
) => (await t.nextly.trash.empty(args)).item;

const TAGS = "trashref_tags";
const PAGES = "trashref_pages";
const NOTES = "trashref_notes";
const PRIVATE = "trashref_private";
const META = "trashref_meta";
// A Single relating to a page.
const FEATURED = "trashref_featured";
// A translated collection relating to a page, its relation kept per language.
const LNOTES = "trashref_lnotes";
// A collection without the Draft/Published lifecycle, with a field of its own
// named `status`.
const PLAIN = "trashref_plain";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetWebhookActivation();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: META,
        fields: [
          text({ name: "note" }),
          text({ name: "token", admin: { hidden: true } }),
          relationship({ name: "badge", relationTo: TAGS }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    singles: [
      defineSingle({
        slug: FEATURED,
        fields: [relationship({ name: "page", relationTo: PAGES })],
      }),
    ],
    collections: [
      defineCollection({
        slug: LNOTES,
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          relationship({ name: "page", relationTo: PAGES, localized: true }),
          // A field name of two words, kept in a column named apart from it.
          relationship({
            name: "mainPage",
            relationTo: PAGES,
            localized: true,
          }),
        ],
      }),
      defineCollection({ slug: TAGS, fields: [text({ name: "title" })] }),
      defineCollection({
        slug: PAGES,
        fields: [
          text({ name: "title" }),
          // A slug that does not say `unique`, kept on the entry's own row:
          // its column there is unique anyway.
          text({ name: "slug", localized: false }),
          fieldGroup({ name: "meta", component: META }),
          relationship({ name: "tag", relationTo: TAGS }),
          // A relation to core's own people, not to a collection.
          relationship({ name: "owner", relationTo: "users" }),
          // Field names of two words, each kept in a column named apart.
          relationship({ name: "leadTag", relationTo: TAGS }),
          text({ name: "shortCode", unique: true, localized: false }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        fields: [
          text({ name: "title" }),
          relationship({ name: "page", relationTo: PAGES }),
          relationship({ name: "featuredPage", relationTo: PAGES }),
        ],
      }),
      defineCollection({
        slug: PLAIN,
        fields: [
          text({ name: "title" }),
          text({ name: "status", localized: false }),
        ],
      }),
      defineCollection({
        slug: PRIVATE,
        fields: [
          text({ name: "title", access: { read: () => false } }),
          text({
            name: "slug",
            localized: false,
            access: { read: () => false },
          }),
        ],
      }),
    ],
  });
  return current;
}

async function make(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const made = await t.nextly.create({ collection, data });
  return String(made.item.id);
}

async function read(
  t: TestNextly,
  collection: string,
  id: string
): Promise<Record<string, unknown>> {
  return (await t.nextly.findByID({
    collection,
    id,
    depth: 0,
  })) as unknown as Record<string, unknown>;
}

/** The trash record of `id`, its stored rows parsed. */
async function trashed(t: TestNextly, id: string) {
  const [row] = await t.adapter.select<{
    label: string | null;
    stored: TrashedEntry | string;
  }>(TRASH_TABLE, {
    where: { and: [{ column: "itemId", op: "=", value: id }] },
  });
  return {
    label: row.label,
    stored: (typeof row.stored === "string"
      ? JSON.parse(row.stored)
      : row.stored) as TrashedEntry,
  };
}

/** An enabled endpoint taking every entry event, its secret kept as given. */
async function endpoint(t: TestNextly): Promise<void> {
  const now = new Date();
  await t.adapter.insert("nextly_webhooks", {
    id: "trashref-hook",
    name: "trashref-hook",
    url: "https://example.com/trashref",
    enabled: true,
    event_types: ["entry.created", "entry.deleted"],
    filter: null,
    headers: null,
    secret_hash: [`whsec_${Buffer.from("trashref").toString("base64")}`],
    secret_prefix: "whsec_",
    field_allowlist: null,
    created_by: null,
    created_at: now,
    updated_at: now,
  });
  (
    t.getService("webhookEndpointRegistry" as never) as WebhookEndpointRegistry
  ).invalidate();
  await refreshEndpointPresence();
}

/** Every event the endpoint is sent by a drain, as delivered. */
async function delivered(t: TestNextly): Promise<WebhookEvent[]> {
  const bodies: WebhookEvent[] = [];
  await runWebhookDrain(
    t.adapter as never,
    t.getService("webhookEndpointRegistry" as never) as WebhookEndpointRegistry,
    {
      transport: async (_url, options) => {
        bodies.push(JSON.parse(options.body) as WebhookEvent);
        return new Response("ok", { status: 200 });
      },
      decryptSecret: ciphertext => ciphertext,
      // A moment ahead: MySQL keeps a delivery's due time to the second,
      // rounding it up, so a delivery made this second is due by the next.
      now: () => new Date(Date.now() + 2000),
    }
  );
  return bodies;
}

/** A person, as the account tables keep one; their id. */
async function person(t: TestNextly, id: string): Promise<string> {
  const now = new Date();
  const db = t.adapter.getDrizzle() as unknown as {
    insert(table: unknown): { values(row: unknown): Promise<unknown> };
  };
  await db.insert(getDialectTables(t.adapter.dialect).users).values({
    id,
    email: `${id}@example.test`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** A reader's dashboard pin of, and "last looked at" marker on, `entryId`. */
async function pinAndMarker(
  t: TestNextly,
  userId: string,
  entryId: string
): Promise<void> {
  const now = new Date();
  await t.adapter.insert(DASHBOARD_PINS_TABLE, {
    id: randomUUID(),
    userId,
    targetType: "collection",
    targetSlug: PAGES,
    entryId,
    pinnedAt: now,
  });
  await t.adapter.insert(VERSION_VIEWS_TABLE, {
    id: randomUUID(),
    userId,
    scopeKind: "collection",
    scopeSlug: PAGES,
    entryId,
    part: null,
    viewKey: randomUUID(),
    versionNo: 1,
    previousVersionNo: null,
    viewedAt: now,
    visitStartedAt: now,
    createdAt: now,
  });
}

/** The readers whose pin, and whose marker, of `entryId` are there. */
async function readersOf(t: TestNextly, entryId: string) {
  const ids = async (table: string) =>
    (
      await t.adapter.select<{ userId: string }>(table, {
        where: { and: [{ column: "entryId", op: "=", value: entryId }] },
      })
    )
      .map(row => row.userId)
      .sort();
  return {
    pins: await ids(DASHBOARD_PINS_TABLE),
    markers: await ids(VERSION_VIEWS_TABLE),
  };
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  it("a batch delete moves each entry to the trash too", async () => {
    const t = await boot(dialect);
    const first = await make(t, PAGES, { title: "One", slug: "one" });
    const second = await make(t, PAGES, { title: "Two", slug: "two" });
    // A batch names its caller: here a super-admin.
    const admin = await superAdminUser(t, `admin-${randomUUID().slice(0, 8)}`);

    await (t.getService("collectionsHandler" as never) as CollectionsHandler)
      .getEntryService()
      .deleteEntries({ collectionName: PAGES, user: { id: admin } }, [
        first,
        second,
      ]);

    expect((await trashed(t, first)).label).toBe("One");
    expect((await trashed(t, second)).label).toBe("Two");
  });

  it("erasing a staff account clears its id and name from what it trashed, and only its own", async () => {
    const t = await boot(dialect);
    const leaving = await superAdminUser(
      t,
      `leaving-${randomUUID().slice(0, 8)}`
    );
    const staying = await superAdminUser(
      t,
      `staying-${randomUUID().slice(0, 8)}`
    );
    const byLeaving = await make(t, PAGES, { title: "A", slug: "by-leaving" });
    const byStaying = await make(t, PAGES, { title: "B", slug: "by-staying" });
    await t.nextly.delete({
      collection: PAGES,
      id: byLeaving,
      user: { id: leaving, name: "Leaving Person" },
    } as never);
    await t.nextly.delete({
      collection: PAGES,
      id: byStaying,
      user: { id: staying, name: "Staying Person" },
    } as never);
    const who = async (id: string) => {
      const [row] = await t.adapter.select<Record<string, unknown>>(
        TRASH_TABLE,
        { where: { and: [{ column: "itemId", op: "=", value: id }] } }
      );
      return {
        kind: row.trashedByKind,
        id: row.trashedById,
        name: row.trashedByName,
      };
    };
    expect(await who(byLeaving)).toEqual({
      kind: "user",
      id: leaving,
      name: "Leaving Person",
    });

    await t.nextly.users.delete({ id: leaving });

    expect(await who(byLeaving)).toEqual({
      kind: "user",
      id: null,
      name: null,
    });
    expect(await who(byStaying)).toEqual({
      kind: "user",
      id: staying,
      name: "Staying Person",
    });
  });

  it("puts back pins and markers of readers still there, and none of a reader deleted since", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Pinned", slug: "pinned" });
    const stays = await person(t, `stays-${randomUUID().slice(0, 8)}`);
    const leaves = await person(t, `leaves-${randomUUID().slice(0, 8)}`);
    await pinAndMarker(t, stays, id);
    await pinAndMarker(t, leaves, id);

    await t.nextly.delete({ collection: PAGES, id });
    expect(await readersOf(t, id)).toEqual({ pins: [], markers: [] });
    // The reader's account goes while the entry is in the trash.
    await t.adapter.delete("users", {
      and: [{ column: "id", op: "=", value: leaves }],
    });

    expect(await restoreOf(t, { id })).toMatchObject({
      restored: true,
    });
    expect(await readersOf(t, id)).toEqual({
      pins: [stays],
      markers: [stays],
    });
  });

  it("puts its field-group rows back, and never delivers a hidden field-group value", async () => {
    const t = await boot(dialect);
    await endpoint(t);
    const id = await make(t, PAGES, {
      title: "Grouped",
      slug: "grouped",
      meta: { note: "kept", token: "s3cret-token" },
    });
    await delivered(t);

    await t.nextly.delete({ collection: PAGES, id });
    const { stored } = await trashed(t, id);
    expect(JSON.stringify(stored.document)).not.toContain("s3cret-token");
    const atDelete = await delivered(t);
    expect(
      atDelete.filter(e => e.type === "entry.deleted" && e.resource.id === id)
    ).toHaveLength(1);

    await restoreOf(t, { id });

    expect(await read(t, PAGES, id)).toMatchObject({
      meta: expect.objectContaining({ note: "kept" }),
    });
    const atRestore = (await delivered(t)).filter(
      e => e.type === "entry.created" && e.resource.id === id
    );
    expect(atRestore).toHaveLength(1);
    expect(atRestore[0].restoredFrom).toBe("trash");
    expect(JSON.stringify(atRestore[0])).not.toContain("s3cret-token");
  });

  it("keeps a field named status as it was, on a collection without the publish lifecycle", async () => {
    const t = await boot(dialect);
    const id = await make(t, PLAIN, {
      title: "Own status",
      status: "published",
    });
    await t.nextly.delete({ collection: PLAIN, id });

    await restoreOf(t, { id });

    expect(await read(t, PLAIN, id)).toMatchObject({ status: "published" });
  });

  it("refuses, writing nothing, a stored column the table no longer has", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Drifted", slug: "drifted" });
    await t.nextly.delete({ collection: PAGES, id });
    // As a field dropped since the delete leaves it: the kept row names a
    // column the table does not have.
    const [row] = await t.adapter.select<{ id: string; stored: unknown }>(
      TRASH_TABLE,
      { where: { and: [{ column: "itemId", op: "=", value: id }] } }
    );
    const stored = (
      typeof row.stored === "string" ? JSON.parse(row.stored) : row.stored
    ) as TrashedEntry;
    stored.tables[0].rows[0].gone_field = { t: "value", v: "x" };
    await t.adapter.update(
      TRASH_TABLE,
      { stored },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );

    const refused = await restoreOf(t, { id }).then(
      () => "restored",
      (error: unknown) => (NextlyError.is(error) ? error.statusCode : error)
    );

    expect(refused).toBe(409);
    expect((await trashed(t, id)).label).toBe("Drifted");
    expect(
      await t.nextly
        .findByID({ collection: PAGES, id })
        .then(() => true)
        .catch(() => false)
    ).toBe(false);
  });

  it("puts back its pending edits and recovery points", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Live", slug: "live" });
    const version = (isAutosave: boolean, body: string) => ({
      id: randomUUID(),
      scopeKind: "collection",
      scopeSlug: PAGES,
      entryId: id,
      versionNo: null,
      status: "draft",
      isAutosave,
      snapshot: JSON.stringify({ title: body }),
      label: null,
      locale: null,
      sourceVersionNo: null,
      createdBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await t.adapter.insert(VERSIONS_TABLE, version(false, "pending edit"));
    await t.adapter.insert(VERSIONS_TABLE, version(true, "recovery point"));
    const kept = async () =>
      (
        await t.adapter.select<{ snapshot: unknown }>(VERSIONS_TABLE, {
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              { column: "versionNo", op: "IS NULL" },
            ],
          },
        })
      )
        .map(row => JSON.stringify(row.snapshot))
        .join(" ");

    await t.nextly.delete({ collection: PAGES, id });
    expect(await kept()).toBe("");

    await restoreOf(t, { id });

    expect(await kept()).toContain("pending edit");
    expect(await kept()).toContain("recovery point");
  });

  it("keeps the pending edits of an editor deleted since, and only their recovery points go", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Live", slug: "edited" });
    const editor = await person(t, `editor-${randomUUID().slice(0, 8)}`);
    const version = (isAutosave: boolean, body: string) => ({
      id: randomUUID(),
      scopeKind: "collection",
      scopeSlug: PAGES,
      entryId: id,
      versionNo: null,
      status: "draft",
      isAutosave,
      snapshot: JSON.stringify({ title: body }),
      label: null,
      locale: null,
      sourceVersionNo: null,
      createdBy: editor,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await t.adapter.insert(VERSIONS_TABLE, version(false, "pending edit"));
    await t.adapter.insert(VERSIONS_TABLE, version(true, "recovery point"));
    const kept = async () =>
      (
        await t.adapter.select<{ snapshot: unknown }>(VERSIONS_TABLE, {
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              { column: "versionNo", op: "IS NULL" },
            ],
          },
        })
      )
        .map(row => JSON.stringify(row.snapshot))
        .join(" ");

    await t.nextly.delete({ collection: PAGES, id });
    // The editor's account goes while the entry is in the trash.
    await t.adapter.delete("users", {
      and: [{ column: "id", op: "=", value: editor }],
    });
    await restoreOf(t, { id });

    expect(await kept()).toContain("pending edit");
    expect(await kept()).not.toContain("recovery point");
  });

  it("puts back each language's version counter, changer and change time as they were", async () => {
    const t = await boot(dialect);
    const id = await make(t, LNOTES, { title: "Eins" });
    for (const title of ["Zwei", "Drei"]) {
      await t.nextly.update({
        collection: LNOTES,
        id,
        data: { title, _overwrite: true },
      } as never);
    }
    const table = languageRevisionTable(
      t.adapter.dialect,
      `dc_${LNOTES}_locales`
    ) as Record<string, never>;
    const db = t.adapter.getDrizzle() as unknown as {
      select(): {
        from(table: unknown): {
          where(condition: unknown): Promise<Record<string, unknown>[]>;
        };
      };
    };
    const { eq } = await import("drizzle-orm");
    const counters = async () =>
      (await db.select().from(table).where(eq(table._parent, id))).map(row => ({
        locale: row._locale,
        revision: Number(row._revision),
        kind: row._changed_by_kind,
        by: row._changed_by_id,
        at: new Date(row._changed_at as string).getTime(),
      }));
    const before = await counters();
    expect(before.some(row => row.revision > 1)).toBe(true);

    await t.nextly.delete({ collection: LNOTES, id });
    await restoreOf(t, { id });

    expect(await counters()).toEqual(before);
  });

  it("asks again for a slug taken since, though its field does not say unique", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "First", slug: "same" });
    await t.nextly.delete({ collection: PAGES, id });
    await make(t, PAGES, { title: "Second", slug: "same" });

    expect(await restoreOf(t, { id })).toEqual({
      restored: false,
      conflicts: [{ field: "slug", value: "same" }],
    });
  });

  it("keeps a relation to a person who is still there, and refuses a restore naming both an id and a trash record", async () => {
    const t = await boot(dialect);
    const owner = await superAdminUser(t, `owner-${randomUUID().slice(0, 8)}`);
    const id = await make(t, PAGES, { title: "Owned", slug: "owned", owner });
    await t.nextly.delete({ collection: PAGES, id });
    const [record] = await t.adapter.select<{ id: string }>(TRASH_TABLE, {
      where: { and: [{ column: "itemId", op: "=", value: id }] },
    });

    const both = await restoreOf(t, { id, trashId: record.id }).then(
      () => "restored",
      (error: unknown) => (NextlyError.is(error) ? error.statusCode : error)
    );
    expect(both).toBe(400);

    const result = await restoreOf(t, { trashId: record.id });

    expect(result).toEqual({ restored: true, collection: PAGES, id });
    expect((await read(t, PAGES, id)).owner).toBe(owner);
  });

  it("puts back a Single's relation, and a translated relation, where they still hold nothing", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Featured", slug: "featured" });
    await t.nextly.updateSingle({
      slug: FEATURED,
      data: { page: id, _overwrite: true },
    } as never);
    const note = await make(t, LNOTES, { title: "Note", page: id });

    await t.nextly.delete({ collection: PAGES, id });
    // What a foreign key set to `set null` leaves, on the Single's row and on
    // the translated relation's row per language.
    await t.adapter.update(
      `single_${FEATURED}`,
      { page: null },
      {
        and: [{ column: "page", op: "=", value: id }],
      }
    );
    await t.adapter.update(
      `dc_${LNOTES}_locales`,
      { page: null },
      {
        and: [{ column: "_parent", op: "=", value: note }],
      }
    );

    await restoreOf(t, { id });

    const [single] = await t.adapter.select<{ page: unknown }>(
      `single_${FEATURED}`,
      {}
    );
    expect(single.page).toBe(id);
    const [language] = await t.adapter.select<{ page: unknown }>(
      `dc_${LNOTES}_locales`,
      { where: { and: [{ column: "_parent", op: "=", value: note }] } }
    );
    expect(language.page).toBe(id);
  });

  it("puts a field group's relation back empty where its target was deleted since", async () => {
    const t = await boot(dialect);
    const badge = await make(t, TAGS, { title: "Badge" });
    const id = await make(t, PAGES, {
      title: "Badged",
      slug: "badged",
      meta: { note: "n", badge },
    });
    await t.nextly.delete({ collection: PAGES, id });
    await t.nextly.delete({ collection: TAGS, id: badge });
    await emptyOf(t, { collection: TAGS });

    const result = await restoreOf(t, { id });

    expect(result).toMatchObject({
      restored: true,
      notPutBack: { relationsCleared: ["badge"] },
    });
  });

  it("leaves out a reference whose field is gone since, and an entry whose collection was made again", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Kept", slug: "kept" });
    await make(t, NOTES, { title: "Points", page: id });
    await t.nextly.delete({ collection: PAGES, id });
    const [row] = await t.adapter.select<{ id: string; stored: unknown }>(
      TRASH_TABLE,
      { where: { and: [{ column: "itemId", op: "=", value: id }] } }
    );
    const stored = (
      typeof row.stored === "string" ? JSON.parse(row.stored) : row.stored
    ) as TrashedEntry;
    const save = (next: TrashedEntry) =>
      t.adapter.update(
        TRASH_TABLE,
        { stored: next },
        {
          and: [{ column: "id", op: "=", value: row.id }],
        }
      );

    // A collection made again under the slug has another registry id.
    await save({ ...stored, collectionId: "another-collection" });
    const refused = await restoreOf(t, { id }).then(
      () => "restored",
      (error: unknown) => (NextlyError.is(error) ? error.statusCode : error)
    );
    expect(refused).toBe(409);

    // The note's field renamed since: its kept reference names a field the
    // collection no longer has.
    const incoming = (stored.incoming ?? []).map(kept =>
      kept.source === undefined
        ? kept
        : { ...kept, source: { ...kept.source, field: "renamed_since" } }
    );
    expect(incoming.length).toBeGreaterThan(0);
    await save({ ...stored, incoming });

    const result = await restoreOf(t, { id });

    expect(result).toMatchObject({
      restored: true,
      notPutBack: { links: 1 },
    });
  });

  it("puts a relation back empty where its target was deleted since, and says so", async () => {
    const t = await boot(dialect);
    const tag = await make(t, TAGS, { title: "Gone" });
    const id = await make(t, PAGES, { title: "Tagged", slug: "tagged", tag });
    await t.nextly.delete({ collection: PAGES, id });
    await t.nextly.delete({ collection: TAGS, id: tag });
    await emptyOf(t, { collection: TAGS });

    const result = await restoreOf(t, { id });

    expect(result).toMatchObject({
      restored: true,
      notPutBack: { links: 0, relationsCleared: ["tag"] },
    });
    expect((await read(t, PAGES, id)).tag ?? null).toBeNull();
  });

  it("puts back other entries' relations to it where they still hold nothing, never over a later edit", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Target", slug: "target" });
    const other = await make(t, PAGES, { title: "Other", slug: "other" });
    const cleared = await make(t, NOTES, { title: "Cleared", page: id });
    const edited = await make(t, NOTES, { title: "Edited", page: id });

    await t.nextly.delete({ collection: PAGES, id });
    // What a foreign key set to `set null` leaves, and a person's later
    // choice of another page.
    await t.adapter.update(
      `dc_${NOTES}`,
      { page: null },
      { and: [{ column: "id", op: "=", value: cleared }] }
    );
    await t.nextly.update({
      collection: NOTES,
      id: edited,
      data: { page: other, _overwrite: true },
    } as never);

    // The note edited since is left as it is, and counted.
    expect(await restoreOf(t, { id })).toMatchObject({
      restored: true,
      notPutBack: { links: 1 },
    });

    expect((await read(t, NOTES, cleared)).page).toBe(id);
    expect((await read(t, NOTES, edited)).page).toBe(other);
  });

  it("keeps and puts back relations whose column is named apart from their field", async () => {
    const t = await boot(dialect);
    const id = await make(t, PAGES, { title: "Lead", slug: "lead" });
    const note = await make(t, NOTES, { title: "Points", featuredPage: id });
    const translated = await make(t, LNOTES, { title: "Zeigt", mainPage: id });

    await t.nextly.delete({ collection: PAGES, id });
    const { stored } = await trashed(t, id);
    expect(stored.incoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "featured_page",
          ids: [note],
          source: expect.objectContaining({ field: "featuredPage" }),
        }),
        expect.objectContaining({
          column: "main_page",
          source: expect.objectContaining({ field: "mainPage" }),
        }),
      ])
    );
    // What a foreign key set to `set null` leaves.
    await t.adapter.update(
      `dc_${NOTES}`,
      { featuredPage: null },
      {
        and: [{ column: "id", op: "=", value: note }],
      }
    );
    await t.adapter.update(
      `dc_${LNOTES}_locales`,
      { main_page: null },
      {
        and: [{ column: "_parent", op: "=", value: translated }],
      }
    );

    expect(await restoreOf(t, { id })).toMatchObject({ restored: true });
    expect((await read(t, NOTES, note)).featuredPage).toBe(id);
    const [language] = await t.adapter.select<{ main_page: unknown }>(
      `dc_${LNOTES}_locales`,
      { where: { and: [{ column: "_parent", op: "=", value: translated }] } }
    );
    expect(language.main_page).toBe(id);
  });

  it("clears and asks again by a field whose column is named apart from it", async () => {
    const t = await boot(dialect);
    const tag = await make(t, TAGS, { title: "Lead tag" });
    const id = await make(t, PAGES, {
      title: "Coded",
      slug: "coded",
      leadTag: tag,
      shortCode: "sc-1",
    });
    await t.nextly.delete({ collection: PAGES, id });
    await t.nextly.delete({ collection: TAGS, id: tag });
    await emptyOf(t, { collection: TAGS });
    await make(t, PAGES, { title: "Took it", slug: "took", shortCode: "sc-1" });

    expect(await restoreOf(t, { id })).toEqual({
      restored: false,
      conflicts: [{ field: "shortCode", value: "sc-1" }],
    });
    expect(
      await restoreOf(t, { id, values: { shortCode: "sc-2" } })
    ).toMatchObject({
      restored: true,
      notPutBack: { relationsCleared: ["leadTag"] },
    });
    const back = await read(t, PAGES, id);
    expect(back.shortCode).toBe("sc-2");
    expect(back.leadTag ?? null).toBeNull();
  });

  it("never shows a title or a taken value behind a field read rule", async () => {
    const t = await boot(dialect);
    const id = await make(t, PRIVATE, { title: "Secret title", slug: "hid" });
    await t.nextly.delete({ collection: PRIVATE, id });
    await make(t, PRIVATE, { title: "Another", slug: "hid" });

    expect((await trashed(t, id)).label).toBeNull();
    const listed = await t.nextly.trash.list({ collection: PRIVATE });
    expect(JSON.stringify(listed.items)).not.toContain("Secret title");
    expect(await restoreOf(t, { id })).toEqual({
      restored: false,
      conflicts: [{ field: "slug" }],
    });
  });
});

describe.each(getConfiguredTestDialects())("many-to-many on %s", dialect => {
  const BTAGS = "trashref_btags";
  const BPOSTS = "trashref_bposts";

  /**
   * Two Schema Builder collections, posts linking tags through a junction,
   * made as development makes them; a tag, and a post linking it.
   */
  async function linked() {
    const t = await createTestNextly({ dialect });
    current = t;
    const handler = t.getService("collectionsHandler" as never) as unknown as {
      createCollection(data: Record<string, unknown>): Promise<{
        success: boolean;
      }>;
    };
    vi.stubEnv("NODE_ENV", "development");
    try {
      const made = [
        await handler.createCollection({
          name: BTAGS,
          label: "Tag",
          fields: [{ name: "label", type: "text" }],
        }),
        await handler.createCollection({
          name: BPOSTS,
          label: "Post",
          fields: [
            {
              name: "tags",
              type: "relationship",
              options: { relationType: "manyToMany", target: BTAGS },
            },
          ],
        }),
      ];
      expect(made.map(result => result.success)).toEqual([true, true]);
    } finally {
      vi.unstubAllEnvs();
    }
    const tag = String(
      (await t.nextly.create({ collection: BTAGS, data: { label: "kept" } }))
        .item.id
    );
    const post = String(
      (await t.nextly.create({ collection: BPOSTS, data: { tags: [tag] } }))
        .item.id
    );
    return { t, tag, post };
  }

  /** The ids of the tags `post` links, as a read gives them. */
  async function tagsOf(t: TestNextly, post: string): Promise<string[]> {
    const read = (await t.nextly.findByID({
      collection: BPOSTS,
      id: post,
      depth: 0,
    })) as unknown as { tags?: unknown[] };
    return (read.tags ?? []).map(tag =>
      typeof tag === "object" && tag !== null
        ? String((tag as { id: unknown }).id)
        : String(tag)
    );
  }

  it("puts back another entry's many-to-many link to the restored entry", async () => {
    const { t, tag, post } = await linked();
    expect(await tagsOf(t, post)).toEqual([tag]);

    // The junction's key removes the post's link with the tag.
    await t.nextly.delete({ collection: BTAGS, id: tag });
    expect(await tagsOf(t, post)).toEqual([]);

    await restoreOf(t, { id: tag });

    expect(await tagsOf(t, post)).toEqual([tag]);
  });

  it("puts back the restored entry's own many-to-many links", async () => {
    const { t, tag, post } = await linked();

    await t.nextly.delete({ collection: BPOSTS, id: post });
    await restoreOf(t, { id: post });

    expect(await tagsOf(t, post)).toEqual([tag]);
  });
});
