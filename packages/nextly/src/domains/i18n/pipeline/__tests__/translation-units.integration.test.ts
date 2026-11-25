/**
 * A document's units of translation work: which texts a caller is listed, what they are told they
 * may do with each, and the languages each may be translated from. A save that says where a text
 * was translated from is asked the same question.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../../auth/session/session-standing";
import {
  defineCollection,
  defineSingle,
  group,
  repeater,
  text,
} from "../../../../config";
import { container } from "../../../../di/container";
import type { Nextly } from "../../../../direct-api/nextly";
import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
import { valueFingerprint } from "../../provenance/value-fingerprint";
import type { DocumentCaller, TranslatedDocument } from "../document-access";
import type { TranslationUnit } from "../document-units";
import { submitSuggestion } from "../suggestions";
import {
  fieldUnit,
  unitProvenancePath,
  type UnitAddress,
} from "../unit-address";
import { assertTranslatedSources, translationUnits } from "../units";

// Each test boots its own site, which on MySQL alone takes most of the default 30 seconds.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const ORIGIN = "http://localhost";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  resetSessionStandingForTests();
  await t?.destroy();
  t = undefined;
});

type Kind = "collection" | "single";

/** Every dialect, with an entry of a collection and with a Single. */
const SITES = getConfiguredTestDialects().flatMap(dialect =>
  (["collection", "single"] as const).map(kind => ({ dialect, kind }))
);

/** Each kind's document with no status, and with drafts. */
const SLUGS: Record<Kind, { plain: string; drafts: string }> = {
  collection: { plain: "posts", drafts: "notes" },
  single: { plain: "banner", drafts: "ticker" },
};

const notEnglish = ({ locale }: { locale?: string }) => locale !== "en";
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";
const onlySpanish = ({ locale }: { locale?: string }) => locale === "es";

const plainFields = () => [
  text({ name: "title", localized: true }),
  text({ name: "code", localized: false }),
  group({ name: "seo", fields: [text({ name: "headline" })] }),
  repeater({
    name: "sections",
    fields: [
      text({ name: "caption" }),
      // Each rule told the language the field is read or written in.
      text({ name: "guarded", access: { update: notSpanish } }),
    ],
  }),
  repeater({
    name: "notices",
    fields: [
      text({ name: "label" }),
      text({ name: "secret", access: { read: () => false } }),
      text({ name: "fromEnglish", access: { read: notEnglish } }),
    ],
  }),
  text({ name: "locked", localized: true, access: { update: notSpanish } }),
  text({ name: "hidden", localized: true, access: { read: () => false } }),
  text({ name: "sourceHidden", localized: true, access: { read: notEnglish } }),
];

