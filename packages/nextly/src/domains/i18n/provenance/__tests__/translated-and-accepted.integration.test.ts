/**
 * Two ways a save says what its value was made from. A body may say it was translated from a
 * language it names: recorded as its writer's, made from that language as it was shown, and
 * refused of a source that is not one. Server code may say the save accepts a suggestion: recorded
 * as the suggestion's, made from the source it was suggested from whatever that holds now, with
 * what accepting it does beside the save in the save's own transaction.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../../config";
import { container } from "../../../../di/container";
import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SOURCE_FINGERPRINT_MOVED } from "../../../../schemas/translation-provenance";
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../../schemas/translation-suggestions";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
import { VersionConflictError } from "../../../versions/version-conflict";
import type { LocaleTranslationMeta } from "../../companion-join";
import type { SuggestionAcceptance } from "../../pipeline/acceptance";
import { fieldUnit, unitKey } from "../../pipeline/unit-address";
import type { SuggestionClaim } from "../provenance-claims";
import { valueFingerprint } from "../value-fingerprint";

let t: TestNextly | undefined;
/** How often a save of `posts` or of `banner` reached its hooks. */
let hookCalls = 0;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const countsSaves = {
  beforeChange: [
    ({ data }: { data?: unknown }) => {
      hookCalls += 1;
      return data as never;
    },
  ],
};

