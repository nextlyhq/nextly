// How one column converts on PostgreSQL: one `ALTER TABLE` in one transaction, built from the live
// table, and what the new type cannot keep.
//
// PostgreSQL keeps most of a column through `ALTER COLUMN .. TYPE`: its comment, a default it can
// cast automatically, a plain index whose method has an operator class for the new type, a check,
// and a trigger that does not name the column. Two things it does not keep on its own, measured:
// the collation, which the type change resets to the new type's default unless the statement
// restates it, and anything that reads the column through a view, rule, generated column or
// row-level-security policy, which refuses every type change. What it would refuse or drop is read here and named before anything runs.
//
// The facts are read by `readPostgresCarryFacts` and judged by `postgresCarry`, a pure function, so
// the judgement can be tested without a database.
//
// @module domains/schema/repair-columns/conversion/postgres

import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../../errors/nextly-error";
import { querySqlRows } from "../../pipeline/classifier/count-helpers";
import type { PgCollation } from "../../pipeline/live-table-facts";
import { referenceConversionStatements } from "../../pipeline/reference-list-conversion";
import { quoteIdent } from "../../pipeline/sql-templates/identifier-quoting";
import { postgresAlterTypeUsing } from "../../pipeline/sql-templates/postgres-alter-type-using";
import { parseColumnType } from "../../value-conversion/column-type";

import {
  OWNER_CAN,
  checkRefusals,
  isIntegerType,
  defaultLiteralRefusal,
  expressionIndexRefusal,
  foreignKeyRefusals,
  kindChanges,
  refusedDefault,
  renderedType,
  typeChanges,
  type Carry,
} from "./carry";
import type {
  CannotCarry,
  ColumnConversionPlan,
  ConversionRequest,
  NotCarried,
} from "./types";

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------

/** One index that uses the column, as PostgreSQL's catalog describes it. */
export interface PostgresIndexUse {
  name: string;
  /** The column is one of the index's keys as it is, not inside an expression. */
  keyed: boolean;
  /** The column is read by one of the index's expressions or by its predicate. */
  inExpression: boolean;
  /** The operator class the column's key names, where it names one rather than the default. */
  explicitOpclass: string | null;
  /**
   * Whether the new type can be indexed the way the column's key is: the named operator class
   * accepts it, or the index's method has a default operator class for it. True where the column
   * is not keyed.
   */
  keptByNewType: boolean;
}

/** What the live table holds that a type change of the column must keep. */
export interface PostgresCarryFacts {
  /** The default, as PostgreSQL prints it, and whether it casts to the new type automatically. */
  default: { expression: string; castsAutomatically: boolean } | null;
  /** The column's collation where it is not its type's default. */
  collation: PgCollation | null;
  /** Whether the new type takes a collation (`text` and `varchar` do; `jsonb` and numbers do not). */
  newTypeTakesCollation: boolean;
  indexes: PostgresIndexUse[];
  /** The checks that read the column. */
  checks: { name: string }[];
  /** The table's triggers, and whether each one's definition names the column. */
  triggers: { name: string; namesColumn: boolean }[];
  /** The views and rules that read the column. */
  dependents: { name: string; kind: "view" | "rule" }[];
  /** Other columns PostgreSQL generates from this one. */
  generatedColumns: { name: string }[];
  /** The row-level-security policies whose expressions read the column. */
  policies: { name: string }[];
  /** Whether the column is an identity column (`GENERATED .. AS IDENTITY`). */
  identity: boolean;
  /**
   * Whether the table has inheritance children or partitions, which an `ALTER TABLE` without
   * `ONLY` changes too.
   */
  hasDescendants: boolean;
  /** Whether the column is inherited from a parent table, which alone can change it. */
  inheritedColumn: boolean;
  /** The foreign keys from or to the column, and the table at their other end. */
  foreignKeys: {
    name: string;
    table: string;
    direction: "into" | "out-of";
  }[];
}

/**
 * A default as a literal value, where PostgreSQL prints one: a quoted string with its casts
 * (`'draft'::text`), or a number (`1.25`, `(-1)`). Null for an expression (`now()`), whose value is
 * not known until a row is written.
 */
