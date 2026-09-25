/**
 * Every ColumnKind builds a column on every dialect.
 *
 * The three `build*ColumnFromKind` functions return `unknown` and have no
 * `default` arm, so a kind nobody added a case for does NOT fail to compile —
 * it falls through and returns `undefined`, and the table receives a
 * non-column. That is how it failed when the extension kinds were added: tsc
 * was clean and `bigint` produced `undefined`.
 *
 * This is the control that makes the omission visible. It enumerates the union
 * rather than sampling it, so a kind added tomorrow is covered by the test
 * written today.
 */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { MySqlBufferBlob, mysqlTable } from "drizzle-orm/mysql-core";
import { PgBytea, pgTable } from "drizzle-orm/pg-core";
import {
  SQLiteBlobBufferBuilder,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { sqliteTableDdl } from "../../../../__tests__/fixtures/sqlite-table-ddl";
import type { SupportedDialect } from "../../../../database/schema-registry";
import { normalizeType } from "../../pipeline/diff/normalize-type";
import type { ColumnDescriptor, ColumnKind } from "../field-column-descriptor";
import { renderDialectType } from "../field-column-descriptor";
import { buildUserDrizzleColumn } from "../runtime-schema-generator";

/**
 * Every member of the union, listed.
 *
 * Typed as `ColumnKind[]` so removing a kind from the union makes this a
 * compile error, and `satisfies` so a kind added to the union without being
 * added here is caught by the exhaustiveness check below.
 */
const ALL_KINDS = [
  "text",
  "longText",
  "shortText",
  "varchar",
  "boolean",
  "integer",
  "double",
  "decimal",
  "timestamp",
  "json",
  "fkSingle",
  "skip",
  "bigint",
  "smallint",
  "serial",
  "char",
  "uuid",
  "real",
  "bytes",
  "enum",
] as const satisfies readonly ColumnKind[];

/**
 * The compile-time half: a kind added to the union but not to the list above
 * makes this assignment fail.
 */
type Missing = Exclude<ColumnKind, (typeof ALL_KINDS)[number]>;
const _everyKindIsListed: Missing extends never ? true : false = true;

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function descriptorFor(kind: ColumnKind): ColumnDescriptor {
  return {
    name: "c",
    dialectType: "text",
    nullable: true,
    kind,
    length: 10,
    precision: 10,
    scale: 2,
  };
}

describe("every ColumnKind", () => {
  it("is listed in this test's own enumeration", () => {
    expect(_everyKindIsListed).toBe(true);
  });

  for (const dialect of DIALECTS) {
    it(`builds a Drizzle column on ${dialect}`, () => {
      for (const kind of ALL_KINDS) {
        const built = buildUserDrizzleColumn(descriptorFor(kind), dialect);
        if (kind === "skip") {
          // The one kind that legitimately produces nothing: the field stores
          // its values in another table.
          expect(built).toBeNull();
          continue;
        }
        // `toBeDefined` rather than a shape assertion: what matters is that
        // the switch has an arm at all. A wrong arm is a different bug, and a
        // visible one.
        expect({
          kind,
          built: built === undefined ? "UNDEFINED" : "ok",
        }).toEqual({ kind, built: "ok" });
      }
    });

    it(`renders a dialect type on ${dialect}`, () => {
      for (const kind of ALL_KINDS) {
        if (kind === "skip") continue;
        const rendered = renderDialectType(kind, dialect, {
          length: 10,
          precision: 10,
          scale: 2,
        });
        expect({ kind, rendered }).toEqual({
          kind,
          rendered: expect.stringMatching(/\S/),
        });
      }
    });
  }
});

/**
 * The SQL type a built column declares, read the way the push path reads it.
 *
 * The builder returns an unbound column builder; binding it into a one-column
 * table of the right dialect is what yields the column whose `getSQLType()`
 * drizzle-kit renders into the CREATE TABLE a fresh push runs.
 */
function builtColumn(
  desc: ColumnDescriptor,
  dialect: SupportedDialect
): { getSQLType(): string } {
  const builder = buildUserDrizzleColumn(desc, dialect) as never;
  const table =
    dialect === "postgresql"
      ? pgTable("t", { c: builder })
      : dialect === "mysql"
        ? mysqlTable("t", { c: builder })
        : sqliteTable("t", { c: builder });
  return (table as unknown as { c: { getSQLType(): string } }).c;
}

/** The `(...)` modifier of a type, whitespace removed, when it carries one. */
function modifierOf(type: string): string | undefined {
  return /\(([^)]*)\)/.exec(type)?.[1]?.replace(/\s/g, "");
}

/**
 * The width each kind is built at in production: the one a field or a DSL
 * column declares, or none. `fkSingle` always carries 36, which is the width
 * its rendered type hard-codes.
 */
