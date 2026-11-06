/**
 * What a column's new type cannot keep, judged from facts about the live table.
 *
 * Each case feeds the pure analysis one property the new type cannot keep, and beside it the same
 * kind of property in a form the new type does keep: the first must be named, with what the owner
 * can change, and the second must not be. A plan that named everything, or nothing, fails one half
 * of each case. The facts are read from real databases in `conversion-preserves-table`.
 */
import { describe, expect, it } from "vitest";

import { keepsEquality } from "../carry";
import type { CannotCarry, ConversionRequest } from "../types";
import { mysqlCarry, mysqlCheckSource, type MysqlCarryFacts } from "../mysql";
import { postgresCarry, type PostgresCarryFacts } from "../postgres";

const pgRequest = (
  from: ConversionRequest["from"],
  to: ConversionRequest["to"],
  extra: Partial<ConversionRequest> = {}
): ConversionRequest => ({
  dialect: "postgresql",
  table: "dc_posts",
  column: "body",
  from,
  to,
  ...extra,
});

const mysqlRequest = (
  from: ConversionRequest["from"],
  to: ConversionRequest["to"],
  extra: Partial<ConversionRequest> = {}
): ConversionRequest => ({
  dialect: "mysql",
  table: "dc_posts",
  column: "body",
  from,
  to,
  ...extra,
});

const pgFacts = (facts: Partial<PostgresCarryFacts>): PostgresCarryFacts => ({
  default: null,
  collation: null,
  newTypeTakesCollation: true,
  indexes: [],
  checks: [],
  triggers: [],
  dependents: [],
  generatedColumns: [],
  policies: [],
  foreignKeys: [],
  identity: false,
  hasDescendants: false,
  inheritedColumn: false,
  expressions: { tried: true, typeRefusal: null, refused: [] },
  ...facts,
});

const mysqlFacts = (facts: Partial<MysqlCarryFacts>): MysqlCarryFacts => ({
  characterSet: null,
  collation: null,
  default: null,
  indexes: [],
  checks: [],
  foreignKeys: [],
  autoIncrement: false,
  ...facts,
});

/** The names a plan gives for one property, each checked to say what the owner can change. */
function named(
  cannotCarry: readonly CannotCarry[],
  property: CannotCarry["property"]
): string[] {
  const found = cannotCarry.filter(item => item.property === property);
  for (const item of found) {
    expect(item.reason.length).toBeGreaterThan(0);
    expect(item.ownerCan.length).toBeGreaterThan(0);
  }
  return found.map(item => item.name);
}

const TEXT = { type: "text", nullable: true };
const JSONB = { type: "jsonb", nullable: true };
const VARCHAR_255 = { type: "varchar", typeModifier: "255", nullable: true };
const NUMERIC = { type: "numeric", typeModifier: "10,2", nullable: true };
const FLOAT8 = { type: "float8", nullable: true };

