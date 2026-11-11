// How one column converts on MySQL: `MODIFY COLUMN` statements built from the live catalog when
// they run, and what the new type cannot keep.
//
// `MODIFY COLUMN` restates the whole definition and drops whatever it leaves out, so every step
// goes through `restatedColumn` (`pipeline/sql-templates/mysql-live-restate`), which reads the
// column's definition from `information_schema` as the statement runs and changes only the type
// and nullability: the default, comment, character set and collation, generated value,
// `ON UPDATE` and visibility stay. A JSON column has no character set or collation, and MySQL
// refuses to be given one, so for a JSON target they are left out and named as not carried.
//
// MySQL keeps the table's views (they are not bound to columns) and triggers across the change, as
// measured. What it would refuse is read here and named before anything runs. The facts are read
// by `readMysqlCarryFacts` and judged by `mysqlCarry`, a pure function.
//
// The catalog differs by server: a functional key part's expression is reported from MySQL 8.0.13,
// a check's clause from MySQL 8.0.16 and MariaDB 10.2.22. Each is read where the server reports
// it; a server that has none of either (an older MySQL keeps no check) has nothing to read, and one
// that enforces checks it does not report (an older MariaDB) cannot be judged, which blocks a
// conversion a check could refuse.
//
// @module domains/schema/repair-columns/conversion/mysql

import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../../errors/nextly-error";
import { querySqlRows } from "../../pipeline/classifier/count-helpers";
import {
  mysqlReferenceListNormalise,
  mysqlReferenceListRewrite,
} from "../../pipeline/reference-list-conversion";
import { isMysqlTextOrBlobType } from "../../pipeline/sql-templates/create-index";
import { quoteIdent } from "../../pipeline/sql-templates/identifier-quoting";
import { restatedColumn } from "../../pipeline/sql-templates/mysql-live-restate";
import { parseColumnType } from "../../value-conversion/column-type";

import {
  OWNER_CAN,
  PRIMARY_KEY_OWNER_CAN,
  checkRefusals,
  defaultLiteralRefusal,
  expressionIndexRefusal,
  foreignKeyRefusals,
  isIntegerType,
  keepsEquality,
  kindChanges,
  refusedDefault,
  renderedType,
  typeChanges,
  uniqueKeyRefusal,
  type Carry,
} from "./carry";
import type {
  CannotCarry,
  ColumnConversionPlan,
  ConversionRequest,
} from "./types";

/** One index part that reads the column, as `information_schema.STATISTICS` reports it. */
export interface MysqlIndexUse {
  name: string;
  unique: boolean;
  /** The key length a prefix key part indexes, or null where the part keys the whole column. */
  prefix: number | null;
  /** The part is a functional key part whose expression reads the column. */
  expression: boolean;
}

/** What the live table holds that a type change of the column must keep. */
export interface MysqlCarryFacts {
  /** The column's character set and collation, null for a type that takes none. */
  characterSet: string | null;
  collation: string | null;
  /**
   * The default: a literal value, or an expression (`DEFAULT (..)`, `CURRENT_TIMESTAMP`), which
   * MySQL evaluates when a row is written.
   */
  default: { value: string; expression: boolean } | null;
  indexes: MysqlIndexUse[];
  /**
   * The checks that read the column, or `unreadable` where the server enforces checks its catalog
   * does not report.
   */
  checks: { name: string }[] | "unreadable";
  /**
   * The foreign keys from or to the column, the table at their other end, and whether the key sets
   * the column to null when the row it references is deleted or its key updated (`SET NULL`).
   */
  foreignKeys: {
    name: string;
    table: string;
    direction: "into" | "out-of";
    setsNull: boolean;
  }[];
  /** Whether the column is `AUTO_INCREMENT`, which MySQL keeps only on an integer type. */
  autoIncrement: boolean;
}

/** What this server's catalog reports, read from `information_schema`'s own columns. */
interface MysqlCatalogCapabilities {
  /** `CHECK_CONSTRAINTS.CHECK_CLAUSE` exists (MySQL 8.0.16, MariaDB 10.2.22). */
  checkClause: boolean;
  /** `CHECK_CONSTRAINTS.TABLE_NAME` exists (MariaDB). */
  checkTableName: boolean;
  /** The server is MariaDB, which enforces checks from 10.2.1. */
  mariadb: boolean;
}

