/**
 * A target collection's read rule may scope reads by one of its own LOCALIZED
 * fields. Populating a relationship has to apply that filter the way the
 * collection's own list read applies it.
 *
 * A localized value is not a column on the main table: it lives in the
 * collection's `_locales` companion, one row per language, and reaches SQL as a
 * correlated EXISTS. Expansion had no companion context, so such a field looked
 * like a column the target does not have — the predicate was reported
 * untranslatable and every row behind the rule was withheld, while a list read
 * of the same collection by the same caller returned them.
 *
 * Withholding was the safe half: a filter that cannot be applied must not be
 * dropped, or the read runs under a weaker predicate than the rule states. What
 * was missing is the language, and it can only come from the read that asked.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const RULE_PATH = new URL(
  "./_fixtures/localized-target-read-rule.ts",
  import.meta.url
).pathname;

interface Seeded {
  handler: CollectionsHandler;
  /** `region` is "emea" in en and "apac" in de. */
  emeaId: string;
  /** `region` is "apac" in every locale. */
  apacId: string;
  /** Points at both pages through one `hasMany` reference. */
  refId: string;
}

/**
 * `pages` is localized and guarded by a rule filtering on its localized
 * `region`; `refs` points at two of its rows through one relationship.
 *
 * The two pages differ in the language their permitted value lives in, so a
 * filter applied against the wrong companion row — or against none — gives a
 * visibly different answer from the right one.
 */
async function boot(): Promise<Seeded> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "region" }),
        ],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "targets", relationTo: "pages", hasMany: true }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });

  const handler = current.getService<CollectionsHandler>("collectionsHandler");

  const emea = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "EMEA page", region: "emea" }
  );
  const apac = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "APAC page", region: "apac" }
  );
  const emeaId = (emea.data as { id: string }).id;
  const apacId = (apac.data as { id: string }).id;

  // The German translation of the permitted page says something else, so the
  // language the filter names decides whether it is readable.
  await handler.updateEntry({
    collectionName: "pages",
    entryId: emeaId,
    data: { region: "apac" },
    locale: "de",
    overrideAccess: true,
  });

  const ref = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    { name: "r", targets: [emeaId, apacId] }
  );

  await current.adapter.update(
    "dynamic_collections",
    { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
    { and: [{ column: "slug", op: "=", value: "pages" }] }
  );

  return { handler, emeaId, apacId, refId: (ref.data as { id: string }).id };
}

/** The ids that actually became rows, in the order the reference holds them. */
async function populatedIds(
  handler: CollectionsHandler,
  refId: string,
  userId: string,
  locale?: string
): Promise<string[]> {
  const result = await handler.getEntry({
    collectionName: "refs",
    entryId: refId,
    user: { id: userId },
    routeAuthorized: true,
    ...(locale ? { locale } : {}),
  });
  expect(result.success).toBe(true);
  const targets = (result.data as { targets?: unknown[] }).targets ?? [];
  // An unpopulated reference stays a bare id string; a populated one is the row.
  return targets
    .filter(
      (value): value is { id: string } =>
        typeof value === "object" && value !== null && "id" in value
    )
    .map(row => row.id);
}

/** The ids the target collection's own list read returns for this caller. */
async function listedIds(
  handler: CollectionsHandler,
  userId: string,
  locale?: string
): Promise<string[]> {
  const result = await handler.listEntries({
    collectionName: "pages",
    user: { id: userId },
    routeAuthorized: true,
    ...(locale ? { locale } : {}),
  });
  expect(result.success).toBe(true);
  return (result.data!.docs as { id: string }[]).map(doc => doc.id);
}

