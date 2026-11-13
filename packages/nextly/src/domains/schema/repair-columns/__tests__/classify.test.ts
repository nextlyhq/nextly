/**
 * The judgement each column difference is classed by: safe, lossy or blocked, from the values the
 * column holds, judged as the conversion will store each one on that database.
 *
 * Values are given as the reader hands them over: the database's own text of each value, SQLite's
 * storage class beside it, and MySQL's own JSON answer where it gives one.
 */
import { describe, expect, it } from "vitest";

import {
  AFFECTED_ROWS_BOUND,
  judgeColumn,
} from "../../value-conversion/judge-column";
import type {
  ColumnConversion,
  ConversionJudgement,
  ConversionReasonKind,
  SqliteStorage,
  StoredValue,
} from "../../value-conversion/types";

/** Stored values keyed 1, 2, 3, ... in order. */
function rows(
  ...values: Array<string | null | Omit<StoredValue, "key">>
): StoredValue[] {
  return values.map((value, index) =>
    value === null || typeof value === "string"
      ? { key: { id: String(index + 1) }, text: value }
      : { key: { id: String(index + 1) }, ...value }
  );
}

/** A SQLite value with its storage class. */
const sqlite = (text: string | null, storage: SqliteStorage) => ({
  text,
  storage: text === null ? ("null" as const) : storage,
});

/** A MySQL value with the server's own JSON answer. */
const mysqlJson = (text: string | null, jsonValid: boolean) => ({
  text,
  jsonValid,
});

/** The reason kinds a judgement names, in its order. */
const kinds = (judgement: ConversionJudgement): ConversionReasonKind[] =>
  judgement.reasons.map(reason => reason.kind);

/** The ids one reason names. */
function idsOf(
  judgement: ConversionJudgement,
  kind: ConversionReasonKind
): string[] {
  const reason = judgement.reasons.find(r => r.kind === kind);
  return (reason?.rows?.first ?? []).map(key =>
    "id" in key ? key.id : `${key.parent}/${key.locale}`
  );
}

const pg = (
  from: string,
  to: string,
  extra: Partial<ColumnConversion> = {}
): ColumnConversion => ({
  dialect: "postgresql",
  from: { type: from, nullable: true },
  to: { type: to, nullable: true },
  compareAs: "exact",
  ...extra,
});

const my = (
  from: string,
  to: string,
  extra: Partial<ColumnConversion> = {}
): ColumnConversion => ({
  ...pg(from, to, extra),
  dialect: "mysql",
});

const lite = (
  from: string,
  to: string,
  extra: Partial<ColumnConversion> = {}
): ColumnConversion => ({
  ...pg(from, to, extra),
  dialect: "sqlite",
});

