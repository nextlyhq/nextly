/**
 * A renamed collection keeps the table it was created with, while the relationships pointing at it
 * name its new slug. A key to it therefore names the table the registry records for it, never one
 * spelled from the slug: the migration of a later save that changes what an existing key does on
 * delete, and a save adding a relationship to the renamed collection, reference the table that is
 * there.
 *
 * And a rename that rewrites a schema's stored relationships moves its version on, so an editor
 * still holding the schema from before the rename cannot save it back over the new target.
 *
 * Keys are changed in place only on PostgreSQL and MySQL, so those are the dialects this runs on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { DynamicCollectionService } from "../../dynamic-collections/services/dynamic-collection-service";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
});

/**
 * A test instance on `dialect`, where the Schema Builder runs its DDL: in development, with the
 * dialect the DDL is written for read from the environment, as a dev server reads it.
 */
async function builderInstance(dialect: TestDialect): Promise<TestNextly> {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  return createTestNextly({ dialect });
}

function t(): TestNextly {
  if (!handle) throw new Error("no test instance");
  return handle;
}

const writer = (onDelete: string) => ({
  name: "writer",
  type: "relationship",
  options: { relationType: "manyToOne", target: "authors", onDelete },
});

/** `authors`, and `posts` relating to it with a key, both Builder-made; then `authors` renamed. */
async function renamedTarget(dialect: TestDialect): Promise<void> {
  handle = await builderInstance(dialect);
  await seedBuilderCollection(handle.adapter, {
    slug: "authors",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(handle.adapter, {
    slug: "posts",
    fields: [{ name: "title", type: "text" }, writer("set null")],
  });
  handle.getService("collectionService");
  await new DynamicCollectionRegistryService(
    handle.adapter,
    silentLogger
  ).updateCollectionMetadata("authors", { slug: "writers" });
}

/** The stored fields and schema version of `posts`, as a Builder editor loads them. */
async function postsSchema(): Promise<{
  fields: Array<Record<string, unknown>>;
  version: number;
}> {
  const [row] = (
    await t().adapter.select<{
      slug: string;
      fields: unknown;
      schemaVersion: number | null;
    }>("dynamic_collections", {
      columns: ["slug", "fields", "schemaVersion"],
    })
  ).filter(entry => entry.slug === "posts");
  if (!row) throw new Error("no posts");
  const fields: unknown =
    typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;
  return {
    fields: fields as Array<Record<string, unknown>>,
    version: row.schemaVersion ?? 1,
  };
}

/**
 * A Builder update of `posts` that sends its whole field list, as the collection editor's update
 * does: the road that alters the table in place, keys included.
 */
function updatePosts(fields: unknown[]) {
  return dispatchCollections(
    {} as ServiceContainer,
    "updateCollection",
    { collectionName: "posts" },
    { fields }
  );
}

/** A Schema Builder save of `posts` from the schema dialog, confirmed, at `version`. */
function savePosts(fields: unknown[], version: number) {
  return dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: "posts" },
    { fields, confirmed: true, schemaVersion: version }
  );
}

/**
 * The key on `dc_posts.<column>`, as the server reports it: the table it references and what it
 * does when that table's row is deleted.
 */
async function keyOn(
  dialect: TestDialect,
  column: string
): Promise<{ table: string; onDelete: string } | undefined> {
  const sql =
    dialect === "mysql"
      ? `SELECT kcu.REFERENCED_TABLE_NAME AS t, rc.DELETE_RULE AS d
           FROM information_schema.KEY_COLUMN_USAGE kcu
           JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
             ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = 'dc_posts'
            AND kcu.COLUMN_NAME = '${column}'`
      : `SELECT ccu.table_name AS t, rc.delete_rule AS d
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.referential_constraints rc
             ON rc.constraint_name = kcu.constraint_name
            AND rc.constraint_schema = kcu.constraint_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = kcu.constraint_name
            AND ccu.constraint_schema = kcu.constraint_schema
          WHERE kcu.table_schema = current_schema() AND kcu.table_name = 'dc_posts'
            AND kcu.column_name = '${column}'`;
  const rows = await t().adapter.executeQuery<{ t: string; d: string }>(sql);
  // One key per column, so a second row would be a second key on it.
  expect(rows.length).toBeLessThanOrEqual(1);
  const [row] = rows;
  return row ? { table: row.t, onDelete: row.d } : undefined;
}

function cases(dialect: TestDialect): void {
  it("changes what a key to the renamed collection does on delete, against the table it kept", async () => {
    await renamedTarget(dialect);
    const before = await postsSchema();
    expect(
      before.fields.find(field => field.name === "writer")?.options
    ).toMatchObject({ target: "writers" });

    // The update's migration, replayed as `nextly migrate` replays it on a database built from
    // migrations. A development save takes the change through the schema pipeline, which keeps
    // the key the table holds, so the file is what changes a key's action.
    const { migrationSQL } = await new DynamicCollectionService(
      t().adapter,
      silentLogger
    ).generateCollectionUpdate("posts", {
      // The field as the rename left it, naming `writers`, with only its action changed.
      fields: before.fields.map(field =>
        field.name === "writer"
          ? {
              ...field,
              options: {
                ...(field.options as Record<string, unknown>),
                onDelete: "cascade",
              },
            }
          : field
      ) as unknown as FieldDefinition[],
    });
    expect(migrationSQL).toBeTruthy();
    for (const statement of splitStatements([migrationSQL ?? ""])) {
      await t().adapter.executeQuery(statement);
    }

    // Changed, and still against the table the renamed collection kept.
    expect(await keyOn(dialect, "writer")).toEqual({
      table: "dc_authors",
      onDelete: "CASCADE",
    });
  });

  it("adds a relationship to the renamed collection with a key to the table it kept", async () => {
    await renamedTarget(dialect);
    const before = await postsSchema();

    await updatePosts([
      ...before.fields,
      {
        name: "editor",
        type: "relationship",
        options: { relationType: "manyToOne", target: "writers" },
      },
    ]);

    expect((await keyOn(dialect, "editor"))?.table).toBe("dc_authors");
  });

  it("refuses a save made from the schema as it was before the rename rewrote it", async () => {
    handle = await builderInstance(dialect);
    await seedBuilderCollection(handle.adapter, {
      slug: "authors",
      fields: [{ name: "name", type: "text" }],
    });
    // The schema dialog's shape, which names the target in `relationTo`.
    await seedBuilderCollection(handle.adapter, {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        { name: "writer", type: "relationship", relationTo: "authors" },
      ],
    });
    handle.getService("collectionService");
    // An editor loads the schema before the rename.
    const stale = await postsSchema();
    await new DynamicCollectionRegistryService(
      handle.adapter,
      silentLogger
    ).updateCollectionMetadata("authors", { slug: "writers" });

    const refused = await savePosts(stale.fields, stale.version).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(NextlyError.is(refused) ? refused.code : refused).toBe("CONFLICT");
    expect(
      (await postsSchema()).fields.find(field => field.name === "writer")
    ).toMatchObject({ relationTo: "writers" });
  });
}

const servers = getConfiguredTestDialects();

describe.skipIf(!servers.includes("postgresql"))(
  "keys to a renamed collection (integration, postgresql)",
  () => cases("postgresql")
);

describe.skipIf(!servers.includes("mysql"))(
  "keys to a renamed collection (integration, mysql)",
  () => cases("mysql")
);
