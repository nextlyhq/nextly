/**
 * A main-table column that turning translation on keeps, and relaxes, keeps the rest of its
 * definition. Unattended provisioning (boot, `db:sync`) copies a translated field's values into the
 * translations table and leaves the main column in place; a required one is made nullable, since
 * the main insert no longer carries its value. Only its nullability changes: its type, default,
 * comment, character set and collation stay as the database had them.
 *
 * Read from the database's own catalog (`readTableDefinition`) and compared whole, so a property
 * nobody thought to list is held too. PostgreSQL and MySQL only: SQLite cannot change a column's
 * nullability, and drops a kept required column instead.
 *
 * A main column's default goes with its values: into the companion column turning translation on
 * creates, and back onto the main column turning it off restores. No field Nextly builds has a
 * column default, so the default is set by hand, as a database may have one; SQLite cannot give
 * an existing column a default without rebuilding its table, so these cases run on PostgreSQL and
 * MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  readTableDefinition,
  withNamedChange,
} from "../../schema/__tests__/helpers/table-definition";
import { ensureI18nArchive } from "../migration/ensure-archive";
import { buildCompanionTransitionStatements } from "../migration/reconcile-companion";
import {
  ensureCompanionTable,
  liveCompanionShape,
} from "../runtime/companion-io";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

// PostgreSQL and MySQL only (see above). A run configured with neither still reports the cases,
// skipped, rather than a file with no suite in it.
const DIALECTS = getConfiguredTestDialects().filter(d => d !== "sqlite");
if (DIALECTS.length === 0) {
  describe("a main-table column relaxed as translation starts", () => {
    it.skip("needs PostgreSQL or MySQL", () => undefined);
  });
}

describe.each(DIALECTS)(
  "a main-table column relaxed as translation starts (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    it("keeps its type, default, comment, character set and collation, only made nullable", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "tmk_posts",
            fields: [text({ name: "summary", required: true })],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const adapter = current.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      const query = <T>(statement: string) =>
        adapter.executeQuery<T>(statement);
      // The column as a database may have it: required, with a default and a comment set by hand.
      if (dialect === "mysql") {
        await query(
          `ALTER TABLE ${q("dc_tmk_posts")} MODIFY COLUMN ${q("summary")} VARCHAR(255) NOT NULL DEFAULT 'none' COMMENT 'kept through translation'`
        );
      } else {
        await query(
          `ALTER TABLE ${q("dc_tmk_posts")} ALTER COLUMN ${q("summary")} SET NOT NULL`
        );
        await query(
          `ALTER TABLE ${q("dc_tmk_posts")} ALTER COLUMN ${q("summary")} SET DEFAULT 'none'`
        );
        await query(
          `COMMENT ON COLUMN ${q("dc_tmk_posts")}.${q("summary")} IS 'kept through translation'`
        );
      }
      await query(
        `INSERT INTO ${q("dc_tmk_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("summary")}) VALUES ('row1', 'T', 'r1', 'Written before')`
      );
      const before = await readTableDefinition(query, dialect, "dc_tmk_posts");

      const created = await ensureCompanionTable(
        current.adapter as Parameters<typeof ensureCompanionTable>[0],
        {
          builtBy: "codeFirst" as const,
          slug: "tmk_posts",
          tableName: "dc_tmk_posts",
          fields: [{ name: "summary", type: "text", localized: true }],
          dialect,
          sourceLocale: "en",
        }
      );

      expect(created).toBe(true);
      expect(await readTableDefinition(query, dialect, "dc_tmk_posts")).toEqual(
        withNamedChange(before, { column: "summary", nullable: true })
      );
    });

    it("takes the main column's default into the companion, and back when translation ends", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "tmk_docs",
            fields: [text({ name: "summary" })],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const adapter = current.adapter as unknown as {
        executeQuery: <T = unknown>(sql: string) => Promise<T[]>;
      };
      const query = <T>(statement: string) =>
        adapter.executeQuery<T>(statement);
      const summaryOf = async (table: string) =>
        (await readTableDefinition(query, dialect, table)).columns.find(
          c => c.name === "summary"
        );
      await query(
        dialect === "mysql"
          ? `ALTER TABLE ${q("dc_tmk_docs")} MODIFY COLUMN ${q("summary")} VARCHAR(255) NULL DEFAULT 'none'`
          : `ALTER TABLE ${q("dc_tmk_docs")} ALTER COLUMN ${q("summary")} SET DEFAULT 'none'`
      );
      await query(
        `INSERT INTO ${q("dc_tmk_docs")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("summary")}) VALUES ('row1', 'T', 'r1', 'Written before')`
      );
      const before = await summaryOf("dc_tmk_docs");
      expect(before?.default).toBeTruthy();

      const translated = [{ name: "summary", type: "text", localized: true }];
      expect(
        await ensureCompanionTable(
          current.adapter as Parameters<typeof ensureCompanionTable>[0],
          {
            builtBy: "codeFirst" as const,
            slug: "tmk_docs",
            tableName: "dc_tmk_docs",
            fields: translated,
            dialect,
            sourceLocale: "en",
          }
        )
      ).toBe(true);
      expect((await summaryOf("dc_tmk_docs_locales"))?.default).toBe(
        before?.default
      );

      // The schema apply drops the main column once its values are in the companion; turning
      // translation off then adds it back from the companion.
      await query(
        `ALTER TABLE ${q("dc_tmk_docs")} DROP COLUMN ${q("summary")}`
      );
      const shared = [{ name: "summary", type: "text" }];
      const plan = buildCompanionTransitionStatements({
        slug: "tmk_docs",
        kind: "collection",
        tableName: "dc_tmk_docs",
        dialect,
        builtBy: "codeFirst",
        defaultLocale: "en",
        status: false,
        wasLocalized: true,
        isLocalized: false,
        // The collection had no Draft/Published, so its companion carried no `_status`.
        wasStatus: false,
        oldFields: translated,
        newFields: shared,
        companionExists: true,
        ...(await liveCompanionShape(
          current.adapter as Parameters<typeof liveCompanionShape>[0],
          {
            tableName: "dc_tmk_docs",
            oldFields: translated,
            newFields: shared,
            builtBy: "codeFirst",
            companionExists: true,
          }
        )),
      });
      if (plan.needsArchive) await ensureI18nArchive(adapter, dialect);
      for (const statement of plan.statements) await query(statement);

      expect((await summaryOf("dc_tmk_docs"))?.default).toBe(before?.default);
      const [row] = await query<{ summary: string }>(
        `SELECT ${q("summary")} AS summary FROM ${q("dc_tmk_docs")} WHERE ${q("id")} = 'row1'`
      );
      expect(row?.summary).toBe("Written before");
    });
  }
);
