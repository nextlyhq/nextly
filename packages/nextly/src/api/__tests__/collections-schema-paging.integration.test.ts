/**
 * The schema builder's collection list pages through what its caller may see.
 *
 * The list shows a caller only the collections it may read. Its pages and its
 * `total` are of that list: every page but the last is full, `total` counts
 * every collection the caller may read rather than the ones on one page, and
 * `hasNext` says whether another page follows. A list paged first and filtered
 * after would return short pages, and a total that stops at one page.
 *
 * What a plugin's nav filter hides is gone from the pages and the total too,
 * and the caller's access is read once for the whole list, so listing every
 * collection reads no more about the caller than listing one.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { getTableName, isTable } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  FilterSeams,
  getFilterRegistry,
  resetFilterRegistry,
} from "../../filters";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { invalidateAllPermissionCaches } from "../../services/lib/permissions";
import { GET as listCollectionsSchema } from "../collections-schema";

/** Five collections; the reader may read three, spread among the others. */
const ALL = ["alpha", "bravo", "charlie", "delta", "echo"];
const READABLE = ["bravo", "delta", "echo"];

/**
 * The tables every question about a caller's access is answered from. The
 * role-epoch row is not counted: it is read on a clock, not per question.
 */
const ACCESS_TABLES = new Set([
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
  "api_keys",
]);

type Select = (...args: unknown[]) => { from: (...args: unknown[]) => unknown };

