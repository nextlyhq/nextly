/**
 * A status saved in a language that holds a change, on every dialect.
 *
 * A language other than the default keeps its status on its own row, and a collection that keeps
 * drafts may hold a change in it beside what is live. A save that names a status there moves the
 * language to it and folds the change into the language's row, as one of the default language does:
 * a publish puts the change live with it, and taking the language offline puts it in front of
 * nobody and keeps it, so an edit made after it is made on it.
 *
 * The plausible broken implementation folds the held change into the save and writes the language's
 * row from the two, which lost the status: it is neither in the change nor, once moved to the
 * language's row, in the save. The language then kept the status it had, or took a new row's.
 *
 * Every case is paired with the same save over nothing held, so a status that never moves, or a
 * right that was never asked, is not mistaken for the change being kept apart.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

// Drafts kept by part, as every installation keeps them: kept whole, a draft holds the status the
// language had as it was held, and some of these pass for that alone.
perLanguageStorageSuite();

type Doc = Record<string, unknown>;
type Caller = Record<string, unknown>;

const TRUSTED: Caller = { overrideAccess: true };
const SLUG = "articles";

describeEachDialect("a status saved in a held language", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  async function boot(): Promise<void> {
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
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
  }

  const entries = (): CollectionEntryService =>
    (
      t!.getService("collectionsHandler") as CollectionsHandler
    ).getEntryService() as CollectionEntryService;

  /** A signed-in person who may do each of `actions` to the articles. */
  async function person(...actions: string[]): Promise<Caller> {
    const [first = "read", ...rest] = actions;
    const id = await userWhoMay(t!, "ann", first, [SLUG]);
    for (const action of rest) await grantTo(t!, id, action, [SLUG]);
    return { user: { id, roles: [] }, overrideAccess: false };
  }
  const whoMayEverything = () =>
    person("read", "update", "publish", "unpublish");

  /** An entry in English, published or a draft. */
  async function english(status: "published" | "draft"): Promise<string> {
    const made = await entries().createEntry(
      { collectionName: SLUG, locale: "en", ...TRUSTED } as never,
      { title: "Hello", body: "English", status }
    );
    return (made.data as { id: string }).id;
  }

  async function save(
    id: string,
    caller: Caller,
    data: Doc,
    locale = "es"
  ): Promise<{ success: boolean; statusCode?: number }> {
    return entries().updateEntry(
      { collectionName: SLUG, entryId: id, locale, ...caller } as never,
      { ...data, _overwrite: true }
    );
  }

  /** An entry published in both languages, Spanish with `held` held where given. */
  async function published(held?: Doc): Promise<string> {
    const id = await english("published");
    const live = { title: "Hola", body: "Vivo", status: "published" };
    await save(id, TRUSTED, live);
    if (held) await save(id, TRUSTED, held);
    return id;
  }

  /** The language's row as it is stored, or null where there is none. */
  async function row(id: string, locale = "es"): Promise<Doc | null> {
    const rows = await t!.adapter.select<Doc>(`dc_${SLUG}_locales`, {
      where: { and: [{ column: "_parent", op: "=", value: id }] },
    });
    const own = rows.find(each => each._locale === locale);
    return own
      ? { status: own._status, title: own.title, body: own.body }
      : null;
  }

  /** The languages that hold a change. */
  async function held(id: string): Promise<(string | null)[]> {
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
    return rows.map(each => each.locale).sort();
  }

  /** What a reader of published content is served in Spanish. */
  async function served(id: string): Promise<unknown> {
    const found = await t!.nextly.find({
      collection: SLUG as never,
      locale: "es",
      fallbackLocale: false,
      status: "published",
      where: { id: { equals: id } },
    } as never);
    return (found.items as Doc[]).map(item => item.body ?? null);
  }

  /** The last saved version's status in Spanish. */
  async function lastVersion(id: string): Promise<unknown> {
    const rows = await t!.adapter.select<{
      versionNo: number | null;
      locale: string | null;
      snapshot: unknown;
    }>("nextly_versions", {
      where: { and: [{ column: "entryId", op: "=", value: id }] },
    });
    const [last] = rows
      .filter(each => each.versionNo !== null && each.locale === "es")
      .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
    const snapshot: unknown =
      typeof last?.snapshot === "string"
        ? JSON.parse(last.snapshot)
        : last?.snapshot;
    return (snapshot as Doc | undefined)?.status;
  }

  /** The status moves announced while `act` runs, each with its language. */
  async function announced(act: () => Promise<unknown>): Promise<Doc[]> {
    const moves: Doc[] = [];
    const stop = t!.events.on("document.statusTransition", event => {
      const { locale, previousStatus, status } = (event as { payload: Doc })
        .payload;
      moves.push({ locale, previousStatus, status });
    }) as unknown;
    await act();
    if (typeof stop === "function") (stop as () => void)();
    return moves;
  }

  /** The status moves in the document's history, newest first: each kind, and the state it left. */
  async function moves(id: string): Promise<Doc[]> {
    const { items } = await t!.nextly.contentEvents.list({
      subject: { kind: "collection", slug: SLUG, id },
      limit: 100,
    });
    return items
      .filter(({ kind }) => ["published", "unpublished"].includes(kind))
      .map(({ kind, toState }) => ({ kind, toState }));
  }

  const OFFLINE = { status: "draft" };
  const PUBLISH = { status: "published" };
  const HELD = { body: "Retenido" };

  // Broken by taking the language's status from the held change, by dropping the change, and by
  // recording a publish of the document, which the fold is in the default language.
  it.each([
    ["trusted code", () => Promise.resolve(TRUSTED)],
    ["a person who may", whoMayEverything],
  ])("takes it offline with nothing of it served: %s", async (_who, caller) => {
    await boot();
    const who = await caller();
    const plain = await published();
    expect((await save(plain, who, OFFLINE)).success).toBe(true);
    expect(await row(plain)).toMatchObject({ status: "draft", body: "Vivo" });

    const id = await published(HELD);
    expect(await held(id)).toEqual(["es"]);
    const told = await announced(async () => {
      expect((await save(id, who, OFFLINE)).success).toBe(true);
    });

    expect(await row(id)).toMatchObject({ status: "draft", body: "Retenido" });
    expect(await served(id)).not.toContain("Retenido");
    expect(await held(id)).toEqual([]);
    // Recorded as the same save over nothing held is.
    expect(await lastVersion(id)).toBe(await lastVersion(plain));
    expect(await lastVersion(id)).toBe("draft");
    expect(told).toEqual([
      { locale: "es", previousStatus: "published", status: "draft" },
    ]);
    expect(await moves(id)).toEqual(await moves(plain));
    expect((await moves(id))[0]).toMatchObject({ kind: "unpublished" });

    // Nothing is left to come back over an edit made from here.
    await save(id, who, { body: "Nuevo" });
    await save(id, who, PUBLISH);
    expect(await served(id)).toEqual(["Nuevo"]);
  });

  // Broken by taking the language's status from the held change.
  it("publishes one taken offline while it held a change", async () => {
    await boot();
    const who = await whoMayEverything();
    const plain = await published();
    const id = await published(HELD);
    for (const each of [plain, id]) {
      await t!.nextly.unpublish({
        collection: SLUG as never,
        id: each,
        locales: ["es"],
        data: { _overwrite: true },
      } as never);
    }
    expect(await row(id)).toMatchObject({ status: "draft", body: "Vivo" });
    expect(await held(id)).toEqual(["es"]);
    await save(plain, who, PUBLISH);

    const told = await announced(async () => {
      expect((await save(id, who, PUBLISH)).success).toBe(true);
    });

    expect(await row(id)).toMatchObject({
      status: "published",
      body: "Retenido",
    });
    expect(await served(id)).toEqual(["Retenido"]);
    expect(await held(id)).toEqual([]);
    expect(await lastVersion(id)).toBe("published");
    expect(told).toEqual([
      { locale: "es", previousStatus: "draft", status: "published" },
    ]);
    expect((await moves(id))[0]).toEqual((await moves(plain))[0]);
  });

  it("leaves one already published so, and puts the change live", async () => {
    await boot();
    const id = await published(HELD);
    await save(id, TRUSTED, PUBLISH);
    expect(await row(id)).toMatchObject({
      status: "published",
      body: "Retenido",
    });
    expect(await held(id)).toEqual([]);
  });

  // Broken by dropping the caller's status before the gate asks of it.
  it.each([
    ["offline", OFFLINE, true],
    ["live", PUBLISH, false],
  ])(
    "is not moved %s by a person who may only update",
    async (_where, data, live) => {
      await boot();
      const who = await person("read", "update");
      const id = await published(HELD);
      if (!live) {
        await t!.nextly.unpublish({
          collection: SLUG as never,
          id,
          locales: ["es"],
          data: { _overwrite: true },
        } as never);
      }
      const before = await row(id);

      expect((await save(id, who, data)).success).toBe(false);

      expect(await row(id)).toEqual(before);
      expect(await held(id)).toEqual(["es"]);
    }
  );

  // Broken by judging a trusted save by the default language's status alone.
  it.each([
    ["trusted code", () => Promise.resolve(TRUSTED)],
    ["a person who may", whoMayEverything],
  ])(
    "holds a save of a published language under a draft default: %s",
    async (_who, caller) => {
      await boot();
      const who = await caller();
      const id = await english("draft");
      await save(id, TRUSTED, {
        title: "Hola",
        body: "Vivo",
        status: "published",
      });
      await save(id, who, HELD);
      expect(await row(id)).toMatchObject({
        status: "published",
        body: "Vivo",
      });
      expect(await held(id)).toEqual(["es"]);
    }
  );

  // Broken by taking the language's status from the held change.
  it("publishes a language never written, whose first text trusted code held", async () => {
    await boot();
    const id = await english("published");
    await save(id, TRUSTED, { title: "Hola", body: "Nuevo" });
    // Over a live document, as a shared value it may carry would be.
    expect(await row(id)).toBeNull();
    expect(await held(id)).toEqual(["es"]);
    await save(id, TRUSTED, PUBLISH);
    expect(await row(id)).toMatchObject({ status: "published", body: "Nuevo" });
    expect(await served(id)).toEqual(["Nuevo"]);
    expect(await held(id)).toEqual([]);
  });

  // The default language's status is the document's own, never lost.
  it("moves the default language as it did", async () => {
    await boot();
    const id = await published();
    await save(id, TRUSTED, { body: "Held" }, "en");
    expect(await held(id)).toEqual(["en"]);
    await save(id, TRUSTED, PUBLISH, "en");
    expect(await row(id, "en")).toMatchObject({
      status: "published",
      body: "Held",
    });
  });
});
