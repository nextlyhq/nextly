/**
 * Translated text sent in the save that names a status, over a change its language holds, on every
 * dialect.
 *
 * Such a save folds the held change into the language's row. What it sends is the newest word on
 * each key it sends, so it is laid over the change; a key it leaves out keeps the change's value.
 * An editor's publish is one of these: it sends what was typed since the last save beside the
 * status.
 *
 * The plausible broken implementation folds the change into what is left of the payload once the
 * split has moved its translated values to the language's row, so the save answers success with the
 * text it was sent nowhere. The default language's values are moved as any other's.
 *
 * Each case is paired with the same save over nothing held, which always stored what it was sent.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { defineCollection, json, repeater, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

// Drafts kept by part, as every installation keeps them.
perLanguageStorageSuite();

type Doc = Record<string, unknown>;
type Caller = Record<string, unknown>;

const TRUSTED: Caller = { overrideAccess: true };
const SLUG = "articles";

const parsed = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;

describeEachDialect("text sent with a status over a held change", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  /** Articles, with a list of points where `withPoints` says so. */
  async function boot(withPoints = false): Promise<void> {
    t = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: SLUG,
          localized: true,
          status: true,
          versions: { drafts: true },
          access: {
            read: () => true,
            update: () => true,
            publish: () => true,
            unpublish: () => true,
          },
          fields: [
            text({
              name: "title",
              validate: (value: unknown) =>
                value !== "REFUSED" || "This title is not allowed.",
            }),
            text({ name: "body" }),
            json({ name: "facts", localized: true } as never),
            ...(withPoints
              ? [repeater({ name: "points", fields: [text({ name: "note" })] })]
              : []),
          ],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
  }

  const entries = (): CollectionEntryService =>
    (
      t!.getService("collectionsHandler") as CollectionsHandler
    ).getEntryService() as CollectionEntryService;

  async function person(): Promise<Caller> {
    const id = await userWhoMay(t!, "ann", "update", [SLUG]);
    for (const action of ["read", "publish", "unpublish"]) {
      await grantTo(t!, id, action, [SLUG]);
    }
    return { user: { id, roles: [] }, overrideAccess: false };
  }

  async function save(
    id: string,
    caller: Caller,
    data: Doc,
    locale: string
  ): Promise<{ success: boolean }> {
    return entries().updateEntry(
      { collectionName: SLUG, entryId: id, locale, ...caller } as never,
      { ...data, _overwrite: true }
    );
  }

  /** An entry published in both languages. */
  async function published(): Promise<string> {
    const made = await entries().createEntry(
      { collectionName: SLUG, locale: "en", ...TRUSTED } as never,
      {
        title: "Live",
        body: "Live",
        status: "published",
      }
    );
    const id = (made.data as { id: string }).id;
    const live = { title: "Vivo", body: "Vivo", status: "published" };
    await save(id, TRUSTED, live, "es");
    return id;
  }

  /** The entry as it stands in a language, live, with nothing filled from another. */
  async function stored(id: string, locale: string): Promise<Doc> {
    const found = await entries().getEntry({
      collectionName: SLUG,
      entryId: id,
      locale,
      fallbackLocale: false,
      ...TRUSTED,
    } as never);
    return found.data as Doc;
  }

  /** Every saved version's snapshot in a language, newest first. */
  async function versions(id: string, locale: string): Promise<Doc[]> {
    const rows = await t!.adapter.select<{
      versionNo: number | null;
      locale: string | null;
      snapshot: unknown;
    }>("nextly_versions", {
      where: { and: [{ column: "entryId", op: "=", value: id }] },
    });
    return rows
      .filter(each => each.versionNo !== null && each.locale === locale)
      .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
      .map(each => parsed(each.snapshot) as Doc);
  }

  const holding = async (id: string, data: Doc, locale: string) => {
    await save(id, TRUSTED, data, locale);
    const rows = await t!.adapter.select<{ locale: string | null }>(
      "nextly_versions",
      {
        where: {
          and: [
            { column: "entryId", op: "=", value: id },
            { column: "isAutosave", op: "=", value: false },
            { column: "versionNo", op: "IS NULL" },
          ],
        },
      }
    );
    // Held, or what follows proves nothing.
    expect(rows.map(each => each.locale)).toContain(locale);
  };

  describe.each([
    ["trusted code", false],
    ["a person who may", true],
  ])("%s", (_who, asPerson) => {
    // Broken by folding the change into the payload the split left.
    it.each([
      ["es", "draft"],
      ["es", "published"],
      ["en", "published"],
      ["en", "draft"],
    ])("is stored in %s saved %s", async (locale, status) => {
      await boot();
      const who = asPerson ? await person() : TRUSTED;
      const plain = await published();
      const id = await published();
      await holding(id, { title: "Held", body: "Held" }, locale);

      for (const each of [plain, id]) {
        const done = await save(each, who, { status, body: "Sent" }, locale);
        expect(done.success).toBe(true);
      }

      expect(await stored(plain, locale)).toMatchObject({ body: "Sent" });
      expect(await stored(id, locale)).toMatchObject({
        title: "Held",
        body: "Sent",
      });
      // Read as it is stored by the version the save recorded.
      expect((await versions(id, locale))[0]).toMatchObject({
        status,
        title: "Held",
        body: "Sent",
      });
    });
  });

  it("keeps the change's value for a key left out, or sent as undefined", async () => {
    await boot();
    const id = await published();
    await holding(id, { title: "Held", body: "Held" }, "en");
    await save(id, TRUSTED, { status: "published", body: undefined }, "en");
    expect(await stored(id, "en")).toMatchObject({
      title: "Held",
      body: "Held",
    });
  });

  it("clears what it sends as null", async () => {
    await boot();
    const id = await published();
    await holding(id, { title: "Held", body: "Held" }, "es");
    await save(id, TRUSTED, { status: "published", body: null }, "es");
    expect(await stored(id, "es")).toMatchObject({ title: "Held", body: null });
  });

  it("lays a structured value over the change's", async () => {
    await boot();
    const id = await published();
    await holding(id, { facts: { from: "held" }, body: "Held" }, "en");
    await save(
      id,
      TRUSTED,
      { status: "published", facts: { from: "sent" } },
      "en"
    );
    const now = await stored(id, "en");
    expect(parsed(now.facts)).toEqual({ from: "sent" });
    expect(now).toMatchObject({ body: "Held" });
  });

  it("lays a list as it was sent over the change's, with the other text it sends", async () => {
    await boot(true);
    const id = await published();
    const points = (note: string) => [{ id: "p", note }];
    await save(
      id,
      TRUSTED,
      { points: points("Live"), status: "published" },
      "en"
    );
    await holding(id, { body: "Held", points: points("Held") }, "en");
    await save(
      id,
      TRUSTED,
      { status: "published", body: "Sent", points: points("Sent") },
      "en"
    );
    expect(await stored(id, "en")).toMatchObject({
      body: "Sent",
      points: points("Sent"),
    });
  });

  // Broken by judging the change on its own: what goes live is judged, and that is what was sent.
  it("is judged as it goes live", async () => {
    await boot();
    const id = await published();
    await holding(id, { title: "Held", body: "Held" }, "en");
    // A held value its rule has come to refuse.
    await t!.adapter.update(
      "nextly_versions",
      { snapshot: JSON.stringify({ title: "REFUSED", body: "Held" }) },
      {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "versionNo", op: "IS NULL" },
          { column: "locale", op: "=", value: "en" },
        ],
      }
    );
    await expect(
      save(id, TRUSTED, { status: "published" }, "en").then(
        done => done.success,
        () => false
      )
    ).resolves.toBe(false);

    const done = await save(
      id,
      TRUSTED,
      { status: "published", title: "Sent" },
      "en"
    );
    expect(done.success).toBe(true);
    expect(await stored(id, "en")).toMatchObject({
      title: "Sent",
      body: "Held",
    });
  });
});
