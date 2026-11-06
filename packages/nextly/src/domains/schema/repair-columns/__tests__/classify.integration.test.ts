/**
 * Each column difference classed from the rows it holds, against live tables on every configured
 * dialect: through `findColumnDifferences`, which introspects the table, finds the difference and
 * classes it by reading the column's values.
 *
 * Each table is created with the column as an earlier version left it and filled with the values a
 * case needs; the field states the column its descriptor names today. Nothing is converted here, so
 * every case also shows that classing reads the rows and changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import { AFFECTED_ROWS_BOUND } from "../../value-conversion/judge-column";
import { judgeStoredColumn } from "../../value-conversion/read-values";
import type { ConversionReasonKind } from "../../value-conversion/types";
import { findColumnDifferences } from "../find-differences";
import type {
  ColumnFinding,
  DiffersFinding,
  RepairEntity,
  RepairEntityKind,
} from "../types";

const f = (field: Record<string, unknown>) =>
  field as unknown as FieldDefinition;

const TABLE = "dc_rcc_values";
const LOCALES = `${TABLE}_locales`;
const CARDS = "comp_rcc_card";

const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const SCORE = f({ name: "score", type: "number" });
const TITLE = f({ name: "title", type: "text" });
const REQUIRED = f({ name: "req", type: "text", required: true });
const AUTHOR = f({ name: "author", type: "relationship", relationTo: "users" });
const AUTHORS = f({
  name: "authors",
  type: "relationship",
  relationTo: "users",
  hasMany: true,
});
const RELATED = f({
  name: "related",
  type: "relationship",
  relationTo: "users",
  options: { relationType: "manyToMany" },
});

/** An entity applied and configured alike. */
function entityOf(
  fields: FieldDefinition[],
  over: {
    kind?: RepairEntityKind;
    table?: string;
    localized?: boolean;
    origin?: "codeFirst" | "fieldGroup";
  } = {}
): RepairEntity {
  const definition = {
    fields,
    localized: over.localized ?? false,
    origin: over.origin ?? "codeFirst",
  };
  return {
    kind: over.kind ?? "collection",
    slug: "rcc-values",
    table: over.table ?? TABLE,
    applied: { ...definition, source: "snapshot" },
    configured: definition,
  };
}

const differs = (findings: ColumnFinding[]): DiffersFinding[] =>
  findings.filter((x): x is DiffersFinding => x.kind === "differs");

/** The ids, or parent/locale pairs, one reason names. */
function rowsOf(finding: DiffersFinding, kind: ConversionReasonKind) {
  const reason = finding.judgement?.reasons.find(r => r.kind === kind);
  return {
    count: reason?.rows?.count ?? 0,
    keys: (reason?.rows?.first ?? []).map(key =>
      "id" in key ? key.id : `${key.parent}/${key.locale}`
    ),
  };
}

