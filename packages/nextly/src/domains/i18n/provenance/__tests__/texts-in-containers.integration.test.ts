/**
 * Each text inside a repeater or a group is recorded, and found out of date, on its own: a text made
 * again leaves the texts beside it as they were, and what the languages share of the container (its
 * rows, their order, a shared value) is no change of any text.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineSingle,
  group,
  number,
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
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../../schemas/translation-suggestions";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
import type { LocaleTranslationMeta } from "../../companion-join";
import type { SuggestionAcceptance } from "../../pipeline/acceptance";
import type {
  DocumentCaller,
  TranslatedDocument,
} from "../../pipeline/document-access";
import { keepCurrent, sourceChange } from "../../pipeline/source-review";
import {
  isTextPath,
  unitKey,
  unitProvenancePath,
  type UnitAddress,
} from "../../pipeline/unit-address";
import type { FieldProvenance } from "../field-status";
import { valueFingerprint } from "../value-fingerprint";

// Each test boots its own site, which on MySQL alone takes most of the default 30 seconds.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const PROVENANCE = "nextly_translation_provenance";

let t: TestNextly | undefined;

afterEach(async () => {
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

const fields = () => [
  text({ name: "title", localized: true }),
  group({ name: "intro", fields: [text({ name: "lead" })] }),
  repeater({
    name: "sections",
    fields: [
      text({ name: "caption" }),
      text({ name: "alt" }),
      number({ name: "rank" }),
      repeater({ name: "points", fields: [text({ name: "label" })] }),
    ],
  }),
];

async function boot(dialect: TestDialect): Promise<void> {
  const drafted = {
    localized: true,
    status: true,
    versions: { drafts: true },
  } as const;
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({ slug: "posts", localized: true, fields: fields() }),
      // Drafts: a save over a live language is held as its working draft.
      defineCollection({ slug: "notes", ...drafted, fields: fields() }),
    ],
    singles: [
      defineSingle({ slug: "banner", localized: true, fields: fields() }),
      defineSingle({ slug: "ticker", ...drafted, fields: fields() }),
    ],
  });
}

const handler = () => container.get<CollectionsHandler>("collectionsHandler");
const singles = () => container.get<SingleEntryService>("singleEntryService");

/** A trusted save in one language, which has to succeed. */
async function save(
  document: TranslatedDocument,
  locale: string,
  data: Record<string, unknown>,
  acceptance?: SuggestionAcceptance
): Promise<void> {
  const body = { ...data, _overwrite: true };
  const as = {
    overrideAccess: true,
    locale,
    user: { id: "ann" },
    ...(acceptance === undefined ? {} : { acceptance }),
  };
  const result =
    document.kind === "single"
      ? await singles().update(document.slug, body, as)
      : await handler().updateEntry(
          { collectionName: document.slug, entryId: document.id, ...as },
          body
        );
  expect(result).toMatchObject({ success: true });
}

/** A document of `kind`, written in English. */
async function made(
  kind: Kind,
  shape: "plain" | "drafts",
  data: Record<string, unknown>
): Promise<TranslatedDocument> {
  const slug = SLUGS[kind][shape];
  if (kind === "single") {
    await save({ kind, slug }, "en", data);
    return { kind, slug };
  }
  const created = (await t!.nextly.create({
    collection: slug,
    locale: "en",
    data,
  } as never)) as unknown as { item: { id: string } };
  return { kind, slug, id: created.item.id };
}

