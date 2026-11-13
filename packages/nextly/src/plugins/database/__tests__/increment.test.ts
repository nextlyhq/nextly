/**
 * What `ctx.db.update` sends for `increment(n)`, on each dialect.
 *
 * The update runs against a handle that records the `set` it was given, over
 * the table each dialect really compiles, and the recorded value is rendered
 * by that dialect's own SQL writer: what reaches the database is the text, so
 * the text is what is checked. That two increments at once both count is the
 * integration suite's (`increment.integration.test.ts`).
 */
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";

import type { SupportedDialect } from "../../../database/schema-registry";
import { toDrizzleTable } from "../../../domains/schema/extension/compile";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import type {
  ExtensionTable,
  SchemaOwner,
} from "../../../domains/schema/extension/types";
import { NextlyError } from "../../../errors/nextly-error";
import { increment, incrementBy, isIncrement } from "../increment";
import { createPluginDatabase } from "../plugin-database";

const counters = defineTable("counters", {
  id: col.id(),
  label: col.shortText(),
  hits: col.integer(),
  score: col.double({ nullable: true }),
});

const OWNER: SchemaOwner = { kind: "plugin", id: "fx" };
const NAME = "fx__counters";

/** The `set` each update was given, over `dialect`'s compiled table. */
function harness(dialect: SupportedDialect) {
  const declared: ExtensionTable = {
    name: NAME,
    authored: "counters",
    owner: OWNER,
    columns: [...counters.columns],
    indexes: [],
  };
  const table = toDrizzleTable(declared, dialect);
  const sets: Record<string, unknown>[] = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          sets.push(values);
          return Promise.resolve({ rowCount: 1 });
        },
      }),
    }),
  };
  const surface = createPluginDatabase({
    dialect,
    owner: OWNER,
    dependsOn: new Set(),
    owners: () => new Map([[NAME, OWNER]]),
    tables: () => ({ [NAME]: table }),
    tableList: () => [{ name: NAME, authored: "counters", owner: OWNER }],
    db: () => db,
    relationalDb: () => db,
    transaction: fn =>
      fn({ db, relationalDb: db, afterCommit: () => undefined }),
  });
  return { surface, sets };
}

/** `value` as `dialect`'s own SQL writer renders it. */
const WRITERS: Record<
  SupportedDialect,
  (value: SQL) => { sql: string; params: unknown[] }
> = {
  postgresql: value => new PgDialect().sqlToQuery(value),
  mysql: value => new MySqlDialect().sqlToQuery(value),
  sqlite: value => new SQLiteDialect().sqlToQuery(value),
};

/** The column as each dialect quotes it. */
const QUOTED: Record<SupportedDialect, string> = {
  postgresql: '"hits"',
  mysql: "`hits`",
  sqlite: '"hits"',
};

const ALWAYS = { getSQL: () => undefined } as unknown as SQL;

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "increment on %s",
  dialect => {
    it("adds to the stored value in the statement itself", async () => {
      const { surface, sets } = harness(dialect);

      await surface.update(counters, { hits: increment(1) }).where(ALWAYS);

      const rendered = WRITERS[dialect](sets[0]?.hits as SQL);
      // The column itself, plus a bound amount: never a value read earlier.
      expect(rendered.sql).toContain(QUOTED[dialect]);
      expect(rendered.sql).toMatch(/\+ (\$1|\?)$/);
      expect(rendered.params).toEqual([1]);
    });

    it("writes a plain value beside it as it always did", async () => {
      const { surface, sets } = harness(dialect);

      await surface
        .update(counters, { hits: increment(5), label: "five" })
        .where(ALWAYS);

      expect(sets[0]?.label).toBe("five");
      expect(WRITERS[dialect](sets[0]?.hits as SQL).params).toEqual([5]);
    });

    it("refuses a column that is not a number", async () => {
      const { surface, sets } = harness(dialect);

      // The type refuses it too; a caller the type does not reach is refused
      // at runtime, before anything is sent.
      const update = surface.update(counters, {
        label: increment(1) as unknown as string,
      });

      await expect(update.where(ALWAYS)).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
      expect(sets).toEqual([]);
    });
  }
);

describe("increment()", () => {
  it("is read as one by a copy of the module loaded apart", async () => {
    // A site's bundler can load the module twice: an increment made by one
    // copy reaches a `ctx.db` built by the other, which must still read it.
    vi.resetModules();
    const apart = await import("../increment");
    expect(apart.increment).not.toBe(increment);

    expect(isIncrement(apart.increment(3))).toBe(true);
    expect(incrementBy(apart.increment(3))).toBe(3);
  });

  it("refuses an amount that is not a finite number", () => {
    for (const by of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => increment(by)).toThrow(NextlyError);
    }
  });
});
