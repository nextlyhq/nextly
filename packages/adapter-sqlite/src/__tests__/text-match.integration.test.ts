// The where builder's text operators against SQLite. Its LIKE already ignores
// case for ASCII letters, so CONTAINS and ICONTAINS agree here; what this file
// holds SQLite to is that ILIKE runs at all, which SQLite has no keyword for,
// and that ICONTAINS still matches `%` and `_` literally.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_sqlite_text_match";

const releases = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

const TITLES = ["Spring launch", "50% off", "a_b", "AXB"];

describe("SQLite text matching", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, title text NOT NULL)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? releases : null),
    });
    for (const [index, title] of TITLES.entries()) {
      await adapter.insert(TABLE, { id: String(index), title });
    }
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  async function titlesWhere(condition: WhereCondition): Promise<string[]> {
    const rows = await adapter.select<{ title: string }>(TABLE, {
      where: { and: [condition] },
    });
    return rows.map(row => row.title).sort();
  }

  it("ICONTAINS ignores case", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "spring" })
    ).toEqual(["Spring launch"]);
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "LAUNCH" })
    ).toEqual(["Spring launch"]);
  });

  it("ICONTAINS matches % and _ as characters, not wildcards", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "50%" })
    ).toEqual(["50% off"]);
    // As a wildcard, `_` would also match "AXB".
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "A_B" })
    ).toEqual(["a_b"]);
  });

  it("ILIKE runs on SQLite and ignores case, its pattern's wildcards intact", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "%SPRING%" })
    ).toEqual(["Spring launch"]);
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "a_b" })
    ).toEqual(["AXB", "a_b"]);
  });
});
