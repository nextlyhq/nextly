/**
 * A save that changes nothing records no version, on the saves that are not
 * held as a working draft: an unpublished document, a history-only collection,
 * a Single, and each language of a translated document. A save that changes
 * a field records one, and so does a publish that changes nothing else.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The durable versions of one document, oldest first. */
async function versionsOf(entryId: string) {
  return (
    await current!.adapter.select<{
      entryId: string;
      versionNo: number | null;
      isAutosave: boolean | number;
      status: string;
      locale: string | null;
    }>("nextly_versions")
  )
    .filter(
      row =>
        row.entryId === entryId &&
        typeof row.versionNo === "number" &&
        !row.isAutosave
    )
    .sort((a, b) => (a.versionNo ?? 0) - (b.versionNo ?? 0));
}

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    collections: [
      // Status and drafts: a document never published saves to its live row.
      defineCollection({
        slug: "drafted",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
      // History only: no status, every save to the live row.
      defineCollection({
        slug: "logged",
        versions: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "translated",
        localized: true,
        versions: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({ slug: "byline", fields: [text({ name: "label" })] }),
    ],
    singles: [
      defineSingle({
        slug: "masthead",
        versions: true,
        fields: [
          text({ name: "heading" }),
          fieldGroup({ name: "byline", component: "byline" }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  const handler = current.getService("collectionsHandler");
  const create = async (
    collectionName: string,
    data: Record<string, unknown>,
    locale?: string
  ) => {
    const created = await handler.createEntry(
      { collectionName, overrideAccess: true, ...(locale ? { locale } : {}) },
      data
    );
    return (created.data as { id: string }).id;
  };
  const update = (
    collectionName: string,
    entryId: string,
    data: Record<string, unknown>,
    locale?: string
  ) =>
    handler.updateEntry(
      {
        collectionName,
        entryId,
        overrideAccess: true,
        ...(locale ? { locale } : {}),
      },
      data
    );
  return { create, update };
}

describe.each(getConfiguredTestDialects())(
  "a save that changes nothing (integration, %s)",
  dialect => {
    it("records no version for an unchanged save of an unpublished document, and one for a change", async () => {
      const t = await boot(dialect);
      const id = await t.create("drafted", { title: "a", status: "draft" });
      const before = (await versionsOf(id)).length;

      await t.update("drafted", id, { title: "a" });
      expect(await versionsOf(id)).toHaveLength(before);

      await t.update("drafted", id, { title: "b" });
      expect(await versionsOf(id)).toHaveLength(before + 1);
    });

    it("records no version for an unchanged save of a history-only collection, and one for a change", async () => {
      const t = await boot(dialect);
      const id = await t.create("logged", { title: "a" });
      const before = (await versionsOf(id)).length;

      await t.update("logged", id, { title: "a" });
      expect(await versionsOf(id)).toHaveLength(before);

      await t.update("logged", id, { title: "b" });
      expect(await versionsOf(id)).toHaveLength(before + 1);
    });

    it("records no version for an unchanged save of a Single, and one for a change", async () => {
      await boot(dialect);
      const singles = current!.getService("singleEntryService");
      await singles.update(
        "masthead",
        { heading: "a" },
        { overrideAccess: true }
      );
      const all = () =>
        current!.adapter
          .select<{
            scopeSlug: string;
            versionNo: number | null;
            isAutosave: boolean | number;
          }>("nextly_versions")
          .then(rows =>
            rows.filter(
              r =>
                r.scopeSlug === "masthead" &&
                typeof r.versionNo === "number" &&
                !r.isAutosave
            )
          );
      const before = (await all()).length;

      await singles.update(
        "masthead",
        { heading: "a" },
        { overrideAccess: true }
      );
      expect(await all()).toHaveLength(before);

      await singles.update(
        "masthead",
        { heading: "b" },
        { overrideAccess: true }
      );
      expect(await all()).toHaveLength(before + 1);
    });

    it("records no version for an unchanged save of a component, whenever it lands", async () => {
      await boot(dialect);
      const singles = current!.getService("singleEntryService");
      const save = (label: string) =>
        singles.update(
          "masthead",
          { heading: "a", byline: { label } },
          { overrideAccess: true }
        );
      const all = () =>
        current!.adapter
          .select<{
            scopeSlug: string;
            versionNo: number | null;
            isAutosave: boolean | number;
          }>("nextly_versions")
          .then(rows =>
            rows.filter(
              r =>
                r.scopeSlug === "masthead" &&
                typeof r.versionNo === "number" &&
                !r.isAutosave
            )
          );
      await save("by Ana");
      const before = (await all()).length;

      // A later second: the component's row is rewritten with new
      // timestamps, which are not content.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      await save("by Ana");
      expect(await all()).toHaveLength(before);

      await save("by Marta");
      expect(await all()).toHaveLength(before + 1);
    });

    it("compares a language's save with the document's newest version", async () => {
      const t = await boot(dialect);
      const id = await t.create("translated", { title: "hello" }, "en");
      await t.update("translated", id, { title: "hola" }, "es");
      const before = (await versionsOf(id)).length;

      // Unchanged in the language that holds the newest version: nothing.
      await t.update("translated", id, { title: "hola" }, "es");
      expect(await versionsOf(id)).toHaveLength(before);

      // Unchanged in another language is still recorded: its own newest
      // version can predate a change to the shared fields.
      await t.update("translated", id, { title: "hello" }, "en");
      expect(await versionsOf(id)).toHaveLength(before + 1);
      await t.update("translated", id, { title: "hello" }, "en");
      expect(await versionsOf(id)).toHaveLength(before + 1);

      // A change in one language records one version, in that language.
      await t.update("translated", id, { title: "buenas" }, "es");
      const after = await versionsOf(id);
      expect(after).toHaveLength(before + 2);
      expect(after[after.length - 1]?.locale).toBe("es");
    });

    it("records a publish that changes no field", async () => {
      const t = await boot(dialect);
      const id = await t.create("drafted", { title: "a", status: "draft" });
      const before = (await versionsOf(id)).length;

      await t.update("drafted", id, { title: "a", status: "published" });
      const after = await versionsOf(id);
      expect(after).toHaveLength(before + 1);
      expect(after[after.length - 1]?.status).toBe("published");
    });
  }
);