describe("PostgreSQL: what the new type cannot keep", () => {
  it("default: one with no automatic cast, or a literal the new type refuses, is named; a castable literal it holds is not", () => {
    const noCast = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        default: { expression: "'[]'::text", castsAutomatically: false },
      })
    );
    expect(named(noCast.cannotCarry, "default")).toEqual(["body"]);

    const tooLong = postgresCarry(
      pgRequest(TEXT, { type: "varchar", typeModifier: "3", nullable: true }),
      pgFacts({
        default: { expression: "'draft'::text", castsAutomatically: true },
      })
    );
    expect(named(tooLong.cannotCarry, "default")).toEqual(["body"]);

    const kept = postgresCarry(
      pgRequest(NUMERIC, FLOAT8),
      pgFacts({ default: { expression: "1.25", castsAutomatically: true } })
    );
    expect(kept.cannotCarry).toEqual([]);
  });

  it("index: an explicit operator class or an expression the new type lacks is named; a plain btree it keeps is not", () => {
    const plan = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        indexes: [
          {
            name: "idx_pattern",
            keyed: true,
            inExpression: false,
            explicitOpclass: "text_pattern_ops",
            keptByNewType: false,
          },
          {
            name: "idx_lower",
            keyed: false,
            inExpression: true,
            explicitOpclass: null,
            keptByNewType: true,
          },
          {
            name: "idx_plain",
            keyed: true,
            inExpression: false,
            explicitOpclass: null,
            keptByNewType: true,
          },
        ],
      })
    );
    // The expression index is named only where PostgreSQL refused it against the new type.
    expect(named(plan.cannotCarry, "index")).toEqual(["idx_pattern"]);
    const refused = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        indexes: [
          {
            name: "idx_lower",
            keyed: false,
            inExpression: true,
            explicitOpclass: null,
            keptByNewType: true,
          },
        ],
        expressions: {
          tried: true,
          typeRefusal: null,
          refused: [
            {
              property: "index",
              name: "idx_lower",
              error: "function lower(jsonb) does not exist",
            },
          ],
        },
      })
    );
    expect(named(refused.cannotCarry, "index")).toEqual(["idx_lower"]);
    expect(refused.cannotCarry[0].reason).toContain(
      "function lower(jsonb) does not exist"
    );
  });

  it("key: a foreign key into or out of the column is named when its type changes, not for a nullability change", () => {
    const keys: PostgresCarryFacts["foreignKeys"] = [
      { name: "fk_into", table: "dc_comments", direction: "into" },
      { name: "fk_out", table: "dc_authors", direction: "out-of" },
    ];
    const plan = postgresCarry(
      pgRequest(VARCHAR_255, TEXT),
      pgFacts({ foreignKeys: keys })
    );
    expect(named(plan.cannotCarry, "key")).toEqual(["fk_into", "fk_out"]);
    const nullability = postgresCarry(
      pgRequest(
        { ...VARCHAR_255, nullable: false },
        { ...VARCHAR_255, nullable: true }
      ),
      pgFacts({ foreignKeys: keys })
    );
    expect(nullability.cannotCarry).toEqual([]);
  });

  it("check: one PostgreSQL refused against the new type is named, whatever the kind of value; one it accepted is not", () => {
    const checks = [{ name: "chk_even" }, { name: "chk_positive" }];
    // numeric to float8 stays a number, yet float8 has no `%`.
    const plan = postgresCarry(
      pgRequest(NUMERIC, FLOAT8),
      pgFacts({
        checks,
        expressions: {
          tried: true,
          typeRefusal: null,
          refused: [
            {
              property: "check",
              name: "chk_even",
              error: "operator does not exist: double precision % integer",
            },
          ],
        },
      })
    );
    expect(named(plan.cannotCarry, "check")).toEqual(["chk_even"]);
    expect(plan.cannotCarry[0].reason).toContain("operator does not exist");
    // A check PostgreSQL accepted on the copy is kept, across kinds too.
    expect(
      postgresCarry(pgRequest(TEXT, JSONB), pgFacts({ checks })).cannotCarry
    ).toEqual([]);
  });

  it("a type change PostgreSQL refuses on the empty copy is named as the column's definition", () => {
    const plan = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        checks: [{ name: "chk_body" }],
        expressions: {
          tried: true,
          typeRefusal:
            'column "body" cannot be cast automatically to type jsonb',
          refused: [],
        },
      })
    );
    expect(named(plan.cannotCarry, "definition")).toEqual(["body"]);
    expect(plan.cannotCarry[0].reason).toContain("cannot be cast");
  });

  it("where the copy could not be made, every check and expression index on the column blocks a type change, saying why", () => {
    const facts = pgFacts({
      checks: [{ name: "chk_body" }],
      indexes: [
        {
          name: "idx_lower",
          keyed: false,
          inExpression: true,
          explicitOpclass: null,
          keptByNewType: true,
        },
        {
          name: "idx_plain",
          keyed: true,
          inExpression: false,
          explicitOpclass: null,
          keptByNewType: true,
        },
      ],
      expressions: {
        tried: false,
        why: "cannot execute CREATE TABLE in a read-only transaction",
      },
    });
    // Even a change PostgreSQL would usually accept, as the expressions could not be tried.
    const plan = postgresCarry(pgRequest(TEXT, VARCHAR_255), facts);
    expect(plan.cannotCarry.map(item => [item.property, item.name])).toEqual([
      ["index", "idx_lower"],
      ["check", "chk_body"],
    ]);
    for (const item of plan.cannotCarry) {
      expect(item.reason).toContain("read-only transaction");
    }
    // A nullability change re-reads no expression.
    expect(
      postgresCarry(pgRequest({ ...TEXT, nullable: false }, TEXT), facts)
        .cannotCarry
    ).toEqual([]);
  });

  it("trigger: one whose definition names the column is named; one that does not is kept", () => {
    const plan = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        triggers: [
          { name: "trg_update_of_body", namesColumn: true },
          { name: "trg_touch", namesColumn: false },
        ],
      })
    );
    expect(named(plan.cannotCarry, "trigger")).toEqual(["trg_update_of_body"]);
  });

  it("view: a view or rule that reads the column is named for any type change, not for a nullability change", () => {
    const dependents: PostgresCarryFacts["dependents"] = [
      { name: "v_posts", kind: "view" },
      { name: "r_audit", kind: "rule" },
    ];
    // Even a change PostgreSQL makes without a rewrite is refused while a view reads the column.
    const plan = postgresCarry(
      pgRequest(
        { type: "varchar", typeModifier: "36", nullable: true },
        VARCHAR_255
      ),
      pgFacts({ dependents })
    );
    expect(named(plan.cannotCarry, "view")).toEqual(["v_posts", "r_audit"]);
    expect(
      postgresCarry(
        pgRequest({ ...TEXT, nullable: false }, TEXT),
        pgFacts({ dependents })
      ).cannotCarry
    ).toEqual([]);
  });

  it("generated column and policy: one that reads the column is named for any type change, not for a nullability change", () => {
    const facts = pgFacts({
      generatedColumns: [{ name: "body_length" }],
      policies: [{ name: "pol_own_rows" }],
    });
    // PostgreSQL refuses every type change under either, even one it makes without a rewrite.
    const plan = postgresCarry(
      pgRequest(
        { type: "varchar", typeModifier: "36", nullable: true },
        VARCHAR_255
      ),
      facts
    );
    expect(named(plan.cannotCarry, "generated column")).toEqual([
      "body_length",
    ]);
    expect(named(plan.cannotCarry, "policy")).toEqual(["pol_own_rows"]);
    expect(
      postgresCarry(pgRequest({ ...TEXT, nullable: false }, TEXT), facts)
        .cannotCarry
    ).toEqual([]);
  });

  it("identity: an identity column becoming a non-integer is named; one becoming another integer is not", () => {
    const facts = pgFacts({ identity: true });
    const INT4 = { type: "int4", nullable: false };
    expect(
      named(
        postgresCarry(pgRequest(INT4, { ...TEXT, nullable: false }), facts)
          .cannotCarry,
        "definition"
      )
    ).toEqual(["body"]);
    expect(
      postgresCarry(pgRequest(INT4, { type: "int8", nullable: false }), facts)
        .cannotCarry
    ).toEqual([]);
  });

  it("inheritance: a table with children or partitions, or an inherited column, is named for any change, nullability included", () => {
    for (const facts of [
      pgFacts({ hasDescendants: true }),
      pgFacts({ inheritedColumn: true }),
    ]) {
      expect(
        named(
          postgresCarry(pgRequest(TEXT, VARCHAR_255), facts).cannotCarry,
          "definition"
        )
      ).toEqual(["body"]);
      expect(
        named(
          postgresCarry(pgRequest({ ...TEXT, nullable: false }, TEXT), facts)
            .cannotCarry,
          "definition"
        )
      ).toEqual(["body"]);
    }
    expect(
      postgresCarry(pgRequest(TEXT, VARCHAR_255), pgFacts({})).cannotCarry
    ).toEqual([]);
  });

  it("collation: named as not carried where the new type takes none, kept where it takes one; never blocking", () => {
    const toJson = postgresCarry(
      pgRequest(TEXT, JSONB),
      pgFacts({
        collation: { schema: "pg_catalog", name: "C" },
        newTypeTakesCollation: false,
      })
    );
    expect(toJson.notCarried).toEqual([{ property: "collation", value: "C" }]);
    expect(toJson.cannotCarry).toEqual([]);
    const toVarchar = postgresCarry(
      pgRequest(TEXT, VARCHAR_255),
      pgFacts({
        collation: { schema: "pg_catalog", name: "C" },
        newTypeTakesCollation: true,
      })
    );
    expect(toVarchar.notCarried).toEqual([]);
  });
});