describe.each(getConfiguredTestDialects())(
  "classing column differences on %s",
  dialect => {
    let handle: TestNextly;
    const run = (statement: string) => handle.adapter.executeQuery(statement);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const db = () => handle.adapter.getDrizzle();
    const find = async (entities: RepairEntity[]) =>
      differs(await findColumnDifferences({ db: db(), dialect, entities }));
    const keyType = dialect === "mysql" ? "varchar(64)" : "text";

    /** A table keyed by `id`, with one column declared as `column`. */
    async function createTable(table: string, column: string) {
      await run(
        `CREATE TABLE ${q(table)} (${q("id")} ${keyType} PRIMARY KEY, ${column})`
      );
    }

    /** A literal for a value: NULL, or the text quoted, with each quote doubled. */
    const literal = (value: string | null) =>
      value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;

    async function insert(
      table: string,
      column: string,
      rows: Array<[string, string | null]>
    ) {
      const values = rows
        .map(([id, value]) => `(${literal(id)}, ${literal(value)})`)
        .join(", ");
      await run(
        `INSERT INTO ${q(table)} (${q("id")}, ${q(column)}) VALUES ${values}`
      );
    }

    /** Every value of a column as text, in key order, to show a run changed none. */
    async function valuesOf(table: string, column: string) {
      const text =
        dialect === "postgresql"
          ? `${q(column)}::text`
          : dialect === "mysql"
            ? `CAST(${q(column)} AS CHAR)`
            : `quote(${q(column)})`;
      return handle.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${text} AS v FROM ${q(table)} ORDER BY ${q("id")}`
      );
    }

    const schemaOf = (tables: string[]) =>
      introspectLiveColumns(db(), dialect, tables);

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      for (const table of [LOCALES, TABLE, CARDS]) {
        await run(`DROP TABLE IF EXISTS ${q(table)}`);
      }
      await handle?.destroy();
    });

    it.skipIf(dialect === "sqlite")(
      "text to JSON: valid, empty string, unparseable",
      async () => {
        await createTable(TABLE, `${q("links")} text`);
        await insert(TABLE, "links", [
          ["r1", '[{"url":"a"}]'],
          ["r2", ""],
          ["r3", "not json"],
          ["r4", null],
        ]);
        const schema = await schemaOf([TABLE]);
        const values = await valuesOf(TABLE, "links");

        const [links] = await find([entityOf([LINKS])]);
        expect(links?.judgement?.class).toBe("lossy");
        expect(links?.judgement?.reasons.map(r => r.kind)).toEqual([
          "not-json",
        ]);
        expect(rowsOf(links!, "not-json")).toEqual({
          count: 2,
          keys: ["r2", "r3"],
        });

        expect(await schemaOf([TABLE])).toEqual(schema);
        expect(await valuesOf(TABLE, "links")).toEqual(values);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "reports no difference for the same column on SQLite",
      async () => {
        await createTable(TABLE, `${q("links")} text`);
        await insert(TABLE, "links", [
          ["r1", '[{"url":"a"}]'],
          ["r2", "not json"],
        ]);
        expect(await find([entityOf([LINKS])])).toEqual([]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "narrowing with a value that fits and one that does not",
      async () => {
        await createTable(TABLE, `${q("title")} text`);
        await insert(TABLE, "title", [
          ["r1", "short"],
          ["r2", "x".repeat(255)],
        ]);
        if (dialect === "mysql") {
          // The descriptor names varchar(255) for a MySQL text field.
          const [fits] = await find([entityOf([TITLE])]);
          expect(fits?.judgement).toEqual({ class: "safe", reasons: [] });
          await insert(TABLE, "title", [["r3", "y".repeat(256)]]);
          const [longer] = await find([entityOf([TITLE])]);
          expect(longer?.judgement?.class).toBe("blocked");
          expect(rowsOf(longer!, "too-long")).toEqual({
            count: 1,
            keys: ["r3"],
          });
          return;
        }
        // No PostgreSQL descriptor names a varchar(N), so the shared judgement is asked directly.
        const narrow = (n: number) =>
          judgeStoredColumn(
            db(),
            {
              dialect,
              from: { type: "text", nullable: true },
              to: { type: `varchar(${n})`, nullable: true },
              compareAs: "exact",
            },
            { table: TABLE, column: "title", keyedBy: "id" }
          );
        await expect(narrow(255)).resolves.toEqual({
          class: "safe",
          reasons: [],
        });
        const blocked = await narrow(254);
        expect(blocked.class).toBe("blocked");
        expect(blocked.reasons).toEqual([
          {
            kind: "too-long",
            class: "blocked",
            rows: { first: [{ id: "r2" }], count: 1 },
          },
        ]);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "no varchar narrowing arises on SQLite",
      async () => {
        await createTable(TABLE, `${q("title")} text`);
        await insert(TABLE, "title", [["r1", "x".repeat(300)]]);
        expect(await find([entityOf([TITLE])])).toEqual([]);
      }
    );

    it("becoming NOT NULL with and without a null", async () => {
      const type = dialect === "mysql" ? "varchar(255)" : "text";
      await createTable(TABLE, `${q("req")} ${type} NULL`);
      await insert(TABLE, "req", [
        ["r1", "a"],
        ["r2", "b"],
      ]);
      const [none] = await find([entityOf([REQUIRED])]);
      expect(none?.aspects).toEqual({ type: false, nullability: true });
      expect(none?.judgement).toEqual({ class: "safe", reasons: [] });

      await insert(TABLE, "req", [["r3", null]]);
      const [withNull] = await find([entityOf([REQUIRED])]);
      expect(withNull?.judgement?.class).toBe("blocked");
      expect(rowsOf(withNull!, "null-under-not-null")).toEqual({
        count: 1,
        keys: ["r3"],
      });
    });

    it.skipIf(dialect === "sqlite")(
      "decimal(10,2) to double reads back equal",
      async () => {
        await createTable(
          TABLE,
          `${q("price")} ${dialect === "mysql" ? "decimal(10,2)" : "numeric(10,2)"}`
        );
        await insert(TABLE, "price", [
          ["r1", "12345678.99"],
          ["r2", "-99999999.99"],
          ["r3", "0.10"],
          ["r4", null],
        ]);
        const [price] = await find([entityOf([PRICE])]);
        expect(price?.cause).toEqual({
          kind: "legacy",
          shape: "float-as-decimal",
          before: "0.0.2-alpha.66",
        });
        expect(price?.judgement).toEqual({ class: "safe", reasons: [] });
      }
    );

    it("reads a column by the database's spelling of it, where that differs from the field's", async () => {
      const type = dialect === "mysql" ? "varchar(255)" : "text";
      // The field's column is `req`; the table holds it as `REQ`, which only a lookup that ignores
      // case matches, and only the database's own spelling names in a query on PostgreSQL.
      await createTable(TABLE, `${q("REQ")} ${type} NULL`);
      await insert(TABLE, "REQ", [
        ["r1", "a"],
        ["r2", null],
      ]);
      const [found] = await find([entityOf([REQUIRED])]);
      expect(found?.location.column).toBe("req");
      expect(found?.judgement?.class).toBe("blocked");
      expect(rowsOf(found!, "null-under-not-null")).toEqual({
        count: 1,
        keys: ["r2"],
      });
    });

    it("classes a table keyed by another column from its primary key, not from its kind", async () => {
      await run(
        `CREATE TABLE ${q(TABLE)} (${q("code")} ${keyType} PRIMARY KEY, ${q("req")} ${keyType})`
      );
      await run(
        `INSERT INTO ${q(TABLE)} (${q("code")}, ${q("req")}) VALUES ('a', 'x'), ('b', NULL)`
      );
      const [req] = await find([entityOf([REQUIRED])]);
      expect(req?.aspects.nullability).toBe(true);
      expect(req?.judgement?.class).toBe("blocked");
      expect(rowsOf(req!, "null-under-not-null").count).toBe(1);
    });

    it("dropping a required relationship's NOT NULL is safe", async () => {
      const type = dialect === "mysql" ? "varchar(36)" : "text";
      await createTable(TABLE, `${q("author")} ${type} NOT NULL`);
      await insert(TABLE, "author", [["r1", "u1"]]);
      const [author] = await find([entityOf([AUTHOR])]);
      expect(author?.aspects).toEqual({ type: false, nullability: true });
      expect(author?.judgement).toEqual({ class: "safe", reasons: [] });
    });

    it.skipIf(dialect !== "postgresql")(
      "component many-to-many: each stored shape converts, a malformed array literal blocks",
      async () => {
        await createTable(CARDS, `${q("related")} text`);
        await insert(CARDS, "related", [
          ["r1", "6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f"],
          ["r2", '{"a","b"}'],
          ["r3", '["a","b"]'],
          ["r4", '"a"'],
          ["r5", ""],
          ["r6", null],
        ]);
        const cards = () =>
          entityOf([RELATED], {
            kind: "fieldGroup",
            table: CARDS,
            origin: "fieldGroup",
          });
        const [shapes] = await find([cards()]);
        expect(shapes?.cause?.kind).toBe("legacy");
        expect(shapes?.judgement).toEqual({ class: "safe", reasons: [] });

        await insert(CARDS, "related", [["r7", '{"a",']]);
        const [malformed] = await find([cards()]);
        expect(malformed?.judgement?.class).toBe("blocked");
        expect(rowsOf(malformed!, "unreadable-reference-list")).toEqual({
          count: 1,
          keys: ["r7"],
        });
      }
    );

    it.skipIf(dialect === "sqlite")(
      "component hasMany relationship: a bare id converts to a one-item list, as the many-to-many does",
      async () => {
        await createTable(CARDS, `${q("authors")} varchar(36)`);
        await insert(CARDS, "authors", [
          ["r1", "6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f"],
          ["r2", null],
        ]);
        const [authors] = await find([
          entityOf([AUTHORS], {
            kind: "fieldGroup",
            table: CARDS,
            origin: "fieldGroup",
          }),
        ]);
        expect(authors?.aspects.type).toBe(true);
        expect(authors?.judgement).toEqual({ class: "safe", reasons: [] });
      }
    );

    it.skipIf(dialect !== "mysql")("every stored shape converts", async () => {
      await createTable(CARDS, `${q("related")} varchar(36)`);
      await insert(CARDS, "related", [
        ["r1", "6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f"],
        ["r2", '["a","b"]'],
        ["r3", '"a"'],
        ["r4", '{"a",'],
        ["r5", ""],
        ["r6", null],
      ]);
      const [related] = await find([
        entityOf([RELATED], {
          kind: "fieldGroup",
          table: CARDS,
          origin: "fieldGroup",
        }),
      ]);
      expect(related?.cause?.kind).toBe("legacy");
      expect(related?.judgement).toEqual({ class: "safe", reasons: [] });
    });

    it.skipIf(dialect !== "sqlite")("no type difference", async () => {
      await createTable(CARDS, `${q("related")} text`);
      await insert(CARDS, "related", [["r1", '{"a",']]);
      expect(
        await find([
          entityOf([RELATED], {
            kind: "fieldGroup",
            table: CARDS,
            origin: "fieldGroup",
          }),
        ])
      ).toEqual([]);
    });

    it.skipIf(dialect !== "sqlite")(
      "classes an integer column whose descriptor names real as safe, and as blocked with an integer a real cannot hold",
      async () => {
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("price")} integer)`
        );
        await run(
          `INSERT INTO ${q(TABLE)} VALUES ('r1', 1), ('r2', 9007199254740992), ('r3', NULL)`
        );
        const [exact] = await find([entityOf([PRICE])]);
        expect(exact?.judgement).toEqual({ class: "safe", reasons: [] });

        await run(`INSERT INTO ${q(TABLE)} VALUES ('r4', 9007199254740993)`);
        const values = await valuesOf(TABLE, "price");
        const [rounded] = await find([entityOf([PRICE])]);
        expect(rounded?.judgement?.class).toBe("blocked");
        expect(rowsOf(rounded!, "stored-differently")).toEqual({
          count: 1,
          keys: ["r4"],
        });
        expect(await valuesOf(TABLE, "price")).toEqual(values);
      }
    );

    it("a lossy column with more rows than the bound", async () => {
      // More rows than one page of the reader too, so the read moves from page to page by key.
      const total = 1005;
      const ids = Array.from(
        { length: total },
        (_, i) => `r${String(i + 1).padStart(4, "0")}`
      );
      // SQLite keeps JSON as text, so its lossy case is a word under a number field instead.
      const [field, column] =
        dialect === "sqlite"
          ? [SCORE, `${q("score")} text`]
          : [LINKS, `${q("links")} text`];
      await createTable(TABLE, column);
      await insert(
        TABLE,
        field.name,
        ids.map(id => [id, "oops"])
      );
      const [lossy] = await find([entityOf([field])]);
      expect(lossy?.judgement?.class).toBe("lossy");
      const kind = dialect === "sqlite" ? "kept-unreadable" : "not-json";
      expect(rowsOf(lossy!, kind)).toEqual({
        count: total,
        keys: ids.slice(0, AFFECTED_ROWS_BOUND),
      });
    });

    it("a translation table's column names each row by parent and locale, counted once", async () => {
      // A translatable field's column in the `_locales` table: JSON on PostgreSQL and MySQL, which
      // the text column cannot read as such, and a number on SQLite, which a word cannot be.
      const field =
        dialect === "sqlite"
          ? f({ name: "score", type: "number", localized: true })
          : f({
              name: "items",
              type: "repeater",
              localized: true,
              fields: [{ name: "url", type: "text" }],
            });
      const locale = dialect === "mysql" ? "varchar(16)" : "text";
      await run(
        `CREATE TABLE ${q(LOCALES)} (${q("_parent")} ${keyType} NOT NULL, ${q("_locale")} ${locale} NOT NULL, ${q(field.name)} text, PRIMARY KEY (${q("_parent")}, ${q("_locale")}))`
      );
      await run(
        `INSERT INTO ${q(LOCALES)} VALUES ('p1', 'en', 'bad'), ('p1', 'fr', 'bad'), ('p2', 'en', ${dialect === "sqlite" ? "'7'" : `'["ok"]'`})`
      );
      const [translated] = await find([entityOf([field], { localized: true })]);
      expect(translated?.location).toMatchObject({
        table: LOCALES,
        translation: true,
      });
      expect(translated?.judgement?.class).toBe("lossy");
      const kind = dialect === "sqlite" ? "kept-unreadable" : "not-json";
      expect(rowsOf(translated!, kind)).toEqual({
        count: 2,
        keys: ["p1/en", "p1/fr"],
      });
    });
  }
);
