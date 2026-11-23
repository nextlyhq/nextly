/**
 * Where a migration file drops an older unique index left holding a column whose field stops being
 * unique: before the rows are filled. A field made required and no longer unique in one change has
 * its existing NULLs filled with the one value the person gave; while the older index stands, the
 * second row filled breaks it and the migration fails.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../../collections/config/define-collection";
import { text } from "../../../../collections/fields/helpers";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

const TABLE = "dc_lbf_posts";
const LEGACY = "lbf_posts_code_key";

function posts(code: ReturnType<typeof text>) {
  return toMinimalEntities(
    [
      defineCollection({
        slug: "lbf_posts",
        fields: [text({ name: "title" }), code],
      }),
    ],
    e => resolveCollectionTableName(e.slug, e.dbName)
  );
}

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-leftover-before-fill-"));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "an older unique index on a field made required and not unique (%s)",
  dialect => {
    it("is dropped before the rows are filled", async () => {
      const base = {
        dialect,
        migrationsDir,
        singles: [],
        components: [],
        nonInteractive: true,
      };
      await generateMigration({
        ...base,
        name: "create",
        collections: posts(text({ name: "code", unique: true, maxLength: 64 })),
        now: new Date("2026-11-20T10:00:00.000Z"),
      });
      const result = await generateMigration({
        ...base,
        name: "required_not_unique",
        collections: posts(
          text({ name: "code", required: true, maxLength: 64 })
        ),
        now: new Date("2026-11-20T10:00:01.000Z"),
        resolutions: [
          { tableName: TABLE, columnName: "code", kind: "fill", value: "same" },
        ],
        liveUniqueIndexes: async () => new Map([["code", [LEGACY]]]),
      });
      const sql = result!.sqlContent;
      const drop = sql.indexOf(LEGACY);
      const fill = sql.search(/UPDATE [`"]dc_lbf_posts[`"] SET [`"]code[`"]/);
      expect(drop, sql).toBeGreaterThan(-1);
      expect(fill, sql).toBeGreaterThan(-1);
      expect(drop, sql).toBeLessThan(fill);
    });
  }
);