/**
 * Where this server's checks are read from:
 * - `through-table-constraints`: MySQL's clause list, matched to the table by its constraint list;
 * - `by-table-name`: MariaDB's clause list, which names each check's table;
 * - `none`: a MySQL before 8.0.16, which parses a check and keeps none, so there is none to read;
 * - `unreadable`: a MariaDB that enforces checks it does not report.
 */
export function mysqlCheckSource(
  catalog: MysqlCatalogCapabilities
): "through-table-constraints" | "by-table-name" | "none" | "unreadable" {
  if (catalog.checkClause) {
    return catalog.checkTableName
      ? "by-table-name"
      : "through-table-constraints";
  }
  return catalog.mariadb ? "unreadable" : "none";
}

/** Whether the new type is JSON: no plain index, no character set, no literal default. */
const isJson = (request: ConversionRequest): boolean =>
  parseColumnType(request.to).family === "json";

/**
 * What the new type cannot keep, from facts about the live table. Pure: every fact is read before.
 * The list conversion is judged against the JSON column it ends as, which holds less than the
 * `text` it passes through.
 *
 * A column becoming NOT NULL is blocked by a foreign key out of it that sets it to null: MySQL
 * refuses NOT NULL on a column a `SET NULL` action writes (1830), with or without a type change.
 *
 * Nothing else blocks a nullability change alone. A type change is blocked by:
 * - an index part keying the column when the new type is JSON, which takes no plain index (3152),
 *   a unique one included; or keying it whole when the new type is TEXT or BLOB, which needs a key
 *   length (1170); or an expression reading the column when the kind of value changes;
 * - a literal default the new type cannot hold: JSON, TEXT and BLOB take only an expression
 *   default, and any other literal is judged as a stored value is (a `varchar(3)` cannot hold
 *   `'draft'`). An expression default is evaluated per row and kept;
 * - a check that reads the column when the kind of value changes, which MySQL re-reads against the
 *   new type; where the server does not report its checks, the column's definition, since one
 *   could;
 * - a foreign key into or out of the column: both ends must keep matching types.
 *
 * A JSON column has no character set or collation: the column's are named as not carried.
 */
export function mysqlCarry(
  request: ConversionRequest,
  facts: MysqlCarryFacts
): Carry {
  const setNull = setNullKeyRefusals(request, facts.foreignKeys);
  if (!typeChanges(request)) return { cannotCarry: setNull, notCarried: [] };
  const to = renderedType(request.to);
  const json = isJson(request);
  const target = {
    json,
    textOrBlob: isMysqlTextOrBlobType(to),
    kindChange: kindChanges(request),
    length: parseColumnType(request.to).length,
    keepsValuesApart: keepsEquality(request),
  };
  return {
    cannotCarry: [
      ...setNull,
      ...(facts.autoIncrement && !isIntegerType(request.to)
        ? [
            {
              property: "definition" as const,
              name: request.column,
              reason: `the column is AUTO_INCREMENT, which MySQL keeps only on an integer type, not on ${to}`,
              ownerCan: OWNER_CAN.definition,
            },
          ]
        : []),
      ...mysqlDefaultRefusals(request, facts.default, target),
      ...mysqlIndexRefusals(facts.indexes, to, target),
      ...(target.kindChange
        ? mysqlCheckRefusals(request, facts.checks, to)
        : []),
      ...foreignKeyRefusals(facts.foreignKeys),
    ],
    notCarried: json
      ? [
          ...(facts.characterSet === null
            ? []
            : [
                {
                  property: "characterSet" as const,
                  value: facts.characterSet,
                },
              ]),
          ...(facts.collation === null
            ? []
            : [{ property: "collation" as const, value: facts.collation }]),
        ]
      : [],
  };
}

/** What the new type is, for the rules that judge a default and an index against it. */
interface MysqlTarget {
  json: boolean;
  textOrBlob: boolean;
  kindChange: boolean;
  /** A string type's length, the longest prefix it can be keyed by. */
  length: number | undefined;
  /** Whether the change keeps two values that differ apart, which a unique key needs. */
  keepsValuesApart: boolean;
}

/**
 * The foreign keys out of the column that set it to null, where it becomes NOT NULL: MySQL refuses
 * NOT NULL on a column a `SET NULL` action writes (1830).
 */
