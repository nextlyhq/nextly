/**
 * A many-to-many keeps the table holding its links through a Schema Builder save, on every dialect.
 *
 * A many-to-many is stored with `options: { target, relationType: "manyToMany" }`, and its links
 * live in a table of their own. The admin used to send such a field back without its `options`,
 * which made every Builder save of the collection either refused (a field stored the earlier way,
 * with no `relationTo`) or drop that table with its links (a field with `relationTo`, or one whose
 * collection the person picked again). The admin now sends the stored `options` back (see the
 * admin's `field-transformers.legacy-many-to-many.test.ts`, which pins each field below as the
 * Builder sends it); these cases send exactly that and read what the registry stores and what the
 * link table holds afterwards.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { ServiceContainer } from "../../../../services";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

/** The many-to-many as the earlier version stored it: its target in `options`, no `relationTo`. */
const LEGACY_TAGS = {
  name: "tags",
  label: "Tags",
  type: "relationship",
  options: { target: "lm_tags", relationType: "manyToMany" },
};

/** The field as the admin's save sends it back, unedited: its stored `options` kept. */
const SENT_TAGS = {
  name: "tags",
  label: "Tags",
  type: "relationship",
  options: { target: "lm_tags", relationType: "manyToMany" },
};

/** Reads and writes made straight to the database, in each dialect's own spelling. */
function sqlOf(t: TestNextly, dialect: TestDialect) {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const query = <T>(sql: string): Promise<T[]> =>
    (
      t.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  /** A table's column names. */
  const columnsOf = async (table: string): Promise<string[]> =>
    (
      await query<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' ORDER BY ordinal_position`
      )
    ).map(row => row.name);
  /** The tables whose names start with `prefix`. */
  const tablesLike = async (prefix: string): Promise<string[]> =>
    (
      await query<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '${prefix}%'`
          : dialect === "mysql"
            ? `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${prefix}%'`
            : `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE '${prefix}%'`
      )
    )
      .map(row => row.name)
      .sort();
  /** A moment as each dialect's timestamp column takes it. */
  const moment =
    dialect === "mysql"
      ? "'2026-11-18 00:00:00'"
      : "'2026-11-18T00:00:00.000Z'";
  return { q, query, columnsOf, tablesLike, moment };
}