function postgresDefaultLiteral(expression: string): string | null {
  const cast = String.raw`(?:::[a-z][a-z0-9_ ]*(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])?)*`;
  const quoted = new RegExp(String.raw`^'((?:[^']|'')*)'${cast}$`, "i").exec(
    expression
  );
  if (quoted !== null) return quoted[1].replace(/''/g, "'");
  const number = new RegExp(
    String.raw`^\(?(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\)?${cast}$`,
    "i"
  ).exec(expression);
  return number === null ? null : number[1];
}

/**
 * What the new type cannot keep, from facts about the live table. Pure: every fact is read before.
 *
 * Nothing here blocks a nullability change alone, which changes no type anything reads. A type
 * change is blocked by:
 * - a view, rule, generated column or row-level-security policy that reads the column: PostgreSQL
 *   refuses every type change under one;
 * - a default it cannot cast automatically (refused), or whose literal the new type would not hold
 *   (a `varchar(3)` accepts the default `'draft'` and refuses every row that takes it);
 * - an index key the new type cannot be indexed by, or an index expression or predicate that reads
 *   the column when the kind of value changes;
 * - a check that reads the column when the kind of value changes. PostgreSQL re-reads it against
 *   the new type, and `jsonb <> ''` has no operator; within one kind it reads as before;
 * - a trigger whose definition names the column (`UPDATE OF`, a `WHEN` reading it), which
 *   PostgreSQL refuses to keep across a type change; one that does not name it is kept;
 * - a foreign key into or out of the column: both ends must keep matching types.
 *
 * A collation of the column's own is restated by the statement where the new type takes one; where
 * it takes none (`jsonb`), it is named as not carried and does not block.
 */
export function postgresCarry(
  request: ConversionRequest,
  facts: PostgresCarryFacts
): Carry {
  const inheritance = inheritanceRefusals(request, facts);
  if (!typeChanges(request))
    return { cannotCarry: inheritance, notCarried: [] };
  const to = renderedType(request.to);
  const kindChange = kindChanges(request);
  const cannotCarry: CannotCarry[] = [
    ...inheritance,
    ...(facts.identity && !isIntegerType(request.to)
      ? [
          {
            property: "definition" as const,
            name: request.column,
            reason: `the column is an identity column, which PostgreSQL keeps only on smallint, integer or bigint, not on ${to}`,
            ownerCan: OWNER_CAN.definition,
          },
        ]
      : []),
    ...readerRefusals(facts),
    ...postgresDefaultRefusals(request, facts.default),
    ...facts.indexes.flatMap(index =>
      postgresIndexRefusals(index, to, kindChange)
    ),
    ...(kindChange ? checkRefusals(facts.checks, to) : []),
    ...facts.triggers
      .filter(trigger => trigger.namesColumn)
      .map(trigger => ({
        property: "trigger" as const,
        name: trigger.name,
        reason:
          "the trigger's definition names the column, and PostgreSQL changes no column type a trigger definition names",
        ownerCan: OWNER_CAN.trigger,
      })),
    ...foreignKeyRefusals(facts.foreignKeys),
  ];
  const notCarried: NotCarried[] =
    facts.collation !== null && !facts.newTypeTakesCollation
      ? [{ property: "collation", value: facts.collation.name }]
      : [];
  return { cannotCarry, notCarried };
}

/**
 * A table in an inheritance tree, for any change of the column, its nullability included: with
 * children or partitions, the statement (no `ONLY`, which PostgreSQL refuses for a type change of
 * a column they inherit) changes their columns too, whose indexes, views and keys this plan does
 * not read; an inherited column PostgreSQL changes only from its parent.
 */
function inheritanceRefusals(
  request: ConversionRequest,
  facts: PostgresCarryFacts
): CannotCarry[] {
  const reason = facts.hasDescendants
    ? `${request.table} has inheritance children or partitions, and converting the column would change theirs too, which this plan does not read`
    : facts.inheritedColumn
      ? `the column is inherited from a parent of ${request.table}, and PostgreSQL changes an inherited column only from the parent`
      : null;
  return reason === null
    ? []
    : [
        {
          property: "definition",
          name: request.column,
          reason,
          ownerCan: OWNER_CAN.definition,
        },
      ];
}

