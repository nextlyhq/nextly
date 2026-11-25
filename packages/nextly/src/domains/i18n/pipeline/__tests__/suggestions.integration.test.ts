/**
 * Suggested translations: what submitting one changes (nothing of the document), what accepting one
 * writes and records, what dismissing one leaves, and who may do each.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { apiKeyScope } from "../../../../auth/authenticated-scope";
import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { runAsPrincipal } from "../../../../auth/principal-scope";
import { resetSessionStandingForTests } from "../../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
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
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../../schemas/translation-suggestions";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
import { valueFingerprint } from "../../provenance/value-fingerprint";
import type { DocumentCaller, TranslatedDocument } from "../document-access";
import { keepSuggestion, type SuggestionStoreDb } from "../suggestion-store";
import {
  acceptSuggestion,
  dismissSuggestion,
  submitSuggestion,
} from "../suggestions";
import {
  fieldUnit,
  unitProvenancePath,
  type UnitAddress,
} from "../unit-address";
import { translationUnits } from "../units";

// Each test boots its own site, which on MySQL alone takes most of the default 30 seconds.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const ORIGIN = "http://localhost";

let t: TestNextly | undefined;
/** Run once, by the next save of any document, before it writes. */
let beforeSave: (() => Promise<void>) | undefined;

afterEach(async () => {
  beforeSave = undefined;
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

/** Each kind's document with no status, with drafts, and with components in its rows. */
const SLUGS: Record<Kind, { plain: string; drafts: string; cards: string }> = {
  collection: { plain: "posts", drafts: "notes", cards: "boards" },
  single: { plain: "banner", drafts: "ticker", cards: "board" },
};

const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";
const onlySpanish = ({ locale }: { locale?: string }) => locale === "es";

const hooks = {
  beforeChange: [
    async ({ data }: { data?: unknown }) => {
      const run = beforeSave;
      beforeSave = undefined;
      await run?.();
      return data as never;
    },
  ],
};

const plainFields = () => [
  text({ name: "title", localized: true }),
  text({ name: "code", localized: false }),
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
      text({ name: "kept", localized: false, access: { read: () => false } }),
      // Read in every language but the one it is suggested in.
      text({ name: "apart", access: { read: notSpanish } }),
    ],
  }),
  text({ name: "locked", localized: true, access: { update: notSpanish } }),
  text({ name: "hidden", localized: true, access: { read: () => false } }),
];

const draftFields = () => [
  text({ name: "title", localized: true }),
  text({ name: "summary", localized: true }),
];

/** A component in each row of a list, and one in a group. */
const cardFields = () => [
  repeater({
    name: "panels",
    fields: [fieldGroup({ name: "card", component: "card" })],
  }),
  group({
    name: "box",
    fields: [fieldGroup({ name: "card", component: "card" })],
  }),
];

const titleAlone = () => [text({ name: "title", localized: true })];

async function boot(dialect: TestDialect): Promise<void> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [
          text({ name: "label" }),
          text({ name: "fixed", access: { update: () => false } }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "boards",
        localized: true,
        fields: cardFields(),
      }),
      defineCollection({
        slug: "posts",
        localized: true,
        hooks,
        fields: plainFields(),
      }),
      // Drafts: a save over a live language is held as its working draft.
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        hooks,
        fields: draftFields(),
      }),
      // Its update rule admits no Spanish.
      defineCollection({
        slug: "unchanged",
        localized: true,
        access: { update: notSpanish },
        fields: titleAlone(),
      }),
      // Read by nobody.
      defineCollection({
        slug: "secrets",
        localized: true,
        access: { read: () => false },
        fields: titleAlone(),
      }),
      // Read in Spanish alone.
      defineCollection({
        slug: "spanish",
        localized: true,
        access: { read: onlySpanish },
        fields: titleAlone(),
      }),
    ],
    singles: [
      defineSingle({ slug: "board", localized: true, fields: cardFields() }),
      defineSingle({
        slug: "banner",
        localized: true,
        hooks,
        fields: plainFields(),
      }),
      defineSingle({
        slug: "ticker",
        localized: true,
        status: true,
        versions: { drafts: true },
        hooks,
        fields: draftFields(),
      }),
    ],
  });
  const slugs = [
    "posts",
    "notes",
    "unchanged",
    "secrets",
    "spanish",
    "banner",
    "ticker",
    "boards",
    "board",
  ];
  await userWhoMay(t, "ann", "read", slugs);
  await grantTo(t, "ann", "update", slugs);
  // May read, and change nothing.
  await userWhoMay(t, "ben", "read", slugs);
}

const ANN: DocumentCaller = {
  user: { id: "ann", email: "ann@x.test", roles: [] },
};
const BEN: DocumentCaller = {
  user: { id: "ben", email: "ben@x.test", roles: [] },
};
const TRUSTED: DocumentCaller = { overrideAccess: true };

/** An API key Ann made, holding `actions` on each kind's plain document. */
const keyWhoMay = (...actions: string[]): DocumentCaller => ({
  ...ANN,
  authenticatedScope: apiKeyScope(
    actions.flatMap(action =>
      ["posts", "banner"].map(resource => ({
        slug: `${action}-${resource}`,
        action,
        resource,
      }))
    )
  ),
});

const handler = () => container.get<CollectionsHandler>("collectionsHandler");
const singles = () => container.get<SingleEntryService>("singleEntryService");

