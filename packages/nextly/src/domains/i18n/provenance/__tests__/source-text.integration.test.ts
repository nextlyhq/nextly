/**
 * The source text a translation was made from is kept beside its record, for as long as a record
 * names it, and an unchanged value keeps the record it has.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  date,
  defineCollection,
  defineSingle,
  json,
  repeater,
  text,
} from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import {
  removeUntranslatedFieldSources,
  renameFieldSources,
} from "../removed-field-sources";
import { valueFingerprint } from "../value-fingerprint";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function boot(
  dialect: TestDialect,
  languages: string[] = ["en", "es", "fr"]
): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: languages, defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "summary", localized: true }),
        ],
      }),
      // Drafts: a save over a live language is held as its working draft.
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "summary", localized: true }),
        ],
      }),
      // Values a store reshapes: a date, and a JSON value.
      defineCollection({
        slug: "events",
        localized: true,
        fields: [
          date({ name: "startsOn", localized: true }),
          json({ name: "meta", localized: true }),
        ],
      }),
      // One structure in every language, each language's text beside it.
      defineCollection({
        slug: "menus",
        localized: true,
        fields: [
          repeater({ name: "items", fields: [text({ name: "label" })] }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  return t;
}

const handler = () => container.get<CollectionsHandler>("collectionsHandler");

/** A save of `data` in `locale`, as a person, or as an API key. */
async function save(
  id: string,
  locale: string,
  data: Record<string, unknown>,
  collectionName = "posts",
  apiKey?: string
): Promise<void> {
  const result = await handler().updateEntry(
    {
      collectionName,
      entryId: id,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
      ...(apiKey === undefined
        ? {}
        : { actor: { type: "apiKey" as const, id: apiKey } }),
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

async function create(
  collection: "posts" | "notes" | "events" | "menus",
  data: Record<string, unknown>
): Promise<string> {
  const created = (await t!.nextly.create({
    collection,
    locale: "en",
    data,
  })) as unknown as { item: { id: string } };
  return created.item.id;
}

/** An identifier as the dialect quotes it. */
function quoted(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** One version of a source's text, as it is kept. */
interface Kept {
  sourceLocale: string;
  fieldPath: string;
  fingerprint: string;
  content: { value: unknown };
}

/** The source text kept for one document, as the adapter reads it. */
async function keptOf(id: string): Promise<Kept[]> {
  const rows = await t!.adapter.select<Kept & { entryId: string }>(
    "nextly_translation_sources"
  );
  return rows
    .filter(row => row.entryId === id)
    .sort((a, b) =>
      `${a.fieldPath}${JSON.stringify(a.content)}`.localeCompare(
        `${b.fieldPath}${JSON.stringify(b.content)}`
      )
    );
}

/** The values kept for one field of a document, in order. */
async function valuesKept(id: string, field = "title"): Promise<unknown[]> {
  return (await keptOf(id))
    .filter(row => row.fieldPath === field)
    .map(row => row.content.value);
}

interface RecordRow {
  id: string;
  entryId: string;
  locale: string;
  partState: string;
  fieldPath: string;
  origin: string;
  engine: string | null;
  valueFingerprint: string;
  sourceFingerprint: string | null;
}

/** One field's records in a language, live before draft. */
async function recordsOf(
  id: string,
  locale: string,
  field = "title"
): Promise<RecordRow[]> {
  const rows = await t!.adapter.select<RecordRow>(
    "nextly_translation_provenance"
  );
  return rows
    .filter(
      row =>
        row.entryId === id && row.locale === locale && row.fieldPath === field
    )
    .sort((a, b) => b.partState.localeCompare(a.partState));
}

describe.each(getConfiguredTestDialects())(
  "the source text a translation was made from (%s)",
  dialect => {
    it("is kept as it was, wrapped, when the source is changed afterwards", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      await save(id, "es", { title: "Hola" });
      await save(id, "en", { title: "Hello" });

      expect(await keptOf(id)).toEqual([
        expect.objectContaining({
          sourceLocale: "en",
          fieldPath: "title",
          fingerprint: valueFingerprint("Hi"),
          content: { value: "Hi" },
        }),
      ]);
      // It is the version the translation's record names.
      expect((await recordsOf(id, "es"))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
    });

    it("is kept for a Single's translation too", async () => {
      await boot(dialect);
      const update = (locale: string, headline: string) =>
        t!.nextly.updateSingle({
          slug: "banner",
          locale,
          data: { headline, _overwrite: true },
        } as never);
      await update("en", "Hi");
      await update("es", "Hola");
      await update("en", "Hello");

      const rows = await t!.adapter.select<Kept & { scopeKind: string }>(
        "nextly_translation_sources"
      );
      expect(rows).toEqual([
        expect.objectContaining({
          scopeKind: "single",
          fieldPath: "headline",
          content: { value: "Hi" },
        }),
      ]);
    });

    it("is one row for every translation made from the same version", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "es", { title: "Hola" });
      await save(id, "fr", { title: "Salut" });
      expect(await valuesKept(id)).toEqual(["Hi"]);
    });

    it("goes once no translation names that version, and not before", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "es", { title: "Hola" });
      await save(id, "fr", { title: "Salut" });
      await save(id, "en", { title: "Hello" });

      // Spanish is made again from the new version: French still names the old one.
      await save(id, "es", { title: "Hola otra vez" });
      expect(await valuesKept(id)).toEqual(["Hello", "Hi"]);

      // A cleared translation is made from nothing.
      await save(id, "fr", { title: "" });
      expect(await valuesKept(id)).toEqual(["Hello"]);
    });

    it("is kept for a held draft, through its publish, and goes when the draft is discarded", async () => {
      await boot(dialect);
      const id = await create("notes", { title: "Hi" });
      await save(id, "en", { status: "published" }, "notes");
      await save(id, "es", { title: "Hola", status: "published" }, "notes");
      await save(id, "en", { title: "Hello" }, "notes");
      await save(id, "en", { status: "published" }, "notes");

      // Held: the draft is made from the new version, the live one still from the old.
      await save(id, "es", { title: "Hola 2" }, "notes");
      expect(await valuesKept(id)).toEqual(["Hello", "Hi"]);

      await handler().discardWorkingDraftCounted({
        collectionName: "notes",
        version: { _overwrite: true },
        entryId: id,
        locale: "es",
      });
      expect(await valuesKept(id)).toEqual(["Hi"]);

      await save(id, "es", { title: "Hola 3" }, "notes");
      await save(id, "es", { status: "published" }, "notes");
      // The live record the draft's took the place of was the last to name the old version.
      expect(await valuesKept(id)).toEqual(["Hello"]);
    });

    it("goes, with the record that named it, when a published draft cleared the translation", async () => {
      await boot(dialect);
      const id = await create("notes", { title: "Hi", summary: "Short" });
      await save(id, "en", { status: "published" }, "notes");
      await save(
        id,
        "es",
        { title: "Hola", summary: "Corto", status: "published" },
        "notes"
      );

      // Held: the live title is still the language's own until the draft is published.
      await save(id, "es", { title: "" }, "notes");
      expect((await recordsOf(id, "es")).map(row => row.partState)).toEqual([
        "live",
      ]);
      expect(await valuesKept(id)).toEqual(["Hi"]);

      await save(id, "es", { status: "published" }, "notes");
      // The language reads the title from another now, so nothing it was made from is kept.
      expect(await recordsOf(id, "es")).toEqual([]);
      expect(await valuesKept(id)).toEqual([]);
      // The field the draft left alone keeps both.
      expect(await recordsOf(id, "es", "summary")).toHaveLength(1);
      expect(await valuesKept(id, "summary")).toEqual(["Short"]);
    });

    it("keeps an empty source as empty, not as no source", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "en", { title: "" });
      await save(id, "es", { title: "Hola" });
      // One version, and it is the empty text in its wrapper: an unwrapped one is no text at all.
      expect((await keptOf(id)).map(row => row.content)).toEqual([
        { value: "" },
      ]);
    });

    it("keeps nothing for a copy whose source had moved, an original, or a value in the default language", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "en", { title: "Hello" });
      // A copy that names no version of its source can't be shown to be of the source as it is.
      await save(id, "es", {
        title: "Hello",
        _provenance: { title: { origin: "copy", sourceLocale: "en" } },
      });
      await save(id, "fr", {
        title: "Salut",
        _provenance: { title: { origin: "original" } },
      });
      expect(await keptOf(id)).toEqual([]);
    });

    it("keeps a value only where it reads back as it was written", async () => {
      await boot(dialect);
      const id = await create("events", {
        startsOn: "2026-01-01T00:00:00.000Z",
        meta: { b: 2, a: { d: [1, 2], c: null } },
      });
      await save(
        id,
        "es",
        { startsOn: "2026-01-01T00:00:00.000Z", meta: { hola: true } },
        "events"
      );
      const kept = await keptOf(id);
      // JSON reads back on every database, whatever order it keeps keys in.
      expect(kept.find(row => row.fieldPath === "meta")?.content.value).toEqual(
        { b: 2, a: { d: [1, 2], c: null } }
      );
      // A date may or may not: what is kept is the one recorded, or nothing.
      for (const row of kept) {
        const recorded = (await recordsOf(id, "es", row.fieldPath))[0];
        expect(row.fingerprint).toBe(recorded?.sourceFingerprint);
      }
    });

    it("keeps nothing where the stored source is not the one recorded", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      // Stored past every write that records it: the record still describes "Hi".
      await t!.adapter.executeQuery(
        `UPDATE ${quoted(dialect, "dc_posts_locales")} SET ${quoted(dialect, "title")} = 'Altered'`
      );
      await save(id, "es", { title: "Hola" });
      expect((await recordsOf(id, "es"))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
      expect(await keptOf(id)).toEqual([]);
    });

    it("keeps each text inside a container, and none for the container itself", async () => {
      await boot(dialect);
      const id = await create("menus", {
        items: [{ id: "r1", label: "Home" }],
      });
      await save(id, "es", { items: [{ id: "r1", label: "Inicio" }] }, "menus");
      expect(
        (await keptOf(id)).map(row => [row.fieldPath, row.content.value])
      ).toEqual([["items#r1.label", "Home"]]);
    });

    it("writes nothing on a site with one language", async () => {
      await boot(dialect, ["en"]);
      const id = await create("posts", { title: "Hi" });
      await save(id, "en", { title: "Hello" });
      expect(await keptOf(id)).toEqual([]);
    });

    it("goes with its document", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      const other = await create("posts", { title: "Hi" });
      await save(id, "es", { title: "Hola" });
      await save(other, "es", { title: "Hola" });

      await t!.nextly.delete({ collection: "posts", id });
      expect(await keptOf(id)).toEqual([]);
      expect(await valuesKept(other)).toEqual(["Hi"]);
    });

    it("goes when its field is no longer translated, and only that field's", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      await save(id, "es", { title: "Hola", summary: "Corto" });
      // Text kept for a field the collection no longer has, as a migration file that dropped it
      // leaves it.
      const [row] = await t!.adapter.select<Record<string, unknown>>(
        "nextly_translation_sources"
      );
      await t!.adapter.insert("nextly_translation_sources", {
        ...row,
        id: "gone-1",
        fieldPath: "subtitle",
      });

      await removeUntranslatedFieldSources(t!.adapter);
      expect((await keptOf(id)).map(kept => kept.fieldPath)).toEqual([
        "summary",
        "title",
      ]);
    });

    it("moves with its field's new name, and takes the place of what an earlier field left there", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      await save(id, "es", { title: "Hola", summary: "Corto" });
      const [title] = (
        await t!.adapter.select<Record<string, unknown>>(
          "nextly_translation_sources"
        )
      ).filter(row => row.fieldPath === "title");
      // The same version, left under the new name by a field that had it before.
      await t!.adapter.insert("nextly_translation_sources", {
        ...title,
        id: "left-1",
        fieldPath: "heading",
      });

      const rename = () =>
        renameFieldSources(
          t!.adapter,
          { scopeKind: "collection", scopeSlug: "posts" },
          { from: "title", to: "heading" }
        );
      await rename();
      expect(await valuesKept(id, "heading")).toEqual(["Hi"]);
      // Run again, as a save tried again does: what it moved stays.
      await rename();
      expect(await valuesKept(id, "heading")).toEqual(["Hi"]);
      expect(await valuesKept(id, "title")).toEqual([]);
      expect(await valuesKept(id, "summary")).toEqual(["Short"]);
    });

    it("records a source nothing had recorded when a translation is made from it", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      // A source written before origins were recorded: no row for English.
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "locale", op: "=", value: "en" }],
      });
      await save(id, "es", { title: "Hola" });

      expect(await recordsOf(id, "en")).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "unknown",
          valueFingerprint: valueFingerprint("Hi"),
        }),
      ]);
      // Only the source something was made from.
      expect(await recordsOf(id, "en", "summary")).toEqual([]);
      expect((await recordsOf(id, "es"))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
      expect(await valuesKept(id)).toEqual(["Hi"]);
    });

    it("saves as before while the table is not there yet", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await t!.adapter.executeQuery(
        `DROP TABLE ${quoted(dialect, "nextly_translation_sources")}`
      );
      await save(id, "es", { title: "Hola" });
      expect(await recordsOf(id, "es")).toHaveLength(1);
      // Deleting the document asks for the table too.
      await t!.nextly.delete({ collection: "posts", id });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a value a save leaves as it was (%s)",
  dialect => {
    it("keeps its origin, and stays out of date, when another field is saved with it", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      await save(id, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(id, "en", { title: "Hello" });

      // The whole language is sent, as an editor sends it; only the summary changed.
      await save(id, "es", { title: "Hola", summary: "Corto" });
      expect(await recordsOf(id, "es")).toEqual([
        expect.objectContaining({
          origin: "machine",
          engine: "deepl",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);
      // The changed one is recorded as the save's.
      expect(await recordsOf(id, "es", "summary")).toEqual([
        expect.objectContaining({ origin: "person" }),
      ]);
      expect(await valuesKept(id)).toEqual(["Hi"]);
    });

    it("is recorded where the save says where it came from", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "es", { title: "Hola" });
      await save(id, "en", { title: "Hello" });
      await save(id, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      expect(await recordsOf(id, "es")).toEqual([
        expect.objectContaining({
          origin: "machine",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);
    });

    it("is recorded when it did change", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await save(id, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(id, "es", { title: "Buenas" });
      expect(await recordsOf(id, "es")).toEqual([
        expect.objectContaining({ origin: "person", engine: null }),
      ]);
    });

    it("has no draft record of its own while the held value is the live one", async () => {
      await boot(dialect);
      const id = await create("notes", { title: "Hi", summary: "Short" });
      await save(id, "en", { status: "published" }, "notes");
      await save(
        id,
        "es",
        {
          title: "Hola",
          summary: "Corto",
          status: "published",
          _provenance: { title: { origin: "machine", engine: "deepl" } },
        },
        "notes"
      );

      // Held with the whole language sent: only the summary is a change.
      await save(id, "es", { title: "Hola", summary: "Corto 2" }, "notes");
      expect((await recordsOf(id, "es")).map(row => row.partState)).toEqual([
        "live",
      ]);
      expect(
        (await recordsOf(id, "es", "summary")).map(row => row.partState)
      ).toEqual(["live", "draft"]);

      // Changed in the draft, then back to the live value: the draft says nothing of it again.
      await save(id, "es", { title: "Otra" }, "notes");
      await save(id, "es", { title: "Hola" }, "notes");
      expect((await recordsOf(id, "es")).map(row => row.partState)).toEqual([
        "live",
      ]);

      await save(id, "es", { status: "published" }, "notes", "key-1");
      expect(await recordsOf(id, "es")).toEqual([
        expect.objectContaining({ origin: "machine", engine: "deepl" }),
      ]);
    });
  }
);
