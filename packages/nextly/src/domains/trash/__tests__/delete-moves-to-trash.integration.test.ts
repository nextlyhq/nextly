/**
 * A delete moves an entry to the trash rather than removing it: one trash
 * record keeps who deleted it and when, and every row it stored (its own row,
 * its row in each language, its field-group rows and theirs in each
 * language), while every read finds the entry gone.
 *
 * Run on per-language storage, as every installation stores languages, and
 * through each door a delete comes by: the Direct API, the entry service in
 * the caller's own transaction, and a plugin's collection service.
 *
 * @module domains/trash/__tests__/delete-moves-to-trash.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { definePlugin } from "../../../plugins/plugin-context";
import type { PluginRouteContext } from "../../../plugins/routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { TRASH_TABLE, type TrashedEntry } from "../../../schemas/trash";

perLanguageStorageSuite();

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
const POSTS = "trashmove_posts";
const SEO = "trashmove_seo";
// A collection the probe plugin contributes, not the site.
const PLUGIN_NOTES = "trashmove_plugin_notes";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };

/** The collection service a plugin is handed, kept from its `init`. */
let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "trashmove-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [
      defineCollection({
        slug: PLUGIN_NOTES,
        fields: [text({ name: "title" })],
      }),
    ],
  },
  init: ctx => {
    services = ctx.services.collections;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    localization: LANGUAGES,
    plugins: [probe],
    fieldGroups: [
      defineFieldGroup({
        slug: SEO,
        localized: true,
        fields: [text({ name: "metaTitle" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          fieldGroup({ name: "seo", component: SEO }),
        ],
      }),
    ],
  });
  return current;
}

/** An entry with an English and a German title and SEO title; its id. */
async function entryInTwoLanguages(t: TestNextly): Promise<string> {
  const made = await t.nextly.create({
    collection: POSTS,
    data: { title: "Hello", seo: { metaTitle: "Hello SEO" } },
  });
  const id = String(made.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "de",
    data: { title: "Hallo", seo: { metaTitle: "Hallo SEO" }, _overwrite: true },
  } as never);
  return id;
}

interface TrashRow {
  itemId: string;
  scopeSlug: string;
  kind: string;
  label: string | null;
  stored: TrashedEntry | string;
  trashedByKind: string | null;
  trashedAt: Date;
  purgeAt: Date;
}

/** The trash records of `id`, their stored rows parsed. */
async function trashOf(t: TestNextly, id: string) {
  const rows = await t.adapter.select<TrashRow>(TRASH_TABLE, {
    where: { and: [{ column: "itemId", op: "=", value: id }] },
  });
  return rows.map(row => ({
    ...row,
    stored: (typeof row.stored === "string"
      ? JSON.parse(row.stored)
      : row.stored) as TrashedEntry,
  }));
}

/** The languages a kept table's rows are in (`_locale`), sorted. */
function languagesKept(stored: TrashedEntry, table: string): string[] {
  const kept = stored.tables.find(t => t.table === table);
  return (kept?.rows ?? []).map(row => String(row._locale?.v)).sort();
}

/** Whether any read still finds `id`: by id, in a list, or in a count. */
async function readsFind(t: TestNextly, id: string) {
  const byId = await t.nextly
    .findByID({ collection: POSTS, id })
    .then(() => true)
    .catch(() => false);
  const listed = await t.nextly.find({
    collection: POSTS,
    where: { id: { equals: id } },
  });
  const counted = await t.nextly.count({
    collection: POSTS,
    where: { id: { equals: id } },
  });
  return { byId, listed: listed.items.length, counted: counted.total };
}

const entriesOf = (t: TestNextly) =>
  t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  it("a Direct API delete keeps every language and field-group row in one trash record, and every read finds the entry gone", async () => {
    const t = await boot(dialect);
    const id = await entryInTwoLanguages(t);
    const before = new Date();

    await t.nextly.delete({ collection: POSTS, id });

    expect(await readsFind(t, id)).toEqual({
      byId: false,
      listed: 0,
      counted: 0,
    });
    const [record, ...more] = await trashOf(t, id);
    expect(more).toHaveLength(0);
    expect(record).toMatchObject({
      kind: "entry",
      scopeSlug: POSTS,
      itemId: id,
      label: "Hello",
      trashedByKind: "system",
    });
    expect(new Date(record.trashedAt).getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000
    );
    // Thirty days after it was trashed, to the second.
    expect(
      new Date(record.purgeAt).getTime() - new Date(record.trashedAt).getTime()
    ).toBe(30 * 24 * 60 * 60 * 1000);

    const tables = record.stored.tables.map(kept => kept.table);
    // The entry's own row first, then its row in each language.
    expect(tables[0]).toBe(`dc_${POSTS}`);
    expect(languagesKept(record.stored, `dc_${POSTS}_locales`)).toEqual([
      "de",
      "en",
    ]);
    // Its field-group row, and that row in each language.
    const groupTable = tables.find(
      name =>
        name !== `dc_${POSTS}` &&
        !name.endsWith("_locales") &&
        !name.startsWith("nextly_")
    );
    expect(groupTable).toBeDefined();
    expect(languagesKept(record.stored, `${groupTable}_locales`)).toEqual([
      "de",
      "en",
    ]);
    // The document the deleted event carried.
    expect(record.stored.document).toMatchObject({ id, title: "Hello" });
  });

  it("a delete in the caller's own transaction, and a plugin service's, go to the trash too", async () => {
    const t = await boot(dialect);
    const inTransaction = await entryInTwoLanguages(t);
    const byPlugin = await entryInTwoLanguages(t);

    const result = await t.adapter.transaction(tx =>
      entriesOf(t).deleteEntryInTransaction(tx, {
        collectionName: POSTS,
        entryId: inTransaction,
        overrideAccess: true,
      })
    );
    expect(result.success).toBe(true);
    await services!.deleteEntry(POSTS, byPlugin, { as: "system" } as never);

    for (const id of [inTransaction, byPlugin]) {
      expect((await readsFind(t, id)).listed).toBe(0);
      const [record] = await trashOf(t, id);
      expect(record?.itemId).toBe(id);
      expect(languagesKept(record.stored, `dc_${POSTS}_locales`)).toEqual([
        "de",
        "en",
      ]);
    }
  });

  it("an entry of a plugin's own collection goes to the trash too", async () => {
    const t = await boot(dialect);
    const made = await t.nextly.create({
      collection: PLUGIN_NOTES,
      data: { title: "A plugin's note" },
    });
    const id = String(made.item.id);

    await t.nextly.delete({ collection: PLUGIN_NOTES, id });

    const listed = await t.nextly.find({
      collection: PLUGIN_NOTES,
      where: { id: { equals: id } },
    });
    expect(listed.items).toHaveLength(0);
    const [record] = await trashOf(t, id);
    expect(record).toMatchObject({
      scopeSlug: PLUGIN_NOTES,
      itemId: id,
      label: "A plugin's note",
    });
  });
});