describe("judgeColumn", () => {
  describe("classes each known pair", () => {
    it("a repeater or group held as text, to JSON: safe when every value parses, lossy otherwise", async () => {
      const toJsonb = pg("text", "jsonb", { compareAs: "json" });
      await expect(
        judgeColumn(toJsonb, rows('{"a":1}', "[1, 2]", "null", null))
      ).resolves.toEqual({ class: "safe", reasons: [] });

      const lossy = await judgeColumn(toJsonb, rows('{"a":1}', "", "not json"));
      expect(lossy.class).toBe("lossy");
      expect(kinds(lossy)).toEqual(["not-json"]);
      expect(idsOf(lossy, "not-json")).toEqual(["2", "3"]);
    });

    it("on MySQL, the server's own JSON answer decides, not a parse of the text", async () => {
      const toJson = my("text", "json", { compareAs: "json" });
      await expect(
        judgeColumn(
          toJson,
          rows(mysqlJson('{"a":1}', true), mysqlJson(null, false))
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });

      // Text that parses in JavaScript but the server refuses is lossy: the server is what converts.
      const refused = await judgeColumn(
        toJson,
        rows(mysqlJson('{"a":1}', false))
      );
      expect(refused.class).toBe("lossy");
      expect(idsOf(refused, "not-json")).toEqual(["1"]);
    });

    it("a float held as decimal(10,2), to a double, on PostgreSQL and MySQL: safe", async () => {
      for (const conversion of [
        pg("numeric", "double precision", {
          compareAs: "number",
          from: { type: "numeric", nullable: true, typeModifier: "10,2" },
        }),
        my("decimal(10,2)", "double", { compareAs: "number" }),
      ]) {
        await expect(
          judgeColumn(
            conversion,
            rows("12345678.99", "-99999999.99", "0.10", "0.00", null)
          )
        ).resolves.toEqual({ class: "safe", reasons: [] });
      }
    });

    it("a PostgreSQL real to double precision: safe, as the conversion reads each value through its text", async () => {
      // 0.1 and 3.14159 read back as themselves only through their text; the conversion casts
      // that way, so every value of a real converts.
      await expect(
        judgeColumn(
          pg("real", "double precision", {
            compareAs: "number",
            throughText: true,
          }),
          rows("0.1", "3.14159", "100.7", "-3.4028235e+38", null)
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
      // A conversion that casts plainly cannot keep 0.1, so without saying it reads through the
      // text it still has no conversion.
      expect(
        kinds(
          await judgeColumn(
            pg("real", "double precision", { compareAs: "number" }),
            rows("0.1")
          )
        )
      ).toEqual(["no-conversion"]);
      // The other way, and on MySQL, there is still no conversion for the pair.
      for (const conversion of [
        pg("double precision", "real", { compareAs: "number" }),
        my("float", "double", { compareAs: "number" }),
      ]) {
        expect(
          kinds(await judgeColumn(conversion, rows("0.5"))),
          `${conversion.dialect} ${conversion.from.type} to ${conversion.to.type}`
        ).toEqual(["no-conversion"]);
      }
    });

    it("a MySQL text column to varchar(255): safe when every value fits, blocked by a longer one", async () => {
      const narrow = my("text", "varchar(255)");
      // 255 characters of four bytes each fit: the limit counts characters, not bytes or UTF-16 units.
      await expect(
        judgeColumn(narrow, rows("short", "😀".repeat(255), "x".repeat(255)))
      ).resolves.toEqual({ class: "safe", reasons: [] });

      const blocked = await judgeColumn(
        narrow,
        rows("short", "x".repeat(256), "😀".repeat(256))
      );
      expect(blocked.class).toBe("blocked");
      expect(kinds(blocked)).toEqual(["too-long"]);
      expect(idsOf(blocked, "too-long")).toEqual(["2", "3"]);
    });

    it("a component's many-to-many in a scalar column, on PostgreSQL: every stored shape reads, a malformed one blocks", async () => {
      for (const from of ["uuid", "text", "varchar"]) {
        const toList = pg(from, "jsonb", {
          compareAs: "json",
          referenceList: true,
        });
        await expect(
          judgeColumn(
            toList,
            rows(
              "6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f",
              '{"a","b"}',
              "{a,b}",
              "{}",
              '["a","b"]',
              '"a"',
              "",
              "  ",
              null
            )
          )
        ).resolves.toEqual({ class: "safe", reasons: [] });
      }

      const toList = pg("text", "jsonb", {
        compareAs: "json",
        referenceList: true,
      });
      const blocked = await judgeColumn(
        toList,
        rows(
          '{"a","b"}',
          '{"a",',
          "[oops",
          '"unterminated',
          // A quote inside an unquoted element, which PostgreSQL refuses, and a nested literal,
          // which it reads into a list of lists no relation holds.
          '{a"b}',
          "{{a},{b}}"
        )
      );
      expect(blocked.class).toBe("blocked");
      expect(kinds(blocked)).toEqual(["unreadable-reference-list"]);
      expect(idsOf(blocked, "unreadable-reference-list")).toEqual([
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
    });

    it("a component's relation list from a number column: the list conversion reads every value as one id", async () => {
      // The list conversion reads any column through its text, so a number column converts too.
      for (const from of ["integer", "bigint", "numeric(10,2)"]) {
        await expect(
          judgeColumn(
            pg(from, "jsonb", { compareAs: "json", referenceList: true }),
            rows("7", "-3", "12.50", null)
          )
        ).resolves.toEqual({ class: "safe", reasons: [] });
        await expect(
          judgeColumn(
            my(from, "json", { compareAs: "json", referenceList: true }),
            rows(mysqlJson("7", true), mysqlJson(null, false))
          )
        ).resolves.toEqual({ class: "safe", reasons: [] });
      }
    });

    it("a component's many-to-many on MySQL: every stored value reads, so none blocks", async () => {
      const toList = my("varchar(36)", "json", {
        compareAs: "json",
        referenceList: true,
      });
      await expect(
        judgeColumn(
          toList,
          rows(
            mysqlJson("6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f", false),
            mysqlJson('["a"]', true),
            mysqlJson('{"a",', false),
            mysqlJson("", false),
            mysqlJson(null, false)
          )
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });

    it("dropping NOT NULL with the type kept is safe; becoming NOT NULL is blocked by a null", async () => {
      for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
        const drop: ColumnConversion = {
          dialect,
          from: { type: "text", nullable: false },
          to: { type: "text", nullable: true },
          compareAs: "exact",
        };
        await expect(judgeColumn(drop, rows("a", "b"))).resolves.toEqual({
          class: "safe",
          reasons: [],
        });

        const require: ColumnConversion = {
          ...drop,
          from: { type: "text", nullable: true },
          to: { type: "text", nullable: false },
        };
        await expect(judgeColumn(require, rows("a", "b"))).resolves.toEqual({
          class: "safe",
          reasons: [],
        });
        const blocked = await judgeColumn(require, rows("a", null, "c", null));
        expect(blocked.class).toBe("blocked");
        expect(kinds(blocked)).toEqual(["null-under-not-null"]);
        expect(idsOf(blocked, "null-under-not-null")).toEqual(["2", "4"]);
      }
    });

    it("a pair Nextly has no conversion for is blocked, whatever the column holds", async () => {
      for (const conversion of [
        pg("text", "integer", { compareAs: "number" }),
        my("timestamp", "varchar(255)"),
        pg("jsonb", "text"),
      ]) {
        const judgement = await judgeColumn(conversion, rows("1"));
        expect(judgement).toEqual({
          class: "blocked",
          reasons: [{ kind: "no-conversion", class: "blocked" }],
        });
      }
    });
  });

  describe("judges each value as the conversion will store it on that database", () => {
    it("PostgreSQL text to JSON: a value jsonb refuses cannot be held", async () => {
      const toJsonb = pg("text", "jsonb", { compareAs: "json" });
      // Key order and spacing change in jsonb, and the field reads the same value from both.
      await expect(
        judgeColumn(toJsonb, rows('{ "b": 2,   "a": 1 }'))
      ).resolves.toEqual({ class: "safe", reasons: [] });
      // JSON that JavaScript accepts and jsonb refuses: a NUL escape, a lone surrogate, and a high
      // half whose low half does not follow it at once. A pair, and an escaped backslash before the
      // letters u0000, are read.
      const refused = await judgeColumn(
        toJsonb,
        rows(
          '"\\u0000"',
          '"\\ud800"',
          '"ok"',
          '"\\ud800x\\udc00"',
          '"\\ud83d\\ude00"',
          '"\\\\u0000"'
        )
      );
      expect(refused.class).toBe("lossy");
      expect(idsOf(refused, "not-json")).toEqual(["1", "2", "4"]);
    });

    it("a 64-bit integer to a double: an integer a double holds exactly keeps, a larger one is stored differently", async () => {
      for (const conversion of [
        pg("bigint", "double precision", { compareAs: "number" }),
        lite("integer", "real", { compareAs: "number" }),
      ]) {
        const exact = rows(
          conversion.dialect === "sqlite"
            ? sqlite("9007199254740992", "integer")
            : "9007199254740992",
          conversion.dialect === "sqlite" ? sqlite("-7", "integer") : "-7"
        );
        await expect(judgeColumn(conversion, exact)).resolves.toEqual({
          class: "safe",
          reasons: [],
        });

        const changed = await judgeColumn(
          conversion,
          rows(
            conversion.dialect === "sqlite"
              ? sqlite("9007199254740993", "integer")
              : "9007199254740993"
          )
        );
        expect(changed.class).toBe("blocked");
        expect(idsOf(changed, "stored-differently")).toEqual(["1"]);
      }
    });

    it("PostgreSQL integer to real holds 24 bits exactly; SQLite's real is a double and holds more", async () => {
      const toFloat4 = pg("integer", "real", { compareAs: "number" });
      await expect(judgeColumn(toFloat4, rows("16777216"))).resolves.toEqual({
        class: "safe",
        reasons: [],
      });
      const changed = await judgeColumn(toFloat4, rows("16777217"));
      expect(idsOf(changed, "stored-differently")).toEqual(["1"]);

      await expect(
        judgeColumn(
          lite("integer", "real", { compareAs: "number" }),
          rows(sqlite("16777217", "integer"))
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });

    it("a decimal wider than a double holds is stored differently", async () => {
      const wide = pg("numeric", "double precision", {
        compareAs: "number",
        from: { type: "numeric", nullable: true, typeModifier: "20,2" },
      });
      await expect(judgeColumn(wide, rows("12.50"))).resolves.toEqual({
        class: "safe",
        reasons: [],
      });
      const changed = await judgeColumn(wide, rows("123456789012345678.91"));
      expect(changed.class).toBe("blocked");
      expect(kinds(changed)).toEqual(["stored-differently"]);
    });

    it("SQLite: a change of affinity from text to integer converts a number written as text and keeps a word as text", async () => {
      const toInteger = lite("text", "integer", { compareAs: "number" });
      await expect(
        judgeColumn(
          toInteger,
          rows(
            sqlite("42", "text"),
            sqlite("-3", "text"),
            sqlite("4.5", "text")
          )
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });

      const word = await judgeColumn(
        toInteger,
        rows(
          sqlite("42", "text"),
          sqlite("hello", "text"),
          sqlite("0x10", "text")
        )
      );
      expect(word.class).toBe("lossy");
      expect(idsOf(word, "kept-unreadable")).toEqual(["2", "3"]);
    });

    it("SQLite: a field read exactly sees a number SQLite made from its text as a different value", async () => {
      const judgement = await judgeColumn(
        lite("text", "integer"),
        rows(sqlite("42", "text"), sqlite("hello", "text"))
      );
      expect(judgement.class).toBe("blocked");
      expect(idsOf(judgement, "stored-differently")).toEqual(["1"]);
    });

    it("SQLite: a change of affinity from real to integer keeps a whole number's value", async () => {
      await expect(
        judgeColumn(
          lite("real", "integer", { compareAs: "number" }),
          rows(sqlite("7.0", "real"), sqlite("7.5", "real"))
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });

    it("SQLite: a REAL is judged by its full digits, not by the text an older SQLite rounds it to", async () => {
      // SQLite before 3.43 renders a REAL as text with 15 significant digits, both when it is read as
      // text and when a rebuild copies it into a TEXT column; the reader also hands over all 17.
      const rounded = {
        text: "1.0",
        storage: "real" as const,
        exactReal: "1.0000000000000011",
      };
      const toText = await judgeColumn(
        lite("real", "text", { compareAs: "number" }),
        rows(rounded, sqlite("2.5", "real"))
      );
      expect(toText.class).toBe("blocked");
      expect(kinds(toText)).toEqual(["stored-differently"]);
      expect(idsOf(toText, "stored-differently")).toEqual(["1"]);

      // Under INTEGER affinity a REAL with a fraction stays the same REAL.
      await expect(
        judgeColumn(lite("real", "integer"), rows(rounded))
      ).resolves.toEqual({ class: "safe", reasons: [] });

      // A SQLite that writes every digit into the TEXT column keeps the number.
      await expect(
        judgeColumn(
          lite("real", "text", { compareAs: "number" }),
          rows({ ...rounded, text: rounded.exactReal })
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });

    it("SQLite: where the affinity does not change, values are copied as stored", async () => {
      // SQLite enforces no length, so a narrowing to varchar(N) changes nothing it holds.
      await expect(
        judgeColumn(
          lite("text", "varchar(10)"),
          rows(
            sqlite("a value much longer than ten", "text"),
            sqlite("", "text")
          )
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });
  });

  describe("reads each value as that database's own reader does", () => {
    it("PostgreSQL json to jsonb: jsonb refuses a NUL escape json kept; MySQL has one JSON type", async () => {
      const toJsonb = pg("json", "jsonb", { compareAs: "json" });
      const judgement = await judgeColumn(
        toJsonb,
        rows('{"a":1}', '"\\u0000"')
      );
      expect(judgement.class).toBe("lossy");
      expect(idsOf(judgement, "not-json")).toEqual(["2"]);
      // Same type, a different spelling of it: nothing to read.
      await expect(
        judgeColumn(my("json", "json", { compareAs: "json" }), rows("x"))
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });

    it("PostgreSQL jsonb refuses a number with more digits than its numeric holds, as written", async () => {
      const toJsonb = pg("text", "jsonb", { compareAs: "json" });
      const judgement = await judgeColumn(
        toJsonb,
        rows("[1e131071]", "[1e131072]", "1e-16383", "10e-16384", "12e131070")
      );
      expect(idsOf(judgement, "not-json")).toEqual(["2", "4"]);
    });

    it("MySQL: a fixed-length or tiny text column converts like text", async () => {
      await expect(
        judgeColumn(
          my("char(36)", "json", { compareAs: "json", referenceList: true }),
          rows("6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f")
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
      const tiny = await judgeColumn(
        my("tinytext", "json", { compareAs: "json" }),
        rows(mysqlJson("[1]", true), mysqlJson("x", false))
      );
      expect(idsOf(tiny, "not-json")).toEqual(["2"]);
    });

    it("PostgreSQL's array reader skips ASCII spaces only: a no-break space blocks", async () => {
      const toList = pg("text", "jsonb", {
        compareAs: "json",
        referenceList: true,
      });
      const judgement = await judgeColumn(
        toList,
        rows('{"a"\u00a0}', '\v{"a" ,\tb}\v', "{a\u00a0b}")
      );
      // An unquoted element may hold one; a quoted element followed by one is malformed.
      expect(idsOf(judgement, "unreadable-reference-list")).toEqual(["1"]);
    });
  });

  describe("on a database that cannot check the rows and change the column in one transaction", () => {
    it("MySQL: a 64-bit integer to a double is blocked with the late-write reason; no known shape is", async () => {
      const judgement = await judgeColumn(
        my("bigint", "double", { compareAs: "number" }),
        rows("1", "9007199254740992")
      );
      expect(judgement).toEqual({
        class: "blocked",
        reasons: [{ kind: "late-write", class: "blocked" }],
      });

      for (const known of [
        my("text", "json", { compareAs: "json" }),
        my("decimal(10,2)", "double", { compareAs: "number" }),
        my("text", "varchar(255)"),
        my("varchar(36)", "json", { compareAs: "json", referenceList: true }),
        my("text", "text", {
          from: { type: "text", nullable: false },
        }),
      ]) {
        const result = await judgeColumn(known, []);
        expect(kinds(result)).not.toContain("late-write");
      }
    });

    it("PostgreSQL and SQLite: the same column holding only exact values is safe", async () => {
      await expect(
        judgeColumn(
          pg("bigint", "double precision", { compareAs: "number" }),
          rows("1", "9007199254740992")
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
      await expect(
        judgeColumn(
          lite("bigint", "real", { compareAs: "number" }),
          rows(sqlite("1", "integer"), sqlite("9007199254740992", "integer"))
        )
      ).resolves.toEqual({ class: "safe", reasons: [] });
    });
  });

  it("a nullable text column with valid JSON, an unparseable value and a null, expected non-null JSON, is blocked with both reasons", async () => {
    for (const conversion of [
      pg("text", "jsonb", { compareAs: "json" }),
      my("text", "json", { compareAs: "json" }),
    ]) {
      const required: ColumnConversion = {
        ...conversion,
        to: { ...conversion.to, nullable: false },
      };
      const values =
        conversion.dialect === "mysql"
          ? rows(
              mysqlJson('{"a":1}', true),
              mysqlJson("oops", false),
              mysqlJson(null, false)
            )
          : rows('{"a":1}', "oops", null);
      const judgement = await judgeColumn(required, values);
      expect(judgement.class).toBe("blocked");
      expect(judgement.reasons).toEqual([
        {
          kind: "not-json",
          class: "lossy",
          rows: { first: [{ id: "2" }], count: 1 },
        },
        // Clearing the unparseable value would leave a null the column does not allow; named in
        // the order its row was read, before the next row's null.
        {
          kind: "cleared-under-not-null",
          class: "blocked",
          rows: { first: [{ id: "2" }], count: 1 },
        },
        {
          kind: "null-under-not-null",
          class: "blocked",
          rows: { first: [{ id: "3" }], count: 1 },
        },
      ]);
    }
  });

  it("a value that would be cleared, where the column is to stay or become NOT NULL, blocks the column", async () => {
    // No row holds a null: only the clearing would make one, which the column refuses, so the
    // value would have to be invented.
    for (const conversion of [
      pg("text", "jsonb", { compareAs: "json" }),
      my("text", "json", { compareAs: "json" }),
    ]) {
      const required: ColumnConversion = {
        ...conversion,
        from: { ...conversion.from, nullable: false },
        to: { ...conversion.to, nullable: false },
      };
      const values =
        conversion.dialect === "mysql"
          ? rows(mysqlJson('{"a":1}', true), mysqlJson("", false))
          : rows('{"a":1}', "");
      const judgement = await judgeColumn(required, values);
      expect(judgement.class).toBe("blocked");
      expect(kinds(judgement)).toEqual(["not-json", "cleared-under-not-null"]);
      expect(idsOf(judgement, "cleared-under-not-null")).toEqual(["2"]);
      // The same values where a null is allowed are only lossy: a positive control that the
      // nullability, not the value, decides.
      const optional = await judgeColumn(
        { ...required, to: { ...required.to, nullable: true } },
        values
      );
      expect(optional.class).toBe("lossy");
      expect(kinds(optional)).toEqual(["not-json"]);
    }
    // SQLite: a word an integer column becoming a non-null real would keep as text.
    const sqliteRequired: ColumnConversion = {
      ...lite("integer", "real", { compareAs: "number" }),
      to: { type: "real", nullable: false },
    };
    const sqliteJudgement = await judgeColumn(
      sqliteRequired,
      rows(sqlite("1", "integer"), sqlite("word", "text"))
    );
    expect(sqliteJudgement.class).toBe("blocked");
    expect(kinds(sqliteJudgement)).toEqual([
      "kept-unreadable",
      "cleared-under-not-null",
    ]);
  });

  it("hands every row a reason names to a caller that asks, past the bound the report keeps", async () => {
    const toJsonb = pg("text", "jsonb", { compareAs: "json" });
    const many = Array.from({ length: AFFECTED_ROWS_BOUND + 5 }, () => "");
    const noted: Array<[ConversionReasonKind, string]> = [];
    const judgement = await judgeColumn(toJsonb, rows('{"a":1}', ...many), {
      noteRow: (kind, key) => {
        noted.push([
          kind,
          "id" in key ? key.id : `${key.parent}/${key.locale}`,
        ]);
      },
    });
    // The report keeps the first keys and the count; the caller gets every one.
    expect(judgement.reasons[0]?.rows?.first).toHaveLength(AFFECTED_ROWS_BOUND);
    expect(judgement.reasons[0]?.rows?.count).toBe(many.length);
    expect(noted).toHaveLength(many.length);
    expect(noted.map(([, id]) => id)).toEqual(
      many.map((_, i) => String(i + 2))
    );
    expect(new Set(noted.map(([kind]) => kind))).toEqual(new Set(["not-json"]));
  });

  it("names rows by id and by parent and locale, never by value", async () => {
    const secret = "do-not-print-this-value";
    const values: StoredValue[] = [
      { key: { id: "post-1" }, text: secret },
      { key: { parent: "post-1", locale: "en" }, text: `${secret}-en` },
      { key: { parent: "post-1", locale: "fr" }, text: '{"ok":true}' },
    ];
    const judgement = await judgeColumn(
      pg("text", "jsonb", { compareAs: "json" }),
      values
    );
    expect(judgement.reasons).toEqual([
      {
        kind: "not-json",
        class: "lossy",
        rows: {
          first: [{ id: "post-1" }, { parent: "post-1", locale: "en" }],
          count: 2,
        },
      },
    ]);
    expect(JSON.stringify(judgement)).not.toContain(secret);
  });

  it("past the bound, names the first keys in the order read and counts every row", async () => {
    const many = Array.from({ length: AFFECTED_ROWS_BOUND + 5 }, () => "oops");
    const judgement = await judgeColumn(
      pg("text", "jsonb", { compareAs: "json" }),
      rows(...many)
    );
    const reason = judgement.reasons[0];
    expect(reason?.rows?.count).toBe(AFFECTED_ROWS_BOUND + 5);
    expect(reason?.rows?.first).toEqual(
      Array.from({ length: AFFECTED_ROWS_BOUND }, (_, i) => ({
        id: String(i + 1),
      }))
    );
  });

  it("reads values handed over a page at a time", async () => {
    async function* pages(): AsyncGenerator<StoredValue> {
      yield* rows('{"a":1}');
      yield { key: { id: "2" }, text: "oops" };
    }
    const judgement = await judgeColumn(
      pg("text", "jsonb", { compareAs: "json" }),
      pages()
    );
    expect(idsOf(judgement, "not-json")).toEqual(["2"]);
  });
});