async function boot(dialect: TestDialect): Promise<void> {
  hookCalls = 0;
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        hooks: countsSaves,
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
        fields: [text({ name: "title", localized: true })],
      }),
      // Its Spanish is read by trusted code alone.
      defineCollection({
        slug: "guarded",
        localized: true,
        fields: [
          text({
            name: "title",
            localized: true,
            access: {
              read: ({ locale }: { locale?: string }) => locale !== "es",
            },
          }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        localized: true,
        hooks: countsSaves,
        fields: [text({ name: "headline", localized: true })],
      }),
      defineSingle({
        slug: "ticker",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
}

const handler = () => container.get<CollectionsHandler>("collectionsHandler");
const singles = () => container.get<SingleEntryService>("singleEntryService");

interface SaveAs {
  apiKey?: string;
  acceptance?: SuggestionAcceptance;
}

/** A trusted save of an entry in `locale`, by Ann or by an API key. */
function saveEntry(
  collectionName: string,
  entryId: string,
  locale: string,
  data: Record<string, unknown>,
  as: SaveAs = {}
) {
  return handler().updateEntry(
    {
      collectionName,
      entryId,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
      ...(as.apiKey === undefined
        ? {}
        : { actor: { type: "apiKey" as const, id: as.apiKey } }),
      ...(as.acceptance === undefined ? {} : { acceptance: as.acceptance }),
    },
    { ...data, _overwrite: true }
  );
}

const savePost = (
  id: string,
  locale: string,
  data: Record<string, unknown>,
  as?: SaveAs
) => saveEntry("posts", id, locale, data, as);

/** A trusted save of a Single in `locale`. */
function saveSingle(
  slug: string,
  locale: string,
  data: Record<string, unknown>,
  acceptance?: SuggestionAcceptance
) {
  return singles().update(
    slug,
    { ...data, _overwrite: true },
    {
      overrideAccess: true,
      locale,
      user: { id: "ann" },
      ...(acceptance === undefined ? {} : { acceptance }),
    }
  );
}

async function create(
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = (await t!.nextly.create({
    collection,
    locale: "en",
    data,
  } as never)) as unknown as { item: { id: string } };
  return created.item.id;
}

/** A save that has to succeed, for a test to stand on. */
async function saved(
  save: Promise<{ success: boolean; statusCode: number; message?: string }>
): Promise<void> {
  expect(await save).toMatchObject({ success: true });
}

/** A post in English and Spanish, its Spanish up to date. */
async function translatedPost(): Promise<string> {
  const id = await create("posts", { title: "Hi", summary: "Short" });
  await saved(savePost(id, "es", { title: "Hola", summary: "Corto" }));
  return id;
}

interface Row {
  scopeSlug: string;
  entryId: string;
  locale: string;
  partState: string;
  fieldPath: string;
  valueFingerprint: string;
  origin: string;
  engine: string | null;
  actorKind: string | null;
  actorId: string | null;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

const PROVENANCE = "nextly_translation_provenance";

/** A language's records in a collection or Single, live before draft. */
async function recordsOf(scopeSlug: string, locale: string): Promise<Row[]> {
  const rows = await t!.adapter.select<Row>(PROVENANCE);
  return rows
    .filter(row => row.scopeSlug === scopeSlug && row.locale === locale)
    .sort((a, b) => b.partState.localeCompare(a.partState));
}

/** A post's record of its title in one language. */
async function titleIn(locale: string): Promise<Row | undefined> {
  return (await recordsOf("posts", locale)).find(
    row => row.fieldPath === "title"
  );
}

/** Whether a post's title in one language reads as out of date. */
async function outOfDateIn(
  id: string,
  locale: string
): Promise<boolean | undefined> {
  const read = await handler().getEntry({
    collectionName: "posts",
    entryId: id,
    translationStatus: true,
    overrideAccess: true,
  });
  const overview = (read.data as Record<string, unknown>)
    ._translations as Record<string, LocaleTranslationMeta>;
  return overview[locale]?.fields?.title?.outOfDate;
}

/** A post's own title in one language, with none filled from another. */
async function ownTitleIn(id: string, locale: string): Promise<unknown> {
  const read = await handler().getEntry({
    collectionName: "posts",
    entryId: id,
    locale,
    fallbackLocale: false,
    overrideAccess: true,
  });
  return (read.data as Record<string, unknown>).title ?? null;
}

/** The claim that a value was translated from Spanish. */
const fromSpanish = (sourceFingerprint?: string) => ({
  origin: "translated",
  sourceLocale: "es",
  ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
});

const NOT_ELIGIBLE = {
  success: false,
  statusCode: 400,
  errors: [expect.objectContaining({ code: "PROVENANCE_SOURCE_NOT_ELIGIBLE" })],
};

/** A machine's suggestion, made from the English `source`. */
const suggested = (
  source: string,
  over: Partial<SuggestionClaim> = {}
): SuggestionClaim => ({
  origin: "suggestion",
  made: "machine",
  engine: "e1",
  sourceLocale: "en",
  sourceFingerprint: valueFingerprint(source),
  ...over,
});

/** Accepting a suggestion for one field, and how often the save ran what it does. */
function accepting(
  field: string,
  claim: SuggestionClaim,
  work?: SuggestionAcceptance["onWritten"]
): SuggestionAcceptance & { runs: () => number } {
  let runs = 0;
  return {
    claims: { [field]: claim },
    onWritten: async tx => {
      runs += 1;
      await work?.(tx);
    },
    runs: () => runs,
  };
}

/** A suggestion's row, for the title of a post in French, made from the English `source`. */
async function suggest(entryId: string, source: string): Promise<string> {
  const id = randomUUID();
  await t!.adapter.insert(TRANSLATION_SUGGESTIONS_TABLE, {
    id,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    targetLocale: "fr",
    sourceLocale: "en",
    fieldPath: "title",
    unitKey: unitKey(fieldUnit("title")),
    unitAddress: fieldUnit("title"),
    value: { value: "Salut" },
    origin: "machine",
    engine: "e1",
    sourceFingerprint: valueFingerprint(source),
    createdAt: new Date(),
  });
  return id;
}

async function suggestionIds(): Promise<string[]> {
  const rows = await t!.adapter.select<{ id: string }>(
    TRANSLATION_SUGGESTIONS_TABLE,
    { columns: ["id"] }
  );
  return rows.map(row => row.id);
}

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

describe.each(getConfiguredTestDialects())(
  "a value translated from a language (%s)",
  dialect => {
    // Broken by recording the claim's own origin, or the default language as its source.
    it("is its writer's, made from the language it names as that now stands", async () => {
      await boot(dialect);
      const id = await translatedPost();
      const claim = {
        title: "Salut",
        _provenance: { title: fromSpanish(valueFingerprint("Hola")) },
      };
      await saved(savePost(id, "fr", claim));
      expect(await titleIn("fr")).toMatchObject({
        origin: "person",
        engine: null,
        actorKind: "user",
        actorId: "ann",
        sourceLocale: "es",
        sourceFingerprint: valueFingerprint("Hola"),
      });
      expect(await outOfDateIn(id, "fr")).toBe(false);

      await saved(savePost(id, "fr", claim, { apiKey: "key-1" }));
      expect(await titleIn("fr")).toMatchObject({
        origin: "integration",
        actorKind: "apiKey",
        sourceLocale: "es",
      });

      // It follows Spanish, the language it was made from.
      await saved(savePost(id, "es", { title: "Buenas" }));
      expect(await outOfDateIn(id, "fr")).toBe(true);
    });

    // Broken by not comparing the fingerprint, and by refusing a claim with none.
    it("is out of date at once where its source is no longer the one it names, and takes the live one where it names none", async () => {
      await boot(dialect);
      const id = await translatedPost();
      await saved(
        savePost(id, "fr", {
          title: "Salut",
          _provenance: { title: fromSpanish(valueFingerprint("Buenas")) },
        })
      );
      expect(await titleIn("fr")).toMatchObject({
        sourceLocale: "es",
        sourceFingerprint: SOURCE_FINGERPRINT_MOVED,
      });
      expect(await outOfDateIn(id, "fr")).toBe(true);

      await saved(
        savePost(id, "fr", {
          title: "Coucou",
          _provenance: { title: fromSpanish() },
        })
      );
      expect(await titleIn("fr")).toMatchObject({
        sourceLocale: "es",
        sourceFingerprint: valueFingerprint("Hola"),
      });
      expect(await outOfDateIn(id, "fr")).toBe(false);
    });

    // Broken by reading a claim of the default language as none, which is always up to date.
    it("names the default language by the version shown, as it names any other", async () => {
      await boot(dialect);
      const id = await translatedPost();
      const fromEnglish = (shown: string) => ({
        title: {
          origin: "translated" as const,
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint(shown),
        },
      });
      await saved(
        savePost(id, "fr", {
          title: "Salut",
          _provenance: fromEnglish("Hello"),
        })
      );
      expect(await titleIn("fr")).toMatchObject({
        origin: "person",
        sourceLocale: "en",
        sourceFingerprint: SOURCE_FINGERPRINT_MOVED,
      });
      expect(await outOfDateIn(id, "fr")).toBe(true);

      await saved(
        savePost(id, "fr", { title: "Coucou", _provenance: fromEnglish("Hi") })
      );
      expect(await titleIn("fr")).toMatchObject({
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
      });
      expect(await outOfDateIn(id, "fr")).toBe(false);
    });

    // Broken by treating any of these as a translation from the language beside it.
    it("leaves a copy, a machine's and a value with no claim as they are recorded", async () => {
      await boot(dialect);
      const id = await translatedPost();
      await saved(savePost(id, "fr", { title: "Un" }));
      expect(await titleIn("fr")).toMatchObject({
        origin: "person",
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
      });
      await saved(
        savePost(id, "fr", {
          title: "Deux",
          _provenance: { title: { origin: "machine", engine: "deepl" } },
        })
      );
      expect(await titleIn("fr")).toMatchObject({
        origin: "machine",
        engine: "deepl",
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
      });
      await saved(
        savePost(id, "fr", {
          title: "Hola",
          _provenance: { title: { origin: "copy", sourceLocale: "es" } },
        })
      );
      expect(await titleIn("fr")).toMatchObject({
        origin: "copy",
        sourceLocale: "es",
        sourceFingerprint: SOURCE_FINGERPRINT_MOVED,
      });
    });

    // Broken by not asking, or by asking after the hooks.
    it("is refused, before any hook, of a source that has no text of its own or is out of date", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      const claim = { title: "Salut", _provenance: { title: fromSpanish() } };
      const before = hookCalls;
      expect(await savePost(id, "fr", claim)).toMatchObject(NOT_ELIGIBLE);
      expect(hookCalls).toBe(before);
      expect(await titleIn("fr")).toBeUndefined();

      await saved(savePost(id, "es", { title: "Hola" }));
      await saved(savePost(id, "en", { title: "Hello" }));
      expect(await savePost(id, "fr", claim)).toMatchObject(NOT_ELIGIBLE);
      expect(await ownTitleIn(id, "fr")).toBeNull();

      // Spanish made again: the same save is written, through its hooks.
      await saved(savePost(id, "es", { title: "Buenas" }));
      const asked = hookCalls;
      await saved(savePost(id, "fr", claim));
      expect(hookCalls).toBeGreaterThan(asked);
      expect(await titleIn("fr")).toMatchObject({ sourceLocale: "es" });
    });

    it("is refused of a source that is not published", async () => {
      await boot(dialect);
      const id = await create("notes", { title: "Hi" });
      await saved(saveEntry("notes", id, "en", { status: "published" }));
      await saved(
        saveEntry("notes", id, "es", { title: "Hola", status: "published" })
      );
      const claim = (title: string) =>
        saveEntry("notes", id, "fr", {
          title,
          _provenance: { title: fromSpanish() },
        });
      await saved(claim("Salut"));
      await saved(saveEntry("notes", id, "es", { status: "draft" }));
      expect(await claim("Coucou")).toMatchObject(NOT_ELIGIBLE);
    });

    // Broken by asking as trusted code whoever saves.
    it("is refused of a source the caller may not read, which trusted code may name", async () => {
      await boot(dialect);
      await userWhoMay(t!, "ann", "read", ["guarded"]);
      await grantTo(t!, "ann", "update", ["guarded"]);
      const id = await create("guarded", { title: "Hi" });
      await saved(saveEntry("guarded", id, "es", { title: "Hola" }));
      const read = await handler().getEntry({
        collectionName: "guarded",
        entryId: id,
        locale: "fr",
        overrideAccess: true,
      });
      const { _rev } = read.data as Record<string, unknown>;
      const claim = { title: "Salut", _provenance: { title: fromSpanish() } };
      const asAnn = (body: Record<string, unknown>) =>
        handler().updateEntry(
          {
            collectionName: "guarded",
            entryId: id,
            overrideAccess: false,
            locale: "fr",
            user: { id: "ann", email: "ann@x.test", roles: [] },
          },
          { ...body, _rev }
        );
      expect(await asAnn(claim)).toMatchObject(NOT_ELIGIBLE);
      expect(await recordsOf("guarded", "fr")).toEqual([]);
      // Hers to change all the same, and English hers to translate from.
      await saved(
        asAnn({
          title: "Salut",
          _provenance: {
            title: { origin: "translated", sourceLocale: "en" },
          },
        })
      );

      await saved(saveEntry("guarded", id, "fr", claim));
      expect(await recordsOf("guarded", "fr")).toEqual([
        expect.objectContaining({ sourceLocale: "es" }),
      ]);
    });

    // Broken by asking of the default language, whose own text is made from none.
    it("is not asked of a save in the default language, where no claim is kept", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await saved(
        savePost(id, "en", {
          title: "Hello",
          _provenance: { title: fromSpanish() },
        })
      );
      expect(await titleIn("en")).toMatchObject({
        origin: "original",
        sourceLocale: null,
      });
    });

    // Broken by keeping the claim of a create.
    it("is refused of an entry that is not there yet", async () => {
      await boot(dialect);
      const creating = (claim: Record<string, unknown>) =>
        handler().createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "fr" },
          { title: "Salut", _provenance: { title: claim } }
        );
      const before = hookCalls;
      expect(await creating(fromSpanish())).toMatchObject(NOT_ELIGIBLE);
      expect(hookCalls).toBe(before);
      expect(await recordsOf("posts", "fr")).toEqual([]);

      expect(
        await creating({ origin: "machine", engine: "deepl" })
      ).toMatchObject({ success: true });
      expect(await titleIn("fr")).toMatchObject({ origin: "machine" });
    });

    // Broken by asking of collections alone.
    it("is asked of a Single's save the same, with a document or with none", async () => {
      await boot(dialect);
      const claim = {
        headline: "Soldes",
        _provenance: { headline: fromSpanish() },
      };
      expect(await saveSingle("banner", "fr", claim)).toMatchObject(
        NOT_ELIGIBLE
      );
      expect(await t!.adapter.select("single_banner").catch(() => [])).toEqual(
        []
      );

      await saved(saveSingle("banner", "en", { headline: "Sale" }));
      const before = hookCalls;
      expect(await saveSingle("banner", "fr", claim)).toMatchObject(
        NOT_ELIGIBLE
      );
      expect(hookCalls).toBe(before);
      expect(await recordsOf("banner", "fr")).toEqual([]);

      await saved(saveSingle("banner", "es", { headline: "Rebajas" }));
      await saved(saveSingle("banner", "fr", claim));
      expect(await recordsOf("banner", "fr")).toEqual([
        expect.objectContaining({
          origin: "person",
          sourceLocale: "es",
          sourceFingerprint: valueFingerprint("Rebajas"),
        }),
      ]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a save that accepts a suggestion (%s)",
  dialect => {
    // Broken by dropping the option anywhere on its way, or the pin of the source.
    it("is recorded as the suggestion's, made from the source it was suggested from", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      const upToDate = accepting("title", suggested("Hi"));
      await saved(
        savePost(id, "es", { title: "Hola" }, { acceptance: upToDate })
      );
      expect(await titleIn("es")).toMatchObject({
        origin: "machine",
        engine: "e1",
        actorKind: "user",
        actorId: "ann",
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
      });
      expect(await outOfDateIn(id, "es")).toBe(false);
      expect(upToDate.runs()).toBe(1);

      // Suggested from "Hi", and accepted once English says something else.
      await saved(savePost(id, "en", { title: "Hello" }));
      await saved(
        savePost(
          id,
          "fr",
          { title: "Salut" },
          { acceptance: accepting("title", suggested("Hi")) }
        )
      );
      expect(await titleIn("fr")).toMatchObject({
        origin: "machine",
        sourceFingerprint: valueFingerprint("Hi"),
      });
      expect(await outOfDateIn(id, "fr")).toBe(true);

      // The same save accepting none is made from English as it now stands.
      await saved(savePost(id, "fr", { title: "Coucou" }));
      expect(await titleIn("fr")).toMatchObject({
        origin: "person",
        engine: null,
        sourceFingerprint: valueFingerprint("Hello"),
      });
    });

    // Broken by recording the claim's `origin` in place of who made it.
    it("is a person's where the person changed the text before accepting it", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      await saved(savePost(id, "en", { title: "Hello" }));
      await saved(
        savePost(
          id,
          "es",
          { title: "Hola" },
          {
            acceptance: accepting(
              "title",
              suggested("Hi", { made: "person", engine: undefined })
            ),
          }
        )
      );
      expect(await titleIn("es")).toMatchObject({
        origin: "person",
        engine: null,
        sourceLocale: "en",
        // Not the live one, which a person's save with no suggestion records.
        sourceFingerprint: valueFingerprint("Hi"),
      });
    });

    // Broken by putting the body's claims over it, or by dropping them.
    it("is recorded over what the body claims of its field, and of no other field", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi", summary: "Short" });
      await saved(
        savePost(
          id,
          "es",
          {
            title: "Hola",
            summary: "Corto",
            _provenance: {
              title: { origin: "original" },
              summary: { origin: "machine", engine: "deepl" },
            },
          },
          { acceptance: accepting("title", suggested("Hi")) }
        )
      );
      const rows = await recordsOf("posts", "es");
      expect(
        Object.fromEntries(rows.map(row => [row.fieldPath, row.engine]))
      ).toEqual({ title: "e1", summary: "deepl" });
    });

    it("is no claim a body may make, and no option a body may state", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      expect(
        await savePost(id, "es", {
          title: "Hola",
          _provenance: { title: suggested("Hi") },
        })
      ).toMatchObject({ success: false, statusCode: 400 });
      expect(await titleIn("es")).toBeUndefined();

      expect(
        await savePost(id, "es", {
          title: "Hola",
          acceptance: { claims: { title: suggested("Hi") } },
        })
      ).toMatchObject({ success: false, statusCode: 400 });
      expect(await titleIn("es")).toBeUndefined();
    });

    // Broken by not carrying the claims to the held branch, or by running what it does there twice.
    it("is recorded as the language's draft where the save is held, and goes live with it", async () => {
      await boot(dialect);
      const id = await create("notes", { title: "Hi" });
      await saved(saveEntry("notes", id, "en", { status: "published" }));
      await saved(
        saveEntry("notes", id, "es", { title: "Hola", status: "published" })
      );
      const acceptance = accepting("title", suggested("Hi"));
      await saved(
        saveEntry("notes", id, "es", { title: "Hola 2" }, { acceptance })
      );
      expect(await recordsOf("notes", "es")).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "person",
          valueFingerprint: valueFingerprint("Hola"),
        }),
        expect.objectContaining({
          partState: "draft",
          origin: "machine",
          engine: "e1",
          valueFingerprint: valueFingerprint("Hola 2"),
        }),
      ]);
      expect(acceptance.runs()).toBe(1);

      await saved(saveEntry("notes", id, "es", { status: "published" }));
      expect(await recordsOf("notes", "es")).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "machine",
          valueFingerprint: valueFingerprint("Hola 2"),
        }),
      ]);
      expect(acceptance.runs()).toBe(1);
    });

    // Broken by leaving either of the Single's two recordings without the claims.
    it("is recorded of a Single's save, live or held", async () => {
      await boot(dialect);
      await saved(saveSingle("ticker", "en", { headline: "Hi" }));
      await saved(saveSingle("ticker", "en", { status: "published" }));
      const live = accepting("headline", suggested("Hi"));
      await saved(
        saveSingle(
          "ticker",
          "es",
          { headline: "Hola", status: "published" },
          live
        )
      );
      expect(await recordsOf("ticker", "es")).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "machine",
          engine: "e1",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);
      expect(live.runs()).toBe(1);

      const held = accepting("headline", suggested("Hi", { engine: "e2" }));
      await saved(saveSingle("ticker", "es", { headline: "Hola 2" }, held));
      expect(await recordsOf("ticker", "es")).toEqual([
        expect.objectContaining({ partState: "live", engine: "e1" }),
        expect.objectContaining({ partState: "draft", engine: "e2" }),
      ]);
      expect(held.runs()).toBe(1);
    });

    // Broken by running it after the commit, or before the values are written.
    it("is undone, values and records, where what it does beside the save is refused", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      const suggestion = await suggest(id, "Hi");
      let writtenThen = 0;
      const refused = accepting("title", suggested("Hi"), async tx => {
        const rows = await tx.select<Row>(PROVENANCE);
        writtenThen = rows.filter(row => row.locale === "fr").length;
        await tx.delete(TRANSLATION_SUGGESTIONS_TABLE, byId(suggestion));
        throw NextlyError.conflict({ reason: "state", message: "Taken." });
      });
      expect(
        await savePost(id, "fr", { title: "Salut" }, { acceptance: refused })
      ).toMatchObject({ success: false, statusCode: 409, message: "Taken." });
      // The value had been written and recorded, and then was not.
      expect(refused.runs()).toBe(1);
      expect(writtenThen).toBe(1);
      expect(await recordsOf("posts", "fr")).toEqual([]);
      expect(await ownTitleIn(id, "fr")).toBeNull();
      expect(await suggestionIds()).toEqual([suggestion]);
    });

    it("is undone of a Single too", async () => {
      await boot(dialect);
      await saved(saveSingle("banner", "en", { headline: "Sale" }));
      const refused = accepting("headline", suggested("Sale"), () =>
        Promise.reject(
          NextlyError.conflict({ reason: "state", message: "Taken." })
        )
      );
      expect(
        await saveSingle("banner", "es", { headline: "Rebajas" }, refused)
      ).toMatchObject({ success: false, statusCode: 409, message: "Taken." });
      expect(refused.runs()).toBe(1);
      expect(await recordsOf("banner", "es")).toEqual([]);
      const read = await singles().get("banner", {
        overrideAccess: true,
        locale: "es",
        fallbackLocale: false,
      });
      expect(
        (read.data as Record<string, unknown>).headline ?? null
      ).toBeNull();
    });

    // Broken by running it once for the save rather than on each try of its transaction.
    it("takes the suggestion out with the try that commits", async () => {
      await boot(dialect);
      const id = await create("posts", { title: "Hi" });
      const suggestion = await suggest(id, "Hi");
      const taken: number[] = [];
      const acceptance = accepting("title", suggested("Hi"), async tx => {
        taken.push(
          await tx.delete(TRANSLATION_SUGGESTIONS_TABLE, byId(suggestion))
        );
        // The first try loses the race for its version's number.
        if (taken.length === 1) throw new VersionConflictError();
      });
      await saved(savePost(id, "fr", { title: "Salut" }, { acceptance }));
      // What the first try took out was put back with the rest of it.
      expect(taken).toEqual([1, 1]);
      expect(await suggestionIds()).toEqual([]);
      expect(await recordsOf("posts", "fr")).toEqual([
        expect.objectContaining({ origin: "machine" }),
      ]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "source text a suggestion names (%s)",
  dialect => {
    // Broken by pruning what the records alone do not name.
    it("stays for as long as the suggestion is open", async () => {
      await boot(dialect);
      const valuesKept = async () =>
        (
          await t!.adapter.select<{ content: { value: unknown } }>(
            "nextly_translation_sources"
          )
        )
          .map(row => String(row.content.value))
          .sort();
      const id = await create("posts", { title: "Hi" });
      await saved(savePost(id, "es", { title: "Hola" }));
      const suggestion = await suggest(id, "Hi");
      await saved(savePost(id, "en", { title: "Hello" }));

      // No record names "Hi" now: the suggestion alone does.
      await saved(savePost(id, "es", { title: "Hola otra vez" }));
      expect(await valuesKept()).toEqual(["Hello", "Hi"]);

      await t!.adapter.delete(TRANSLATION_SUGGESTIONS_TABLE, byId(suggestion));
      await saved(savePost(id, "es", { title: "Buenas" }));
      expect(await valuesKept()).toEqual(["Hello"]);
    });
  }
);