const DECLARED_LENGTH: Partial<Record<ColumnKind, number>> = {
  text: 120,
  shortText: 120,
  varchar: 120,
  char: 3,
  fkSingle: 36,
};

describe("the built Drizzle column declares the rendered dialect type", () => {
  // A fresh development push creates tables from the Drizzle columns built
  // here; a production migration creates them from the rendered type. Where
  // the two disagree, the same declaration yields two physical schemas, and
  // the next diff or the next read of a value finds the one it did not expect.
  //
  // Compared through `normalizeType`, the diff's own equivalence — `integer`
  // and `int4` are one type — and, where BOTH sides state a width or
  // precision, that too, since the diff cannot see a width once created.
  for (const dialect of DIALECTS) {
    it(`on ${dialect}, for every kind`, () => {
      for (const kind of ALL_KINDS) {
        if (kind === "skip") continue;
        for (const length of [undefined, DECLARED_LENGTH[kind]]) {
          const { built, rendered } = builtAndRendered(kind, dialect, length);
          expect(built).toEqual(rendered);
        }
      }
    });
  }
});

/**
 * One kind at one width, as the two sides describe it: the Drizzle column the
 * push builds and the type a migration renders. The width is compared only
 * where both sides state one, since the diff cannot see it otherwise.
 */
function builtAndRendered(
  kind: ColumnKind,
  dialect: (typeof DIALECTS)[number],
  length: number | undefined
): { built: unknown; rendered: unknown } {
  const opts = {
    ...(length !== undefined ? { length } : {}),
    precision: 12,
    scale: 4,
  };
  const rendered = renderDialectType(kind, dialect, opts);
  const built = builtColumn(
    { name: "c", dialectType: rendered, nullable: true, kind, ...opts },
    dialect
  ).getSQLType();
  const renderedWidth = modifierOf(rendered);
  const builtWidth = modifierOf(built);
  const bothStateWidth =
    renderedWidth !== undefined && builtWidth !== undefined;
  return {
    built: {
      kind,
      length,
      type: normalizeType(built),
      width: bothStateWidth ? builtWidth : "n/a",
    },
    rendered: {
      kind,
      length,
      type: normalizeType(rendered),
      width: bothStateWidth ? renderedWidth : "n/a",
    },
  };
}

describe("the bytes kind", () => {
  const bytes: ColumnDescriptor = {
    name: "c",
    dialectType: "",
    nullable: true,
    kind: "bytes",
  };

  it("builds a binary column on every dialect, in buffer mode", () => {
    // The type alone does not settle it: each dialect's Drizzle blob has a
    // non-binary mode (MySQL's string mode, SQLite's JSON mode) that declares
    // the same SQL type and changes what a read returns.
    const pg = builtColumn(bytes, "postgresql");
    expect(pg.getSQLType()).toBe("bytea");
    expect(pg).toBeInstanceOf(PgBytea);

    const mysql = builtColumn(bytes, "mysql");
    expect(mysql.getSQLType()).toBe("longblob");
    expect(mysql).toBeInstanceOf(MySqlBufferBlob);

    const sqlite = builtColumn(bytes, "sqlite");
    expect(sqlite.getSQLType()).toBe("blob");
    expect((sqlite as unknown as { dataType: string }).dataType).toBe(
      "object buffer"
    );
  });

  it("round-trips the exact bytes on SQLite", () => {
    // What buffer mode is for, observed through a real driver: the bytes
    // read back are the bytes written, not a JSON rendering of them.
    // Narrowed by the builder's class rather than cast: a non-buffer blob
    // builder fails here, before any bytes are written.
    const built = buildUserDrizzleColumn(bytes, "sqlite");
    if (!(built instanceof SQLiteBlobBufferBuilder)) {
      throw new Error("the bytes kind did not build a buffer-mode blob");
    }
    const table = sqliteTable("bytes_rt", {
      id: sqliteText("id").notNull(),
      c: built,
    });
    const client = new Database(":memory:");
    try {
      // DDL derived from the table itself, so the column created is the one
      // the builder declared.
      for (const statement of sqliteTableDdl(table)) {
        client.exec(statement);
      }
      const db = drizzle({ client });
      const written = Buffer.from([0, 1, 2, 250, 255]);
      db.insert(table).values({ id: "a", c: written }).run();

      const stored = client
        .prepare("SELECT hex(c) AS h FROM bytes_rt")
        .get() as { h: string };
      expect(stored.h).toBe("000102FAFF");

      const row = db.select().from(table).where(eq(table.id, "a")).get();
      expect(Buffer.isBuffer(row?.c)).toBe(true);
      expect(row?.c).toEqual(written);
    } finally {
      client.close();
    }
  });
});
