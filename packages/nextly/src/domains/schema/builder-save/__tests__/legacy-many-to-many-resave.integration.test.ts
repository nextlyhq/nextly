/**
 * A many-to-many keeps the table holding its links through a Schema Builder save, on SQLite.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
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

describe("a many-to-many stored with options.target, saved again in the Builder (sqlite)", () => {
  let t: TestNextly;
  let basePath: string;
  let junction: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "nextly-legacy-m2m-"));
    vi.stubEnv("NODE_ENV", "development");
    t = await createTestNextly({ dialect: "sqlite", basePath, db: DB });
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
    await seedBuilderCollection(adapter, {
      slug: "lm_posts",
      fields: [{ name: "body", type: "text" }, LEGACY_TAGS],
    });
    junction = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    ).junctionTableNameFor("dc_lm_posts", LEGACY_TAGS as FieldDefinition);
    await query(
      `INSERT INTO "dc_lm_tags" ("id", "title", "slug", "label") VALUES ('t1', 'News', 't1', 'News')`
    );
    await query(
      `INSERT INTO "dc_lm_posts" ("id", "title", "slug", "body") VALUES ('p1', 'Hello', 'p1', 'x')`
    );
    const columns = await junctionColumns();
    await query(
      `INSERT INTO "${junction}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${columns
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
                    ? "'2026-11-18T00:00:00.000Z'"
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

  async function query<T>(sql: string): Promise<T[]> {
    return (
      t.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  async function junctionColumns(): Promise<string[]> {
    const rows = await query<{ name: string }>(
      `SELECT name FROM pragma_table_info('${junction}')`
    );
    return rows.map(row => row.name);
  }

  /** The `tags` field the registry stores for `lm_posts`. */
  async function storedTags(): Promise<Record<string, unknown> | undefined> {
    const [row] = await query<{ fields: unknown; v: unknown }>(
      `SELECT "fields" AS fields FROM "dynamic_collections" WHERE "slug" = 'lm_posts'`
    );
    const fields = (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as Record<string, unknown>[];
    return fields.find(field => field.name === "tags");
  }

  async function schemaVersion(): Promise<number> {
    const [row] = await query<{ v: unknown }>(
      `SELECT "schema_version" AS v FROM "dynamic_collections" WHERE "slug" = 'lm_posts'`
    );
    return Number(row?.v ?? 1);
  }

  /** The junction as it stands: whether it exists, and the links it holds. */
  async function junctionState(): Promise<{
    exists: boolean;
    links: unknown[];
  }> {
    const exists = await t.adapter.tableExists(junction);
    return {
      exists,
      links: exists ? await query(`SELECT * FROM "${junction}"`) : [],
    };
  }

  async function resave(sent: Record<string, unknown>) {
    const before = {
      stored: await storedTags(),
      junction: await junctionState(),
    };
    expect(before.junction.links).toHaveLength(1);

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
      junction: await junctionState(),
      postColumns: (
        await query<{ name: string }>(
          `SELECT name FROM pragma_table_info('dc_lm_posts')`
        )
      ).map(row => row.name),
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
  });

  it("keeps its link table and the link it holds once its collection is picked again", async () => {
    const { before, after } = await resave({
      ...SENT_TAGS,
      relationTo: "lm_tags",
    });
    const report = JSON.stringify({ before, after }, null, 2);
    expect(after.outcome, report).toBe("accepted");
    expect(after.junction, report).toEqual(before.junction);
  });

  // Another collection picked: the field is still a many-to-many, now naming the other collection.
  it("answers a different collection picked", async () => {
    const { before, after } = await resave({
      ...SENT_TAGS,
      relationTo: "lm_other",
      options: { target: "lm_other", relationType: "manyToMany" },
    });
    const report = JSON.stringify({ before, after }, null, 2);
    expect(after.outcome, report).toBe("__measure__");
  });
});

describe("a many-to-many stored with relationTo, saved again in the Builder (sqlite)", () => {
  let t: TestNextly;
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "nextly-modern-m2m-"));
    vi.stubEnv("NODE_ENV", "development");
    t = await createTestNextly({ dialect: "sqlite", basePath, db: DB });
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
    const tableNames = async () =>
      (
        await (
          t.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dc_mm_posts%'"
        )
      )
        .map(row => row.name)
        .sort();
    const before = await tableNames();
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
    const after = await tableNames();
    expect(
      { outcome, after },
      JSON.stringify({ before, outcome, after })
    ).toEqual({
      outcome: "accepted",
      after: before,
    });
  });
});
