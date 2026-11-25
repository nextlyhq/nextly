/**
 * What changed in a translated field's source since its translation was made, and "Keep current":
 * who may ask, what each answer is, and that keeping a translation moves its record alone.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { apiKeyScope } from "../../../../auth/authenticated-scope";
import { defineCollection, defineSingle, text } from "../../../../config";
import { container } from "../../../../di/container";
import type { Nextly } from "../../../../direct-api/nextly";
import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { valueFingerprint } from "../../provenance/value-fingerprint";
import type { DocumentCaller, TranslatedDocument } from "../document-access";
import { keepCurrent, sourceChange } from "../source-review";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const notEnglish = ({ locale }: { locale?: string }) => locale !== "en";
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
          // Each rule told the language the field is read or written in.
          text({
            name: "hidden",
            localized: true,
            access: { read: () => false },
          }),
          text({
            name: "sourceHidden",
            localized: true,
            access: { read: notEnglish },
          }),
          text({
            name: "locked",
            localized: true,
            access: { update: notSpanish },
          }),
          // What a reader is shown is not what is stored.
          text({
            name: "masked",
            localized: true,
            hooks: { afterRead: [() => "***"] },
          }),
        ],
      }),
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title", localized: true })],
      }),
      // Its update rule admits no Spanish.
      defineCollection({
        slug: "guarded",
        localized: true,
        access: { update: notSpanish },
        fields: [text({ name: "title", localized: true })],
      }),
      // Read by nobody.
      defineCollection({
        slug: "secrets",
        localized: true,
        access: { read: () => false },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
      defineSingle({
        slug: "unwritten",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  const slugs = ["posts", "notes", "guarded", "secrets", "banner", "unwritten"];
  await userWhoMay(t, "ann", "read", slugs);
  await grantTo(t, "ann", "update", slugs);
  // May read, and change nothing.
  await userWhoMay(t, "ben", "read", slugs);
  return t;
}

const ANN: DocumentCaller = {
  user: { id: "ann", email: "ann@x.test", roles: [] },
};
const BEN: DocumentCaller = {
  user: { id: "ben", email: "ben@x.test", roles: [] },
};

const handler = () => container.get<CollectionsHandler>("collectionsHandler");

async function save(
  document: TranslatedDocument,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  if (document.kind === "single") {
    await t!.nextly.updateSingle({
      slug: document.slug,
      locale,
      data: { ...data, _overwrite: true },
    } as never);
    return;
  }
  const result = await handler().updateEntry(
    {
      collectionName: document.slug,
      entryId: document.id,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

async function entry(
  slug: string,
  data: Record<string, unknown>
): Promise<TranslatedDocument & { kind: "collection" }> {
  const created = (await t!.nextly.create({
    collection: slug,
    locale: "en",
    data,
  } as never)) as unknown as { item: { id: string } };
  return { kind: "collection", slug, id: created.item.id };
}

interface RecordRow {
  id: string;
  entryId: string;
  locale: string;
  partState: string;
  fieldPath: string;
  origin: string;
  engine: string | null;
  actorId: string | null;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** One field's records in Spanish, live before draft. */
async function recordsOf(field = "title"): Promise<RecordRow[]> {
  const rows = await t!.adapter.select<RecordRow>(
    "nextly_translation_provenance"
  );
  return rows
    .filter(row => row.locale === "es" && row.fieldPath === field)
    .sort((a, b) => b.partState.localeCompare(a.partState));
}

async function valuesKept(): Promise<unknown[]> {
  const rows = await t!.adapter.select<{ content: { value: unknown } }>(
    "nextly_translation_sources"
  );
  return rows.map(row => row.content.value);
}

/** The code a refusal carries. */
async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (NextlyError.is(error)) return error.code;
    throw error;
  }
  return "not refused";
}

const inSpanish = (field = "title") => ({ locale: "es", field });

