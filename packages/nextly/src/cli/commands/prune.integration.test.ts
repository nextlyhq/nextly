import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { definePlugin } from "../../plugins/plugin-context";
import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { ensureI18nArchive } from "../../domains/i18n/migration/ensure-archive";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { nextlyI18nArchiveTables } from "../../schemas/nextly-i18n-archive";

import { countArchivedTranslations, runPrune } from "./prune";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const bootWithPluginCollection = async (slug: string) => {
  const plugin = definePlugin({
    name: "@t/prune",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [defineCollection({ slug, fields: [text({ name: "v" })] })],
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  return current.getService(
    "collectionRegistryService"
  ) as CollectionRegistryService;
};

describe("nextly prune (D14)", () => {
  it("an unapproved prune lists orphans and drops nothing", async () => {
    const registry = await bootWithPluginCollection("p2_prune_dry");

    const result = await runPrune({
      registry,
      adapter: current!.adapter,
      currentSlugs: [], // plugin removed → its collection is orphaned
      approve: async () => false,
    });

    expect(result.orphans).toContain("p2_prune_dry");
    expect(result.dropped).toEqual([]);
    // Retained — dry-run never drops.
    expect(await registry.getCollectionBySlug("p2_prune_dry")).not.toBeNull();
  });

  it("an approved prune drops the orphaned collection (metadata + physical table)", async () => {
    const registry = await bootWithPluginCollection("p2_prune_force");

    const result = await runPrune({
      registry,
      adapter: current!.adapter,
      currentSlugs: [],
      approve: async () => true,
    });

    expect(result.dropped).toContain("p2_prune_force");
    expect(await registry.getCollectionBySlug("p2_prune_force")).toBeNull();
  });
});

/** The insert and delete surface of a Drizzle handle, for the archive rows below. */
interface ArchiveWriteDb {
  insert(table: unknown): { values(rows: unknown): Promise<unknown> };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

describe.each(getConfiguredTestDialects())(
  "what prune lists of a collection's archived translations (%s)",
  dialect => {
    it("counts the collection's rows in the shared archive, and says when it cannot tell", async () => {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      const adapter = current.adapter;
      // The archive is shared by every entity, so this file's rows carry a
      // slug no other test uses, and are removed again below.
      const slug = `prune_count_${randomBytes(6).toString("hex")}`;
      await ensureI18nArchive(adapter, dialect);
      const { nextlyI18nArchive } = nextlyI18nArchiveTables(dialect);
      const db = adapter.getDrizzle<ArchiveWriteDb>();
      const row = (entityKind: string, entryId: string) => ({
        collection: slug,
        entityKind,
        entryId,
        locale: "fr",
        field: "title",
        value: "titre",
      });
      try {
        expect(await countArchivedTranslations(adapter, dialect, slug)).toBe(0);

        await db
          .insert(nextlyI18nArchive)
          .values([
            row("collection", "1"),
            row("collection", "2"),
            row("single", "3"),
          ]);
        // The collection's rows only: a Single of the same slug keeps its own.
        expect(await countArchivedTranslations(adapter, dialect, slug)).toBe(2);

        // A row of no known kind is labelled by the teardown and may go too.
        await db.insert(nextlyI18nArchive).values([row("unknown", "4")]);
        expect(
          await countArchivedTranslations(adapter, dialect, slug)
        ).toBeUndefined();
      } finally {
        await db
          .delete(nextlyI18nArchive)
          .where(eq(nextlyI18nArchive.collection, slug));
      }
    });
  }
);