describeEachDialect(
  "a many-to-many stored with options.target, saved again in the Builder",
  dialect => {
    let t: TestNextly;
    let basePath: string;
    let junction: string;
    let sql: ReturnType<typeof sqlOf>;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-legacy-m2m-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      sql = sqlOf(t, dialect as TestDialect);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      // The target through the Builder's own create, so the definition file knows it; the
      // many-to-many's collection as the earlier version left it, in the registry alone.
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "lm_tags",
          label: "Tag",
          fields: [{ name: "label", type: "text" }],
        }
      );
      // Another collection the person may pick instead.
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "lm_other",
          label: "Other",
          fields: [{ name: "label", type: "text" }],
        }
      );
      await seedBuilderCollection(adapter, {
        slug: "lm_posts",
        fields: [{ name: "body", type: "text" }, LEGACY_TAGS],
      });
      junction = new DynamicCollectionSchemaService(
        undefined,
        dialect as TestDialect
      ).junctionTableNameFor("dc_lm_posts", LEGACY_TAGS as FieldDefinition);
      const { q, query, columnsOf, moment } = sql;
      await query(
        `INSERT INTO ${q("dc_lm_tags")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("label")}) VALUES ('t1', 'News', 't1', 'News')`
      );
      await query(
        `INSERT INTO ${q("dc_lm_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('p1', 'Hello', 'p1', 'x')`
      );
      const columns = await columnsOf(junction);
      await query(
        `INSERT INTO ${q(junction)} (${columns.map(q).join(", ")}) VALUES (${columns
          .map(c =>
            c === "id"
              ? "'j1'"
              : /source|post|parent/.test(c)
                ? "'p1'"
                : /target|tag|child|related/.test(c)
                  ? "'t1'"
                  : /order|position/.test(c)
                    ? "0"
                    : /created|updated/.test(c)
                      ? moment
                      : "NULL"
          )
          .join(", ")})`
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    /** The `tags` field the registry stores for `lm_posts`. */
    async function storedTags(): Promise<Record<string, unknown> | undefined> {
      const { q, query } = sql;
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'lm_posts'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as Record<string, unknown>[];
      return fields.find(field => field.name === "tags");
    }

    async function schemaVersion(): Promise<number> {
      const { q, query } = sql;
      const [row] = await query<{ v: unknown }>(
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'lm_posts'`
      );
      return Number(row?.v ?? 1);
    }

    /** A link table as it stands: whether it exists, and the links it holds, by id. */
    async function linksOf(table: string): Promise<{
      exists: boolean;
      links: string[];
    }> {
      const exists = await t.adapter.tableExists(table);
      if (!exists) return { exists, links: [] };
      const rows = await sql.query<{ id: string }>(
        `SELECT ${sql.q("id")} AS id FROM ${sql.q(table)}`
      );
      return { exists, links: rows.map(row => row.id).sort() };
    }

    async function resave(sent: Record<string, unknown>) {
      const before = {
        stored: await storedTags(),
        junction: await linksOf(junction),
      };
      expect(before.junction.links).toEqual(["j1"]);

      let outcome: unknown = "accepted";
      try {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "lm_posts" },
          {
            fields: [{ name: "body", type: "text" }, sent],
            confirmed: true,
            schemaVersion: await schemaVersion(),
          }
        );
      } catch (error) {
        const e = error as {
          code?: string;
          publicData?: { errors?: unknown[] };
          message?: string;
        };
        outcome = e.publicData?.errors ?? { code: e.code, message: e.message };
      }
      const after = {
        outcome,
        stored: await storedTags(),
        junction: await linksOf(junction),
        postColumns: await sql.columnsOf("dc_lm_posts"),
      };
      return { before, after };
    }

    it("is saved again unedited, keeping its target, its link table and the link it holds", async () => {
      const { before, after } = await resave(SENT_TAGS);
      const report = JSON.stringify({ before, after }, null, 2);
      expect(after.outcome, report).toBe("accepted");
      expect(after.stored, report).toMatchObject({
        options: { target: "lm_tags", relationType: "manyToMany" },
      });
      expect(after.junction, report).toEqual(before.junction);
      expect(after.postColumns, report).not.toContain("tags");
    });

    it("keeps its link table and the link it holds once its collection is picked again", async () => {
      const { before, after } = await resave({
        ...SENT_TAGS,
        relationTo: "lm_tags",
      });
      const report = JSON.stringify({ before, after }, null, 2);
      expect(after.outcome, report).toBe("accepted");
      expect(after.junction, report).toEqual(before.junction);
      expect(after.postColumns, report).not.toContain("tags");
    });

    // Another collection picked: the field is still a many-to-many, now naming the other
    // collection. Its links named entries of the collection it no longer links to, so the table
    // holding them goes, and an empty one for the other collection takes its place. (The review
    // before the save does not yet say so: that is the next change's.)
    it("becomes a many-to-many of the other collection when another is picked, its old links dropped", async () => {
      const { after } = await resave({
        ...SENT_TAGS,
        relationTo: "lm_other",
        options: { target: "lm_other", relationType: "manyToMany" },
      });
      const report = JSON.stringify(after, null, 2);
      expect(after.outcome, report).toBe("accepted");
      expect(after.stored, report).toMatchObject({
        relationTo: "lm_other",
        options: { target: "lm_other", relationType: "manyToMany" },
      });
      expect(after.junction, report).toEqual({ exists: false, links: [] });
      const otherJunction = new DynamicCollectionSchemaService(
        undefined,
        dialect as TestDialect
      ).junctionTableNameFor("dc_lm_posts", {
        ...LEGACY_TAGS,
        relationTo: "lm_other",
        options: { target: "lm_other", relationType: "manyToMany" },
      } as FieldDefinition);
      expect(await linksOf(otherJunction), report).toEqual({
        exists: true,
        links: [],
      });
    });
  }
);

describeEachDialect(
  "a many-to-many stored with relationTo, saved again in the Builder",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-modern-m2m-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "mm_tags",
          label: "Tag",
          fields: [{ name: "label", type: "text" }],
        }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "mm_posts",
          label: "Post",
          fields: [
            {
              name: "tags",
              type: "relationship",
              relationTo: "mm_tags",
              options: { target: "mm_tags", relationType: "manyToMany" },
            },
          ],
        }
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    // The admin sends a many-to-many stored this way back with its `options`, so a save of the
    // collection, here one adding a field, leaves it a many-to-many.
    it("keeps its junction through a save that adds another field", async () => {
      const { tablesLike } = sqlOf(t, dialect as TestDialect);
      const before = await tablesLike("dc_mm_posts");
      expect(before.length, JSON.stringify(before)).toBeGreaterThan(1);
      let outcome: unknown = "accepted";
      try {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "mm_posts" },
          {
            fields: [
              {
                name: "tags",
                type: "relationship",
                relationTo: "mm_tags",
                options: { target: "mm_tags", relationType: "manyToMany" },
              },
              { name: "note", type: "text" },
            ],
            confirmed: true,
            schemaVersion: 1,
          }
        );
      } catch (error) {
        outcome =
          (error as { publicData?: unknown; message?: string }).publicData ??
          (error as Error).message;
      }
      const after = await tablesLike("dc_mm_posts");
      expect(
        { outcome, after },
        JSON.stringify({ before, outcome, after })
      ).toEqual({
        outcome: "accepted",
        after: before,
      });
    });
  }
);