/** A "Keep current" of what `sourceChange` shows `caller` of the field. */
async function keepShown(
  document: TranslatedDocument,
  caller: DocumentCaller = ANN,
  field = "title"
): Promise<void> {
  const shown = await sourceChange(document, caller, inSpanish(field));
  await keepCurrent(document, caller, {
    ...inSpanish(field),
    valueFingerprint: shown.valueFingerprint ?? "",
    sourceFingerprint: shown.sourceFingerprint ?? "",
  });
}

describe.each(getConfiguredTestDialects())(
  "what changed in a translated field's source (%s)",
  dialect => {
    it("is the source then and now, for an entry and for a Single", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      expect(await sourceChange(post, ANN, inSpanish())).toEqual({
        available: true,
        sourceLocale: "en",
        before: "Hi",
        after: "Hello",
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      });

      const banner = { kind: "single", slug: "banner" } as const;
      await save(banner, "en", { headline: "Sale" });
      await save(banner, "es", { headline: "Rebajas" });
      await save(banner, "en", { headline: "Big sale" });
      expect(
        await sourceChange(banner, ANN, inSpanish("headline"))
      ).toMatchObject({ available: true, before: "Sale", after: "Big sale" });
    });

    it("is of the language the value was made from", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "fr", { title: "Salut" });
      const french = await handler().getEntry({
        collectionName: "posts",
        entryId: post.id,
        locale: "fr",
        overrideAccess: true,
      });
      await save(post, "es", {
        title: "Salut",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "fr",
            sourceRevision: (french.data as Record<string, unknown>)._rev,
          },
        },
      });
      await save(post, "fr", { title: "Bonjour" });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: true,
        sourceLocale: "fr",
        before: "Salut",
        after: "Bonjour",
      });
    });

    it("tells a source that was empty from one that was not kept", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "en", { title: "" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const empty = await sourceChange(post, ANN, inSpanish());
      expect(empty).toMatchObject({
        available: true,
        before: "",
        after: "Hello",
      });

      await t!.adapter.delete("nextly_translation_sources", {
        and: [{ column: "fieldPath", op: "=", value: "title" }],
      });
      const lost = await sourceChange(post, ANN, inSpanish());
      expect(lost).toMatchObject({
        available: false,
        reason: "not-kept",
        sourceLocale: "en",
        after: "Hello",
      });
      expect(lost).not.toHaveProperty("before");
    });

    it("says why where there is nothing to show", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", {
        title: "Hi",
        _provenance: { title: { origin: "copy", sourceLocale: "en" } },
      });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: false,
        reason: "source-moved",
      });

      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "original" } },
      });
      const original = await sourceChange(post, ANN, inSpanish());
      expect(original).toMatchObject({ available: false, reason: "original" });
      // It has no source, so none is named and none is shown.
      expect(original).not.toHaveProperty("sourceLocale");
      expect(original).not.toHaveProperty("after");

      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "locale", op: "=", value: "es" }],
      });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: false,
        reason: "unknown-origin",
        sourceLocale: "en",
        after: "Hi",
        valueFingerprint: valueFingerprint("Hola"),
      });
    });

    it("is of the held draft where there is one", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola 2" });
      expect(await sourceChange(note, ANN, inSpanish())).toMatchObject({
        available: true,
        before: "Hello",
        valueFingerprint: valueFingerprint("Hola 2"),
      });
    });

    it("shows no older text where a hook changes what the reader sees of the source", async () => {
      await boot(dialect);
      const post = await entry("posts", { masked: "Secret one" });
      await save(post, "es", { masked: "Secreto" });
      await save(post, "en", { masked: "Secret two" });
      const change = await sourceChange(post, ANN, inSpanish("masked"));
      expect(change).toMatchObject({
        available: false,
        reason: "not-kept",
        after: "***",
      });
      expect(JSON.stringify(change)).not.toContain("Secret");
    });

    it("answers not found, the same, for a document or field the reader may not read", async () => {
      await boot(dialect);
      const post = await entry("posts", {
        title: "Hi",
        hidden: "Hi",
        sourceHidden: "Hi",
      });
      await save(post, "es", {
        title: "Hola",
        hidden: "Hola",
        sourceHidden: "Hola",
      });
      const secret = await entry("secrets", { title: "Hi" });
      await save(secret, "es", { title: "Hola" });

      for (const [document, field] of [
        [post, "hidden"],
        // Read in Spanish, and not in the language it was made from.
        [post, "sourceHidden"],
        [secret, "title"],
        [{ ...post, id: "00000000-0000-4000-8000-000000000000" }, "title"],
        [{ kind: "single", slug: "unwritten" }, "headline"],
      ] as [TranslatedDocument, string][]) {
        expect(
          await refusalOf(sourceChange(document, ANN, inSpanish(field))),
          `${document.slug}.${field}`
        ).toBe("NOT_FOUND");
      }
      // Asking gave the Single no document.
      expect(
        await t!.adapter.select("single_unwritten").catch(() => [])
      ).toEqual([]);
    });

    it("refuses a language or a field that has no translation, by name", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi", code: "c1" });
      for (const named of [
        { locale: "en", field: "title" },
        { locale: "xx", field: "title" },
        { locale: "es", field: "code" },
      ]) {
        expect(await refusalOf(sourceChange(post, ANN, named))).toBe(
          "VALIDATION_ERROR"
        );
      }
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "keeping a translation as it is (%s)",
  dialect => {
    it("points its record at the source as it is now, and moves nothing else", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(post, "en", { title: "Hello" });
      const [before] = await recordsOf();
      const read = async () =>
        (
          await handler().getEntry({
            collectionName: "posts",
            entryId: post.id,
            locale: "es",
            overrideAccess: true,
          })
        ).data as Record<string, unknown>;
      const document = await read();

      await keepShown(post);

      const [after] = await recordsOf();
      expect(after).toEqual({
        ...before,
        sourceFingerprint: valueFingerprint("Hello"),
      });
      // The text, the version and the time it was saved are as they were.
      expect(await read()).toEqual(document);
      // The new version is what it is now held to, and the old one is named by nothing.
      expect(await valuesKept()).toEqual(["Hello"]);
    });

    it("is answered again when asked again", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      await keepShown(post);
      // Nothing left to change, which MySQL counts as no row: not a record that moved.
      await keepShown(post);
      expect(await valuesKept()).toEqual(["Hello"]);
    });

    it("keeps a Single's", async () => {
      await boot(dialect);
      const banner = { kind: "single", slug: "banner" } as const;
      await save(banner, "en", { headline: "Sale" });
      await save(banner, "es", { headline: "Rebajas" });
      await save(banner, "en", { headline: "Big sale" });
      await keepShown(banner, ANN, "headline");
      expect((await recordsOf("headline"))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Big sale")
      );
    });

    it("marks the held draft's value, and leaves a different live one out of date", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      await save(note, "es", { title: "Hola 2" });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });

      await keepShown(note);
      expect(await recordsOf()).toEqual([
        expect.objectContaining({
          partState: "live",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
        expect.objectContaining({
          partState: "draft",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);
    });

    it("marks both where a held record describes the live value too", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      // A claim is recorded though the value is the live one.
      await save(note, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });
      expect(await recordsOf()).toHaveLength(2);

      await keepShown(note);
      expect((await recordsOf()).map(row => row.sourceFingerprint)).toEqual([
        valueFingerprint("Hello"),
        valueFingerprint("Hello"),
      ]);
    });

    it("gives a value with no record one, of unknown origin", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "fieldPath", op: "=", value: "title" }],
      });
      await keepShown(post);
      expect(await recordsOf()).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "unknown",
          actorId: null,
          valueFingerprint: valueFingerprint("Hola"),
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);
    });

    it("is refused once the translation or the source is no longer what was shown", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const shown = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      };

      await save(post, "en", { title: "Hello again" });
      expect(await refusalOf(keepCurrent(post, ANN, shown))).toBe("CONFLICT");
      await save(post, "en", { title: "Hello" });
      await save(post, "es", { title: "Buenas" });
      expect(await refusalOf(keepCurrent(post, ANN, shown))).toBe("CONFLICT");
    });

    it("is refused where there is nothing to review, or nothing to review it against", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      const asked = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hi"),
      };
      // No Spanish at all.
      expect(await refusalOf(keepCurrent(post, ANN, asked))).toBe(
        "VALIDATION_ERROR"
      );
      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "original" } },
      });
      expect(await refusalOf(keepCurrent(post, ANN, asked))).toBe(
        "VALIDATION_ERROR"
      );
    });

    it("is a signed-in person's act, whatever else a caller may do", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const asked = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      };
      const key = apiKeyScope([
        { slug: "read-posts", action: "read", resource: "posts" },
        { slug: "update-posts", action: "update", resource: "posts" },
      ]);
      for (const caller of [
        {},
        { overrideAccess: true },
        { ...ANN, overrideAccess: true },
        // A key whose maker is a person is the key.
        { ...ANN, authenticatedScope: key },
      ] as DocumentCaller[]) {
        expect(await refusalOf(keepCurrent(post, caller, asked))).toBe(
          "FORBIDDEN"
        );
      }
      expect((await recordsOf())[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
      // The control: the same request, made by the person.
      await keepCurrent(post, ANN, asked);
    });

    it("is asked through the Direct API as the person it names, and never as trusted code", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const { translations } = t!.nextly as unknown as Nextly;
      const named = { collection: "posts", id: post.id, ...inSpanish() };
      const shown = await translations.sourceChange(named);
      expect(shown).toMatchObject({ available: true, before: "Hi" });
      const asked = {
        ...named,
        valueFingerprint: shown.valueFingerprint ?? "",
        sourceFingerprint: shown.sourceFingerprint ?? "",
      };
      expect(await refusalOf(translations.keepCurrent(asked))).toBe(
        "FORBIDDEN"
      );
      expect(
        await translations.keepCurrent({
          ...asked,
          overrideAccess: false,
          user: { id: "ann" },
        })
      ).toMatchObject({ item: inSpanish() });
      expect((await recordsOf())[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hello")
      );
    });

    it("needs the right to change the field in the translation's language, and to read its source", async () => {
      await boot(dialect);
      const all = { title: "Hi", locked: "Hi", sourceHidden: "Hi" };
      const post = await entry("posts", all);
      await save(post, "es", {
        title: "Hola",
        locked: "Hola",
        sourceHidden: "Hola",
      });
      const guarded = await entry("guarded", { title: "Hi" });
      await save(guarded, "es", { title: "Hola" });
      const asked = (field: string) => ({
        ...inSpanish(field),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hi"),
      });

      // A field rule refuses the field, where a save would leave it out and succeed.
      expect(await refusalOf(keepCurrent(post, ANN, asked("locked")))).toBe(
        "FORBIDDEN"
      );
      // May read, and update nothing.
      expect(await refusalOf(keepCurrent(post, BEN, asked("title")))).toBe(
        "NOT_FOUND"
      );
      // The collection's own rule refuses this language alone.
      expect(await refusalOf(keepCurrent(guarded, ANN, asked("title")))).toBe(
        "NOT_FOUND"
      );
      expect(
        await refusalOf(keepCurrent(post, ANN, asked("sourceHidden")))
      ).toBe("NOT_FOUND");
      for (const field of ["title", "locked", "sourceHidden"]) {
        const rows = await recordsOf(field);
        expect(
          rows.every(row => row.sourceFingerprint === valueFingerprint("Hi"))
        ).toBe(true);
      }
    });
  }
);