/** A document as one language holds it, with every language's standing beside it. */
async function read(
  document: TranslatedDocument,
  locale = "en"
): Promise<Record<string, unknown>> {
  const as = {
    overrideAccess: true,
    locale,
    fallbackLocale: false as const,
    status: "all" as const,
    translationStatus: true,
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

interface Point {
  id: string;
  label?: string | null;
}

interface Section {
  id: string;
  caption?: string | null;
  alt?: string | null;
  rank?: number | null;
  points?: Point[] | null;
}

/** A document's rows as one language holds them. */
async function sectionsIn(
  document: TranslatedDocument,
  locale: string
): Promise<Section[]> {
  return (await read(document, locale)).sections as Section[];
}

/** How one language stands in the document. */
async function standing(
  document: TranslatedDocument,
  locale: string
): Promise<LocaleTranslationMeta> {
  const { _translations } = await read(document);
  return (_translations as Record<string, LocaleTranslationMeta>)[locale];
}

/** What one language's field says of itself. */
async function fieldIn(
  document: TranslatedDocument,
  locale: string,
  field = "sections"
): Promise<FieldProvenance | undefined> {
  return (await standing(document, locale)).fields?.[field];
}

/** Whether each of a field's texts in one language is out of date, by its path. */
async function ages(
  document: TranslatedDocument,
  locale: string,
  field = "sections"
): Promise<Record<string, boolean | undefined>> {
  const texts = (await fieldIn(document, locale, field))?.texts ?? {};
  return Object.fromEntries(
    Object.entries(texts).map(([path, text]) => [path, text.outOfDate])
  );
}

const at = (row: string, field = "caption"): string =>
  unitProvenancePath([{ field: "sections" }, { row }, { field }]);

const LEAD: UnitAddress = [{ field: "intro" }, { field: "lead" }];

interface RecordRow {
  scopeSlug: string;
  locale: string;
  partState: string;
  fieldPath: string;
  valueFingerprint: string;
  origin: string;
  engine: string | null;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** One document's records, as they are kept, in order. */
async function recordsOf({ slug }: TranslatedDocument): Promise<RecordRow[]> {
  const rows = await t!.adapter.select<RecordRow>(PROVENANCE);
  return rows
    .filter(row => row.scopeSlug === slug)
    .sort((a, b) =>
      `${a.locale}${a.partState}${a.fieldPath}`.localeCompare(
        `${b.locale}${b.partState}${b.fieldPath}`
      )
    );
}

/** A document's records of its texts. */
async function textRecords(document: TranslatedDocument): Promise<RecordRow[]> {
  return (await recordsOf(document)).filter(row => isTextPath(row.fieldPath));
}

/** The record of one live text in one language. */
async function recordAt(
  document: TranslatedDocument,
  locale: string,
  path: string
): Promise<RecordRow | undefined> {
  return (await recordsOf(document)).find(
    row =>
      row.locale === locale &&
      row.partState === "live" &&
      row.fieldPath === path
  );
}

/** Takes away every text's record, as a document written before texts had one has none. */
async function forgetTextRecords(): Promise<void> {
  await t!.adapter.delete(PROVENANCE, {
    and: [{ column: "fieldPath", op: "LIKE", value: "%#%.%" }],
  });
}

/** Two rows as Spanish is first written in them. */
const inSpanish = (first: string, second: string): Section[] => [
  { id: first, caption: "uno", alt: "a-es", rank: 1 },
  { id: second, caption: "dos", alt: "b-es", rank: 2 },
];

/** Two rows, in English and Spanish. */
async function translated(
  kind: Kind,
  shape: "plain" | "drafts" = "plain",
  status?: "published"
): Promise<{
  document: TranslatedDocument;
  first: string;
  second: string;
}> {
  const document = await made(kind, shape, {
    title: "Hi",
    sections: [
      { caption: "one", alt: "a", rank: 1 },
      { caption: "two", alt: "b", rank: 2 },
    ],
    ...(status === undefined ? {} : { status }),
  });
  const [one, two] = await sectionsIn(document, "en");
  await save(document, "es", {
    title: "Hola",
    sections: inSpanish(one.id, two.id),
    ...(status === undefined ? {} : { status }),
  });
  return { document, first: one.id, second: two.id };
}

/** The claim that `path` is an accepted machine suggestion, made from the English `source`. */
const accepting = (path: string, source: string): SuggestionAcceptance => ({
  claims: {
    [path]: {
      origin: "suggestion",
      made: "machine",
      engine: "e1",
      sourceLocale: "en",
      sourceFingerprint: valueFingerprint(source),
    },
  },
  onWritten: async () => undefined,
});

/** Changes one row's values in one language, sending the whole list as a form does. */
async function change(
  document: TranslatedDocument,
  locale: string,
  row: string,
  values: Partial<Section>,
  acceptance?: SuggestionAcceptance
): Promise<void> {
  const rows = await sectionsIn(document, locale);
  await save(
    document,
    locale,
    {
      sections: rows.map(each =>
        each.id === row ? { ...each, ...values } : each
      ),
    },
    acceptance
  );
}

const ANN: DocumentCaller = {
  user: { id: "ann", email: "ann@x.test", roles: [] },
};

describe.each(SITES)(
  "the texts inside a container ($dialect, a $kind)",
  ({ dialect, kind }) => {
    // Broken by recording the container alone: the save of one text brings the others up to date.
    it("are made again one by one, leaving the others out of date", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(kind);
      expect(Object.values(await ages(document, "es"))).toEqual([
        false,
        false,
        false,
        false,
      ]);
      await change(document, "en", first, { caption: "ONE" });
      await change(document, "en", second, { caption: "TWO" });
      expect(await ages(document, "es")).toEqual({
        [at(first)]: true,
        [at(first, "alt")]: false,
        [at(second)]: true,
        [at(second, "alt")]: false,
      });

      await change(document, "es", first, { caption: "UNO" });
      expect(await ages(document, "es")).toMatchObject({
        [at(first)]: false,
        [at(second)]: true,
      });
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: true });
      expect((await standing(document, "es")).stale).toBe(true);

      await change(
        document,
        "es",
        second,
        { caption: "DOS" },
        accepting(at(second), "TWO")
      );
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: false });
      expect((await standing(document, "es")).stale).toBeUndefined();
      expect(await recordAt(document, "es", at(second))).toMatchObject({
        origin: "machine",
        engine: "e1",
      });
      // Made by whoever wrote it, not by what was accepted beside it.
      expect(await recordAt(document, "es", at(first))).toMatchObject({
        origin: "person",
      });
    });

    // Broken by judging a language by its container's own record, and by recording a container a
    // language holds no text in: the rows it was sent with are every language's.
    it("are as they were in every language once rows are reordered or a shared value changes", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(kind);
      const [one, two] = await sectionsIn(document, "fr");
      await save(document, "fr", {
        title: "Salut",
        sections: [
          { id: one.id, rank: 1 },
          { id: two.id, rank: 2 },
        ],
      });
      const before = await textRecords(document);
      const rows = await sectionsIn(document, "en");

      await save(document, "en", { sections: [rows[1], rows[0]] });
      await change(document, "en", first, { rank: 7 });

      const order = await sectionsIn(document, "es");
      expect(order.map(row => [row.id, row.rank])).toEqual([
        [second, 2],
        [first, 7],
      ]);
      expect(await textRecords(document)).toEqual(before);
      for (const locale of ["es", "fr"]) {
        expect(
          (await standing(document, locale)).stale,
          locale
        ).toBeUndefined();
      }
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: false });
      expect(await fieldIn(document, "fr")).toBeUndefined();
    });

    // Broken by deleting a path that is no row id, which every text's is not, and by leaving a
    // text of a nested list, or a group's, to its container's rows.
    it("lose their records and suggestions with their row, at every depth and in every language", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", {
        intro: { lead: "lead" },
        sections: [
          { caption: "one", points: [{ label: "p" }, { label: "q" }] },
          { caption: "two", points: [{ label: "r" }] },
        ],
      });
      const [one, two] = await sectionsIn(document, "en");
      const [p, q] = one.points!;
      const es = (row: Section): Section => ({
        ...row,
        caption: `${row.caption}-es`,
        points: row.points!.map(point => ({
          ...point,
          label: `${point.label}-es`,
        })),
      });
      await save(document, "es", {
        intro: { lead: "entrada" },
        sections: [es(one), es(two)],
      });
      const inPoint = (row: string, point: string): UnitAddress => [
        { field: "sections" },
        { row },
        { field: "points" },
        { row: point },
        { field: "label" },
      ];
      const recorded = async () =>
        (await textRecords(document))
          .filter(row => row.locale === "es")
          .map(row => row.fieldPath);
      expect(await recorded()).toEqual(
        expect.arrayContaining([
          unitProvenancePath(LEAD),
          unitProvenancePath(inPoint(one.id, q.id)),
          unitProvenancePath(inPoint(two.id, two.points![0].id)),
        ])
      );
      const kept = [
        inPoint(one.id, p.id),
        [{ field: "sections" }, { row: one.id }, { field: "caption" }],
      ] as const satisfies readonly UnitAddress[];
      const gone = [inPoint(one.id, q.id), inPoint(two.id, two.points![0].id)];
      for (const address of [...kept, ...gone])
        await suggest(document, address);

      await save(document, "en", {
        sections: [{ ...one, points: [p] }],
      });

      expect((await recorded()).sort()).toEqual(
        [unitProvenancePath(LEAD), ...kept.map(unitProvenancePath)].sort()
      );
      const keys = (
        await t!.adapter.select<{ unitKey: string }>(
          TRANSLATION_SUGGESTIONS_TABLE
        )
      ).map(row => row.unitKey);
      expect(keys.sort()).toEqual(kept.map(unitKey).sort());
      // The text they were made from goes with them.
      const sources = await t!.adapter.select<{ fieldPath: string }>(
        "nextly_translation_sources"
      );
      expect(sources.map(row => row.fieldPath).sort()).toEqual(
        [unitProvenancePath(LEAD), ...kept.map(unitProvenancePath)].sort()
      );
    });

    // Broken by replacing every live text with its container's draft, which holds only what it
    // changed, and by leaving the record of a text the draft cleared.
    it("keep their own records through a draft and its publish, but for those it cleared", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(
        kind,
        "drafts",
        "published"
      );
      // Held: one text says where it came from, and another is cleared.
      const rows = await sectionsIn(document, "es");
      await save(document, "es", {
        sections: rows.map(row =>
          row.id === first ? { ...row, caption: "UNO" } : { ...row, alt: null }
        ),
        _provenance: { [at(first)]: { origin: "machine", engine: "e2" } },
      });
      const live = await recordAt(document, "es", at(second));
      expect(live).toMatchObject({ origin: "person" });
      expect(await recordAt(document, "es", at(first))).toMatchObject({
        origin: "person",
      });

      await save(document, "es", { status: "published" });

      expect(await recordAt(document, "es", at(first))).toMatchObject({
        origin: "machine",
        engine: "e2",
        valueFingerprint: valueFingerprint("UNO"),
      });
      expect(await recordAt(document, "es", at(second))).toEqual(live);
      expect(await recordAt(document, "es", at(second, "alt"))).toBeUndefined();
      expect(
        (await recordsOf(document)).filter(row => row.partState === "draft")
      ).toEqual([]);
      // What is live is what the records say it is.
      await change(document, "en", second, { caption: "TWO" });
      await save(document, "en", { status: "published" });
      expect(await ages(document, "es")).toEqual({
        [at(first)]: false,
        [at(first, "alt")]: false,
        [at(second)]: true,
      });
    });

    // Broken by reading a container with no text records as up to date, by bringing its texts up to
    // date with a save that leaves them as they were, and by never recording them.
    it("are read by their container's record until the container is next changed", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(kind);
      await forgetTextRecords();
      expect(await ages(document, "es")).toEqual({});
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: false });
      await change(document, "en", first, { caption: "ONE" });
      await change(document, "en", second, { caption: "TWO" });
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: true });

      // Sent as they were, beside a field that changed.
      await save(document, "es", {
        title: "Buenas",
        sections: inSpanish(first, second),
      });
      expect(await ages(document, "es")).toEqual({});
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: true });
      expect((await standing(document, "es")).stale).toBe(true);

      await change(document, "es", first, { caption: "UNO" });
      expect(await ages(document, "es")).toEqual({
        [at(first)]: false,
        [at(first, "alt")]: false,
        [at(second)]: false,
        [at(second, "alt")]: false,
      });
      await change(document, "en", second, { caption: "two again" });
      expect(await ages(document, "es")).toMatchObject({
        [at(first)]: false,
        [at(second)]: true,
      });
    });

    // Broken by recording the texts beside an accepted one as the accepter's, made now.
    it("stay as their container stood where one is accepted before they have records", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(kind);
      await forgetTextRecords();
      await change(document, "en", first, { caption: "ONE" });
      await change(document, "en", second, { caption: "TWO" });

      await change(
        document,
        "es",
        first,
        { caption: "UNO" },
        accepting(at(first), "ONE")
      );
      expect(await ages(document, "es")).toMatchObject({
        [at(first)]: false,
        [at(second)]: true,
      });
      expect((await standing(document, "es")).stale).toBe(true);
    });

    // Broken by claiming the container alone.
    it("are each a copy where their container is copied", async () => {
      await boot(dialect);
      const { document, first, second } = await translated(kind);
      const rows = await sectionsIn(document, "en");
      const { _rev } = await read(document, "en");
      await save(document, "fr", {
        sections: rows,
        _provenance: {
          sections: {
            origin: "copy",
            sourceLocale: "en",
            sourceRevision: _rev,
          },
        },
      });
      const french = (await textRecords(document)).filter(
        row => row.locale === "fr"
      );
      expect(french.map(row => [row.fieldPath, row.origin]).sort()).toEqual(
        [first, second]
          .flatMap(row => [at(row), at(row, "alt")])
          .map(path => [path, "copy"])
          .sort()
      );
      expect(Object.values(await ages(document, "fr"))).toEqual([
        false,
        false,
        false,
        false,
      ]);
    });

    // Broken by recording only a container the main row already held.
    it("are the language's own in a group nothing was written in before", async () => {
      await boot(dialect);
      const document = await made(kind, "plain", { title: "Hi" });
      await save(document, "es", { intro: { lead: "entrada" } });

      expect((await read(document, "es")).intro).toMatchObject({
        lead: "entrada",
      });
      const english = (await read(document, "en")).intro as {
        lead?: unknown;
      } | null;
      expect(english?.lead ?? null).toBeNull();
      expect(
        (await textRecords(document))
          .filter(row => row.locale === "es")
          .map(row => [row.fieldPath, row.origin])
      ).toEqual([[unitProvenancePath(LEAD), "person"]]);
    });

    // Broken by moving the container's record alone, which its texts are no longer read by.
    it("are marked with their container when it is kept as it is", async () => {
      await boot(dialect);
      const slug = SLUGS[kind].plain;
      await userWhoMay(t!, "ann", "read", [slug]);
      await grantTo(t!, "ann", "update", [slug]);
      const { document, first } = await translated(kind);
      await change(document, "en", first, { caption: "ONE" });
      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: true });

      const asked = { locale: "es", field: "sections" };
      const shown = await sourceChange(document, ANN, asked);
      await keepCurrent(document, ANN, {
        ...asked,
        valueFingerprint: shown.valueFingerprint ?? "",
        sourceFingerprint: shown.sourceFingerprint ?? "",
      });

      expect(await fieldIn(document, "es")).toMatchObject({ outOfDate: false });
      expect((await standing(document, "es")).stale).toBeUndefined();
      await change(document, "en", first, { alt: "A" });
      expect(await ages(document, "es")).toMatchObject({
        [at(first)]: false,
        [at(first, "alt")]: true,
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a collection listed by what is out of date in a language (%s)",
  dialect => {
    // Broken by judging the filter by the container's record and the overview by its texts'.
    it("holds an entry exactly where its overview says so, by its texts", async () => {
      await boot(dialect);
      const { document, first } = await translated("collection");
      const listed = async () => {
        const answer = await handler().listEntries({
          collectionName: "posts",
          where: { _translated: { locale: "es", state: "stale" } },
          overrideAccess: true,
          limit: 50,
        } as never);
        return (answer.data as { docs: unknown[] }).docs.length === 1;
      };
      const agree = async (stale: boolean) => {
        expect((await standing(document, "es")).stale === true).toBe(stale);
        expect(await listed()).toBe(stale);
      };
      await agree(false);
      const rows = await sectionsIn(document, "en");
      await save(document, "en", { sections: [rows[1], rows[0]] });
      await agree(false);
      await change(document, "en", first, { caption: "ONE" });
      await agree(true);
      await change(document, "es", first, { caption: "UNO" });
      await agree(false);
    });
  }
);

/** A Spanish suggestion for the text at `address`, as it is kept. */
async function suggest(
  { slug, kind }: TranslatedDocument,
  address: UnitAddress
): Promise<void> {
  const rows = await t!.adapter.select<{ entryId: string; scopeSlug: string }>(
    PROVENANCE
  );
  const entryId = rows.find(row => row.scopeSlug === slug)?.entryId;
  await t!.adapter.insert(TRANSLATION_SUGGESTIONS_TABLE, {
    id: randomUUID(),
    scopeKind: kind,
    scopeSlug: slug,
    entryId,
    targetLocale: "es",
    sourceLocale: "en",
    fieldPath: address[0].field,
    unitKey: unitKey(address),
    unitAddress: address,
    value: { value: "Hola" },
    origin: "machine",
    sourceFingerprint: valueFingerprint("nothing kept"),
    createdAt: new Date(),
  });
}
