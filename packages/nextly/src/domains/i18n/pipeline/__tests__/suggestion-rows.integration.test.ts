/**
 * A deleted document's suggested translations go with it, on the delete's own transaction, through
 * both ways an entry is deleted: no other document's do, and a delete that is undone keeps them. A
 * suggested value reads back as it was stored: a null, an empty text and text that looks like JSON.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../../schemas/translation-suggestions";
import type { CollectionService } from "../../../collections/services/collection-service";
import { fieldUnit, unitKey } from "../unit-address";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function boot(dialect: TestDialect): Promise<void> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
  });
}

async function createPost(): Promise<string> {
  const created = (await t!.nextly.create({
    collection: "posts",
    locale: "en",
    data: { title: "Hi" },
  })) as unknown as { item: { id: string } };
  return created.item.id;
}

/** A suggestion for the title of entry `entryId` of `scopeSlug`; its id. */
async function suggest(
  entryId: string,
  over: { scopeSlug?: string; value?: unknown } = {}
): Promise<string> {
  const id = randomUUID();
  const { scopeSlug = "posts", value = "Hola" } = over;
  await t!.adapter.insert(TRANSLATION_SUGGESTIONS_TABLE, {
    id,
    scopeKind: "collection",
    scopeSlug,
    entryId,
    targetLocale: "es",
    sourceLocale: "en",
    fieldPath: "title",
    unitKey: unitKey(fieldUnit("title")),
    unitAddress: fieldUnit("title"),
    value: { value },
    origin: "machine",
    sourceFingerprint: "f",
    createdAt: new Date(),
  });
  return id;
}

async function suggestionIds(): Promise<string[]> {
  const rows = await t!.adapter.select<{ id: string }>(
    TRANSLATION_SUGGESTIONS_TABLE,
    { columns: ["id"] }
  );
  return rows.map(row => row.id).sort();
}

describe.each(getConfiguredTestDialects())(
  "suggested translations (%s)",
  dialect => {
    it("go with a deleted entry, and no other document's do", async () => {
      await boot(dialect);
      const [deleted, kept] = [await createPost(), await createPost()];
      await suggest(deleted);
      const others = [
        await suggest(kept),
        // Another collection's entry of the same id.
        await suggest(deleted, { scopeSlug: "pages" }),
      ].sort();

      await t!.nextly.delete({ collection: "posts", id: deleted });

      expect(await suggestionIds()).toEqual(others);
    });

    it("go with an entry deleted in a caller's transaction, and stay when it is undone", async () => {
      await boot(dialect);
      const [deleted, kept] = [await createPost(), await createPost()];
      const gone = await suggest(deleted);
      const stays = await suggest(kept);
      const service = container.get<CollectionService>("collectionService");
      const remove = (undo: boolean) =>
        service.withTransaction(async tx => {
          // Trusted server code, as a plugin's own write is by default.
          await service.deleteEntryInTransaction(tx, "posts", deleted, {
            overrideAccess: true,
          });
          if (undo) throw new Error("undone");
        });

      await expect(remove(true)).rejects.toThrow();
      expect(await suggestionIds()).toEqual([gone, stays].sort());

      await remove(false);
      expect(await suggestionIds()).toEqual([stays]);
    });

    it.each<[string, unknown]>([
      ["a null", null],
      ["an empty text", ""],
      ["text that reads as JSON", '{"a":1}'],
      ["a structure", { blocks: [{ text: "Hola" }] }],
    ])("read %s back as it was suggested", async (_what, value) => {
      await boot(dialect);
      await suggest("e1", { value });

      const [row] = await t!.adapter.select<{
        value: unknown;
        unitAddress: unknown;
      }>(TRANSLATION_SUGGESTIONS_TABLE);

      expect(row?.value).toEqual({ value });
      expect(row?.unitAddress).toEqual(fieldUnit("title"));
    });
  }
);