/** A trusted save in one language, by its answer. */
function trySave(
  document: TranslatedDocument,
  locale: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; statusCode: number; message?: string }> {
  const as = { overrideAccess: true, locale, user: { id: "ann" } };
  return document.kind === "single"
    ? singles().update(document.slug, body, as)
    : handler().updateEntry(
        { collectionName: document.slug, entryId: document.id, ...as },
        body
      );
}

/** A trusted save in one language, which has to succeed. */
async function save(
  document: TranslatedDocument,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  expect(
    await trySave(document, locale, { ...data, _overwrite: true })
  ).toMatchObject({ success: true });
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
  shape: "plain" | "drafts" | "cards",
  data: Record<string, unknown>
): Promise<TranslatedDocument> {
  const slug = SLUGS[kind][shape];
  if (kind === "collection") return entry(slug, data);
  await save({ kind, slug }, "en", data);
  return { kind, slug };
}

/** A document of `kind`, live in English and Spanish, whose saves are held as drafts. */
async function published(kind: Kind): Promise<TranslatedDocument> {
  const document = await made(kind, "drafts", { title: "Hi", summary: "Long" });
  await save(document, "en", { status: "published" });
  await save(document, "es", {
    title: "Hola",
    summary: "Largo",
    status: "published",
  });
  return document;
}

/** A document as one language holds it, with none of it filled from another. */
async function read(
  document: TranslatedDocument,
  locale = "es",
  includeWorkingDraft = false
): Promise<Record<string, unknown>> {
  const as = {
    overrideAccess: true,
    locale,
    fallbackLocale: false as const,
    status: "all" as const,
    includeWorkingDraft,
  };
  const answer =
    document.kind === "single"
      ? await singles().get(document.slug, as)
      : await handler().getEntry({
          collectionName: document.slug,
          entryId: document.id,
          ...as,
        });
  return answer.data as unknown as Record<string, unknown>;
}

/** A document's rows in one language. */
async function rowsIn(
  document: TranslatedDocument,
  locale: string
): Promise<{ id: string; caption?: unknown; guarded?: unknown }[]> {
  const { sections } = await read(document, locale);
  return sections as { id: string }[];
}

interface SuggestionRow {
  id: string;
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  value: { value: unknown };
  engine: string | null;
  createdByKind: string | null;
  createdById: string | null;
}

async function suggestionRows(): Promise<SuggestionRow[]> {
  return t!.adapter.select<SuggestionRow>(TRANSLATION_SUGGESTIONS_TABLE);
}

async function suggestionIds(): Promise<string[]> {
  return (await suggestionRows()).map(row => row.id);
}

interface RecordRow {
  scopeSlug: string;
  locale: string;
  partState: string;
  fieldPath: string;
  origin: string;
  engine: string | null;
  actorId: string | null;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** A document's records of its Spanish title, live before draft. */
async function recordsOf({ slug }: TranslatedDocument): Promise<RecordRow[]> {
  const rows = await t!.adapter.select<RecordRow>(
    "nextly_translation_provenance"
  );
  return rows
    .filter(
      row =>
        row.scopeSlug === slug &&
        row.locale === "es" &&
        row.fieldPath === "title"
    )
    .sort((a, b) => b.partState.localeCompare(a.partState));
}

/** Every row a document is kept in, as stored: its own, its languages', its drafts and records. */
async function stored({
  kind,
  slug,
}: TranslatedDocument): Promise<Record<string, string[]>> {
  const main = kind === "collection" ? `dc_${slug}` : `single_${slug}`;
  const tables = [
    main,
    `${main}_locales`,
    "nextly_versions",
    "nextly_translation_provenance",
    "nextly_translation_sources",
  ];
  const kept: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = await t!.adapter.executeQuery<Record<string, unknown>>(
      `SELECT * FROM ${table}`
    );
    kept[table] = rows.map(row => JSON.stringify(row)).sort();
  }
  return kept;
}

