/**
 * A Single's field type change through its schema save (`updateSingleSchema`) that carries values
 * runs the service's own statements, and on SQLite those cannot change a column's type: the table
 * is rebuilt with the new type, as a nullability change is and as the save's migration file does.
 * The change then stands as the file says, so the file is recorded applied.
 *
 * The values are judged first: a change the stored values cannot take is refused before anything
 * runs, and the table, its values, the registry row and the migrations folder are as they were.
 *
 * PostgreSQL and MySQL change the column in place; they run here as the control.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { SchemaEventsRepository } from "../../schema/events/schema-events-repository";
import { getColumnDescriptor } from "../../schema/services/field-column-descriptor";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "stc_home";
const TABLE = `single_${SLUG}`;

describeEachDialect("a Single's field type change", dialect => {
  let t: TestNextly;
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "nextly-single-type-change-"));
    vi.stubEnv("NODE_ENV", "development");
    t = await createTestNextly({
      dialect: dialect as TestDialect,
      basePath,
      db: DB,
    });
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: SLUG,
        label: "Home",
        fields: [
          { name: "count", type: "text" },
          { name: "score", type: "text" },
        ],
      }
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await t?.destroy();
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  });

  /** The Single's row: `count` holds a value, so the save carries values; `score` as given. */
  async function fillRow(score: string | null): Promise<void> {
    await t.nextly.updateSingle({
      slug: SLUG,
      data: { count: "one", score, _overwrite: true },
    });
  }

  async function query<T>(sql: string): Promise<T[]> {
    return (
      t.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  /** The column's type as SQLite declares it; elsewhere undefined (the file's record covers it). */
  async function sqliteColumnType(column: string): Promise<string | undefined> {
    if (dialect !== "sqlite") return undefined;
    const [row] = await query<{ type: string }>(
      `SELECT type FROM pragma_table_info('${TABLE}') WHERE name = '${column}'`
    );
    return row?.type.toLowerCase();
  }

  async function storedScore(): Promise<unknown> {
    const [row] = await query<{ value: unknown }>(
      `SELECT score AS value FROM ${dialect === "mysql" ? `\`${TABLE}\`` : `"${TABLE}"`}`
    );
    return row?.value;
  }

  /** The migration files in the project's folder, sorted. */
  async function migrationFiles(): Promise<string[]> {
    try {
      return (await readdir(join(basePath, "migrations")))
        .filter(name => name.endsWith(".sql"))
        .sort();
    } catch {
      return [];
    }
  }

  /** The migration files the ledger records applied. */
  async function appliedFiles(): Promise<string[]> {
    const repo = new SchemaEventsRepository(
      t.adapter.getDrizzle() as never,
      t.adapter.getCapabilities().dialect
    );
    return (await repo.listFileApplies())
      .filter(row => row.status === "applied")
      .map(row => String(row.filename));
  }

  /** The registry row's fields and status, as stored. */
  async function recorded() {
    clearRegistryRowCache();
    const [row] = await t.adapter.select<Record<string, unknown>>(
      "dynamic_singles",
      {
        columns: ["fields", "migrationStatus"],
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      }
    );
    const fields =
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
    return { fields, migrationStatus: row?.migrationStatus };
  }

  /** The save of `score` as a number, as what it threw or what it answered. */
  async function scoreToNumber(): Promise<{ thrown?: unknown; said: string }> {
    try {
      const answer = await dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        {
          fields: [
            { name: "count", type: "text" },
            { name: "score", type: "number" },
          ],
        }
      );
      return {
        said:
          answer instanceof Response
            ? JSON.stringify(await answer.json())
            : JSON.stringify(answer),
      };
    } catch (error) {
      return { thrown: error, said: "" };
    }
  }

  it("changes an empty field's column to the new type and records its file applied", async () => {
    await fillRow(null);
    const folderBefore = await migrationFiles();

    const { thrown, said } = await scoreToNumber();

    expect(thrown, `the save failed: ${String(thrown)}`).toBeUndefined();
    expect(said).toContain("migration applied successfully");
    const written = (await migrationFiles()).filter(
      name => !folderBefore.includes(name)
    );
    expect(written, "the change's one file").toHaveLength(1);
    // Recorded only where the table stands as the file says.
    expect(await appliedFiles()).toContain(written[0]);
    const { fields, migrationStatus } = await recorded();
    expect(migrationStatus).toBe("applied");
    expect(fields).toEqual([
      expect.objectContaining({ name: "count", type: "text" }),
      expect.objectContaining({ name: "score", type: "number" }),
    ]);
    if (dialect === "sqlite") {
      expect(await sqliteColumnType("score"), "the column's type").toBe(
        getColumnDescriptor(
          { name: "score", type: "number" },
          "sqlite",
          "collection"
        )?.dialectType.toLowerCase()
      );
    }
  });

  it("refuses a change the stored value cannot take, with nothing changed", async () => {
    await fillRow("abc");
    const before = await recorded();
    const folderBefore = await migrationFiles();
    const typeBefore = await sqliteColumnType("score");

    const { thrown, said } = await scoreToNumber();

    expect(thrown, `the save answered: ${said}`).toBeDefined();
    expect(JSON.stringify(thrown)).toContain("TYPE_CHANGE_LOSES_VALUES");
    expect(await recorded(), "the registry row").toEqual(before);
    expect(await migrationFiles(), "the migrations folder").toEqual(
      folderBefore
    );
    expect(await storedScore(), "the stored value").toBe("abc");
    expect(await sqliteColumnType("score"), "the column's type").toBe(
      typeBefore
    );
  });
});