interface Listed {
  items: { slug: string }[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

describe.each(getConfiguredTestDialects())(
  "the schema builder's collection list, paged (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let readerId: string;
    let readerRoleId: string;
    let superAdminId: string;
    let readerKey: string;

    async function session(userId: string, roleIds: string[]) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    async function list(
      headers: Record<string, string>,
      limit: number,
      offset: number
    ): Promise<Listed> {
      const res = await listCollectionsSchema(
        new Request(
          `http://localhost/api/collections/schema?limit=${limit}&offset=${offset}`,
          { headers }
        )
      );
      expect(res.status).toBe(200);
      return (await res.json()) as Listed;
    }

    /**
     * The access tables `work` reads through the instance's Drizzle client,
     * one entry per statement, with every permission cache emptied first.
     */
    async function accessRead(work: () => Promise<unknown>) {
      await invalidateAllPermissionCaches();
      const tables: string[] = [];
      const db = t.adapter.getDrizzle() as { select: Select };
      const select = db.select.bind(db);
      const spy = vi.spyOn(db, "select").mockImplementation((...args) => {
        const builder = select(...args);
        const from = builder.from.bind(builder);
        builder.from = (table: unknown, ...rest: unknown[]) => {
          if (isTable(table) && ACCESS_TABLES.has(getTableName(table))) {
            tables.push(getTableName(table));
          }
          return from(table, ...rest);
        };
        return builder;
      });
      try {
        await work();
      } finally {
        spy.mockRestore();
      }
      return tables;
    }

    /** Every collection the caller is shown, page by page, in order. */
    async function walk(headers: Record<string, string>, limit: number) {
      const pages: Listed[] = [];
      for (let offset = 0; ; offset += limit) {
        const page = await list(headers, limit, offset);
        pages.push(page);
        if (!page.meta.hasNext) break;
        expect(pages.length, "the list must end").toBeLessThan(20);
      }
      return pages;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: ALL.map(slug =>
          defineCollection({ slug, fields: [text({ name: "title" })] })
        ),
      });
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
        permissions: {
          find(a: { limit: number }): Promise<{
            items: { id: string; slug: string }[];
          }>;
        };
        roles: {
          create(a: { data: Record<string, unknown> }): Promise<{
            item: { id: string };
          }>;
        };
      };
      superAdminId = (
        await direct.users.create({
          email: "owner@example.com",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        })
      ).item.id;
      const seeded = await direct.permissions.find({ limit: 1000 });
      readerRoleId = (
        await direct.roles.create({
          data: {
            name: "readers",
            slug: "readers",
            permissionIds: READABLE.map(
              slug => seeded.items.find(p => p.slug === `read-${slug}`)!.id
            ),
          },
        })
      ).item.id;
      readerId = (
        await direct.users.create({
          email: "reader@example.com",
          password: "Password123!",
          data: { name: "Reader", isActive: true, roles: [readerRoleId] },
        })
      ).item.id;
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      readerKey = (
        await keys.createApiKey(readerId, {
          name: "reads three",
          tokenType: "read-only",
          expiresIn: "unlimited",
        })
      ).key;
    }, 120_000);

    afterAll(async () => {
      resetFilterRegistry();
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("pages through exactly the collections a reader may read, with their total", async () => {
      const pages = await walk(await session(readerId, [readerRoleId]), 2);

      // Full pages, then the rest: not a page shortened by what it hid.
      expect(pages.map(p => p.items.length)).toEqual([2, 1]);
      expect(pages.flatMap(p => p.items.map(i => i.slug)).sort()).toEqual(
        READABLE
      );
      for (const [index, page] of pages.entries()) {
        expect(page.meta).toMatchObject({
          total: 3,
          page: index + 1,
          limit: 2,
          totalPages: 2,
          hasNext: index === 0,
          hasPrev: index > 0,
        });
      }
    });

    it("says what follows and precedes from the offset asked, not a page number", async () => {
      // An offset that is not a multiple of the limit: the rest of the list
      // fits, so nothing follows, and something precedes.
      const page = await list(await session(readerId, [readerRoleId]), 2, 1);
      expect(page.items).toHaveLength(2);
      expect(page.meta).toMatchObject({
        total: 3,
        hasNext: false,
        hasPrev: true,
      });
      const last = await list(await session(readerId, [readerRoleId]), 2, 3);
      expect(last.items).toHaveLength(0);
      expect(last.meta).toMatchObject({ hasNext: false, hasPrev: true });
    });

    it("pages an API key's list by the key's own scope, the same way", async () => {
      const pages = await walk({ authorization: `Bearer ${readerKey}` }, 2);
      expect(pages.map(p => p.items.length)).toEqual([2, 1]);
      expect(pages.flatMap(p => p.items.map(i => i.slug)).sort()).toEqual(
        READABLE
      );
      expect(pages[0]!.meta).toMatchObject({ total: 3, hasNext: true });
    });

    it("pages a super-admin through every collection, the same list one page shows", async () => {
      const headers = await session(superAdminId, []);
      const whole = await list(headers, 500, 0);
      expect(whole.items.map(i => i.slug)).toEqual(expect.arrayContaining(ALL));

      const pages = await walk(headers, 2);
      expect(pages.flatMap(p => p.items.map(i => i.slug))).toEqual(
        whole.items.map(i => i.slug)
      );
      expect(pages[0]!.meta.total).toBe(whole.items.length);
      expect(pages.at(-1)!.meta.hasNext).toBe(false);
    });

    it("leaves what a plugin's nav filter hides out of the pages and the total", async () => {
      getFilterRegistry().addFilter(
        FilterSeams.AdminNav,
        (items: Array<{ slug: string }>) =>
          items.filter(item => item.slug !== "delta")
      );
      try {
        const pages = await walk(await session(readerId, [readerRoleId]), 1);
        expect(pages.flatMap(p => p.items.map(i => i.slug)).sort()).toEqual([
          "bravo",
          "echo",
        ]);
        expect(pages.map(p => p.items.length)).toEqual([1, 1]);
        expect(pages[0]!.meta).toMatchObject({
          total: 2,
          totalPages: 2,
          hasNext: true,
        });
      } finally {
        resetFilterRegistry();
      }
    });

    it("reads the reader's access as often for every collection as for one", async () => {
      const headers = await session(readerId, [readerRoleId]);
      const ask = (search: string) =>
        listCollectionsSchema(
          new Request(
            `http://localhost/api/collections/schema?limit=500${search}`,
            { headers }
          )
        ).then(async res => {
          expect(res.status).toBe(200);
          return (await res.json()) as Listed;
        });

      let one: Listed | undefined;
      let every: Listed | undefined;
      const forOne = await accessRead(async () => {
        one = await ask("&search=bravo");
      });
      const forEvery = await accessRead(async () => {
        every = await ask("");
      });

      // POPULATION CONTROL: one list matched one collection and the other
      // all of them, each filtered by the reader's access, and the reader's
      // access was read for both.
      expect(one!.items.map(i => i.slug)).toEqual(["bravo"]);
      expect(every!.items.map(i => i.slug).sort()).toEqual(READABLE);
      expect(forOne.length).toBeGreaterThan(0);
      expect(forEvery.length).toBe(forOne.length);
    });
  }
);