/** A document as it is stored, and the suggestions open beside it. */
async function everything(
  document: TranslatedDocument
): Promise<Record<string, string[]>> {
  return { ...(await stored(document)), suggestions: await suggestionIds() };
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

interface Suggested {
  locale?: string;
  address?: UnitAddress;
  value?: unknown;
  from?: string;
  engine?: string;
}

/** What a machine suggests: a Spanish title made from the English "Hi", unless said otherwise. */
function suggested({
  locale = "es",
  address = fieldUnit("title"),
  value = "Buenas",
  from = "Hi",
  engine = "e1",
}: Suggested = {}) {
  return {
    locale,
    address,
    value,
    origin: "machine" as const,
    engine,
    sourceLocale: "en",
    sourceFingerprint: valueFingerprint(from),
  };
}

/** A suggestion submitted by trusted code; its id. */
function suggest(
  document: TranslatedDocument,
  over: Suggested = {}
): Promise<string> {
  return submitSuggestion(document, TRUSTED, suggested(over));
}

const inSpanish = (id: string) => ({ locale: "es", id });

/** Whether the document's Spanish title reads as older than its source. */
async function outOfDate(
  document: TranslatedDocument
): Promise<boolean | undefined> {
  const { units } = await translationUnits(document, ANN, { locale: "es" });
  return units.find(unit => unit.path === "title")?.outOfDate;
}

/** The source text kept for the titles, in order. */
async function titlesKept(): Promise<unknown[]> {
  const rows = await t!.adapter.select<{
    fieldPath: string;
    content: { value: unknown };
  }>("nextly_translation_sources");
  return rows
    .filter(row => row.fieldPath === "title")
    .map(row => row.content.value)
    .sort();
}

const caption = (row: string, field = "caption"): UnitAddress => [
  { field: "sections" },
  { row },
  { field },
];

describe.each(SITES)(
  "submitting a suggested translation ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by writing the text, a draft or a record of it, or by keeping a second one beside the
    // first, or the first one's id.
    it("leaves the document as it is, and takes the place of the one its text had", async () => {
      await boot(dialect);
      const document = await published(kind);
      await save(document, "es", { summary: "Más largo" });
      const before = await stored(document);

      const first = await submitSuggestion(document, TRUSTED, suggested(), {
        type: "apiKey",
        id: "key-1",
      });
      const second = await suggest(document, { value: "Hey", engine: "e2" });

      expect(await stored(document)).toEqual(before);
      expect(second).not.toBe(first);
      expect(await suggestionRows()).toEqual([
        expect.objectContaining({
          id: second,
          value: { value: "Hey" },
          engine: "e2",
          // Whoever submitted the one it replaced did not submit this one.
          createdByKind: null,
          createdById: null,
        }),
      ]);
    });

    // Broken by leaving the text only the replaced one named.
    it("takes the source text only the replaced one was made from with it", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      await suggest(document);
      await save(document, "en", { title: "Hello" });
      await save(document, "es", { title: "Hola otra vez" });
      expect(await titlesKept()).toEqual(["Hello", "Hi"]);

      await suggest(document, { from: "Hello" });
      expect(await titlesKept()).toEqual(["Hello"]);
    });

    // Broken by taking an address as given.
    it("is refused of a text the document has no place for", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        code: "c1",
        sections: [{ caption: "one" }],
      });
      for (const address of [
        fieldUnit("nothing"),
        // Not translated, and not a text.
        fieldUnit("code"),
        fieldUnit("sections"),
        caption("gone"),
      ]) {
        expect(
          await refusalOf(suggest(document, { address })),
          JSON.stringify(address)
        ).toBe("NOT_FOUND");
      }
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by asking only that the caller may read, or as trusted code.
    it("needs the right to change the text, which a key may have", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        locked: "Hi",
        hidden: "Hi",
        sections: [{ caption: "one", guarded: "one" }],
      });
      const [row] = await rowsIn(document, "en");
      const by = (caller: DocumentCaller, over: Suggested = {}) =>
        refusalOf(submitSuggestion(document, caller, suggested(over)));

      expect(await by(BEN)).toBe("NOT_FOUND");
      // Nobody is signed in: told that, and nothing of the document.
      expect(await by({})).toBe("AUTH_REQUIRED");
      expect(await by(keyWhoMay("read"))).toBe("NOT_FOUND");
      expect(await by(keyWhoMay("update"))).toBe("NOT_FOUND");
      expect(await by(ANN, { address: fieldUnit("hidden") })).toBe("NOT_FOUND");
      expect(await by(ANN, { address: fieldUnit("locked") })).toBe("FORBIDDEN");
      expect(await by(ANN, { address: caption(row.id, "guarded") })).toBe(
        "FORBIDDEN"
      );
      expect(await suggestionIds()).toEqual([]);

      expect(await by(ANN)).toBe("not refused");
      expect(await by(keyWhoMay("read", "update"))).toBe("not refused");
    });
  }
);

