/**
 * The translation worklist lists one language's outstanding work across every collection and
 * Single the caller may read, page by page: Singles beside collection entries, a collection the
 * caller may not read left out, and the rows a read rule withholds left out too. Its "stale" tab
 * reads the same per-field answer the translation overview gives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", async importActual => {
  const actual = await importActual<typeof import("../../auth/middleware")>();
  return {
    ...actual,
    requireAuthentication: vi.fn(async () => ({
      userId: "u1",
      userEmail: "u@x.test",
      userName: "U",
      authMethod: "session" as const,
      permissions: [] as string[],
      claims: {},
    })),
  };
});

// A Single's document lookup fails for the slugs named here, as a database error would.
const lookup = vi.hoisted(() => ({ fails: new Set<string>() }));
vi.mock(
  "../../domains/singles/services/single-document-access",
  async importActual => {
    const actual =
      await importActual<
        typeof import("../../domains/singles/services/single-document-access")
      >();
    return {
      ...actual,
      resolveSingleDocumentId: vi.fn(
        async (
          ...args: Parameters<typeof actual.resolveSingleDocumentId>
        ): ReturnType<typeof actual.resolveSingleDocumentId> => {
          if (lookup.fails.has(args[0])) throw new Error("lookup failed");
          return actual.resolveSingleDocumentId(...args);
        }
      ),
    };
  }
);

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  lookup.fails.clear();
  await current?.destroy();
  current = undefined;
});

interface WorkRow {
  kind?: string;
  collection: string;
  id: string;
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        // The caller reads only the public pages.
        access: {
          read: () => ({ team: { equals: "public" } }) as unknown as boolean,
        },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "summary", localized: true }),
          text({ name: "team", localized: false }),
        ],
      }),
      // A collection the caller may not read at all.
      defineCollection({
        slug: "secrets",
        localized: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  await userWhoMay(current, "u1", "read", ["pages", "banner"]);
  return current;
}

async function worklist(query: string): Promise<{
  items: WorkRow[];
  meta: Record<string, unknown>;
}> {
  const { getTranslationWorklist } = await import("../translations");
  const res = await getTranslationWorklist(
    new Request(`http://t/api/translations?${query}`)
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    items: WorkRow[];
    meta: Record<string, unknown>;
  };
}

describe("the translation worklist, page by page", () => {
  it("lists every readable document missing the language, Singles included, across pages", async () => {
    const t = await boot();
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) {
      const created = (await t.nextly.create({
        collection: "pages",
        locale: "en",
        data: { title, team: "public" },
      })) as unknown as { item: { id: string } };
      ids.push(created.item.id);
    }
    await t.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hidden", team: "private" },
    });
    await t.nextly.create({
      collection: "secrets",
      locale: "en",
      data: { title: "S" },
    });
    await t.nextly.updateSingle({
      slug: "banner",
      locale: "en",
      data: { headline: "Sale", _overwrite: true },
    } as never);

    const first = await worklist("locale=de&state=missing&limit=2&page=1");
    const second = await worklist("locale=de&state=missing&limit=2&page=2");

    expect(first.items).toHaveLength(2);
    expect(first.meta).toMatchObject({
      total: 4,
      page: 1,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
    expect(second.items).toHaveLength(2);
    expect(second.meta).toMatchObject({
      page: 2,
      hasNext: false,
      hasPrev: true,
    });

    const listed = [...first.items, ...second.items];
    expect(new Set(listed.map(row => `${row.collection}:${row.id}`)).size).toBe(
      4
    );
    expect(
      listed
        .filter(row => row.collection === "pages")
        .map(row => row.id)
        .sort()
    ).toEqual([...ids].sort());
    expect(listed.filter(row => row.collection === "banner")).toEqual([
      expect.objectContaining({ kind: "single", collection: "banner" }),
    ]);
    expect(listed.some(row => row.collection === "secrets")).toBe(false);
  });

  it("lists a translation whose source changed under stale, and only that one", async () => {
    const t = await boot();
    const handler = t.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const ids: string[] = [];
    for (const title of ["A", "B"]) {
      const created = (await t.nextly.create({
        collection: "pages",
        locale: "en",
        data: { title, team: "public" },
      })) as unknown as { item: { id: string } };
      ids.push(created.item.id);
      await handler.updateEntry(
        {
          collectionName: "pages",
          entryId: created.item.id,
          overrideAccess: true,
          locale: "de",
          user: { id: "u1" },
        },
        { title: `${title} (de)`, _overwrite: true }
      );
    }
    // A second later, so a language-level stamp would see both sources move.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const english = (id: string, data: Record<string, unknown>) =>
      handler.updateEntry(
        {
          collectionName: "pages",
          entryId: id,
          overrideAccess: true,
          locale: "en",
          user: { id: "u1" },
        },
        { ...data, _overwrite: true }
      );
    // A's translated title changes at its source. B's summary changes, which
    // German never translated: nothing German was made from it.
    await english(ids[0], { title: "A, changed" });
    await english(ids[1], { summary: "A summary" });

    const stale = await worklist("locale=de&state=stale");
    expect(stale.items.map(row => row.id)).toEqual([ids[0]]);
  });

  it("names a Single whose document cannot be looked up as not consulted, and answers for the rest", async () => {
    // One Single's lookup failing is that Single's answer missing, not the worklist's: the rest
    // is listed, and the Single is named as not consulted, as a collection whose read fails is.
    const t = await boot();
    await t.nextly.updateSingle({
      slug: "banner",
      locale: "en",
      data: { headline: "Sale", _overwrite: true },
    } as never);
    await t.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Home", team: "public" },
    });
    lookup.fails.add("banner");

    const { items, meta } = await worklist("locale=de&state=missing");
    expect(items.map(item => item.collection)).toEqual(["pages"]);
    expect(meta.notConsulted).toEqual(expect.arrayContaining(["banner"]));
  });
});
