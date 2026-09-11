/**
 * Every assertion here compiles the built statement to SQL text and a
 * parameter list, as `drizzle-where.test.ts` does, because the text and the
 * params are what the driver receives: a column bound through the wrong
 * encoder, a key dropped, or a placeholder misnumbered all change one of the
 * two, and none can hide behind "a statement came back".
 *
 * `PgDialect` fixes the rendering for most cases; the dialect cases at the
 * end compile one statement through all three, since quoting and placeholder
 * numbering are the parts that differ.
 */
import { sql as rawSql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  boolean,
  integer,
  jsonb,
  PgDialect,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import type { WhereClause } from "../types";
import {
  buildUpdateStatement,
  type UpdateStatementInput,
} from "../update-statement";

/**
 * A model that declares LESS than the physical table has: `title` is a
 * column on the table this stands for, and not here — the localization
 * transition window in miniature.
 */
const pages = pgTable("dc_pages", {
  id: text("id").primaryKey(),
  slug: text("slug"),
  meta: jsonb("meta"),
  published: boolean("published"),
  updatedAt: timestamp("updated_at"),
});

const byId = (id: string): WhereClause => ({
  and: [{ column: "id", op: "=", value: id }],
});

/** Marks a value as having gone through the unmodeled binder. */
const tagged = (value: unknown): string => `unmodeled:${String(value)}`;

function build(
  overrides: Partial<UpdateStatementInput>
): ReturnType<typeof buildUpdateStatement> {
  return buildUpdateStatement({
    table: "dc_pages",
    tableObj: pages,
    data: {},
    where: byId("p1"),
    bindUnmodeled: tagged,
    ...overrides,
  });
}

/** Compiles through Postgres, refusing an absent statement by name. */
function compile(overrides: Partial<UpdateStatementInput>): {
  sql: string;
  params: unknown[];
} {
  const statement = build(overrides);
  if (!statement) throw new Error("expected a statement, got null");
  return new PgDialect().sqlToQuery(statement);
}

describe("buildUpdateStatement — which columns are written", () => {
  it("writes a column the model does not declare, through the unmodeled binder", () => {
    const { sql, params } = compile({ data: { title: "Hallo" } });
    expect(sql).toBe(
      'UPDATE "dc_pages" SET "title" = $1 WHERE "dc_pages"."id" = $2'
    );
    expect(params).toEqual(["unmodeled:Hallo", "p1"]);
  });

  it("omits a key whose value is undefined, and refuses when nothing is left", () => {
    const { sql, params } = compile({
      data: { slug: "kept", title: undefined },
    });
    expect(sql).not.toContain("title");
    expect(params).toEqual(["kept", "p1"]);

    expect(build({ data: { title: undefined } })).toBeNull();
    expect(build({ data: {} })).toBeNull();
  });

  it("writes null as NULL rather than omitting it", () => {
    const { sql, params } = compile({ data: { slug: null } });
    expect(sql).toContain('"slug" = $1');
    expect(params[0]).toBeNull();
  });

  it("accepts a declared column by either spelling and emits its SQL name", () => {
    const at = new Date("2026-09-11T10:00:00.000Z");
    const js = compile({ data: { updatedAt: at } });
    const sqlName = compile({ data: { updated_at: at } });
    expect(js.sql).toBe(sqlName.sql);
    expect(js.sql).toContain('"updated_at" = $1');
    expect(js.params).toEqual(sqlName.params);
  });
});

describe("buildUpdateStatement — how a declared column binds", () => {
  it("binds a date through the column's own encoder, not as a Date", () => {
    const at = new Date("2026-09-11T10:00:00.000Z");
    const { params } = compile({ data: { updated_at: at } });
    // What `db.update(pages).set({ updatedAt: at })` binds for this column.
    expect(params[0]).toBe(pages.updatedAt.mapToDriverValue(at));
    expect(params[0]).not.toBeInstanceOf(Date);
  });

  it("binds a document for a JSON column as its encoder does, whether it arrives as an object or already serialized", () => {
    // The query-builder path parses an already-serialized string before the
    // encoder sees it, so the document is encoded once either way. Compared
    // against the encoder's own output rather than a literal, because which
    // stage serializes JSON is the dialect's business, not this builder's.
    const document = { a: 1, b: [true, null] };
    const encoded = pages.meta.mapToDriverValue(document);
    const fromObject = compile({ data: { meta: document } });
    const fromString = compile({ data: { meta: JSON.stringify(document) } });
    expect(fromObject.params[0]).toEqual(encoded);
    expect(fromString.params[0]).toEqual(encoded);
  });

  it("keeps a string that is not JSON as the JSON column's encoder would", () => {
    const { params } = compile({ data: { meta: "not json" } });
    expect(params[0]).toBe(pages.meta.mapToDriverValue("not json"));
  });

  it("leaves a boolean to the driver on a boolean column", () => {
    const { params } = compile({ data: { published: true } });
    expect(params[0]).toBe(true);
  });

  it("does not put an unmodeled value through any column's encoder", () => {
    const at = new Date("2026-09-11T10:00:00.000Z");
    const { params } = compile({ data: { title: at } });
    expect(params[0]).toBe(tagged(at));
  });

  it("writes a column or an SQL fragment as the expression it is, not as a bound value", () => {
    // `{ slug: pages.id }` copies a column; the query builder's `mapUpdateSet`
    // passes a Column or an SQL through untouched, and so does this.
    const { sql, params } = compile({
      data: { slug: pages.id, meta: rawSql`'{}'::jsonb` },
    });
    expect(sql).toBe(
      `UPDATE "dc_pages" SET "slug" = "dc_pages"."id", "meta" = '{}'::jsonb WHERE "dc_pages"."id" = $1`
    );
    expect(params).toEqual(["p1"]);
  });

  it("assigns a declared $onUpdate column the caller left unnamed, as the query builder does", () => {
    const counted = pgTable("dc_counted", {
      id: text("id").primaryKey(),
      slug: text("slug"),
      revision: integer("revision").$onUpdate(() => 7),
      touchedAt: timestamp("touched_at").$onUpdate(
        () => new Date("2026-09-11T10:00:00.000Z")
      ),
    });
    const { sql, params } = new PgDialect().sqlToQuery(
      buildUpdateStatement({
        table: "dc_counted",
        tableObj: counted,
        data: { slug: "a" },
        where: byId("p1"),
        bindUnmodeled: tagged,
      })!
    );
    expect(sql).toBe(
      'UPDATE "dc_counted" SET "slug" = $1, "revision" = $2, "touched_at" = $3 WHERE "dc_counted"."id" = $4'
    );
    // Through the column's own encoder, like any declared column.
    expect(params).toEqual([
      "a",
      7,
      counted.touchedAt.mapToDriverValue(new Date("2026-09-11T10:00:00.000Z")),
      "p1",
    ]);

    // Named by the caller, the caller's value wins and the callback is not run.
    const named = new PgDialect().sqlToQuery(
      buildUpdateStatement({
        table: "dc_counted",
        tableObj: counted,
        data: { revision: 1 },
        where: byId("p1"),
        bindUnmodeled: tagged,
      })!
    );
    expect(named.sql).not.toContain('"revision" = $2');
    expect(named.params).toEqual([
      1,
      counted.touchedAt.mapToDriverValue(new Date("2026-09-11T10:00:00.000Z")),
      "p1",
    ]);
  });
});

describe("buildUpdateStatement — WHERE and RETURNING", () => {
  it("renders the where through the shared builder, params after the SET", () => {
    const { sql, params } = compile({
      data: { slug: "a", title: "b" },
      where: {
        and: [
          { column: "slug", op: "=", value: "old" },
          { column: "published", op: "=", value: false },
        ],
      },
    });
    expect(sql).toBe(
      'UPDATE "dc_pages" SET "slug" = $1, "title" = $2 WHERE (("dc_pages"."slug" = $3) and ("dc_pages"."published" = $4))'
    );
    expect(params).toEqual(["a", "unmodeled:b", "old", false]);
  });

  it("emits no WHERE for an empty clause, as the query builder does", () => {
    const { sql } = compile({ data: { slug: "a" }, where: {} });
    expect(sql).toBe('UPDATE "dc_pages" SET "slug" = $1');
  });

  it("appends the RETURNING list it is handed, verbatim", () => {
    // A raw fragment, which is what the adapters pass: they spell the list
    // with their own identifier escaping and wall-clock aliases.
    const { sql } = compile({
      data: { slug: "a" },
      returning: rawSql.raw('"id", "slug"'),
    });
    expect(sql).toMatch(/ RETURNING "id", "slug"$/);
  });
});

describe("buildUpdateStatement — one statement, three dialects", () => {
  const statement = () =>
    build({ data: { slug: "a", title: "b" }, where: byId("p1") })!;

  it("postgres quotes with double quotes and numbers placeholders", () => {
    expect(new PgDialect().sqlToQuery(statement()).sql).toBe(
      'UPDATE "dc_pages" SET "slug" = $1, "title" = $2 WHERE "dc_pages"."id" = $3'
    );
  });

  it("mysql quotes with backticks and uses ? placeholders", () => {
    expect(new MySqlDialect().sqlToQuery(statement()).sql).toBe(
      "UPDATE `dc_pages` SET `slug` = ?, `title` = ? WHERE `dc_pages`.`id` = ?"
    );
  });

  it("sqlite quotes with double quotes and uses ? placeholders", () => {
    expect(new SQLiteDialect().sqlToQuery(statement()).sql).toBe(
      'UPDATE "dc_pages" SET "slug" = ?, "title" = ? WHERE "dc_pages"."id" = ?'
    );
  });

  it("binds the same params in the same order on every dialect", () => {
    const expected = ["a", "unmodeled:b", "p1"];
    expect(new PgDialect().sqlToQuery(statement()).params).toEqual(expected);
    expect(new MySqlDialect().sqlToQuery(statement()).params).toEqual(expected);
    expect(new SQLiteDialect().sqlToQuery(statement()).params).toEqual(
      expected
    );
  });
});