async function boot(dialect: TestDialect): Promise<void> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: plainFields(),
      }),
      // Drafts: a save over a live language is held as its working draft.
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title", localized: true })],
      }),
      // Read by nobody.
      defineCollection({
        slug: "secrets",
        localized: true,
        access: { read: () => false },
        fields: [text({ name: "title", localized: true })],
      }),
      // Read in Spanish alone.
      defineCollection({
        slug: "spanish",
        localized: true,
        access: { read: onlySpanish },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({ slug: "banner", localized: true, fields: plainFields() }),
      defineSingle({
        slug: "ticker",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title", localized: true })],
      }),
      defineSingle({
        slug: "unwritten",
        localized: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
  });
  const slugs = [
    "posts",
    "notes",
    "secrets",
    "spanish",
    "banner",
    "ticker",
    "unwritten",
  ];
  await userWhoMay(t, "ann", "read", slugs);
  await grantTo(t, "ann", "update", slugs);
  // May read, and change nothing.
  await userWhoMay(t, "ben", "read", slugs);
  // May read none of those a test asks them about.
  await userWhoMay(t, "cy", "read", ["secrets"]);
}

const ANN: DocumentCaller = {
  user: { id: "ann", email: "ann@x.test", roles: [] },
};
const BEN: DocumentCaller = {
  user: { id: "ben", email: "ben@x.test", roles: [] },
};
const CY: DocumentCaller = {
  user: { id: "cy", email: "cy@x.test", roles: [] },
};
const TRUSTED: DocumentCaller = { overrideAccess: true };

const handler = () => container.get<CollectionsHandler>("collectionsHandler");
const singles = () => container.get<SingleEntryService>("singleEntryService");

/** A trusted save in one language, which has to succeed. */
async function save(
  document: TranslatedDocument,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const body = { ...data, _overwrite: true };
  const as = { overrideAccess: true, locale, user: { id: "ann" } };
  const result =
    document.kind === "single"
      ? await singles().update(document.slug, body, as)
      : await handler().updateEntry(
          { collectionName: document.slug, entryId: document.id, ...as },
          body
        );
  expect(result).toMatchObject({ success: true });
}

async function entry(
  slug: string,
  data: Record<string, unknown>
): Promise<TranslatedDocument> {
  const created = (await t!.nextly.create({
    collection: slug,
    locale: "en",
    data,
  } as never)) as unknown as { item: { id: string } };
  return { kind: "collection", slug, id: created.item.id };
}

/** A document of `kind`, written in English. */
async function made(
  kind: Kind,
  shape: "plain" | "drafts",
  data: Record<string, unknown>
): Promise<TranslatedDocument> {
  const slug = SLUGS[kind][shape];
  if (kind === "collection") return entry(slug, data);
  await save({ kind, slug }, "en", data);
  return { kind, slug };
}

/** The ids of a document's rows, in order. */
async function rowIds(
  document: TranslatedDocument,
  field: "sections" | "notices" = "sections"
): Promise<string[]> {
  const as = { overrideAccess: true, locale: "en" };
  const read =
    document.kind === "single"
      ? await singles().get(document.slug, as)
      : await handler().getEntry({
          collectionName: document.slug,
          entryId: document.id,
          ...as,
        });
  const rows = read.data as unknown as Record<typeof field, { id: string }[]>;
  return rows[field].map(row => row.id);
}

/** The path of one row's text. */
const rowPath = (row: string, field = "caption") =>
  unitProvenancePath([{ field: "sections" }, { row }, { field }]);

async function unitsOf(
  document: TranslatedDocument,
  locale: string,
  caller: DocumentCaller = ANN
): Promise<TranslationUnit[]> {
  return (await translationUnits(document, caller, { locale })).units;
}

async function unitAt(
  document: TranslatedDocument,
  locale: string,
  path: string,
  caller: DocumentCaller = ANN
): Promise<TranslationUnit> {
  const unit = (await unitsOf(document, locale, caller)).find(
    each => each.path === path
  );
  if (unit === undefined) throw new Error(`no unit at ${path}`);
  return unit;
}

/** The languages one text may be translated from. */
async function sourcesOf(
  document: TranslatedDocument,
  locale: string,
  path = "title",
  caller: DocumentCaller = ANN
): Promise<string[]> {
  const { sources } = await unitAt(document, locale, path, caller);
  return (sources ?? []).map(source => source.locale);
}

/** The code a refusal carries: its issues' own, for one that names them. */
async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const issues = (
      error.publicData as { errors?: { code: string }[] } | undefined
    )?.errors;
    return issues?.map(issue => issue.code).join() ?? error.code;
  }
  return "not refused";
}

/** A suggestion for the document's Spanish title, or another text, submitted by a key. */
function suggest(
  document: TranslatedDocument,
  address: UnitAddress = fieldUnit("title")
): Promise<string> {
  return submitSuggestion(
    document,
    TRUSTED,
    {
      locale: "es",
      address,
      value: "Buenas",
      origin: "machine",
      engine: "e1",
      model: "m1",
      sourceLocale: "en",
      sourceFingerprint: valueFingerprint("Hi"),
    },
    { type: "apiKey", id: "submitting-key" }
  );
}

const ELSEWHERE = "00000000-0000-4000-8000-000000000000";

