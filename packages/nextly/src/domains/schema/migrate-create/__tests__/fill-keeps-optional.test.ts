/**
 * A column the person's answer fills is made NOT NULL afterwards only where its field is required.
 *
 * An answer that fills the existing rows (`resolutions`) is written into the migration between the
 * column's creation and its NOT NULL. A Single's dialog save also fills its row with an optional
 * field's default, and that field stays optional: the file fills the row and leaves the column
 * taking NULL, as the field declares it.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../../collections/config/define-collection";
import { text } from "../../../../collections/fields/helpers";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

const TABLE = "dc_fko_posts";

function posts(added: ReturnType<typeof text>[] = []) {
  return toMinimalEntities(
    [
      defineCollection({
        slug: "fko_posts",
        fields: [text({ name: "title" }), ...added],
      }),
    ],
    e => resolveCollectionTableName(e.slug, e.dbName)
  );
}

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-fill-keeps-optional-"));
});

/** The SQL of the migration that adds `field`, its rows filled with "Hello". */
async function addedAndFilled(field: ReturnType<typeof text>): Promise<string> {
  const base = {
    dialect: "postgresql" as const,
    migrationsDir,
    singles: [],
    components: [],
    nonInteractive: true,
  };
  await generateMigration({
    ...base,
    name: "create",
    collections: posts(),
    now: new Date("2026-11-17T10:00:00.000Z"),
  });
  const result = await generateMigration({
    ...base,
    name: "add",
    collections: posts([field]),
    now: new Date("2026-11-17T10:00:01.000Z"),
    resolutions: [
      { tableName: TABLE, columnName: "extra", kind: "fill", value: "Hello" },
    ],
  });
  expect(result).not.toBeNull();
  return result!.sqlContent;
}

describe("a filled column after the fill", () => {
  it("stays optional for an optional field", async () => {
    const sql = await addedAndFilled(text({ name: "extra" }));
    expect(sql).toMatch(/UPDATE "dc_fko_posts" SET "extra"/);
    expect(sql).not.toMatch(/ALTER COLUMN "extra" SET NOT NULL/);
  });

  it("is made NOT NULL for a required field", async () => {
    const sql = await addedAndFilled(text({ name: "extra", required: true }));
    expect(sql).toMatch(/UPDATE "dc_fko_posts" SET "extra"/);
    expect(sql).toMatch(/ALTER COLUMN "extra" SET NOT NULL/);
  });
});
