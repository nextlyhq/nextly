/**
 * Two existing sibling fields sharing one stored value, `siteName` and `site_name` (one column,
 * `site_name`), as an entity configured before the sibling rule may hold them. Changing one of them
 * must leave the other's values in place: a renamed or moved field gets a value of its own with a
 * copy of each entry's value, a removed field leaves the value with the other, and a change to the
 * shared column's type is refused while both use it.
 *
 * Each case makes one change on one road and checks the other field's values, the changed field's
 * values and the column. What each road does today is also written to a report, for the plan.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { appendFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const REPORT =
  "/private/tmp/claude-502/-Users-faisal-code-nextly-workspace/3194b56e-5228-4ed2-9e16-37bc5855d366/scratchpad/m2m/pair-report.jsonl";

const SHARED = { name: "site_name", type: "text" };
const PAIRED = { name: "siteName", type: "text" };
const SEO = {
  name: "seo",
  type: "group",
  fields: [{ name: "title", type: "text" }],
};

/** Each change to one field of the pair, as the fields a save sends after it. */
const CHANGES = {
  rename: [SHARED, { name: "headline", type: "text" }, SEO],
  move: [
    SHARED,
    { ...SEO, fields: [...SEO.fields, { name: "siteName", type: "text" }] },
  ],
  removal: [SHARED, SEO],
  typeChange: [SHARED, { name: "siteName", type: "number" }, SEO],
} as const;
type Change = keyof typeof CHANGES;

const ROADS = ["dialog", "push", "collectionPatch", "singlePatch"] as const;
type Road = (typeof ROADS)[number];

describeEachDialect(
  "one field of an existing pair sharing a value, changed",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const query = <T>(sql: string): Promise<T[]> =>
      (
        t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
      ).executeQuery<T>(sql);
    const columnsOf = async (table: string): Promise<string[]> =>
      (
        await query<{ name: string }>(
          dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : dialect === "mysql"
              ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
              : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        )
      )
        .map(row => row.name)
        .sort();

    /** Adds `siteName` beside `site_name` in the registry row, as a definition from before the rule held it. */
    async function pairInRegistry(registry: string, slug: string) {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as unknown[];
      const paired = JSON.stringify([...fields, PAIRED]).replace(/'/g, "''");
      await query(
        `UPDATE ${q(registry)} SET ${q("fields")} = '${paired}' WHERE ${q("slug")} = '${slug}'`
      );
      clearRegistryRowCache();
    }

    async function versionOf(registry: string, slug: string): Promise<number> {
      const [row] = await query<{ v: unknown }>(
        `SELECT ${q("schema_version")} AS v FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.v ?? 1);
    }

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-shared-pair-"));
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
          name: "sp_posts",
          label: "Post",
          fields: [SHARED, SEO],
        }
      );
      await query(
        `INSERT INTO ${q("dc_sp_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("site_name")}) VALUES ('e1', 'One', 'e1', 'A'), ('e2', 'Two', 'e2', 'B')`
      );
      await pairInRegistry("dynamic_collections", "sp_posts");
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "sp_home", label: "Home", fields: [SHARED, SEO] }
      );
      await t.nextly.updateSingle({
        slug: "sp_home",
        data: { site_name: "H", _overwrite: true },
      });
      await pairInRegistry("dynamic_singles", "sp_home");
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    /** Sends `fields` on `road`; the error it was refused with, or "accepted". */
    async function send(
      road: Road,
      fields: readonly unknown[]
    ): Promise<unknown> {
      try {
        if (road === "singlePatch") {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "sp_home" },
            { fields }
          );
        } else if (road === "collectionPatch") {
          await dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: "sp_posts" },
            { fields }
          );
        } else {
          // The push where a save is not in development; the save's own file there.
          if (road === "push") vi.stubEnv("NODE_ENV", "test");
          await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "sp_posts" },
            {
              fields,
              confirmed: true,
              schemaVersion: await versionOf("dynamic_collections", "sp_posts"),
            }
          );
        }
        return "accepted";
      } catch (error) {
        const e = error as {
          code?: string;
          message?: string;
          publicData?: unknown;
          logContext?: unknown;
        };
        return { code: e.code, message: e.message, data: e.publicData };
      } finally {
        vi.stubEnv("NODE_ENV", "development");
        clearRegistryRowCache();
      }
    }

    /** What the entity holds after: its columns and each row's stored values. */
    async function state(road: Road) {
      const table = road === "singlePatch" ? "single_sp_home" : "dc_sp_posts";
      const columns = await columnsOf(table);
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM ${q(table)} ORDER BY ${q("id")}`
      );
      const pick = (row: Record<string, unknown>) =>
        Object.fromEntries(
          ["site_name", "headline", "seo"]
            .filter(c => c in row)
            .map(c => [c, row[c]])
        );
      return { columns, rows: rows.map(pick) };
    }

    const kept = (road: Road) => (road === "singlePatch" ? ["H"] : ["A", "B"]);
    const valuesIn = (rows: Record<string, unknown>[], column: string) =>
      rows.map(row => row[column]);
    const keyIn = (rows: Record<string, unknown>[], key: string) =>
      rows.map(row => {
        const seo = typeof row.seo === "string" ? JSON.parse(row.seo) : row.seo;
        return (seo as Record<string, unknown> | null)?.[key];
      });

    for (const road of ROADS)
      for (const change of Object.keys(CHANGES) as Change[])
        it(`${change} on the ${road} road`, async () => {
          const outcome = await send(road, CHANGES[change]);
          const after = await state(road);
          appendFileSync(
            REPORT,
            `${JSON.stringify({ dialect, road, change, outcome, after })}\n`
          );

          // The other field keeps every value, in the column both used.
          expect
            .soft(after.columns, "the shared column stays")
            .toContain("site_name");
          expect
            .soft(valuesIn(after.rows, "site_name"), "the other field's values")
            .toEqual(kept(road));
          if (change === "typeChange") {
            expect
              .soft(outcome, "a change to the shared column is refused")
              .not.toBe("accepted");
          } else {
            expect.soft(outcome, "the change is accepted").toBe("accepted");
          }
          if (change === "rename") {
            expect
              .soft(
                valuesIn(after.rows, "headline"),
                "the renamed field's copy"
              )
              .toEqual(kept(road));
          }
          if (change === "move") {
            expect
              .soft(keyIn(after.rows, "siteName"), "the moved field's copy")
              .toEqual(kept(road));
          }
        });
  }
);