function setNullKeyRefusals(
  request: ConversionRequest,
  keys: MysqlCarryFacts["foreignKeys"]
): CannotCarry[] {
  if (!request.from.nullable || request.to.nullable) return [];
  return keys
    .filter(key => key.direction === "out-of" && key.setsNull)
    .map(key => ({
      property: "key",
      name: key.name,
      reason: `the foreign key sets the column to null when its row in ${key.table} goes, and MySQL refuses NOT NULL on a column a SET NULL key writes`,
      ownerCan:
        "change the foreign key's SET NULL action to another, or keep the field optional, then run the repair again",
    }));
}

/**
 * A literal default the new type cannot hold: JSON, TEXT and BLOB take only an expression default,
 * and any other literal is judged as a stored value is. An expression default is evaluated per
 * row and kept.
 */
function mysqlDefaultRefusals(
  request: ConversionRequest,
  columnDefault: MysqlCarryFacts["default"],
  target: MysqlTarget
): CannotCarry[] {
  if (columnDefault === null || columnDefault.expression) return [];
  if (target.json || target.textOrBlob) {
    return [
      {
        property: "default",
        name: request.column,
        reason: `the column's default is a literal value, and ${renderedType(request.to)} takes only an expression default`,
        ownerCan: OWNER_CAN.default,
      },
    ];
  }
  const refusal = defaultLiteralRefusal(request, columnDefault.value);
  return refusal === null ? [] : [refusedDefault(request, refusal)];
}

/**
 * Each index the new type cannot keep, named once however many of its parts read the column. The
 * primary key's index, which MySQL always names `PRIMARY`, is named as the table's key.
 */
function mysqlIndexRefusals(
  indexes: readonly MysqlIndexUse[],
  to: string,
  target: MysqlTarget
): CannotCarry[] {
  const refused = new Map<string, CannotCarry>();
  for (const index of indexes) {
    if (refused.has(index.name)) continue;
    const entry = mysqlIndexEntry(index, to, target);
    if (entry !== null) refused.set(index.name, entry);
  }
  return [...refused.values()];
}

/** What one index part over the column makes the new type unable to keep, or null. */
function mysqlIndexEntry(
  index: MysqlIndexUse,
  to: string,
  target: MysqlTarget
): CannotCarry | null {
  if (index.expression) {
    return target.kindChange ? expressionIndexRefusal(index.name, to) : null;
  }
  const reason = mysqlIndexRefusal(index, to, target);
  if (reason === null) {
    // A unique key the new type can index, but whose values the change can make equal.
    return index.unique && !target.keepsValuesApart
      ? uniqueKeyRefusal(index.name, to)
      : null;
  }
  return index.name === "PRIMARY"
    ? {
        property: "key",
        name: index.name,
        reason: `the column is in the table's primary key, and ${reason}`,
        ownerCan: PRIMARY_KEY_OWNER_CAN,
      }
    : {
        property: "index",
        name: index.name,
        reason,
        ownerCan: OWNER_CAN.index,
      };
}

/**
 * The checks that read the column, under a kind change; where the server enforces checks it does
 * not report, the column's definition, since one could.
 */
function mysqlCheckRefusals(
  request: ConversionRequest,
  checks: MysqlCarryFacts["checks"],
  to: string
): CannotCarry[] {
  if (checks !== "unreadable") return checkRefusals(checks, to);
  return [
    {
      property: "definition",
      name: request.column,
      reason:
        "this server enforces checks it does not report, so whether one reads the column cannot be known",
      ownerCan: OWNER_CAN.definition,
    },
  ];
}

/** Why the new type cannot keep one index part on the column itself, or null where it can. */
function mysqlIndexRefusal(
  index: MysqlIndexUse,
  to: string,
  target: MysqlTarget
): string | null {
  if (target.json) {
    return index.unique
      ? "a JSON column takes no unique index"
      : "a JSON column takes no index on the column itself";
  }
  if (target.textOrBlob && index.prefix === null) {
    return `the index keys the whole column, and ${to} can only be indexed by a prefix`;
  }
  // A prefix key needs a string longer than the prefix: on any other new type MySQL quietly keys
  // the whole column instead (measured: text keyed by 191 characters becoming varchar(36)), which
  // changes the index the database reports.
  if (
    index.prefix !== null &&
    !target.textOrBlob &&
    (target.length === undefined || target.length <= index.prefix)
  ) {
    return `the index keys the column's first ${index.prefix} characters, and on ${to} MySQL would key the whole column instead, changing the index`;
  }
  return null;
}

