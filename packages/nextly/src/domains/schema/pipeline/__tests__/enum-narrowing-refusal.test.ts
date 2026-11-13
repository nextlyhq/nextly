/**
 * The enum narrowing refusal: which operation pairs are a narrowing, and what
 * the refusal says over the rows a narrowing would break.
 *
 * The pairs are read from check SQL alone, so the tests write the SQL the
 * diff emits for an enum check; the rows are counted through the dialect
 * helper's SQLite shape, so a fake `all` answers for the database.
 *
 * @module domains/schema/pipeline/__tests__/enum-narrowing-refusal.test
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { enumColumnIn } from "../../extension/enum-check";

import {
  checkNarrowings,
  refuseEnumNarrowingsOverRows,
} from "../enum-narrowing-refusal";
import type { Operation } from "../diff/types";
import type { DesiredSchema } from "../types";

const dropCheck = (table: string, sql: string): Operation => ({
  type: "drop_check",
  tableName: table,
  check: { name: "ck_t_state", sql },
});

const addCheck = (table: string, sql: string): Operation => ({
  type: "add_check",
  tableName: table,
  check: { name: "ck_t_state", sql },
});

const WIDE = `"state" IN ('draft', 'live')`;
const NARROW = `"state" IN ('draft')`;

/** `state` renamed to `status` in the same apply. */
const renameState: Operation = {
  type: "rename_column",
  tableName: "t__items",
  fromColumn: "state",
  toColumn: "status",
  fromType: "text",
  toType: "text",
};

describe("checkNarrowings", () => {
  it("pairs a drop and add of the same column into the values taken away", () => {
    const narrowings = checkNarrowings([
      dropCheck("t__items", WIDE),
      addCheck("t__items", NARROW),
    ]);
    expect(narrowings).toEqual([
      {
        table: "t__items",
        column: "state",
        liveColumn: "state",
        values: ["live"],
        kept: ["draft"],
      },
    ]);
  });

  it("pairs by the column, so renaming the constraint still narrows", () => {
    const narrowings = checkNarrowings([
      {
        type: "drop_check",
        tableName: "t__items",
        check: { name: "ck_t_old", sql: WIDE },
      },
      {
        type: "add_check",
        tableName: "t__items",
        check: { name: "ck_t_new", sql: NARROW },
      },
    ]);
    expect(narrowings.map(n => n.values)).toEqual([["live"]]);
  });

  it("is no narrowing when the values only grow or stay", () => {
    expect(
      checkNarrowings([
        dropCheck("t__items", NARROW),
        addCheck("t__items", WIDE),
      ])
    ).toEqual([]);
    expect(
      checkNarrowings([dropCheck("t__items", WIDE), addCheck("t__items", WIDE)])
    ).toEqual([]);
  });

  it("is no narrowing when only the add is there, as a new enum is", () => {
    expect(checkNarrowings([addCheck("t__items", NARROW)])).toEqual([]);
  });

  it("does not pair sides naming different columns no rename joins", () => {
    expect(
      checkNarrowings([
        dropCheck("t__items", WIDE),
        addCheck("t__items", `"status" IN ('draft')`),
      ])
    ).toEqual([]);
  });

  it("pairs a dropped check it cannot read by its name, leaving the rows to decide", () => {
    // MySQL reports a literal holding a backslash escaped, in a form whose
    // meaning depends on its sql_mode, so the old side is not read back.
    const unreadable = "(`state` in (_utf8mb4\\'back\\\\slash\\'))";
    expect(enumColumnIn(unreadable)).toBeNull();
    const narrowings = checkNarrowings([
      dropCheck("t__items", unreadable),
      addCheck("t__items", NARROW),
    ]);
    expect(narrowings).toEqual([
      {
        table: "t__items",
        column: "state",
        liveColumn: "state",
        values: [],
        kept: ["draft"],
      },
    ]);
  });

  it("pairs through a rename of the column in the same apply", () => {
    expect(
      checkNarrowings([
        renameState,
        dropCheck("t__items", WIDE),
        addCheck("t__items", `"status" IN ('draft')`),
      ])
    ).toEqual([
      {
        table: "t__items",
        column: "status",
        liveColumn: "state",
        values: ["live"],
        kept: ["draft"],
      },
    ]);
  });

  it("does not pair checks that are not enum value sets", () => {
    expect(
      checkNarrowings([
        dropCheck("t__items", `"quantity" >= 0`),
        addCheck("t__items", `"quantity" >= 10`),
      ])
    ).toEqual([]);
  });

  it("pairs per table, not across tables sharing a column name", () => {
    expect(
      checkNarrowings([
        dropCheck("t__items", WIDE),
        addCheck("t__other", NARROW),
      ])
    ).toEqual([]);
  });
});

/** A SQLite-shaped db answering `rows` for every count. */
const dbCounting = (n: number): { all: () => Array<{ n: number }> } => ({
  all: () => [{ n }],
});

const emptyDesired = {
  collections: {},
  singles: {},
  components: {},
} as unknown as DesiredSchema;

