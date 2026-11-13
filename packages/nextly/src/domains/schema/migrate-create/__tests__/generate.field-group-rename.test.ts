/**
 * A field-group field renamed in a code-first config, in the file `migrate:create` writes, on
 * every dialect.
 *
 * The rename changes no column, so the table diff is empty, and the file once carried only the
 * settings change: its rows stayed keyed by the old name, and its DOWN was `SELECT 1`. Asked about
 * as a column rename is, an accepted pair re-keys the rows in the UP and keys them back in the
 * DOWN, for the renamed field's own parent table only; a declined one moves nothing; a pair that
 * cannot hold the same rows is never asked about; and answers giving one field two names are
 * refused. The rows themselves are read back after a real apply in
 * `cli/commands/__tests__/migrate-create-renamed-field-group.integration.test.ts`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../../config";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { parseSqlSections } from "../../migrate/sql-sections";
import type { RenameCandidate } from "../../pipeline/pushschema-pipeline-interfaces";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

// The terminal prompt: every run here answers through `decideRenames`.
vi.mock("../prompt-renames", async importOriginal => ({
  ...(await importOriginal<typeof import("../prompt-renames")>()),
  promptRenames: vi.fn(() => {
    throw new Error("the rename prompt was loaded");
  }),
}));

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

type Answer = (c: RenameCandidate) => boolean;

const fieldGroups = [
  defineFieldGroup({ slug: "seo", fields: [text({ name: "metaTitle" })] }),
  defineFieldGroup({ slug: "card", fields: [text({ name: "label" })] }),
];

/** The posts collection with its field groups under `names`, and a Single keeping `seo`. */
function declared(fields: unknown[]) {
  return {
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" }), ...fields] as never,
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        fields: [fieldGroup({ name: "seo", component: "seo" })],
      }),
    ],
    fieldGroups,
  };
}

describe.each(DIALECTS)("a field group renamed in code (%s)", dialect => {
  let dir: string;
  let clock = 0;
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-group-rename-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** `migrate:create` over `fields`, as the command reduces a config, answering with `answer`. */
  async function generate(fields: unknown[], answer: Answer = () => false) {
    clock += 1;
    const config = declared(fields);
    const asked: RenameCandidate[] = [];
    const result = await generateMigration({
      name: `step_${clock}`,
      dialect,
      migrationsDir: dir,
      collections: toMinimalEntities(config.collections, e =>
        resolveCollectionTableName(e.slug, e.dbName)
      ),
      singles: toMinimalEntities(config.singles, e =>
        resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
      ),
      components: toMinimalEntities(config.fieldGroups, e =>
        resolveComponentTableName(e.slug)
      ),
      decideRenames: async candidates => {
        asked.push(...candidates);
        return candidates.map(candidate => ({
          candidate,
          accepted: answer(candidate),
        }));
      },
      now: new Date(Date.UTC(2026, 10, 13, 12, 0, 0, clock)),
    });
    if (result === null) throw new Error("no migration was written");
    const sql = await readFile(result.sqlPath, "utf-8");
    return { ...parseSqlSections(sql), sql, asked, result };
  }

  const move = (table: string, from: string, to: string, parent: string) =>
    `UPDATE ${q(table)}\nSET ${q("_parent_field")} = '${to}'\n` +
    `WHERE ${q("_parent_field")} = '${from}'\n  AND ${q("_parent_table")} = '${parent}'`;

  it("re-keys an accepted rename's rows in the UP, for its own table, and back in the DOWN", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    const { upSql, downSql, sql, asked, result } = await generate(
      [fieldGroup({ name: "legacySeo", component: "seo" })],
      () => true
    );

    expect(
      asked.map(c => [
        c.tableName,
        c.fromColumn,
        c.toColumn,
        c.fieldGroupTables,
      ])
    ).toEqual([["dc_posts", "seo", "legacySeo", ["comp_seo"]]]);
    expect(upSql).toContain(move("comp_seo", "seo", "legacySeo", "dc_posts"));
    expect(downSql).toContain(move("comp_seo", "legacySeo", "seo", "dc_posts"));
    // The Single sharing the group's table keeps its rows: no statement names it.
    expect(sql).not.toContain("single_home");
    // A file that moves rows names the collection it changes, and has a DOWN that moves them.
    expect(sql).toMatch(/^-- Collections: posts$/m);
    expect(downSql).not.toContain("SELECT 1");
    expect(result.renamesAccepted).toBe(1);
  });

  it("moves nothing for a declined rename", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    const { sql, asked } = await generate([
      fieldGroup({ name: "legacySeo", component: "seo" }),
    ]);
    expect(asked).toHaveLength(1);
    expect(sql).not.toMatch(/UPDATE/);
  });

  it("does not ask about a removed and an added field that hold different groups", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    const { sql, asked } = await generate(
      [fieldGroup({ name: "teaser", component: "card" })],
      () => true
    );
    expect(asked).toEqual([]);
    expect(sql).not.toMatch(/UPDATE/);
  });

  it("does not ask about a single group renamed into a repeatable one", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    const { asked } = await generate(
      [fieldGroup({ name: "seos", component: "seo", repeatable: true })],
      () => true
    );
    expect(asked).toEqual([]);
  });

  it("asks about a zone of groups renamed and reordered, and moves its rows in each group's table", async () => {
    await generate([
      fieldGroup({
        name: "layout",
        components: ["seo", "card"],
        repeatable: true,
      }),
    ]);
    const { upSql, downSql } = await generate(
      [
        fieldGroup({
          name: "sections",
          components: ["card", "seo"],
          repeatable: true,
        }),
      ],
      () => true
    );
    for (const table of ["comp_seo", "comp_card"]) {
      expect(upSql).toContain(move(table, "layout", "sections", "dc_posts"));
      expect(downSql).toContain(move(table, "sections", "layout", "dc_posts"));
    }
  });

  it("refuses answers that give one field group two names", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    await expect(
      generate(
        [
          fieldGroup({ name: "metaA", component: "seo" }),
          fieldGroup({ name: "metaB", component: "seo" }),
        ],
        () => true
      )
    ).rejects.toThrow(/more than one name/);
  });

  it("applies one of two possible pairs when only that one is accepted", async () => {
    await generate([fieldGroup({ name: "seo", component: "seo" })]);
    const { upSql, asked } = await generate(
      [
        fieldGroup({ name: "metaA", component: "seo" }),
        fieldGroup({ name: "metaB", component: "seo" }),
      ],
      c => c.toColumn === "metaB"
    );
    expect(asked.map(c => c.toColumn)).toEqual(["metaA", "metaB"]);
    expect(upSql).toContain(move("comp_seo", "seo", "metaB", "dc_posts"));
    expect(upSql).not.toContain("metaA");
  });
});