/**
 * The steps that convert the column, each one commit:
 * - a type change: one `MODIFY COLUMN` restating the definition with the new type, and the new
 *   nullability where it changes; without the character set and collation for JSON;
 * - a nullability change alone: one restatement with the new nullability;
 * - the list conversion: widen to `text` (restated, so the column keeps what it has), rewrite each
 *   value as a list (`pipeline/reference-list-conversion`), retype to JSON. Each step can run
 *   again over its own result, so a run stopped between two finishes on the next one.
 */
function mysqlSteps(request: ConversionRequest): string[][] {
  const { table, column } = request;
  const nullability =
    request.from.nullable === request.to.nullable
      ? {}
      : { nullable: request.to.nullable };
  const characterSet = isJson(request)
    ? { characterSet: "left-out" as const }
    : {};
  const to = renderedType(request.to);
  // Each statement states how it runs while others use the table, as the report says it does:
  // a type change copies the table and lets reads continue, a nullability change runs in place.
  // MySQL refuses one it cannot run that way rather than run it another way.
  if (request.referenceList === true) {
    return [
      restatedColumn(table, column, { type: "text", online: "copy" }),
      [mysqlReferenceListRewrite(table, column)],
      // The retype, then any value written since the rewrite made a one-item list in the same
      // step, so the step never ends with a scalar in the list column.
      [
        ...restatedColumn(table, column, {
          type: to,
          ...nullability,
          ...characterSet,
          online: "copy",
        }),
        mysqlReferenceListNormalise(table, column),
      ],
    ];
  }
  if (typeChanges(request)) {
    return [
      restatedColumn(table, column, {
        type: to,
        ...nullability,
        ...characterSet,
        online: "copy",
      }),
    ];
  }
  return "nullable" in nullability
    ? [restatedColumn(table, column, { ...nullability, online: "in-place" })]
    : [];
}

interface ColumnRow {
  characterSet: string | null;
  collation: string | null;
  columnDefault: string | null;
  extra: string;
}

interface IndexRow {
  name: string;
  nonUnique: number | string;
  subPart: number | string | null;
  expression: string | null;
}

/** Reads which of the columns `readMysqlCarryFacts` needs this server's catalog has. */
async function readMysqlCatalogCapabilities(
  db: unknown
): Promise<MysqlCatalogCapabilities & { statisticsExpression: boolean }> {
  const has = (table: string, column: string): SQL =>
    sql`EXISTS (SELECT 1 FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = ${table}
                  AND COLUMN_NAME = ${column})`;
  const [row] = await querySqlRows<{
    statisticsExpression: number | string;
    checkClause: number | string;
    checkTableName: number | string;
    mariadb: number | string;
  }>(
    db,
    "mysql",
    sql`SELECT ${has("STATISTICS", "EXPRESSION")} AS statisticsExpression,
          ${has("CHECK_CONSTRAINTS", "CHECK_CLAUSE")} AS checkClause,
          ${has("CHECK_CONSTRAINTS", "TABLE_NAME")} AS checkTableName,
          VERSION() LIKE '%MariaDB%' AS mariadb`
  );
  return {
    statisticsExpression: Number(row.statisticsExpression) === 1,
    checkClause: Number(row.checkClause) === 1,
    checkTableName: Number(row.checkTableName) === 1,
    mariadb: Number(row.mariadb) === 1,
  };
}

/** The checks on the table whose clause names the column, read from where the server keeps them. */
async function readMysqlChecks(
  db: unknown,
  request: ConversionRequest,
  source: ReturnType<typeof mysqlCheckSource>
): Promise<MysqlCarryFacts["checks"]> {
  if (source === "none") return [];
  if (source === "unreadable") return "unreadable";
  const quoted = quoteIdent(request.column, "mysql");
  if (source === "by-table-name") {
    return querySqlRows<{ name: string }>(
      db,
      "mysql",
      sql`SELECT CONSTRAINT_NAME AS name FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ${request.table}
            AND INSTR(CHECK_CLAUSE, ${quoted}) > 0
          ORDER BY CONSTRAINT_NAME`
    );
  }
  return querySqlRows<{ name: string }>(
    db,
    "mysql",
    sql`SELECT cc.CONSTRAINT_NAME AS name
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc
          ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ${request.table}
          AND tc.CONSTRAINT_TYPE = 'CHECK' AND INSTR(cc.CHECK_CLAUSE, ${quoted}) > 0
        ORDER BY cc.CONSTRAINT_NAME`
  );
}

/**
 * Reads the facts `mysqlCarry` judges from `information_schema`, from the columns this server's
 * catalog has. A functional key part, a check and a foreign key are found by the column's name as
 * the catalog writes it, backquoted.
 */
