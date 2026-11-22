/**
 * A field renamed through the Builder's apply keeps its values when the rename is answered as one,
 * on every dialect.
 *
 * The Builder sends a renamed saved field under its new name, which the save first sees as one
 * column dropped and another added. The admin answers that pair as a rename, and this pins what
 * the answer does to the values: an entry's value is read back under the new name, and the old
 * column is gone. The same pair answered as a drop and an add loses it, which is why the admin
 * never sends that answer for a field it renamed.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its DDL at once.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

const BEFORE = [
  { name: "body", type: "text" },
  { name: "summary", type: "text" },
];
const AFTER = [
  { name: "body", type: "text" },
  { name: "abstract", type: "text" },
];

describeEachDialect("a field renamed through the Builder's apply", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  async function columnsOf(table: string): Promise<string[]> {
    const rows = await query<{ name: string }>(
      dialect === "mysql"
        ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        : dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    return rows.map(row => row.name).sort();
  }

  async function schemaVersion(): Promise<number> {
    const [row] = await query<{ schema_version: unknown }>(
      `SELECT ${q("schema_version")} AS schema_version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
    );
    return Number(row?.schema_version ?? 1);
  }

  /** `posts` with an entry whose `summary` holds "kept", and that entry's id. */
  async function seeded(): Promise<string> {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      {
        name: "posts",
        label: "Posts",
        fields: BEFORE,
      }
    );
    const created = await current.nextly.create({
      collection: "posts",
      data: { body: "b", summary: "kept" },
    });
    return String((created.item as { id: unknown }).id);
  }

  /** The Builder's apply of `AFTER`, with `summary`→`abstract` answered as `choice`. */
  async function apply(choice: "rename" | "drop_and_add") {
    return dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "posts" },
      {
        fields: AFTER,
        confirmed: true,
        schemaVersion: await schemaVersion(),
        renameResolutions: [
          {
            tableName: "dc_posts",
            fromColumn: "summary",
            toColumn: "abstract",
            choice,
          },
        ],
      }
    );
  }

  it("keeps the value under the new name when the pair is answered as a rename", async () => {
    const id = await seeded();

    await apply("rename");

    const columns = await columnsOf("dc_posts");
    expect(columns).toContain("abstract");
    expect(columns).not.toContain("summary");
    expect(
      await current.nextly.findByID({ collection: "posts", id })
    ).toMatchObject({ body: "b", abstract: "kept" });
  });

  // The control: the same pair answered as a drop and an add loses the value, so the rename
  // answer above is what keeps it.
  it("loses the value when the pair is answered as a drop and an add", async () => {
    const id = await seeded();

    await apply("drop_and_add");

    const read = (await current.nextly.findByID({
      collection: "posts",
      id,
    })) as Record<string, unknown>;
    expect(read.body).toBe("b");
    expect(read.abstract ?? null).toBeNull();
  });
});