/**
 * The objects PostgreSQL refuses every type change under, whatever the types: the generated
 * columns, row-level-security policies, views and rules that read the column.
 */
function readerRefusals(facts: PostgresCarryFacts): CannotCarry[] {
  const refusal = (
    property: CannotCarry["property"],
    name: string,
    reads: string
  ): CannotCarry => ({
    property,
    name,
    reason: `${reads} reads the column, and PostgreSQL changes no column type it reads`,
    ownerCan: OWNER_CAN[property],
  });
  return [
    ...facts.generatedColumns.map(column =>
      refusal(
        "generated column",
        column.name,
        "the generated column's expression"
      )
    ),
    ...facts.policies.map(policy =>
      refusal("policy", policy.name, "the row-level-security policy")
    ),
    ...facts.dependents.map(dependent =>
      refusal("view", dependent.name, `the ${dependent.kind}`)
    ),
  ];
}

/**
 * A default PostgreSQL cannot cast to the new type automatically, which it refuses, or one whose
 * literal the new type would not hold (a `varchar(3)` accepts the default `'draft'` and refuses
 * every row that takes it). An expression default is not known until a row is written.
 */
function postgresDefaultRefusals(
  request: ConversionRequest,
  columnDefault: PostgresCarryFacts["default"]
): CannotCarry[] {
  if (columnDefault === null) return [];
  if (!columnDefault.castsAutomatically) {
    return [
      {
        property: "default",
        name: request.column,
        reason: `the column's default (${columnDefault.expression}) has no automatic cast to ${renderedType(request.to)}`,
        ownerCan: OWNER_CAN.default,
      },
    ];
  }
  const literal = postgresDefaultLiteral(columnDefault.expression);
  const refusal =
    literal === null ? null : defaultLiteralRefusal(request, literal);
  return refusal === null ? [] : [refusedDefault(request, refusal)];
}

/**
 * An index key the new type cannot be indexed by, or a key expression or predicate that reads the
 * column when the kind of value changes.
 */
function postgresIndexRefusals(
  index: PostgresIndexUse,
  to: string,
  kindChange: boolean
): CannotCarry[] {
  if (index.keyed && !index.keptByNewType) {
    return [
      {
        property: "index",
        name: index.name,
        reason:
          index.explicitOpclass === null
            ? `the index's method has no operator class for ${to}`
            : `the operator class ${index.explicitOpclass} does not accept ${to}`,
        ownerCan: OWNER_CAN.index,
      },
    ];
  }
  return index.inExpression && kindChange
    ? [expressionIndexRefusal(index.name, to)]
    : [];
}

/**
 * Whether PostgreSQL changes the type without rewriting the table, as measured: a string becoming
 * `text`, an unbounded `varchar`, or a `varchar` at least as long as the `varchar` it was. Every
 * other change (a narrower `varchar`, `text` to `varchar(n)`, a number to a double, anything to
 * `jsonb`) writes the table again.
 */
function postgresKeepsStorage(request: ConversionRequest): boolean {
  if (request.referenceList === true) return false;
  const from = parseColumnType(request.from);
  const to = parseColumnType(request.to);
  if (from.family !== "text" && from.family !== "varchar") return false;
  if (to.family === "text") return true;
  if (to.family !== "varchar") return false;
  if (to.length === undefined) return true;
  return (
    from.family === "varchar" &&
    from.length !== undefined &&
    to.length >= from.length
  );
}

/**
 * The one statement that converts the column: its type, restating a collation of its own where
 * the new type takes one, and its nullability. The list conversion's statement where the column
 * becomes a relation's list (`pipeline/reference-list-conversion`).
 */