describe.each(SITES)(
  "the units of a translated document ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by listing every field, by addressing a row by its position, and by taking a
    // group's or a row's text from the language beside it.
    it("are each text the caller may read, a row's under its id wherever the row stands", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        code: "c1",
        hidden: "Hi",
        seo: { headline: "Read me" },
        sections: [{ caption: "one" }, { caption: "two" }],
      });
      const [first, second] = await rowIds(document);
      await save(document, "es", {
        title: "Hola",
        hidden: "Hola",
        seo: { headline: "Leeme" },
        sections: [
          { id: first, caption: "uno" },
          { id: second, caption: "dos" },
        ],
      });
      const reversed = [
        { id: second, caption: "two" },
        { id: first, caption: "one" },
      ];
      await save(document, "en", { sections: reversed });

      const units = await unitsOf(document, "es");
      expect(units.map(unit => unit.path).sort()).toEqual(
        [
          "title",
          "seo#.headline",
          rowPath(first),
          rowPath(first, "guarded"),
          rowPath(second),
          rowPath(second, "guarded"),
          "locked",
          "sourceHidden",
        ].sort()
      );
      // In the order their rows stand in now, each with its own text and its own source's.
      expect(
        units
          .filter(unit => unit.path.endsWith(".caption"))
          .map(({ path, value, sources }) => ({ path, value, sources }))
      ).toEqual([
        {
          path: rowPath(second),
          value: "dos",
          sources: [
            {
              locale: "en",
              value: "two",
              fingerprint: valueFingerprint("two"),
            },
          ],
        },
        {
          path: rowPath(first),
          value: "uno",
          sources: [
            {
              locale: "en",
              value: "one",
              fingerprint: valueFingerprint("one"),
            },
          ],
        },
      ]);
      expect(await unitAt(document, "es", "title")).toMatchObject({
        address: [{ field: "title" }],
        value: "Hola",
        origin: "person",
        outOfDate: false,
        sources: [
          { locale: "en", value: "Hi", fingerprint: valueFingerprint("Hi") },
        ],
        suggestion: null,
      });
      expect(await unitAt(document, "es", "seo#.headline")).toMatchObject({
        value: "Leeme",
      });
      // A text the language has none of is no text, never the default language's.
      expect((await unitAt(document, "fr", "title")).value ?? null).toBeNull();
    });

    // Broken by listing every text a row's shape has, whose suggestion was then told with it, and
    // by asking only of the whole field whether a source may be read.
    it("leave out a text of a row the caller may not read, and what is suggested for it or from it", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        notices: [{ label: "Hi", secret: "Hi", fromEnglish: "Hi" }],
      });
      const [row] = await rowIds(document, "notices");
      const at = (field: string): UnitAddress => [
        { field: "notices" },
        { row },
        { field },
      ];
      const toldOf = async (caller?: DocumentCaller) =>
        (await unitsOf(document, "es", caller))
          .filter(unit => unit.path.startsWith("notices#"))
          .map(({ path, sources, suggestion }) => ({
            path,
            sources: sources?.map(source => source.locale),
            suggested: suggestion !== null,
          }));
      const told = (field: string, sources: string[], suggested: boolean) => ({
        path: unitProvenancePath(at(field)),
        sources,
        suggested,
      });
      for (const field of ["label", "secret", "fromEnglish"]) {
        await suggest(document, at(field));
      }
      expect(await toldOf()).toEqual([
        told("label", ["en"], true),
        told("fromEnglish", [], false),
      ]);
      // The control: each is there, for who may read it.
      expect(await toldOf(TRUSTED)).toEqual([
        told("label", ["en"], true),
        told("secret", ["en"], true),
        told("fromEnglish", ["en"], true),
      ]);
    });

    // Broken by asking of the whole field, by asking in another language than the units', or by
    // asking the field rules of a caller who may not change the document at all.
    it("say whether the caller may change each, by the rules of the language", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        locked: "Hi",
        sections: [{ caption: "one", guarded: "one" }],
      });
      const [row] = await rowIds(document);
      const editable = async (locale: string, caller: DocumentCaller) =>
        (await unitsOf(document, locale, caller))
          .filter(unit => unit.canEdit)
          .map(unit => unit.path);

      const inSpanish = await editable("es", ANN);
      expect(inSpanish).toContain("title");
      expect(inSpanish).toContain(rowPath(row));
      expect(inSpanish).not.toContain("locked");
      expect(inSpanish).not.toContain(rowPath(row, "guarded"));
      const inFrench = await editable("fr", ANN);
      expect(inFrench).toContain("locked");
      expect(inFrench).toContain(rowPath(row, "guarded"));
      expect(await editable("es", BEN)).toEqual([]);
      expect((await unitsOf(document, "es", BEN)).length).toBeGreaterThan(0);
    });

    // Broken by asking the rules of what the document holds, where a text not written yet is not.
    it("say a text may be changed in a group nothing was ever written in", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      expect(await unitAt(document, "es", "seo#.headline")).toMatchObject({
        value: null,
        canEdit: true,
      });
    });

    // Broken by reading the source's draft, by asking the document's status alone, and by taking
    // a translation whose own source has moved.
    it("may be translated from a language as readers see it, published and up to date", async () => {
      await boot(dialect);
      const document = await made(kind, "drafts", { title: "Hi" });
      expect(await sourcesOf(document, "es")).toEqual([]);

      await save(document, "en", { status: "published" });
      expect(await sourcesOf(document, "es")).toEqual(["en"]);
      expect(await sourcesOf(document, "fr")).toEqual(["en"]);
      await save(document, "es", { title: "Hola", status: "published" });
      expect(await sourcesOf(document, "fr")).toEqual(["en", "es"]);
      await save(document, "es", { status: "draft" });
      expect(await sourcesOf(document, "fr")).toEqual(["en"]);
      await save(document, "es", { status: "published" });
      expect(await sourcesOf(document, "fr")).toEqual(["en", "es"]);
      // Never from itself.
      expect(await sourcesOf(document, "es")).toEqual(["en"]);

      // Held: readers still see the text before it.
      await save(document, "en", { title: "Hello" });
      expect((await unitAt(document, "fr", "title")).sources).toMatchObject([
        { locale: "en", value: "Hi" },
        { locale: "es", value: "Hola" },
      ]);
      await save(document, "en", { status: "published" });
      expect((await unitAt(document, "fr", "title")).sources).toEqual([
        {
          locale: "en",
          value: "Hello",
          fingerprint: valueFingerprint("Hello"),
        },
      ]);
      expect(await unitAt(document, "es", "title")).toMatchObject({
        value: "Hola",
        outOfDate: true,
      });
    });

    // Broken by reading a source with its fallbacks, and by reading it as trusted code.
    it("may be translated from no text lent by another language, nor one the caller may not read", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        sourceHidden: "Hi",
      });
      await save(document, "es", { sourceHidden: "Hola" });
      // Spanish reads the title in English.
      expect(await sourcesOf(document, "fr")).toEqual(["en"]);
      expect(await sourcesOf(document, "fr", "sourceHidden")).toEqual(["es"]);
      expect(await sourcesOf(document, "fr", "sourceHidden", TRUSTED)).toEqual([
        "en",
        "es",
      ]);
    });

    // Broken by naming the fingerprint and the age each text has once it was read, whatever it was.
    it("are told what is recorded of the text that was read, where it is saved as it is read", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      let left = 0;
      let saved = 0;
      let language = "en";
      const savedMeanwhile = async (asked: { translations?: unknown }) => {
        if (asked.translations !== "all" || left === 0) return;
        left -= 1;
        saved += 1;
        await save(document, language, { title: `Text ${saved}` });
      };
      const getEntry = handler().getEntry.bind(handler());
      vi.spyOn(handler(), "getEntry").mockImplementation(async params => {
        const answer = await getEntry(params);
        await savedMeanwhile(params);
        return answer;
      });
      const get = singles().get.bind(singles());
      vi.spyOn(singles(), "get").mockImplementation(async (slug, options) => {
        const answer = await get(slug, options);
        await savedMeanwhile(options ?? {});
        return answer;
      });

      left = 1;
      const unit = await unitAt(document, "es", "title");
      expect(left).toBe(0);
      expect(unit).toMatchObject({ value: "Hola", outOfDate: true });
      expect(unit.sources).toEqual([
        {
          locale: "en",
          value: "Text 1",
          fingerprint: valueFingerprint("Text 1"),
        },
      ]);

      // Saved at every reading: nothing is told of what was not read.
      left = 99;
      const moving = await unitAt(document, "es", "title");
      expect(moving).not.toHaveProperty("sources");
      expect(moving).not.toHaveProperty("outOfDate");

      // Its own text saved at every reading: its source stands, and its age is not told.
      language = "es";
      const own = await unitAt(document, "es", "title");
      expect(own.sources).toHaveLength(1);
      expect(own).not.toHaveProperty("origin");
      expect(own).not.toHaveProperty("outOfDate");
    });

    it("are refused of the default language and of one the site does not have", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      expect(await refusalOf(unitsOf(document, "en"))).toBe(
        "LANGUAGE_IS_THE_DEFAULT"
      );
      expect(await refusalOf(unitsOf(document, "xx"))).toBe("UNKNOWN_LANGUAGE");
    });

    // Broken by reading the document as trusted code.
    it("are not found where the caller may not read the document", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      expect(await refusalOf(unitsOf(document, "es", CY))).toBe("NOT_FOUND");
      // Nobody is signed in: told that, and nothing of the document.
      expect(await refusalOf(unitsOf(document, "es", {}))).toBe(
        "AUTH_REQUIRED"
      );
      expect(await refusalOf(unitsOf(document, "es"))).toBe("not refused");
    });

    // Broken by listing a suggestion with everything its row holds, and by a second mapping at
    // either door.
    it("are answered over REST and the Direct API alike, with no word of who suggested one", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);

      const path =
        document.kind === "single"
          ? ["singles", document.slug, "translation-units"]
          : [
              "collections",
              document.slug,
              "entries",
              document.id,
              "translation-units",
            ];
      const get = async (query: string, signedIn = true) =>
        createDynamicHandlers().GET(
          new Request(`${ORIGIN}/api/${path.join("/")}${query}`, {
            headers: signedIn ? { cookie: await sessionOf("ann") } : {},
          }),
          { params: Promise.resolve({ params: path }) }
        );

      const response = await get("?locale=es");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const answered = await response.text();
      expect(answered).not.toContain("submitting-key");
      const answer = JSON.parse(answered) as {
        locale: string;
        units: { path: string; suggestion: Record<string, unknown> | null }[];
      };
      expect(answer.locale).toBe("es");
      expect(
        answer.units.find(unit => unit.path === "title")?.suggestion
      ).toEqual({
        id,
        value: "Buenas",
        origin: "machine",
        engine: "e1",
        model: "m1",
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      });

      const { translations } = t!.nextly as unknown as Nextly;
      const named =
        document.kind === "single"
          ? { single: document.slug }
          : { collection: document.slug, id: document.id };
      const direct = await translations.units({
        ...named,
        locale: "es",
        overrideAccess: false,
        user: { id: "ann" },
      });
      expect(JSON.parse(JSON.stringify(direct))).toEqual(answer);
      // Trusted by default: the field nobody may read is listed too.
      const trusted = await translations.units({ ...named, locale: "es" });
      expect(trusted.units.map(unit => unit.path)).toContain("hidden");

      expect((await get("")).status).toBe(400);
      expect((await get("?locale=es", false)).status).toBe(401);
    });

    // Broken by reading a nested path as a field's name (none is accepted), and by asking the
    // field's own value in its place (every one is).
    it("are what a save's claim about one text inside a field is asked of", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        sections: [{ caption: "one" }, { caption: "two" }],
      });
      const [first, second] = await rowIds(document);
      // Spanish has a text of its own in one row alone.
      await save(document, "es", {
        sections: [{ id: first, caption: "uno" }, { id: second }],
      });
      const claiming = (path: string) =>
        refusalOf(
          assertTranslatedSources(document, ANN, "fr", {
            [path]: { origin: "translated", sourceLocale: "es" },
          })
        );
      expect(await claiming(rowPath(first))).toBe("not refused");
      for (const path of [rowPath(second), rowPath("gone")]) {
        expect(await claiming(path), path).toBe(
          "PROVENANCE_SOURCE_NOT_ELIGIBLE"
        );
      }
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the units of a document that can't be read (%s)",
  dialect => {
    // Broken by answering a hidden document otherwise than a missing one, and by giving a Single
    // a document by asking.
    it("are not found, the same, for one that is hidden and one that is not there", async () => {
      await boot(dialect);
      const secret = await entry("secrets", { title: "Hi" });
      const elsewhere: TranslatedDocument = {
        kind: "collection",
        slug: "secrets",
        id: ELSEWHERE,
      };
      for (const document of [
        secret,
        elsewhere,
        { kind: "single", slug: "unwritten" },
      ] as TranslatedDocument[]) {
        expect(await refusalOf(unitsOf(document, "es")), document.slug).toBe(
          "NOT_FOUND"
        );
      }
      // Nor does a visitor tell an entry that is there from one that is not.
      for (const each of [secret, elsewhere]) {
        expect(await refusalOf(unitsOf(each, "es", {}))).toBe("AUTH_REQUIRED");
      }
      const rows = await t!.adapter.select("single_unwritten").catch(() => []);
      expect(rows).toEqual([]);
    });

    // Broken by asking the read rule in the target language alone.
    it("leave out a language the collection's rule withholds, and what is suggested from it", async () => {
      await boot(dialect);
      const document = await entry("spanish", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      await suggest(document);
      const unit = await unitAt(document, "es", "title");
      expect(unit).toMatchObject({
        value: "Hola",
        sources: [],
        suggestion: null,
      });
      expect(await refusalOf(unitsOf(document, "fr"))).toBe("NOT_FOUND");
      // The control: it is there, for who may read what it was made from.
      expect(await unitAt(document, "es", "title", TRUSTED)).toMatchObject({
        sources: [{ locale: "en", value: "Hi" }],
        suggestion: { value: "Buenas" },
      });
    });
  }
);

/** The cookie `userId`'s session sends. */
async function sessionOf(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}