describe.each(SITES)(
  "accepting a suggested translation ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by recording the accepter as where it came from, and by leaving it open.
    it("makes it the language's text, recorded as the suggestion's", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      await acceptSuggestion(document, ANN, inSpanish(id));

      expect((await read(document)).title).toBe("Buenas");
      expect((await read(document, "en")).title).toBe("Hi");
      expect(await recordsOf(document)).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "machine",
          engine: "e1",
          actorId: "ann",
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);
      expect(await outOfDate(document)).toBe(false);
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by writing the live text, and by building the save from it (the held summary is
    // lost with the draft it was held in).
    it("is held with the language's draft where the document is published", async () => {
      await boot(dialect);
      const document = await published(kind);
      await save(document, "es", { summary: "Más largo" });
      const live = await read(document);
      const id = await suggest(document);
      const { version } = await acceptSuggestion(document, ANN, inSpanish(id));

      expect(await read(document)).toMatchObject({
        title: live.title,
        summary: live.summary,
        status: "published",
      });
      expect(await read(document, "es", true)).toMatchObject({
        title: "Buenas",
        summary: "Más largo",
      });
      expect(await recordsOf(document)).toEqual([
        expect.objectContaining({ partState: "live", origin: "person" }),
        expect.objectContaining({
          partState: "draft",
          origin: "machine",
          engine: "e1",
        }),
      ]);
      expect(
        await trySave(document, "es", { summary: "Corto", _rev: version })
      ).toMatchObject({ success: true });
    });

    // Broken by recording the source as it is at the accept.
    it("is out of date at once where its source changed since it was made", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      await save(document, "en", { title: "Hello" });
      await acceptSuggestion(document, ANN, inSpanish(id));
      expect((await recordsOf(document))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
      expect(await outOfDate(document)).toBe(true);
    });

    // Broken by asking only whether a value was sent, and by taking null for none.
    it("is the person's where they changed the text, and the suggestion's where they sent it as it was", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "en", { title: "Hello" });
      const accept = async (value: unknown) =>
        acceptSuggestion(document, ANN, {
          ...inSpanish(await suggest(document)),
          value,
        });

      await accept("Qué tal");
      expect((await read(document)).title).toBe("Qué tal");
      expect((await recordsOf(document))[0]).toMatchObject({
        origin: "person",
        engine: null,
        // Made from what was suggested, not from the source as it is.
        sourceLocale: "en",
        sourceFingerprint: valueFingerprint("Hi"),
      });

      await accept("Buenas");
      expect((await recordsOf(document))[0]).toMatchObject({
        origin: "machine",
        engine: "e1",
      });

      await accept(null);
      expect((await read(document)).title ?? null).toBeNull();
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by taking the suggestion out only where the save finds something to write.
    it("is taken where the language already says the same, and says where that came from", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      const id = await suggest(document, { value: "Hola" });
      await acceptSuggestion(document, ANN, inSpanish(id));
      expect((await read(document)).title).toBe("Hola");
      expect((await recordsOf(document))[0]).toMatchObject({
        origin: "machine",
        engine: "e1",
      });
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by answering the version before the save.
    it("answers the version the next save is made from", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      const { _rev: before } = await read(document);
      const id = await suggest(document);
      const { version } = await acceptSuggestion(document, ANN, inSpanish(id));

      expect(
        await trySave(document, "es", { locked: "Uno", _rev: before })
      ).toMatchObject({ success: false, statusCode: 409 });
      expect(
        await trySave(document, "es", { locked: "Dos", _rev: version })
      ).toMatchObject({ success: true });
    });

    // Broken by taking the suggestion out before the save.
    it("leaves it open where the save is refused", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      const before = await everything(document);
      beforeSave = () => {
        throw NextlyError.forbidden();
      };
      expect(
        await refusalOf(acceptSuggestion(document, ANN, inSpanish(id)))
      ).toBe("FORBIDDEN");
      expect(await everything(document)).toEqual(before);
    });

    // Broken by taking the suggestion out on a connection of its own, or after the commit (then
    // nothing is ever refused here).
    it("leaves it open where the save fails once it is taken out", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      const before = await everything(document);
      let takenOut = 0;
      const { adapter } = t!;
      const transaction = adapter.transaction.bind(adapter);
      const failing = vi
        .spyOn(adapter, "transaction")
        .mockImplementation((work, options) =>
          transaction(async tx => {
            const result = await work(tx);
            const open = await tx.select(TRANSLATION_SUGGESTIONS_TABLE);
            if (open.length > 0) return result;
            takenOut += 1;
            throw new Error("the commit failed");
          }, options)
        );
      await expect(
        acceptSuggestion(document, ANN, inSpanish(id))
      ).rejects.toThrow();
      failing.mockRestore();
      // It failed where it was meant to: with the suggestion taken out, and not before.
      expect(takenOut).toBeGreaterThan(0);
      expect(await everything(document)).toEqual(before);
      // The control: the same accept, with nothing to fail it.
      await acceptSuggestion(document, ANN, inSpanish(id));
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by finding the suggestion by its text at the write, and by not asking that it was
    // there to take.
    it("is refused where another took its place while it was being saved", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      const before = await stored(document);
      let newer = "";
      beforeSave = async () => {
        newer = await suggest(document, { value: "Hey" });
      };
      expect(
        await refusalOf(acceptSuggestion(document, ANN, inSpanish(id)))
      ).toBe("CONFLICT");
      expect(await stored(document)).toEqual(before);
      expect(await suggestionIds()).toEqual([newer]);
    });

    // Broken by naming a suggestion by its text.
    it("is refused of one that was replaced or already taken", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const replaced = await suggest(document);
      const id = await suggest(document, { value: "Hey" });
      const accept = (named: string) =>
        refusalOf(acceptSuggestion(document, ANN, inSpanish(named)));
      expect(await accept(replaced)).toBe("NOT_FOUND");
      expect((await read(document)).title ?? null).toBeNull();
      expect(await accept(id)).toBe("not refused");
      expect(await accept(id)).toBe("NOT_FOUND");
      expect((await read(document)).title).toBe("Hey");
    });

    // Broken by dropping both the version sent and the check that it was there to take: either
    // alone still refuses one of the two.
    it("is one person's, of two who accept it at once", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      const accepting = (value: string) =>
        refusalOf(acceptSuggestion(document, ANN, { ...inSpanish(id), value }));
      const answers = await Promise.all([accepting("Uno"), accepting("Dos")]);

      const won = answers.indexOf("not refused");
      expect(answers.filter(answer => answer === "not refused")).toHaveLength(
        1
      );
      expect(["STALE_VERSION", "CONFLICT", "NOT_FOUND"]).toContain(
        answers[1 - won]
      );
      expect((await read(document)).title).toBe(["Uno", "Dos"][won]);
    });

    // Broken by finding a suggestion by its id alone, or whatever its language.
    it("is refused of another document's, and of another language's", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const other =
        kind === "collection"
          ? await made(kind, "plain", { title: "Hi" })
          : await made(kind, "drafts", { title: "Hi" });
      const id = await suggest(document);
      for (const work of [acceptSuggestion, dismissSuggestion]) {
        expect(await refusalOf(work(other, ANN, inSpanish(id)))).toBe(
          "NOT_FOUND"
        );
        expect(await refusalOf(work(document, ANN, { locale: "fr", id }))).toBe(
          "NOT_FOUND"
        );
      }
      expect(await suggestionIds()).toEqual([id]);
      expect(
        await refusalOf(acceptSuggestion(document, ANN, inSpanish(id)))
      ).toBe("not refused");
    });

    // Broken by addressing the row by its position, and by sending the row alone, or the rows as
    // they stood when it was suggested.
    it("goes into its own row wherever that stands, and leaves the others", async () => {
      await boot(dialect);
      // The text beside it in its row is one Ann may not change in Spanish. A Single's save does
      // not yet keep such a text in its language, so a Single's rows have none here.
      const beside = (guarded: string) =>
        kind === "collection" ? { guarded } : {};
      const document = await made(kind, "plain", {
        sections: [
          { caption: "one", ...beside("g1") },
          { caption: "two", ...beside("g2") },
        ],
      });
      const [first, second] = await rowsIn(document, "en");
      await save(document, "es", {
        sections: [
          { id: first.id, caption: "uno", ...beside("e1") },
          { id: second.id, caption: "dos", ...beside("e2") },
        ],
      });
      const id = await suggest(document, {
        address: caption(second.id),
        value: "doble",
        from: "two",
      });
      await save(document, "en", { sections: [second, first] });

      await acceptSuggestion(document, ANN, inSpanish(id));
      expect(await rowsIn(document, "es")).toMatchObject([
        { id: second.id, caption: "doble", ...beside("e2") },
        { id: first.id, caption: "uno", ...beside("e1") },
      ]);
      expect(await rowsIn(document, "en")).toMatchObject([
        { id: second.id, caption: "two", ...beside("g2") },
        { id: first.id, caption: "one", ...beside("g1") },
      ]);
    });

    // Broken by sending the row as the person was shown it: what they may not read went with it.
    it("leaves what the person may not read beside it in its row as it was", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        notices: [
          { label: "one", secret: "two", kept: "three", apart: "four" },
        ],
      });
      const [{ id: row }] = (await read(document, "en")).notices as {
        id: string;
      }[];
      await save(document, "es", {
        notices: [{ id: row, label: "uno", secret: "dos", kept: "three" }],
      });
      const at = (field: string): UnitAddress => [
        { field: "notices" },
        { row },
        { field },
      ];
      const id = await suggest(document, {
        address: at("label"),
        value: "un",
        from: "one",
      });
      await acceptSuggestion(document, ANN, inSpanish(id));
      expect((await read(document)).notices).toMatchObject([
        { id: row, label: "un", secret: "dos", kept: "three" },
      ]);

      // One for a text they may not read is none of theirs, though they may read its source.
      const hidden = await suggest(document, { address: at("secret") });
      const apart = await suggest(document, { address: at("apart") });
      const before = await everything(document);
      for (const [decide, each] of [
        [acceptSuggestion, hidden],
        [dismissSuggestion, hidden],
        [acceptSuggestion, apart],
        [dismissSuggestion, apart],
      ] as const) {
        expect(await refusalOf(decide(document, ANN, inSpanish(each)))).toBe(
          "NOT_FOUND"
        );
      }
      expect(await everything(document)).toEqual(before);
    });

    // Broken by saving over whatever came in between: the row written meanwhile is put back.
    it("is refused where the document was saved while it was being accepted", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        sections: [{ caption: "one" }, { caption: "two" }],
      });
      const [first, second] = await rowsIn(document, "en");
      const id = await suggest(document, {
        address: caption(first.id),
        value: "uno",
        from: "one",
      });
      beforeSave = () =>
        save(document, "es", {
          sections: [{ id: first.id }, { id: second.id, caption: "dos" }],
        });
      expect(
        await refusalOf(acceptSuggestion(document, ANN, inSpanish(id)))
      ).toBe("STALE_VERSION");
      const now = await rowsIn(document, "es");
      expect(now[0].caption ?? null).toBeNull();
      expect(now[1].caption).toBe("dos");
      expect(await suggestionIds()).toEqual([id]);

      // Asked again, it is made from the document as it is.
      await acceptSuggestion(document, ANN, inSpanish(id));
      expect(await rowsIn(document, "es")).toMatchObject([
        { caption: "uno" },
        { caption: "dos" },
      ]);
    });

    // Broken by adding the row again, by writing another in its place, and by asking a dismissal
    // for the text too.
    it("is refused of a text whose row is gone, which can still be dismissed", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        sections: [{ caption: "one" }, { caption: "two" }],
      });
      const [first, second] = await rowsIn(document, "en");
      const about = { address: caption(second.id), from: "two" };
      await suggest(document, about);
      const [{ scopeKind, scopeSlug, entryId }] = await suggestionRows();
      await save(document, "en", { sections: [first] });
      // Kept once more, as by a submit that had read the document before the row went.
      const { address, locale, ...suggestion } = suggested(about);
      const id = await keepSuggestion(
        t!.adapter,
        {
          document: { scopeKind, scopeSlug, entryId },
          targetLocale: locale,
          address,
        },
        suggestion,
        undefined
      );

      const before = await everything(document);
      expect(
        await refusalOf(acceptSuggestion(document, ANN, inSpanish(id)))
      ).toBe("SUGGESTED_TEXT_GONE");
      expect(await everything(document)).toEqual(before);
      await dismissSuggestion(document, ANN, inSpanish(id));
      expect(await suggestionIds()).toEqual([]);
    });

    // Broken by judging the recorded author of the save (a key and an override that name Ann are
    // recorded as Ann), and by asking once the document was read (a visitor is told it is there).
    it("is a signed-in person's act, whatever else a caller may do", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const id = await suggest(document);
      const before = await everything(document);
      const accept = (caller: DocumentCaller) =>
        acceptSuggestion(document, caller, inSpanish(id));
      const refused: Promise<unknown>[] = [
        accept({}),
        accept(TRUSTED),
        accept({ ...ANN, overrideAccess: true }),
        // A key whose maker is a person is the key.
        accept(keyWhoMay("read", "update")),
        runAsPrincipal(
          {
            type: "principal",
            kind: "shop:customer",
            id: "c1",
            attributes: {},
          },
          () => accept(ANN)
        ),
      ];
      for (const result of await Promise.allSettled(refused)) {
        const refusal: unknown =
          result.status === "rejected" ? result.reason : undefined;
        // Told apart from the refusal of a field, which is the same code.
        expect(NextlyError.is(refusal) && refusal.publicMessage).toBe(
          "Only a signed-in person can accept a suggestion."
        );
      }
      expect(await everything(document)).toEqual(before);
      // The control: the same suggestion, accepted by the person.
      await accept(ANN);
      expect((await read(document)).title).toBe("Buenas");
    });

    // Broken by leaving the refused text out of the save, as a save does: it succeeds and writes
    // nothing. And by asking the rules of the top-level field alone.
    it("needs the right to change the text, and is refused whole without it", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        title: "Hi",
        locked: "Hi",
        hidden: "Hi",
        sections: [{ caption: "one", guarded: "one" }],
      });
      const [row] = await rowsIn(document, "en");
      const ids: Record<string, string> = {
        title: await suggest(document),
        locked: await suggest(document, { address: fieldUnit("locked") }),
        hidden: await suggest(document, { address: fieldUnit("hidden") }),
        guarded: await suggest(document, {
          address: caption(row.id, "guarded"),
        }),
      };
      const before = await everything(document);
      for (const [named, caller, code] of [
        // May read, and change nothing.
        ["title", BEN, "NOT_FOUND"],
        ["locked", ANN, "FORBIDDEN"],
        ["guarded", ANN, "FORBIDDEN"],
        ["hidden", ANN, "NOT_FOUND"],
      ] as const) {
        expect(
          await refusalOf(
            acceptSuggestion(document, caller, inSpanish(ids[named]))
          ),
          named
        ).toBe(code);
      }
      expect(await everything(document)).toEqual(before);
    });

    // Broken by asking the document's own rules alone, which never reach a component's fields, and
    // by asking a dismissal for the field it starts in.
    it("is judged by the rules of a component held in a row or a group", async () => {
      await boot(dialect);
      const card = { label: "one", fixed: "one" };
      const document = await made(kind, "cards", {
        panels: [{ card }],
        box: { card },
      });
      const { panels } = await read(document, "en");
      const [{ id: row }] = panels as { id: string }[];
      const inRow = (field: string): UnitAddress => [
        { field: "panels" },
        { row },
        { field: "card" },
        { field },
      ];
      const inBox = (field: string): UnitAddress => [
        { field: "box" },
        { field: "card" },
        { field },
      ];
      const { units } = await translationUnits(document, ANN, { locale: "es" });
      expect(
        Object.fromEntries(units.map(unit => [unit.path, unit.canEdit]))
      ).toEqual({
        [unitProvenancePath(inRow("label"))]: true,
        [unitProvenancePath(inRow("fixed"))]: false,
        [unitProvenancePath(inBox("label"))]: true,
        [unitProvenancePath(inBox("fixed"))]: false,
      });

      for (const place of [inRow, inBox]) {
        const about = { address: place("fixed"), from: "one" };
        const fixed = await suggest(document, about);
        const label = await suggest(document, {
          address: place("label"),
          from: "one",
          value: "uno",
        });
        const before = await everything(document);
        for (const refused of [
          () => submitSuggestion(document, ANN, suggested(about)),
          () => acceptSuggestion(document, ANN, inSpanish(fixed)),
          () => dismissSuggestion(document, ANN, inSpanish(fixed)),
        ]) {
          expect(await refusalOf(refused())).toBe("FORBIDDEN");
        }
        expect(await everything(document)).toEqual(before);
        // The controls: the text beside it, and trusted code.
        await acceptSuggestion(document, ANN, inSpanish(label));
        await dismissSuggestion(document, TRUSTED, inSpanish(fixed));
        expect(await suggestionIds()).toEqual([]);
      }
      const es = await read(document);
      const written = { label: "uno" };
      expect(es).toMatchObject({
        panels: [{ card: written }],
        box: { card: written },
      });
    });

    // Broken by claiming the whole field, which brings the text beside it up to date, and by
    // recording the source as it is now for one made from it before.
    it("says what that one text was made from, and nothing of those beside it", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        sections: [{ caption: "one" }, { caption: "two" }],
      });
      const [first, second] = await rowsIn(document, "en");
      await save(document, "es", {
        sections: [
          { id: first.id, caption: "uno" },
          { id: second.id, caption: "dos" },
        ],
      });
      await save(document, "en", {
        sections: [
          { id: first.id, caption: "ONE" },
          { id: second.id, caption: "TWO" },
        ],
      });
      const said = async () => {
        const { units } = await translationUnits(document, ANN, {
          locale: "es",
        });
        return [first, second].map(({ id }) => {
          const path = unitProvenancePath(caption(id));
          const unit = units.find(each => each.path === path);
          return [unit?.origin, unit?.outOfDate];
        });
      };
      const accept = async (row: string, from: string) => {
        const address = caption(row);
        const id = await suggest(document, { address, from });
        await acceptSuggestion(document, ANN, inSpanish(id));
      };
      expect(await said()).toEqual([
        ["person", true],
        ["person", true],
      ]);
      await accept(first.id, "ONE");
      expect(await said()).toEqual([
        ["machine", false],
        ["person", true],
      ]);
      // Made from the text before it changed.
      await accept(second.id, "two");
      expect(await said()).toEqual([
        ["machine", false],
        ["machine", true],
      ]);
    });

    // Broken by pruning before the suggestion is taken out, which still names the text.
    it("takes the source text it alone was made from with it, where its text is cleared", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      const id = await suggest(document);
      await save(document, "en", { title: "Hello" });
      await save(document, "es", { title: "Hola otra vez" });
      expect(await titlesKept()).toEqual(["Hello", "Hi"]);

      await acceptSuggestion(document, ANN, { ...inSpanish(id), value: "" });
      expect(await titlesKept()).toEqual([]);
    });

    // Broken by naming the caller as trusted code at either call, or by dropping the version.
    it("is asked through the Direct API as the person it names, and never as trusted code", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      const { translations } = t!.nextly as unknown as Nextly;
      const target =
        document.kind === "single"
          ? { single: document.slug }
          : { collection: document.slug, id: document.id };
      await save(document, "es", { title: "Hola" });
      const asAnn = { overrideAccess: false, user: { id: "ann" } };
      const suggestionId = await suggest(document);
      const named = { ...target, locale: "es", suggestionId };

      for (const as of [
        {},
        { user: { id: "ann" } },
        { ...asAnn, actor: keyWhoMay("read", "update").authenticatedScope },
      ]) {
        expect(
          await refusalOf(translations.acceptSuggestion({ ...named, ...as }))
        ).toBe("FORBIDDEN");
      }
      expect(await suggestionIds()).toEqual([suggestionId]);
      expect((await read(document)).title).toBe("Hola");
      const accepted = await translations.acceptSuggestion({
        ...named,
        ...asAnn,
        value: null,
      });
      expect(accepted.item).toEqual({
        locale: "es",
        suggestionId,
        version: expect.any(String),
      });
      // Null is the text the person left, not the absence of one.
      expect((await read(document)).title ?? null).toBeNull();

      const another = await suggest(document);
      expect(
        await translations.dismissSuggestion({
          ...target,
          ...asAnn,
          locale: "es",
          suggestionId: another,
        })
      ).toMatchObject({ item: { locale: "es", suggestionId: another } });
      expect(await suggestionIds()).toEqual([]);
    });
  }
);