const MYSQL_TEXT = { type: "text", nullable: true };
const MYSQL_JSON = { type: "json", nullable: true };
const MYSQL_VARCHAR_36 = { type: "varchar(36)", nullable: true };
const MYSQL_VARCHAR_255 = { type: "varchar(255)", nullable: true };

describe("MySQL: what the new type cannot keep", () => {
  it("default: a literal the new type cannot hold is named; an expression default, or a literal it holds, is not", () => {
    const literalToJson = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_255, MYSQL_JSON),
      mysqlFacts({ default: { value: "[]", expression: false } })
    );
    expect(named(literalToJson.cannotCarry, "default")).toEqual(["body"]);
    const literalToText = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_36, MYSQL_TEXT),
      mysqlFacts({ default: { value: "x", expression: false } })
    );
    expect(named(literalToText.cannotCarry, "default")).toEqual(["body"]);
    const tooLong = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_255, { type: "varchar(3)", nullable: true }),
      mysqlFacts({ default: { value: "draft", expression: false } })
    );
    expect(named(tooLong.cannotCarry, "default")).toEqual(["body"]);

    expect(
      mysqlCarry(
        mysqlRequest(MYSQL_TEXT, MYSQL_JSON),
        mysqlFacts({ default: { value: "_utf8mb4\\'[]\\'", expression: true } })
      ).cannotCarry
    ).toEqual([]);
    expect(
      mysqlCarry(
        mysqlRequest(
          { type: "decimal(10,2)", nullable: true },
          { type: "double", nullable: true }
        ),
        mysqlFacts({ default: { value: "1.25", expression: false } })
      ).cannotCarry
    ).toEqual([]);
  });

  it("index: any key on a JSON column, unique ones included, and a whole-column key on TEXT are named; a prefix key on TEXT is not", () => {
    const toJson = mysqlCarry(
      mysqlRequest(MYSQL_TEXT, MYSQL_JSON),
      mysqlFacts({
        indexes: [
          { name: "idx_prefix", unique: false, prefix: 20, expression: false },
          { name: "uq_body", unique: true, prefix: 20, expression: false },
        ],
      })
    );
    expect(named(toJson.cannotCarry, "index")).toEqual([
      "idx_prefix",
      "uq_body",
    ]);
    const toText = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_36, MYSQL_TEXT),
      mysqlFacts({
        indexes: [
          { name: "idx_whole", unique: false, prefix: null, expression: false },
          { name: "idx_prefix", unique: false, prefix: 20, expression: false },
        ],
      })
    );
    expect(named(toText.cannotCarry, "index")).toEqual(["idx_whole"]);
    expect(
      mysqlCarry(
        mysqlRequest(MYSQL_VARCHAR_36, MYSQL_VARCHAR_255),
        mysqlFacts({
          indexes: [
            {
              name: "idx_whole",
              unique: true,
              prefix: null,
              expression: false,
            },
          ],
        })
      ).cannotCarry
    ).toEqual([]);
  });

  it("index: a prefix key is named where the new string is no longer than the prefix, not where it is longer", () => {
    // MySQL would key a varchar(36) whole instead of by its first 191 characters, changing the
    // index; a varchar(255) keeps the 191-character prefix as it is.
    const prefix191 = mysqlFacts({
      indexes: [
        { name: "idx_prefix", unique: false, prefix: 191, expression: false },
      ],
    });
    expect(
      named(
        mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_VARCHAR_36), prefix191)
          .cannotCarry,
        "index"
      )
    ).toEqual(["idx_prefix"]);
    expect(
      mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_VARCHAR_255), prefix191)
        .cannotCarry
    ).toEqual([]);
  });

  it("key: a foreign key into or out of the column is named when its type changes, not for a nullability change", () => {
    const keys: MysqlCarryFacts["foreignKeys"] = [
      {
        name: "fk_into",
        table: "dc_comments",
        direction: "into",
        setsNull: false,
      },
    ];
    expect(
      named(
        mysqlCarry(
          mysqlRequest(MYSQL_VARCHAR_36, MYSQL_VARCHAR_255),
          mysqlFacts({ foreignKeys: keys })
        ).cannotCarry,
        "key"
      )
    ).toEqual(["fk_into"]);
    expect(
      mysqlCarry(
        mysqlRequest(
          { ...MYSQL_VARCHAR_36, nullable: false },
          MYSQL_VARCHAR_36
        ),
        mysqlFacts({ foreignKeys: keys })
      ).cannotCarry
    ).toEqual([]);
  });

  it("key: a SET NULL key out of the column is named when the column becomes NOT NULL, even with no type change", () => {
    // MySQL refuses NOT NULL on a column a SET NULL action writes (error 1830).
    const keys: MysqlCarryFacts["foreignKeys"] = [
      {
        name: "fk_sets_null",
        table: "dc_authors",
        direction: "out-of",
        setsNull: true,
      },
      {
        name: "fk_restricts",
        table: "dc_editors",
        direction: "out-of",
        setsNull: false,
      },
      {
        name: "fk_into",
        table: "dc_comments",
        direction: "into",
        setsNull: true,
      },
    ];
    const toNotNull = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_36, { ...MYSQL_VARCHAR_36, nullable: false }),
      mysqlFacts({ foreignKeys: keys })
    );
    expect(named(toNotNull.cannotCarry, "key")).toEqual(["fk_sets_null"]);
    // Staying nullable, the SET NULL key keeps its place.
    expect(
      mysqlCarry(
        mysqlRequest(
          { ...MYSQL_VARCHAR_36, nullable: false },
          MYSQL_VARCHAR_36
        ),
        mysqlFacts({ foreignKeys: keys })
      ).cannotCarry
    ).toEqual([]);
  });

  it("check: one on the column is named when the type family changes, not within one family", () => {
    const checks = [{ name: "chk_body" }];
    expect(
      named(
        mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_JSON), mysqlFacts({ checks }))
          .cannotCarry,
        "check"
      )
    ).toEqual(["chk_body"]);
    expect(
      mysqlCarry(
        mysqlRequest(MYSQL_TEXT, MYSQL_VARCHAR_255),
        mysqlFacts({ checks })
      ).cannotCarry
    ).toEqual([]);
  });

  it("check: where the server cannot show its checks, a kind change is blocked by the column's definition; one within a kind is not", () => {
    const checks = "unreadable" as const;
    expect(
      named(
        mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_JSON), mysqlFacts({ checks }))
          .cannotCarry,
        "definition"
      )
    ).toEqual(["body"]);
    expect(
      mysqlCarry(
        mysqlRequest(MYSQL_TEXT, MYSQL_VARCHAR_255),
        mysqlFacts({ checks })
      ).cannotCarry
    ).toEqual([]);
  });

  it("checks are read from what the server's catalog has, and are unreadable only where the server keeps them out of sight", () => {
    // MySQL 8.0.16 and later: the clause beside the table's constraint list.
    expect(
      mysqlCheckSource({
        checkClause: true,
        checkTableName: false,
        mariadb: false,
      })
    ).toBe("through-table-constraints");
    // MariaDB 10.2.22 and later: the clause carries its table.
    expect(
      mysqlCheckSource({
        checkClause: true,
        checkTableName: true,
        mariadb: true,
      })
    ).toBe("by-table-name");
    // MySQL before 8.0.16 parses a check and keeps none, so there is none to read.
    expect(
      mysqlCheckSource({
        checkClause: false,
        checkTableName: false,
        mariadb: false,
      })
    ).toBe("none");
    // MariaDB before 10.2.22 enforces checks it does not report.
    expect(
      mysqlCheckSource({
        checkClause: false,
        checkTableName: false,
        mariadb: true,
      })
    ).toBe("unreadable");
  });

  it("primary key: the PRIMARY index is named as the key where the new type cannot be keyed; kept where it can", () => {
    const facts = mysqlFacts({
      indexes: [
        { name: "PRIMARY", unique: true, prefix: null, expression: false },
      ],
    });
    for (const to of [MYSQL_JSON, MYSQL_TEXT]) {
      const plan = mysqlCarry(mysqlRequest(MYSQL_VARCHAR_36, to), facts);
      expect(named(plan.cannotCarry, "key")).toEqual(["PRIMARY"]);
      expect(named(plan.cannotCarry, "index")).toEqual([]);
    }
    expect(
      mysqlCarry(mysqlRequest(MYSQL_VARCHAR_36, MYSQL_VARCHAR_255), facts)
        .cannotCarry
    ).toEqual([]);
  });

  it("AUTO_INCREMENT: a column becoming a non-integer is named; one becoming another integer is not", () => {
    const facts = mysqlFacts({ autoIncrement: true });
    const INT = { type: "int", nullable: false };
    expect(
      named(
        mysqlCarry(
          mysqlRequest(INT, { type: "varchar(36)", nullable: false }),
          facts
        ).cannotCarry,
        "definition"
      )
    ).toEqual(["body"]);
    expect(
      mysqlCarry(
        mysqlRequest(INT, { type: "bigint unsigned", nullable: false }),
        facts
      ).cannotCarry
    ).toEqual([]);
  });

  it("character set and collation: both named as not carried for a JSON column, never blocking; kept for a string", () => {
    const facts = mysqlFacts({
      characterSet: "utf8mb4",
      collation: "utf8mb4_bin",
    });
    const toJson = mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_JSON), facts);
    expect(toJson.notCarried).toEqual([
      { property: "characterSet", value: "utf8mb4" },
      { property: "collation", value: "utf8mb4_bin" },
    ]);
    expect(toJson.cannotCarry).toEqual([]);
    expect(
      mysqlCarry(mysqlRequest(MYSQL_TEXT, MYSQL_VARCHAR_255), facts).notCarried
    ).toEqual([]);
  });

  it("the list conversion is judged against the JSON column it ends as", () => {
    const plan = mysqlCarry(
      mysqlRequest(MYSQL_VARCHAR_36, MYSQL_JSON, { referenceList: true }),
      mysqlFacts({
        characterSet: "utf8mb4",
        collation: "utf8mb4_0900_ai_ci",
        indexes: [
          { name: "idx_ref", unique: false, prefix: null, expression: false },
        ],
      })
    );
    expect(named(plan.cannotCarry, "index")).toEqual(["idx_ref"]);
    expect(plan.notCarried.map(item => item.property)).toEqual([
      "characterSet",
      "collation",
    ]);
  });
});