async function readMysqlCarryFacts(
  db: unknown,
  request: ConversionRequest
): Promise<MysqlCarryFacts> {
  const quoted = quoteIdent(request.column, "mysql");
  const [column] = await querySqlRows<ColumnRow>(
    db,
    "mysql",
    sql`SELECT CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation,
          COLUMN_DEFAULT AS columnDefault, EXTRA AS extra
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${request.table} AND COLUMN_NAME = ${request.column}`
  );
  if (column === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "the column to convert is not in the live table",
        table: request.table,
        column: request.column,
      },
    });
  }
  const catalog = await readMysqlCatalogCapabilities(db);
  // A server that reports no key-part expression has no functional key part to report.
  const expression = catalog.statisticsExpression ? sql`EXPRESSION` : sql`NULL`;
  const readsColumn = catalog.statisticsExpression
    ? sql`(COLUMN_NAME = ${request.column} OR INSTR(EXPRESSION, ${quoted}) > 0)`
    : sql`COLUMN_NAME = ${request.column}`;
  const indexes = await querySqlRows<IndexRow>(
    db,
    "mysql",
    sql`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SUB_PART AS subPart, ${expression} AS expression
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${request.table} AND ${readsColumn}
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`
  );
  const checks = await readMysqlChecks(db, request, mysqlCheckSource(catalog));
  // A key out of the column is this database's; a key into it may be any schema's, which MySQL
  // checks as it checks its own, so a table elsewhere is named with its schema.
  const outOf = sql`(k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ${request.table} AND k.COLUMN_NAME = ${request.column})`;
  const into = sql`(k.REFERENCED_TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = ${request.table}
                    AND k.REFERENCED_COLUMN_NAME = ${request.column})`;
  const foreignKeys = await querySqlRows<{
    name: string;
    table: string;
    direction: "into" | "out-of";
    setsNull: number | string;
  }>(
    db,
    "mysql",
    sql`SELECT DISTINCT k.CONSTRAINT_NAME AS name,
          IF(${outOf},
             IF(k.REFERENCED_TABLE_SCHEMA = DATABASE(), k.REFERENCED_TABLE_NAME,
                CONCAT(k.REFERENCED_TABLE_SCHEMA, '.', k.REFERENCED_TABLE_NAME)),
             IF(k.TABLE_SCHEMA = DATABASE(), k.TABLE_NAME, CONCAT(k.TABLE_SCHEMA, '.', k.TABLE_NAME))) AS \`table\`,
          IF(${outOf}, 'out-of', 'into') AS direction,
          (rc.DELETE_RULE = 'SET NULL' OR rc.UPDATE_RULE = 'SET NULL') AS setsNull
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            AND rc.TABLE_NAME = k.TABLE_NAME
        WHERE k.REFERENCED_TABLE_NAME IS NOT NULL AND (${outOf} OR ${into})
        ORDER BY k.CONSTRAINT_NAME`
  );
  return {
    characterSet: column.characterSet,
    collation: column.collation,
    default:
      column.columnDefault === null
        ? null
        : {
            value: column.columnDefault,
            expression: column.extra.includes("DEFAULT_GENERATED"),
          },
    indexes: indexes.map(index => ({
      name: index.name,
      unique: Number(index.nonUnique) === 0,
      prefix: index.subPart === null ? null : Number(index.subPart),
      expression: index.expression !== null,
    })),
    checks,
    autoIncrement: /\bauto_increment\b/i.test(column.extra),
    foreignKeys: foreignKeys.map(key => ({
      name: key.name,
      table: key.table,
      direction: key.direction,
      setsNull: Number(key.setsNull) === 1,
    })),
  };
}

/**
 * The plan for converting `request`'s column on MySQL, read from the live table through `db`.
 *
 * Each step commits on its own. A type change copies the table (`ALGORITHM=COPY`, which MySQL runs
 * under a shared lock: reads continue, writes wait). A nullability change alone is rebuilt in place
 * with reads and writes continuing, apart from brief locks as it starts and ends.
 */
export async function buildMysqlConversion(
  db: unknown,
  request: ConversionRequest
): Promise<ColumnConversionPlan> {
  const facts = await readMysqlCarryFacts(db, request);
  const steps = mysqlSteps(request);
  return {
    steps,
    rewritesTable: steps.length > 0,
    blocks: typeChanges(request) ? "writes" : "brief-locks",
    ...mysqlCarry(request, facts),
  };
}