describe.each(SITES)(
  "dismissing a suggested translation ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by writing anything, and by leaving the source text it alone named.
    it("removes it and the source text it alone was made from, and leaves the text", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      const id = await suggest(document);
      await save(document, "en", { title: "Hello" });
      // No record names "Hi" now: the suggestion alone does.
      await save(document, "es", { title: "Hola otra vez" });
      expect(await titlesKept()).toEqual(["Hello", "Hi"]);
      const text = await read(document);
      const records = await recordsOf(document);

      await dismissSuggestion(document, ANN, inSpanish(id));
      expect(await suggestionIds()).toEqual([]);
      expect(await titlesKept()).toEqual(["Hello"]);
      expect(await read(document)).toEqual(text);
      expect(await recordsOf(document)).toEqual(records);
      expect(
        await refusalOf(dismissSuggestion(document, ANN, inSpanish(id)))
      ).toBe("NOT_FOUND");
    });

    // Broken by asking only that the caller may read it.
    it("needs the right to change the field, by whoever asks", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi", locked: "Hi" });
      const id = await suggest(document);
      const locked = await suggest(document, { address: fieldUnit("locked") });
      const dismiss = (caller: DocumentCaller, named = id) =>
        refusalOf(dismissSuggestion(document, caller, inSpanish(named)));
      expect(await dismiss(BEN)).toBe("NOT_FOUND");
      expect(await dismiss({})).toBe("AUTH_REQUIRED");
      expect(await dismiss(keyWhoMay("read"))).toBe("NOT_FOUND");
      expect(await dismiss(ANN, locked)).toBe("FORBIDDEN");
      expect((await suggestionIds()).sort()).toEqual([id, locked].sort());
      expect(await dismiss(ANN)).toBe("not refused");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a suggested translation and its document's own rules (%s)",
  dialect => {
    // Broken by asking a rule in the default language, or in the target language alone.
    it("is kept to the languages each rule admits", async () => {
      await boot(dialect);
      const unchanged = await entry("unchanged", { title: "Hi" });
      const secret = await entry("secrets", { title: "Hi" });
      const spanish = await entry("spanish", { title: "Hi" });
      for (const document of [
        // Not to be changed in Spanish.
        unchanged,
        // Not to be read at all.
        secret,
        // Not to be read in the language it was made from.
        spanish,
      ]) {
        const id = await suggest(document);
        const before = await everything(document);
        for (const work of [acceptSuggestion, dismissSuggestion]) {
          expect(
            await refusalOf(work(document, ANN, inSpanish(id))),
            document.slug
          ).toBe("NOT_FOUND");
        }
        expect(await everything(document)).toEqual(before);
      }

      // The control: the language the same rule admits.
      const id = await suggest(unchanged, { locale: "fr" });
      await acceptSuggestion(unchanged, ANN, { locale: "fr", id });
      expect((await read(unchanged, "fr")).title).toBe("Buenas");
    });

    // Broken by not trying again, and by trying again in the transaction the clash ended (which
    // PostgreSQL refuses).
    it("takes the place of one kept between its two statements", async () => {
      await boot(dialect);
      const document = await made("collection", "plain", { title: "Hi" });
      await suggest(document);
      const [{ scopeKind, scopeSlug, entryId }] = await suggestionRows();
      let tries = 0;
      // The first try is told the text has none, so its insert meets the one that is there.
      const racing: SuggestionStoreDb = {
        transaction: work =>
          t!.adapter.transaction(tx => {
            tries += 1;
            return work(tries === 1 ? findingNone(tx) : tx);
          }),
      };
      const { address, locale, ...suggestion } = suggested({ value: "Hey" });
      const id = await keepSuggestion(
        racing,
        {
          document: { scopeKind, scopeSlug, entryId },
          targetLocale: locale,
          address,
        },
        suggestion,
        undefined
      );
      expect(tries).toBe(2);
      expect(await suggestionRows()).toEqual([
        expect.objectContaining({ id, value: { value: "Hey" } }),
      ]);
    });
  }
);