function postgresStatements(
  request: ConversionRequest,
  facts: PostgresCarryFacts
): string[] {
  const table = quoteIdent(request.table, "postgresql");
  const column = quoteIdent(request.column, "postgresql");
  const nullability =
    request.from.nullable === request.to.nullable
      ? []
      : [
          `ALTER COLUMN ${column} ${request.to.nullable ? "DROP" : "SET"} NOT NULL`,
        ];
  const from = renderedType(request.from);
  const to = renderedType(request.to);
  if (request.referenceList === true) {
    return [
      ...referenceConversionStatements(
        {
          type: "change_column_type",
          tableName: request.table,
          columnName: request.column,
          fromType: from,
          toType: to,
          conversion: "referenceList",
        },
        "postgresql"
      ),
      ...nullability.map(action => `ALTER TABLE ${table} ${action}`),
    ];
  }
  const actions: string[] = [];
  if (typeChanges(request)) {
    const collation =
      facts.collation !== null && facts.newTypeTakesCollation
        ? ` COLLATE ${quoteIdent(facts.collation.schema, "postgresql")}.${quoteIdent(facts.collation.name, "postgresql")}`
        : "";
    actions.push(
      `ALTER COLUMN ${column} TYPE ${to}${collation} ${postgresAlterTypeUsing(column, from, to)}`
    );
  }
  actions.push(...nullability);
  return actions.length === 0
    ? []
    : [`ALTER TABLE ${table} ${actions.join(", ")}`];
}

interface ColumnRow {
  attnum: number;
  identity: boolean;
  inherited: boolean;
  has_descendants: boolean;
  default_expression: string | null;
  default_casts: boolean;
  new_type_takes_collation: boolean;
  /** The column's collation and its schema, where it is not its type's default. */
  collation_schema: string | null;
  collation_name: string | null;
}

interface IndexRow {
  name: string;
  keyed: boolean;
  in_expression: boolean;
  explicit_opclass: string | null;
  kept: boolean;
}

interface ForeignKeyRow {
  name: string;
  table: string;
  direction: "into" | "out-of";
}

/**
 * Reads the facts `postgresCarry` judges, from the catalog of the table an unqualified statement
 * reaches (`to_regclass(quote_ident(..))`). The new type is resolved by PostgreSQL itself
 * (`to_regtype`), so what it can cast, collate and index is the database's answer.
 */