describe("a unique key under a change that can make two values equal", () => {
  const change = (
    dialect: ConversionRequest["dialect"],
    from: ConversionRequest["from"],
    to: ConversionRequest["to"]
  ): ConversionRequest => ({ dialect, table: "t", column: "c", from, to });
  const pg = (type: string, typeModifier?: string) => ({
    type,
    ...(typeModifier === undefined ? {} : { typeModifier }),
    nullable: true,
  });
  const my = (type: string) => ({ type, nullable: true });

  it("keeps equality only from a string to a string, to a wider integer, float4 to float8 and numeric to numeric of one scale", () => {
    const kept = [
      change("postgresql", pg("varchar", "36"), pg("varchar", "255")),
      change("postgresql", pg("text"), pg("varchar", "255")),
      change("postgresql", pg("int4"), pg("int8")),
      change("postgresql", pg("float4"), pg("float8")),
      change("postgresql", pg("numeric", "10,2"), pg("numeric", "12,2")),
      change("mysql", my("int"), my("bigint unsigned")),
      change("mysql", my("decimal(10,2)"), my("decimal(14,2)")),
    ];
    const merges = [
      change("postgresql", pg("text"), pg("jsonb")),
      change("postgresql", pg("text"), pg("uuid")),
      change("postgresql", pg("numeric", "10,2"), pg("numeric", "10,1")),
      change("postgresql", pg("numeric", "10,2"), pg("float8")),
      change("postgresql", pg("int8"), pg("int4")),
      change("mysql", my("decimal(10,2)"), my("double")),
    ];
    expect(kept.map(keepsEquality)).toEqual(kept.map(() => true));
    expect(merges.map(keepsEquality)).toEqual(merges.map(() => false));
  });

  it("PostgreSQL: a unique key on the column is named where the change can merge values; a plain index is not", () => {
    const facts = pgFacts({
      indexes: [
        {
          name: "posts_body_key",
          keyed: true,
          unique: true,
          inExpression: false,
          explicitOpclass: null,
          keptByNewType: true,
        },
        {
          name: "idx_body",
          keyed: true,
          inExpression: false,
          explicitOpclass: null,
          keptByNewType: true,
        },
      ],
    });
    const plan = postgresCarry(pgRequest(TEXT, JSONB), facts);
    expect(named(plan.cannotCarry, "key")).toEqual(["posts_body_key"]);
    expect(named(plan.cannotCarry, "index")).toEqual([]);
    expect(
      postgresCarry(pgRequest(TEXT, VARCHAR_255), facts).cannotCarry
    ).toEqual([]);
  });

  it("MySQL: a unique key on the column is named where the change can merge values, the primary key as PRIMARY", () => {
    const facts = mysqlFacts({
      indexes: [
        { name: "PRIMARY", unique: true, prefix: null, expression: false },
        { name: "uq_amount", unique: true, prefix: null, expression: false },
        { name: "idx_amount", unique: false, prefix: null, expression: false },
      ],
    });
    const DECIMAL = { type: "decimal(10,2)", nullable: false };
    const plan = mysqlCarry(
      mysqlRequest(DECIMAL, { type: "double", nullable: false }),
      facts
    );
    expect(named(plan.cannotCarry, "key")).toEqual(["PRIMARY", "uq_amount"]);
    expect(named(plan.cannotCarry, "index")).toEqual([]);
    expect(
      mysqlCarry(
        mysqlRequest(DECIMAL, { type: "decimal(14,2)", nullable: false }),
        facts
      ).cannotCarry
    ).toEqual([]);
  });
});
