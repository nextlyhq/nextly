/**
 * Every case-insensitive text search ignores case on every dialect, whatever the column's
 * collation, and matches what was typed literally.
 *
 * A collection's `contains` and `search` filters and its search box, and the registry's search,
 * each spelled "contains, ignoring case" for themselves: PostgreSQL's ILIKE, and a plain LIKE
 * elsewhere, which on MySQL follows the column's collation and so became case-sensitive under
 * `utf8mb4_bin`, and which on SQLite treated the escaped `%` and `_` as a backslash followed by a
 * wildcard. They now all compile through the adapter's one rule, `caseInsensitiveContains`.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const TITLES = ["Spring launch", "50% off", "50 years", "a_b", "AXB"];

interface ListHandler {
  listEntries(params: {
    collectionName: string;
    overrideAccess?: boolean;
    search?: string;
    where?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    data?: { docs: { title?: unknown }[] };
  }>;
}

interface CollectionRegistry {
  listCollections(options?: { search?: string; limit?: number }): Promise<{
    data: { slug: string }[];
  }>;
}

interface CollectionsCreator {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

describeEachDialect(
  "text search ignores case and matches literally",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "notes",
            search: { searchableFields: ["title"] },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      for (const title of TITLES) {
        await current.nextly.create({
          collection: "notes",
          data: { title },
          overrideAccess: true,
        });
      }
    });

    afterEach(async () => {
      await current.destroy();
    });

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    /**
     * On MySQL, move the searched text columns (the title, and the slug the search box also reads)
     * to a case-sensitive collation, keeping their stored types. A plain LIKE then compares
     * case-sensitively, which the control below proves, so a search that ignores case only
     * because the default collation does would show here.
     */
    async function makeTextCaseSensitive(): Promise<void> {
      if (dialect !== "mysql") return;
      for (const name of ["title", "slug"]) {
        const [column] = await query<{ type: string; nullable: string }>(
          `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_notes' AND COLUMN_NAME = '${name}'`
        );
        await query(
          `ALTER TABLE dc_notes MODIFY ${name} ${column.type} COLLATE utf8mb4_bin ${column.nullable === "NO" ? "NOT NULL" : "NULL"}`
        );
      }
      const [control] = await query<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM dc_notes WHERE title LIKE '%SPRING%' OR slug LIKE '%SPRING%'"
      );
      expect(Number(control.n)).toBe(0);
    }

    async function titlesWhereContains(value: string): Promise<string[]> {
      const found = await current.nextly.find({
        collection: "notes",
        where: { title: { contains: value } },
        overrideAccess: true,
      });
      return found.items.map(item => String(item.title)).sort();
    }

    async function titlesSearched(value: string): Promise<string[]> {
      const handler = current.getService(
        "collectionsHandler"
      ) as unknown as ListHandler;
      const listed = await handler.listEntries({
        collectionName: "notes",
        overrideAccess: true,
        search: value,
      });
      expect(listed.success, JSON.stringify(listed)).toBe(true);
      return (listed.data?.docs ?? []).map(doc => String(doc.title)).sort();
    }

    it("a `contains` filter ignores case, whatever the collation", async () => {
      await makeTextCaseSensitive();

      expect(await titlesWhereContains("SPRING")).toEqual(["Spring launch"]);
      expect(await titlesWhereContains("LAUNCH")).toEqual(["Spring launch"]);
    });

    it("a `contains` filter matches % and _ as characters", async () => {
      expect(await titlesWhereContains("50%")).toEqual(["50% off"]);
      // As a wildcard, `_` would also match "AXB".
      expect(await titlesWhereContains("A_B")).toEqual(["a_b"]);
    });

    it("the search box ignores case, whatever the collation", async () => {
      await makeTextCaseSensitive();

      // Upper case, which neither the title nor its lower-case slug holds.
      expect(await titlesSearched("SPRING")).toEqual(["Spring launch"]);
    });

    it("the search box matches % and _ as characters", async () => {
      expect(await titlesSearched("50%")).toEqual(["50% off"]);
      expect(await titlesSearched("a_b")).toEqual(["a_b"]);
    });

    it("the collection registry's search matches _ as a character", async () => {
      const creator = current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsCreator;
      for (const name of ["a_b", "axb"]) {
        const created = await creator.createCollection({
          name,
          label: name,
          fields: [],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
      }
      const registry = current.getService(
        "collectionRegistryService"
      ) as unknown as CollectionRegistry;

      const listed = await registry.listCollections({ search: "a_b" });

      expect(listed.data.map(c => c.slug)).toEqual(["a_b"]);
    });

    it("a `contains` filter on a field group's field matches % and _ as characters", async () => {
      // A field group's values live in its own table, and a filter on one is built apart from
      // the collection's own fields.
      await current.destroy();
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "seo",
            fields: [text({ name: "metaTitle" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "pages",
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "seo", component: "seo" }),
            ],
          }),
        ],
      });
      const handler = current.getService(
        "collectionsHandler"
      ) as unknown as ListHandler & {
        createEntry(
          ctx: Record<string, unknown>,
          data: Record<string, unknown>
        ): Promise<unknown>;
      };
      for (const metaTitle of ["a_b", "AXB", "50% off", "50 years"]) {
        await handler.createEntry(
          { collectionName: "pages", overrideAccess: true },
          { title: metaTitle, seo: { metaTitle } }
        );
      }
      const titlesWhere = async (value: string) => {
        const listed = await handler.listEntries({
          collectionName: "pages",
          overrideAccess: true,
          where: { "seo.metaTitle": { contains: value } },
        });
        expect(listed.success, JSON.stringify(listed)).toBe(true);
        return (listed.data?.docs ?? []).map(doc => String(doc.title)).sort();
      };

      expect(await titlesWhere("A_B")).toEqual(["a_b"]);
      expect(await titlesWhere("50%")).toEqual(["50% off"]);
    });
  }
);