async function readPostgresCarryFacts(
  db: unknown,
  request: ConversionRequest
): Promise<PostgresCarryFacts> {
  const relation = sql`to_regclass(quote_ident(${request.table}))`;
  const newType = sql`to_regtype(${renderedType(request.to)})`;
  // The collation is read here, through the same quoted relation as the rest, so a mixed-case
  // table is found and its column's own collation restated. A default casts automatically where it keeps its type, where PostgreSQL has an implicit or
  // assignment cast, or where the new type is a string, which any type converts to through its
  // text on assignment.
  const [column] = await querySqlRows<ColumnRow>(
    db,
    "postgresql",
    sql`SELECT a.attnum::int AS attnum, pg_get_expr(d.adbin, d.adrelid) AS default_expression,
          a.attidentity <> '' AS identity, a.attinhcount > 0 AS inherited,
          EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = a.attrelid) AS has_descendants,
          (a.atttypid = ${newType}
            OR EXISTS (SELECT 1 FROM pg_cast c WHERE c.castsource = a.atttypid
                       AND c.casttarget = ${newType} AND c.castcontext IN ('a', 'i'))
            OR COALESCE((SELECT t.typcategory = 'S' FROM pg_type t WHERE t.oid = ${newType}), false)
          ) AS default_casts,
          COALESCE((SELECT t.typcollation <> 0 FROM pg_type t WHERE t.oid = ${newType}), false)
            AS new_type_takes_collation,
          n.nspname AS collation_schema, co.collname AS collation_name
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        JOIN pg_type ct ON ct.oid = a.atttypid
        LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> ct.typcollation
        LEFT JOIN pg_namespace n ON n.oid = co.collnamespace
        WHERE a.attrelid = ${relation} AND a.attname = ${request.column} AND NOT a.attisdropped`
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
  const attnum = column.attnum;

  // An operator class keeps the new type when its input type is the new type or one the new type
  // is binary-coercible to (`varchar` to `text`). A key on the default class is kept where the
  // index's method has a default class that does.
  const keeps = (opclass: SQL): SQL =>
    sql`EXISTS (SELECT 1 FROM pg_opclass oc
          WHERE (CASE WHEN (SELECT o.opcdefault FROM pg_opclass o WHERE o.oid = ${opclass})
                      THEN oc.opcmethod = ic.relam AND oc.opcdefault
                      ELSE oc.oid = ${opclass} END)
            AND (oc.opcintype = ${newType}
                 OR EXISTS (SELECT 1 FROM pg_cast c WHERE c.castsource = ${newType}
                            AND c.casttarget = oc.opcintype AND c.castmethod = 'b')))`;
  // A position among the index's keys holding the column. The positions past `indnkeyatts` are its
  // INCLUDE columns, carried as stored values with no operator class (their `indclass` is 0),
  // which any type keeps.
  const keyPosition = sql`x.indkey[k] = ${attnum} AND k < x.indnkeyatts`;
  const indexes = await querySqlRows<IndexRow>(
    db,
    "postgresql",
    sql`SELECT ic.relname AS name,
          EXISTS (SELECT 1 FROM generate_subscripts(x.indkey, 1) k WHERE ${keyPosition}) AS keyed,
          ((x.indexprs IS NOT NULL OR x.indpred IS NOT NULL)
            AND EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_class'::regclass
                        AND dep.objid = x.indexrelid AND dep.refclassid = 'pg_class'::regclass
                        AND dep.refobjid = x.indrelid AND dep.refobjsubid = ${attnum})
            AND (NOT EXISTS (SELECT 1 FROM generate_subscripts(x.indkey, 1) k WHERE ${keyPosition})
                 OR position(quote_ident(${request.column}) IN
                    COALESCE(pg_get_expr(x.indexprs, x.indrelid), '') || ' ' ||
                    COALESCE(pg_get_expr(x.indpred, x.indrelid), '')) > 0)
          ) AS in_expression,
          (SELECT string_agg(o.opcname, ', ') FROM generate_subscripts(x.indkey, 1) k
             JOIN pg_opclass o ON o.oid = x.indclass[k]
             WHERE ${keyPosition} AND NOT o.opcdefault) AS explicit_opclass,
          COALESCE((SELECT bool_and(${keeps(sql`x.indclass[k]`)})
             FROM generate_subscripts(x.indkey, 1) k WHERE ${keyPosition}), true) AS kept
        FROM pg_index x
        JOIN pg_class ic ON ic.oid = x.indexrelid
        WHERE x.indrelid = ${relation}
          AND (${attnum} = ANY (x.indkey::int2[])
               OR EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_class'::regclass
                          AND dep.objid = x.indexrelid AND dep.refclassid = 'pg_class'::regclass
                          AND dep.refobjid = x.indrelid AND dep.refobjsubid = ${attnum}))
        ORDER BY ic.relname`
  );

  const checks = await querySqlRows<{ name: string }>(
    db,
    "postgresql",
    sql`SELECT conname AS name FROM pg_constraint
        WHERE conrelid = ${relation} AND contype = 'c' AND ${attnum} = ANY (conkey)
        ORDER BY conname`
  );

  // A trigger names the column where PostgreSQL records it depending on the column: an
  // `UPDATE OF` list or a `WHEN` condition reading it.
  const triggers = await querySqlRows<{ name: string; names_column: boolean }>(
    db,
    "postgresql",
    sql`SELECT t.tgname AS name,
          EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_trigger'::regclass
                  AND dep.objid = t.oid AND dep.refclassid = 'pg_class'::regclass
                  AND dep.refobjid = t.tgrelid AND dep.refobjsubid = ${attnum}) AS names_column
        FROM pg_trigger t WHERE t.tgrelid = ${relation} AND NOT t.tgisinternal
        ORDER BY t.tgname`
  );

  // A view reads the column through its `_RETURN` rule, so it is named by the view; a rule on the
  // table itself is named by the rule.
  const dependents = await querySqlRows<{
    name: string;
    kind: "view" | "rule";
  }>(
    db,
    "postgresql",
    sql`SELECT DISTINCT CASE WHEN r.ev_class = ${relation} THEN r.rulename ELSE v.relname END AS name,
          CASE WHEN r.ev_class = ${relation} THEN 'rule' ELSE 'view' END AS kind
        FROM pg_depend dep
        JOIN pg_rewrite r ON r.oid = dep.objid
        JOIN pg_class v ON v.oid = r.ev_class
        WHERE dep.classid = 'pg_rewrite'::regclass AND dep.refclassid = 'pg_class'::regclass
          AND dep.refobjid = ${relation} AND dep.refobjsubid = ${attnum}
        ORDER BY 1`
  );

  const foreignKeys = await querySqlRows<ForeignKeyRow>(
    db,
    "postgresql",
    sql`SELECT con.conname AS name, other.relname AS "table",
          CASE WHEN con.conrelid = ${relation} AND ${attnum} = ANY (con.conkey)
               THEN 'out-of' ELSE 'into' END AS direction
        FROM pg_constraint con
        JOIN pg_class other ON other.oid =
          CASE WHEN con.conrelid = ${relation} AND ${attnum} = ANY (con.conkey)
               THEN con.confrelid ELSE con.conrelid END
        WHERE con.contype = 'f'
          AND ((con.conrelid = ${relation} AND ${attnum} = ANY (con.conkey))
               OR (con.confrelid = ${relation} AND ${attnum} = ANY (con.confkey)))
        ORDER BY con.conname`
  );

  // A generated column's expression is stored as its default (`pg_attrdef`), which depends on
  // each column it reads; the converted column's own default depends on it too, so it is left out.
  const generatedColumns = await querySqlRows<{ name: string }>(
    db,
    "postgresql",
    sql`SELECT DISTINCT g.attname AS name
        FROM pg_depend dep
        JOIN pg_attrdef ad ON ad.oid = dep.objid
        JOIN pg_attribute g ON g.attrelid = ad.adrelid AND g.attnum = ad.adnum
        WHERE dep.classid = 'pg_attrdef'::regclass AND dep.refclassid = 'pg_class'::regclass
          AND dep.refobjid = ${relation} AND dep.refobjsubid = ${attnum}
          AND g.attnum <> ${attnum} AND g.attgenerated <> ''
        ORDER BY 1`
  );

  // A policy depends on each column its USING or WITH CHECK expression reads, on this table or,
  // through a subquery, on another.
  const policies = await querySqlRows<{ name: string }>(
    db,
    "postgresql",
    sql`SELECT DISTINCT pol.polname AS name
        FROM pg_depend dep
        JOIN pg_policy pol ON pol.oid = dep.objid
        WHERE dep.classid = 'pg_policy'::regclass AND dep.refclassid = 'pg_class'::regclass
          AND dep.refobjid = ${relation} AND dep.refobjsubid = ${attnum}
        ORDER BY 1`
  );

  const collation =
    column.collation_schema === null || column.collation_name === null
      ? null
      : { schema: column.collation_schema, name: column.collation_name };

  return {
    default:
      column.default_expression === null
        ? null
        : {
            expression: column.default_expression,
            castsAutomatically: column.default_casts,
          },
    collation,
    newTypeTakesCollation: column.new_type_takes_collation,
    indexes: indexes.map(index => ({
      name: index.name,
      keyed: index.keyed,
      inExpression: index.in_expression,
      explicitOpclass: index.explicit_opclass,
      keptByNewType: index.kept,
    })),
    checks,
    triggers: triggers.map(trigger => ({
      name: trigger.name,
      namesColumn: trigger.names_column,
    })),
    dependents,
    foreignKeys,
    generatedColumns,
    policies,
    identity: column.identity,
    hasDescendants: column.has_descendants,
    inheritedColumn: column.inherited,
  };
}

/**
 * The plan for converting `request`'s column on PostgreSQL, read from the live table through `db`.
 *
 * One group: PostgreSQL runs the whole conversion in one transaction, holding an
 * `ACCESS EXCLUSIVE` lock, so reads and writes wait until it ends. Whether the table is rewritten
 * is decided from the pair of types (`postgresKeepsStorage`); a nullability change alone never
 * rewrites it.
 */
export async function buildPostgresConversion(
  db: unknown,
  request: ConversionRequest
): Promise<ColumnConversionPlan> {
  const facts = await readPostgresCarryFacts(db, request);
  const statements = postgresStatements(request, facts);
  return {
    steps: statements.length === 0 ? [] : [statements],
    rewritesTable: typeChanges(request) && !postgresKeepsStorage(request),
    blocks: "reads-and-writes",
    ...postgresCarry(request, facts),
  };
}
