/**
 * The column facts read for a proof (`readLiveColumnFacts`), against a connection that answers
 * as a server without MySQL's `SRS_ID` column does.
 *
 * @module domains/schema/migrate/live-column-facts.test
 */
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import { readLiveColumnFacts } from "./live-column-facts";

const rendered = (query: unknown): string =>
  new MySqlDialect().sqlToQuery(query as SQL).sql;

/** One column's row, as `information_schema.COLUMNS` answers it. */
const noted = {
  table: "dc_posts",
  column: "title",
  collation: "utf8mb4_0900_ai_ci",
  table_collation: "utf8mb4_0900_ai_ci",
  comment: "by hand",
  extra: "",
  generated: "",
};

/** A MySQL-dialect connection whose catalog has `SRS_ID` or, as MariaDB's, has not. */
function server(hasSrid: boolean, engine = "InnoDB") {
  const queries: string[] = [];
  return {
    queries,
    execute(query: unknown): Promise<unknown> {
      const text = rendered(query);
      queries.push(text);
      if (text.includes("COLUMN_NAME = 'SRS_ID'")) {
        return Promise.resolve([[{ found: hasSrid ? 1 : 0 }], []]);
      }
      if (text.includes("SRS_ID") && !hasSrid) {
        return Promise.reject(
          new Error("Unknown column 'c.SRS_ID' in 'field list'")
        );
      }
      const row = { ...noted, engine };
      return Promise.resolve([[hasSrid ? { ...row, srid: 4326 } : row], []]);
    },
  };
}

describe("readLiveColumnFacts on a MySQL-dialect server", () => {
  it("reads a column's settings from a catalog without SRS_ID, as MariaDB's is", async () => {
    const db = server(false);
    const facts = await readLiveColumnFacts(db, "mysql", ["dc_posts"], {
      tables: [],
    });
    expect(facts.untrackedSettings("dc_posts", "title")).toEqual(["COMMENT"]);
  });

  it("reads the spatial reference where the catalog has it", async () => {
    const db = server(true);
    const facts = await readLiveColumnFacts(db, "mysql", ["dc_posts"], {
      tables: [],
    });
    expect(facts.untrackedSettings("dc_posts", "title")).toEqual([
      "SRID",
      "COMMENT",
    ]);
    expect(db.queries.some(text => text.includes("c.SRS_ID"))).toBe(true);
  });

  it("says a table's column settings cannot be read where its engine keeps more than the catalog reports", async () => {
    const ndb = await readLiveColumnFacts(
      server(true, "ndbcluster"),
      "mysql",
      ["dc_posts"],
      { tables: [] }
    );
    expect(ndb.settingsReadable("dc_posts")).toBe(false);
    expect(ndb.settingsReadable("DC_POSTS")).toBe(false);
    const innodb = await readLiveColumnFacts(
      server(true),
      "mysql",
      ["dc_posts"],
      {
        tables: [],
      }
    );
    expect(innodb.settingsReadable("dc_posts")).toBe(true);
  });

  it("answers for no table it was not asked to read", async () => {
    // Nothing read of a table is not the same as nothing kept on it: a caller must not take a
    // restated column there for one that holds no setting.
    const facts = await readLiveColumnFacts(
      server(true),
      "mysql",
      ["dc_posts"],
      {
        tables: [],
      }
    );
    expect(facts.settingsReadable("dc_pages")).toBe(false);
    const none = await readLiveColumnFacts(server(true), "mysql", [], {
      tables: [],
    });
    expect(none.settingsReadable("dc_posts")).toBe(false);
  });

  it("names a column flag it does not know, and none of the flags MySQL writes itself", async () => {
    const withExtra = async (extra: string) => {
      const db = {
        execute(query: unknown): Promise<unknown> {
          const text = rendered(query);
          if (text.includes("COLUMN_NAME = ")) {
            return Promise.resolve([[{ found: 1 }], []]);
          }
          return Promise.resolve([
            [{ ...noted, comment: "", extra, engine: "InnoDB", srid: null }],
            [],
          ]);
        },
      };
      const facts = await readLiveColumnFacts(db, "mysql", ["dc_posts"], {
        tables: [],
      });
      return facts.untrackedSettings("dc_posts", "title");
    };
    // A flag of another engine (HeatWave's), which a plain restatement would take off.
    expect(await withExtra("NOT SECONDARY")).toEqual(["NOT SECONDARY"]);
    expect(await withExtra("auto_increment NOT SECONDARY")).toEqual([
      "AUTO_INCREMENT",
      "NOT SECONDARY",
    ]);
    // Every flag an ordinary MySQL server reports is known: none is named as unknown.
    for (const [extra, settings] of [
      ["", []],
      ["DEFAULT_GENERATED", []],
      ["auto_increment", ["AUTO_INCREMENT"]],
      ["on update CURRENT_TIMESTAMP", ["ON UPDATE"]],
      ["DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)", ["ON UPDATE"]],
      ["INVISIBLE", ["INVISIBLE"]],
      ["DEFAULT_GENERATED INVISIBLE", ["INVISIBLE"]],
      ["VIRTUAL GENERATED", []],
      ["STORED GENERATED", []],
    ] as const) {
      expect(await withExtra(extra), extra).toEqual(settings);
    }
  });
});
