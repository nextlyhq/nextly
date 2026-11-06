/**
 * The reader against live tables on every configured dialect, keyed as the database reports each
 * table's primary key: a translation table by its parent and locale, and a table keyed some other
 * way read whole. The development push's checks read any table the diff manages this way.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import { judgeStoredColumn, keyedByOf } from "../read-values";

const LOCALES = "dc_rvi_values_locales";
const BY_SLUG = "dc_rvi_by_slug";

describe.each(getConfiguredTestDialects())(
  "reading stored values on %s",
  dialect => {
    let handle: TestNextly;
    const run = (statement: string) => handle.adapter.executeQuery(statement);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const db = () => handle.adapter.getDrizzle();
    const key = dialect === "mysql" ? "varchar(64)" : "text";
    const keyedBy = async (table: string) =>
      keyedByOf(
        (await introspectLiveColumns(db(), dialect, [table])).tables[0]
          ?.columns ?? []
      );
    // The column is to become NOT NULL, so every null is a reason with its row: a judgement every
    // dialect reads alike, whatever the column's type.
    const requireColumn = (table: string, by: "id" | "translation" | "none") =>
      judgeStoredColumn(
        db(),
        {
          dialect,
          from: { type: "text", nullable: true },
          to: { type: "text", nullable: false },
          compareAs: "exact",
        },
        { table, column: "c", keyedBy: by }
      );

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      for (const table of [LOCALES, BY_SLUG]) {
        await run(`DROP TABLE IF EXISTS ${q(table)}`);
      }
      await handle?.destroy();
    });

    it("names a translation table's rows by parent and locale, keyed as its primary key says", async () => {
      await run(
        `CREATE TABLE ${q(LOCALES)} (${q("_parent")} ${key} NOT NULL, ${q("_locale")} ${key} NOT NULL, ${q("c")} text, PRIMARY KEY (${q("_parent")}, ${q("_locale")}))`
      );
      await run(
        `INSERT INTO ${q(LOCALES)} VALUES ('p1', 'fr', NULL), ('p1', 'en', 'x'), ('p0', 'en', NULL)`
      );
      expect(await keyedBy(LOCALES)).toBe("translation");
      const judgement = await requireColumn(LOCALES, "translation");
      expect(judgement.reasons).toEqual([
        {
          kind: "null-under-not-null",
          class: "blocked",
          rows: {
            first: [
              { parent: "p0", locale: "en" },
              { parent: "p1", locale: "fr" },
            ],
            count: 2,
          },
        },
      ]);
    });

    it("reads a table keyed by another column whole, and still classes it", async () => {
      await run(
        `CREATE TABLE ${q(BY_SLUG)} (${q("slug")} ${key} PRIMARY KEY, ${q("c")} text)`
      );
      await run(`INSERT INTO ${q(BY_SLUG)} VALUES ('a', 'x'), ('b', NULL)`);
      expect(await keyedBy(BY_SLUG)).toBe("none");
      const judgement = await requireColumn(BY_SLUG, "none");
      expect(judgement.class).toBe("blocked");
      expect(judgement.reasons[0]?.rows?.count).toBe(1);
    });
  }
);
