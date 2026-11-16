/**
 * A plugin release that only adds or removes a permission is written as a migration, and every
 * snapshot records every declared permission, by owner, and no grant.
 *
 * Entities are reduced from `define*` configs through `toMinimalEntities`, the reduction
 * `migrate:create` itself uses, and the record is built by `permissionRecordOf`, as the command
 * builds it. What separates a correct generator from the plausible broken one is the file existing
 * at all when only a permission changed: a generator that compares tables and settings alone
 * returns null there. The second property is that it carries no table statement.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import type { CollectedPermission } from "../../../../plugins/permissions/collect-permissions";
import { parseSqlSections } from "../../migrate/sql-sections";
import { splitSqlStatements } from "../../migrate/split-sql";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { permissionRecordOf } from "../declared-permissions";
import { generateMigration } from "../generate";

const formBuilder = "@nextlyhq/plugin-form-builder";

let migrationsDir: string;
let clock = 0;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-permissions-only-"));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

const collection = (slug: string, fields = ["headline"]) =>
  defineCollection({
    slug,
    fields: fields.map(name => text({ name })) as never,
  });

const plugin = (action: string, extra: Partial<CollectedPermission> = {}) =>
  ({
    action,
    resource: "submissions",
    slug: `${action}-submissions`,
    name: `${action} submissions`,
    owner: formBuilder,
    source: "plugin",
    group: "Forms",
    danger: false,
    ...extra,
  }) satisfies CollectedPermission;

/**
 * `migrate:create` over `collections` with the plugin declaring `custom`; `permissions: false`
 * runs it as a caller that knows no permissions.
 */
function generate(
  collections: unknown[],
  custom: CollectedPermission[] | false,
  name = "change"
) {
  clock += 1;
  const entities = toMinimalEntities(collections, e =>
    resolveCollectionTableName(e.slug, e.dbName)
  );
  return generateMigration({
    name,
    dialect: "postgresql",
    migrationsDir,
    collections: entities,
    singles: [],
    components: [],
    ...(custom === false
      ? {}
      : {
          permissions: permissionRecordOf({
            collections: entities,
            singles: [],
            workflows: [],
            custom,
          }),
        }),
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 10, 10, 12, 0, 0, clock)),
  });
}

async function written(result: Awaited<ReturnType<typeof generate>>) {
  expect(result).not.toBeNull();
  const sql = await readFile(result!.sqlPath, "utf-8");
  const snapshot = JSON.parse(await readFile(result!.snapshotPath, "utf-8"));
  return { sql, snapshot };
}

const upStatements = (sql: string) =>
  splitSqlStatements(parseSqlSections(sql).upSql, "postgresql");

describe("a plugin release that only changes its permissions writes a migration", () => {
  it("names the plugin and the permission its new release adds, with no table statement", async () => {
    await generate([collection("posts")], [plugin("export")], "create");
    const { sql, snapshot } = await written(
      await generate(
        [collection("posts")],
        [plugin("export"), plugin("archive")]
      )
    );
    expect(sql).toContain(
      `-- Permissions: ${formBuilder}: + archive-submissions`
    );
    expect(upStatements(sql)).toEqual([]);
    expect(
      Object.keys(snapshot.permissions.plugins[formBuilder]).sort()
    ).toEqual(["archive-submissions", "export-submissions"]);
  });

  it("names the permission its new release removes", async () => {
    await generate(
      [collection("posts")],
      [plugin("export"), plugin("archive")],
      "create"
    );
    const { sql } = await written(
      await generate([collection("posts")], [plugin("export")])
    );
    expect(sql).toContain(
      `-- Permissions: ${formBuilder}: - archive-submissions`
    );
    expect(upStatements(sql)).toEqual([]);
  });

  it("writes nothing when only a permission's label changed", async () => {
    await generate([collection("posts")], [plugin("export")], "create");
    expect(
      await generate(
        [collection("posts")],
        [plugin("export", { name: "Download submissions" })]
      )
    ).toBeNull();
  });

  it("records them all once over a snapshot written before permissions were recorded", async () => {
    // The same tables and settings, written by a caller that knew no permissions.
    await generate([collection("posts")], false, "create");
    const { sql } = await written(
      await generate([collection("posts")], [plugin("export")])
    );
    expect(sql).toContain("-- Permissions: every declared permission recorded");
    expect(upStatements(sql)).toEqual([]);
  });
  it("records the entities' permissions once over such a snapshot, with no plugin declaring any", async () => {
    await generate([collection("posts")], false, "create");
    const { sql, snapshot } = await written(
      await generate([collection("posts")], [])
    );
    expect(sql).toContain("-- Permissions: every declared permission recorded");
    expect(snapshot.permissions.collections.posts).toHaveProperty("read-posts");
  });
});

describe("every snapshot records every declared permission", () => {
  it("one written by a column change on one entity records every entity's, and no grant", async () => {
    await generate(
      [collection("posts"), collection("pages")],
      [plugin("export")],
      "create"
    );
    const { snapshot } = await written(
      await generate(
        [collection("posts", ["headline", "subtitle"]), collection("pages")],
        [plugin("export")]
      )
    );
    expect(Object.keys(snapshot.permissions.collections).sort()).toEqual([
      "pages",
      "posts",
    ]);
    expect(snapshot.permissions.collections.pages["read-pages"]).toMatchObject({
      action: "read",
      resource: "pages",
    });
    expect(snapshot.permissions.plugins[formBuilder]).toHaveProperty(
      "export-submissions"
    );
    // A permission record has owners, never roles: the preset roles' grants follow the release.
    expect(Object.keys(snapshot.permissions)).toEqual([
      "app",
      "collections",
      "plugins",
      "singles",
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/"grants?"|"roles?"/);
  });
});