describe("localized target read predicates (integration)", () => {
  it("populates a row its target's localized predicate admits", async () => {
    const { handler, emeaId, refId } = await boot();

    // The rule permits exactly this row in the language being read. Without a
    // companion context the predicate is untranslatable and both rows are
    // withheld, so the reference comes back as bare ids.
    expect(await populatedIds(handler, refId, "emea-only")).toEqual([emeaId]);
  });

  it("still withholds a row the localized predicate excludes", async () => {
    const { handler, apacId, refId } = await boot();

    // The mirror, and the reason the test above is not simply the gate being
    // switched off: the row whose translation the rule excludes must stay
    // unpopulated.
    expect(await populatedIds(handler, refId, "emea-only")).not.toContain(
      apacId
    );
  });

  it("judges the predicate in the language being read", async () => {
    const { handler, emeaId, refId } = await boot();

    // Same rule, same row, different language: its German translation says
    // "apac", so reading in German must not populate it. This is what fails
    // when a filter is applied against whichever companion row exists rather
    // than the one for the requested locale.
    expect(await populatedIds(handler, refId, "emea-only", "en")).toEqual([
      emeaId,
    ]);
    expect(await populatedIds(handler, refId, "emea-only", "de")).toEqual([]);
  });

  it("agrees with the target collection's own list read", async () => {
    const { handler, refId } = await boot();

    // The property the whole change exists to establish: a row is readable
    // through a relationship exactly when the collection that owns it says it
    // is readable. Asserted per language, because the rule answers each one
    // differently.
    for (const locale of ["en", "de"]) {
      expect(await populatedIds(handler, refId, "emea-only", locale)).toEqual(
        await listedIds(handler, "emea-only", locale)
      );
    }
  });

  it("withholds when the read asked for every language at once", async () => {
    const { handler, refId } = await boot();

    // `locale=all` returns language-keyed values rather than one translation,
    // so there is no single language for a companion filter to name. Withholding
    // is the honest answer: applying the filter to an arbitrary language would
    // decide the read on a translation the caller never asked about.
    expect(await populatedIds(handler, refId, "emea-only", "all")).toEqual([]);
  });

  it("does not admit a row whose permitted translation is only a draft", async () => {
    // The target's own list read constrains the companion filter by the status
    // it resolved for this caller, so an unpublished translation cannot satisfy
    // it. Expansion has to do the same: a draft translation holding the
    // permitted value would otherwise make population the more permissive way
    // in, which is the shape of every bug in this area.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          status: true,
          access: { create: () => true, update: () => true },
          fields: [
            text({ name: "title", localized: false }),
            text({ name: "region" }),
          ],
        }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({
              name: "targets",
              relationTo: "pages",
              hasMany: true,
            }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Page", region: "apac", status: "published" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", targets: [pageId] }
    );
    const refId = (ref.data as { id: string }).id;
    await current.adapter.update(
      "dynamic_collections",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "pages" }] }
    );

    // The German translation carries the permitted value and is NOT published.
    // Written into the migration-owned companion table directly, through the
    // typed adapter: the write path cannot currently produce this state (a
    // localized update of a status-enabled collection fails), and the state is
    // the premise of the test rather than the thing under test.
    await current.adapter.insert("dc_pages_locales", {
      _parent: pageId,
      _locale: "de",
      _status: "draft",
      region: "emea",
    });

    // Asserted, not assumed: the row has to be there AND be a draft, or the
    // withholding below would prove nothing (an absent row withholds too).
    const seeded = (
      (await current.adapter.select("dc_pages_locales")) as Record<
        string,
        unknown
      >[]
    ).find(row => row._locale === "de");
    expect(seeded, "the German translation should exist").toBeDefined();
    expect(seeded!._status).toBe("draft");
    expect(seeded!.region).toBe("emea");

    expect(await populatedIds(handler, refId, "emea-only", "de")).toEqual([]);

    // Publishing that same translation admits the row, so the withholding above
    // is about its status and not about the language, the value, or a missing
    // companion row.
    await current.adapter.update(
      "dc_pages_locales",
      { _status: "published" },
      {
        and: [
          { column: "_parent", op: "=", value: pageId },
          { column: "_locale", op: "=", value: "de" },
        ],
      }
    );

    expect(await populatedIds(handler, refId, "emea-only", "de")).toEqual([
      pageId,
    ]);
  });

  it("withholds a localized predicate that cannot be translated exactly", async () => {
    const { handler, refId } = await boot();

    // Having a companion context does not make every shape applicable. A dotted
    // path translates to a comparison against the whole value, which is a
    // different predicate than the rule states — so it is still refused, and
    // refusal still reads as an absent relationship rather than an error.
    expect(await populatedIds(handler, refId, "dotted-localized")).toEqual([]);
  });
});
