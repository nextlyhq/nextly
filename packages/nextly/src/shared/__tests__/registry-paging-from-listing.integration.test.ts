/**
 * The registry's pages, totals, searches and sorts, derived from the listing
 * the process already holds, on every dialect.
 *
 * The admin's navigation asks for `/collections` and `/singles` with a page
 * and a size on every screen. Each answer is now cut from the registry
 * listing kept under the stored schema version (`cachedRegistryListing`)
 * rather than counted and paged by a query each time. What that must keep:
 * - every filter, the reader's allowlist above all, applies before the total
 *   is counted, so a total never counts a row the reader cannot see;
 * - a search matches without regard to case on every dialect, and a typed
 *   `%` or `_` is a character to find rather than a wildcard;
 * - an unchanged registry costs no statement, a change made here is seen at
 *   once, and one made by another copy once the stored count is read again;
 * - inside a transaction the page is read from the database, as the listing
 *   is.
 *
 * The answers are written out here rather than computed by the code under
 * test.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { recordStatements } from "../../__tests__/helpers/record-statements";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../config";
import { DynamicCollectionRegistryService } from "../../domains/dynamic-collections/services/dynamic-collection-registry-service";
import { storeSchemaVersion } from "../../domains/schema/schema-version";
import {
  SCHEMA_VERSION_READ_INTERVAL_MS,
  storedSchemaSeq,
} from "../../domains/schema/stored-schema-seq";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { Logger } from "../types";

const ORIGIN = "http://localhost";
const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** 23 plain collections, then two with descriptions: 25 in all. */
const ITEMS = Array.from(
  { length: 23 },
  (_, i) => `item-${String(i + 1).padStart(2, "0")}`
);
const COLLECTIONS = [
  ...ITEMS.map(slug =>
    defineCollection({ slug, fields: [text({ name: "title" })] })
  ),
  defineCollection({
    slug: "posts",
    description: "Blog Posts",
    fields: [text({ name: "title" })],
  }),
  defineCollection({
    slug: "pages",
    description: "Static pages, 100%_literal",
    fields: [text({ name: "title" })],
  }),
];
const SINGLES = Array.from({ length: 8 }, (_, i) =>
  defineSingle({
    slug: `single-${i + 1}`,
    label: { singular: i === 0 ? "Home Page" : `Single ${i + 1}` },
    fields: [text({ name: "heading" })],
  })
);

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** The statements of `texts` that read a registry table. */
function registryReads(texts: readonly string[]): string[] {
  return texts.filter(text =>
    /\bfrom\s+["`]?(dynamic_collections|dynamic_singles)["`]?/i.test(text)
  );
}

describe.each(getConfiguredTestDialects())(
  "registry pages from the listing (%s)",
  dialect => {
    async function boot(): Promise<{
      t: TestNextly;
      collections: DynamicCollectionRegistryService;
      singles: SingleRegistryService;
    }> {
      const t = (current = await createTestNextly({
        dialect,
        collections: COLLECTIONS,
        singles: SINGLES,
      }));
      // Followed from here on, as a server copy follows it from its first
      // request.
      await storedSchemaSeq(t.adapter, { fresh: true });
      return {
        t,
        collections: new DynamicCollectionRegistryService(t.adapter, silent),
        singles: new SingleRegistryService(t.adapter, silent),
      };
    }

    async function slugsOf(
      registry: DynamicCollectionRegistryService,
      options: Parameters<
        DynamicCollectionRegistryService["listCollections"]
      >[0]
    ): Promise<{ slugs: string[]; total: number; totalPages: number }> {
      const listed = await registry.listCollections({
        source: "code",
        ...options,
      });
      return {
        slugs: listed.collections.map(c => c.slug),
        total: listed.total,
        totalPages: listed.totalPages,
      };
    }

    it("pages, sorts and counts collections as written out", async () => {
      const { collections } = await boot();

      expect(
        await slugsOf(collections, {
          page: 1,
          limit: 5,
          sortBy: "name",
          sortOrder: "asc",
        })
      ).toEqual({
        slugs: ["item-01", "item-02", "item-03", "item-04", "item-05"],
        total: 25,
        totalPages: 5,
      });
      expect(
        await slugsOf(collections, {
          page: 5,
          limit: 5,
          sortBy: "name",
          sortOrder: "asc",
        })
      ).toEqual({
        slugs: ["item-21", "item-22", "item-23", "pages", "posts"],
        total: 25,
        totalPages: 5,
      });
      expect(
        await slugsOf(collections, {
          page: 1,
          limit: 3,
          sortBy: "slug",
          sortOrder: "desc",
        })
      ).toEqual({
        slugs: ["posts", "pages", "item-23"],
        total: 25,
        totalPages: 9,
      });
      // Past the last page: nothing on it, the total unchanged.
      expect(
        await slugsOf(collections, { page: 4, limit: 10, sortBy: "name" })
      ).toEqual({ slugs: [], total: 25, totalPages: 3 });
      // The fields are dropped only when asked.
      const schemaless = await collections.listCollections({
        source: "code",
        limit: 1,
        includeSchema: false,
      });
      expect(schemaless.collections[0]).not.toHaveProperty("fields");
      const withSchema = await collections.listCollections({
        source: "code",
        limit: 1,
      });
      expect(Array.isArray(withSchema.collections[0].fields)).toBe(true);
    });

    it("applies the allowlist and the denylist before counting", async () => {
      const { collections } = await boot();

      expect(
        await slugsOf(collections, {
          page: 2,
          limit: 2,
          sortBy: "name",
          sortOrder: "asc",
          slugAllowlist: ["item-03", "posts", "item-10", "pages", "nope"],
          slugDenylist: ["pages"],
        })
      ).toEqual({ slugs: ["posts"], total: 3, totalPages: 2 });
      expect(
        await slugsOf(collections, { slugAllowlist: [], limit: 10 })
      ).toEqual({ slugs: [], total: 0, totalPages: 0 });
      expect(
        await slugsOf(collections, {
          limit: 50,
          sortBy: "name",
          source: "ui",
        })
      ).toEqual({ slugs: [], total: 0, totalPages: 0 });
    });

    it("searches slugs and descriptions without regard to case, and literally", async () => {
      const { collections } = await boot();

      for (const search of ["post", "POST", "Blog posts"]) {
        expect(
          await slugsOf(collections, { search, limit: 10, sortBy: "name" }),
          search
        ).toEqual({ slugs: ["posts"], total: 1, totalPages: 1 });
      }
      expect(
        await slugsOf(collections, { search: "PAGE", sortBy: "name" })
      ).toEqual({ slugs: ["pages"], total: 1, totalPages: 1 });
      // A `%` and an `_` are characters to find, not wildcards.
      expect(
        await slugsOf(collections, { search: "100%_lit", sortBy: "name" })
      ).toEqual({ slugs: ["pages"], total: 1, totalPages: 1 });
      expect(
        await slugsOf(collections, { search: "item%", sortBy: "name" })
      ).toEqual({ slugs: [], total: 0, totalPages: 0 });
    });

    it("pages Singles with the allowlist before the total, and searches their labels", async () => {
      const { singles } = await boot();

      const pages = await Promise.all(
        [0, 3, 6].map(offset => singles.listSingles({ offset, limit: 3 }))
      );
      expect(pages.map(page => page.total)).toEqual([8, 8, 8]);
      expect(pages.map(page => page.data.length)).toEqual([3, 3, 2]);
      expect(
        pages.flatMap(page => page.data.map(single => single.slug)).sort()
      ).toEqual(SINGLES.map(single => single.slug).sort());

      const allowed = await singles.listSingles({
        slugAllowlist: ["single-2", "single-5", "single-9"],
        offset: 0,
        limit: 1,
      });
      expect(allowed.total).toBe(2);
      expect(allowed.data).toHaveLength(1);
      expect(["single-2", "single-5"]).toContain(allowed.data[0].slug);
      expect(
        await singles.listSingles({ slugAllowlist: [], limit: 5 })
      ).toEqual({ data: [], total: 0 });

      const found = await singles.listSingles({ search: "hOME pAGE" });
      expect(found.data.map(single => single.slug)).toEqual(["single-1"]);
      expect(found.total).toBe(1);
    });

    it("counts only what the reader may see, through the admin's request", async () => {
      const { t } = await boot();
      const reader = await userWhoMay(t, "registry-page-reader", "read", [
        "item-02",
        "posts",
        "item-07",
      ]);
      const token = await signAccessToken(
        buildClaims({
          userId: reader,
          email: `${reader}@example.test`,
          name: reader,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const response = await createDynamicHandlers().GET(
        new Request(
          `${ORIGIN}/admin/api/collections?limit=2&page=1&sortBy=name&sortOrder=asc`,
          { headers: { origin: ORIGIN, cookie: `nextly_session=${token}` } }
        ),
        { params: Promise.resolve({ params: ["collections"] }) }
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        items: { slug?: string; name?: string }[];
        meta: { total: number; totalPages: number };
      };
      expect(body.items.map(item => item.slug ?? item.name)).toEqual([
        "item-02",
        "item-07",
      ]);
      expect(body.meta.total).toBe(3);
      expect(body.meta.totalPages).toBe(2);
    });

    it("sends no statement for an unchanged registry, and sees a change made here at once", async () => {
      const { t, collections, singles } = await boot();
      await collections.listCollections({ limit: 100, sortBy: "name" });
      await singles.listSingles({ limit: 100 });

      const recorder = await recordStatements(t.adapter, dialect);
      try {
        await collections.listCollections({ limit: 100, sortBy: "name" });
        await singles.listSingles({ limit: 100 });
      } finally {
        recorder.uninstall();
      }
      expect(recorder.statements).toEqual([]);

      await collections.updateCollectionMetadata("posts", {
        description: "Changed here",
      });
      expect(
        (
          await collections.listCollections({ search: "changed here" })
        ).collections.map(c => c.slug)
      ).toEqual(["posts"]);
    });

    it("sees another copy's change once the count is read again, and not before", async () => {
      const { t, collections } = await boot();
      expect(
        (await collections.listCollections({ search: "elsewhere" })).total
      ).toBe(0);

      await t.adapter.transaction(async tx => {
        await tx.update(
          "dynamic_collections",
          { description: "Changed elsewhere" },
          { and: [{ column: "slug", op: "=", value: "posts" }] }
        );
        await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
      });

      expect(
        (await collections.listCollections({ search: "elsewhere" })).total
      ).toBe(0);
      await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
      expect(
        (
          await collections.listCollections({ search: "elsewhere" })
        ).collections.map(c => c.slug)
      ).toEqual(["posts"]);
    });

    it("reads the page from the database inside a transaction", async () => {
      const { t, collections } = await boot();
      // Kept outside first, so a page served from memory would send nothing.
      await collections.listCollections({ limit: 5 });

      const recorder = await recordStatements(t.adapter, dialect);
      let total = 0;
      try {
        await t.adapter.transaction(async () => {
          total = (await collections.listCollections({ limit: 5 })).total;
        });
      } finally {
        recorder.uninstall();
      }
      expect(total).toBeGreaterThanOrEqual(25);
      expect(registryReads(recorder.statements).length).toBeGreaterThan(0);
    });
  }
);