describe("refuseEnumNarrowingsOverRows", () => {
  it("refuses while a row holds a value the change takes away, naming it", async () => {
    const refusal = refuseEnumNarrowingsOverRows({
      db: dbCounting(2),
      dialect: "sqlite",
      desired: emptyDesired,
      operations: [dropCheck("t__items", WIDE), addCheck("t__items", NARROW)],
    });
    await expect(refusal).rejects.toSatisfy((error: unknown) => {
      expect(NextlyError.isValidation(error)).toBe(true);
      const entry = (error as NextlyError).publicData;
      const messages = JSON.stringify(entry);
      // Every part a usable refusal names: the value, the column, the table
      // and the count — the database's own error names none of them.
      expect(messages).toContain("'live'");
      expect(messages).toContain("state");
      expect(messages).toContain("t__items");
      expect(messages).toContain("2 rows hold");
      return true;
    });
  });

  it("names the values the rows hold and counts them all", async () => {
    const db = {
      all: (): Array<{ v: string; n: number }> => [
        { v: "live", n: 2 },
        { v: "archived", n: 1 },
      ],
    };
    const refusal = refuseEnumNarrowingsOverRows({
      db,
      dialect: "sqlite",
      desired: emptyDesired,
      operations: [
        dropCheck("t__items", `(\`state\` in (_utf8mb4\\'odd\\'))`),
        addCheck("t__items", NARROW),
      ],
    });
    await expect(refusal).rejects.toSatisfy((error: unknown) => {
      const messages = JSON.stringify((error as NextlyError).publicData);
      expect(messages).toContain("'live', 'archived'");
      expect(messages).toContain("3 rows hold");
      return true;
    });
  });

  it("names the entity and field path a table belongs to rather than the table", async () => {
    const desired = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "publishState" }],
        },
      },
      singles: {
        settings: { slug: "settings", tableName: "ds_settings", fields: [] },
      },
      components: {
        meta: { slug: "meta", tableName: "comp_meta", fields: [] },
      },
    } as unknown as DesiredSchema;

    const assertEntity = async (
      table: string,
      column: string,
      expectedLabel: string,
      expectedPath: string
    ) => {
      const refusal = refuseEnumNarrowingsOverRows({
        db: dbCounting(1),
        dialect: "sqlite",
        desired,
        operations: [
          dropCheck(table, `"${column}" IN ('draft', 'live')`),
          addCheck(table, `"${column}" IN ('draft')`),
        ],
      });
      await expect(refusal).rejects.toSatisfy((error: unknown) => {
        const entry = (error as NextlyError).publicData as {
          errors: Array<{ path: string; code: string; message: string }>;
        };
        expect(entry.errors).toHaveLength(1);
        expect(entry.errors[0]?.path).toBe(expectedPath);
        expect(entry.errors[0]?.message).toContain(`${expectedLabel}:`);
        expect(entry.errors[0]?.message).not.toContain(`Table '${table}'`);
        expect(entry.errors[0]?.message).toContain("1 row holds");
        return true;
      });
    };

    await assertEntity(
      "dc_posts",
      "publish_state",
      "Collection 'posts'",
      "fields.publishState"
    );
    await assertEntity(
      "dc_posts_locales",
      "state",
      "Collection 'posts'",
      "fields.state"
    );
    await assertEntity(
      "ds_settings",
      "state",
      "Single 'settings'",
      "fields.state"
    );
    await assertEntity(
      "comp_meta",
      "state",
      "Field group 'meta'",
      "fields.state"
    );
  });

  it("queries rows outside the kept values so database collation decides", async () => {
    const queries: Array<{ strings: string[]; params: unknown[] }> = [];
    const db = {
      execute: (query: unknown): Promise<[Array<{ n: number }>, unknown]> => {
        const text = JSON.stringify(query);
        queries.push({ strings: [text], params: [] });
        return Promise.resolve([[{ n: 0 }], undefined]);
      },
    };
    await refuseEnumNarrowingsOverRows({
      db,
      dialect: "mysql",
      desired: emptyDesired,
      operations: [
        dropCheck("t__items", "`state` IN ('draft', 'live', 'Live')"),
        addCheck("t__items", "`state` IN ('draft', 'Live')"),
      ],
    });
    expect(queries[0]?.strings[0]).toContain("NOT IN");
    expect(queries[0]?.strings[0]).toContain('"Live"');
    expect(queries[0]?.strings[0]).not.toContain('"live"');
  });

  it("applies the narrowing when nothing holds a taken value", async () => {
    await expect(
      refuseEnumNarrowingsOverRows({
        db: dbCounting(0),
        dialect: "sqlite",
        desired: emptyDesired,
        operations: [dropCheck("t__items", WIDE), addCheck("t__items", NARROW)],
      })
    ).resolves.toBeUndefined();
  });

  it("counts on the table's name before a rename in the same apply", async () => {
    const seen: string[] = [];
    const db = {
      all: (query: unknown): Array<{ n: number }> => {
        // The statement carries the table name it counted, among its chunks.
        seen.push(JSON.stringify(query));
        return [{ n: 0 }];
      },
    };
    await refuseEnumNarrowingsOverRows({
      db,
      dialect: "sqlite",
      desired: emptyDesired,
      operations: [
        {
          type: "rename_table",
          fromName: "t__old",
          toName: "t__items",
        } as Operation,
        dropCheck("t__items", WIDE),
        addCheck("t__items", NARROW),
      ],
    });
    expect(seen[0]).toContain("t__old");
  });

  it("refuses a narrowing through a column rename, counting the live column", async () => {
    const seen: string[] = [];
    const db = {
      all: (query: unknown): Array<{ n: number }> => {
        seen.push(JSON.stringify(query));
        return [{ n: 3 }];
      },
    };
    const refused = await refuseEnumNarrowingsOverRows({
      db,
      dialect: "sqlite",
      desired: emptyDesired,
      operations: [
        renameState,
        dropCheck("t__items", WIDE),
        addCheck("t__items", `"status" IN ('draft')`),
      ],
    }).catch((error: unknown) => error);
    expect(NextlyError.isValidation(refused)).toBe(true);
    const messages = JSON.stringify((refused as NextlyError).publicData);
    expect(messages).toContain("ENUM_VALUE_HELD_BY_ROWS");
    expect(messages).toContain("'live'");
    expect(seen[0]).toContain("state");
    expect(seen[0]).not.toContain("status");
  });
});