describe.each(SITES)(
  "a suggested translation over REST ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by taking a body's other keys, by taking null for no text, by matching a path that
    // goes on, and by leaving either route on a definition's permission.
    it("is accepted and dismissed by whoever may change the document, as each body says", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { title: "Hola" });
      const cookie = await sessionOf("ann");
      const post = (
        id: string,
        decision: string,
        body: unknown,
        headers: Record<string, string> = { cookie }
      ) => {
        const path = [
          ...(document.kind === "single"
            ? ["singles", document.slug]
            : ["collections", document.slug, "entries", document.id]),
          "suggestions",
          id,
          ...decision.split("/"),
        ];
        return createDynamicHandlers().POST(
          new Request(`${ORIGIN}/api/${path.join("/")}`, {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ params: path }) }
        );
      };
      const statusOf = async (answer: Promise<Response>) =>
        (await answer).status;

      const id = await suggest(document);
      for (const body of [
        {},
        { locale: "es", value: "x", engine: "mine" },
        { locale: 1 },
      ]) {
        expect(await statusOf(post(id, "accept", body))).toBe(400);
      }
      expect(
        await statusOf(post(id, "dismiss", { locale: "es", value: "x" }))
      ).toBe(400);
      expect(await statusOf(post(id, "accept", { locale: "es" }, {}))).toBe(
        401
      );
      expect(
        await statusOf(
          post(
            id,
            "accept",
            { locale: "es" },
            { cookie: await sessionOf("ben") }
          )
        ),
        "a caller who may read the document alone"
      ).toBe(403);
      for (const past of ["accept/extra", "dismiss/extra", "submit"]) {
        expect(
          await statusOf(post(id, past, { locale: "es" })),
          past
        ).toBeGreaterThanOrEqual(400);
      }
      expect(
        await statusOf(post("no-such-suggestion", "accept", { locale: "es" }))
      ).toBe(404);
      expect(await suggestionIds()).toEqual([id]);
      expect((await read(document)).title).toBe("Hola");

      const accepted = await post(id, "accept", { locale: "es" });
      expect(accepted.status).toBe(200);
      const answer = (await accepted.json()) as Record<string, unknown>;
      expect(answer).toMatchObject({
        message: "Suggestion accepted.",
        locale: "es",
        suggestionId: id,
        version: expect.any(String),
      });
      expect((await read(document)).title).toBe("Buenas");
      expect(
        await trySave(document, "es", { locked: "Uno", _rev: answer.version })
      ).toMatchObject({ success: true });

      // Null is the text the person left, where no value at all is the suggestion's own.
      const cleared = await suggest(document);
      expect(
        await statusOf(post(cleared, "accept", { locale: "es", value: null }))
      ).toBe(200);
      expect((await read(document)).title ?? null).toBeNull();

      const another = await suggest(document);
      const dismissed = await post(another, "dismiss", { locale: "es" });
      expect(dismissed.status).toBe(200);
      expect(await dismissed.json()).toEqual({
        message: "Suggestion dismissed.",
        locale: "es",
        suggestionId: another,
      });
      expect(await suggestionIds()).toEqual([]);
      expect((await read(document)).title ?? null).toBeNull();
    });
  }
);

/** `tx`, whose updates find no row and change none. */
function findingNone(tx: TransactionContext): TransactionContext {
  return new Proxy(tx, {
    get(target, key) {
      if (key === "updateCount") return () => Promise.resolve(0);
      const member: unknown = Reflect.get(target, key);
      return typeof member === "function"
        ? (member.bind(target) as unknown)
        : member;
    },
  });
}

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
