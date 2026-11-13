/**
 * Columns added to a table somebody else owns.
 *
 * Such a column needs two things. An entity read is
 * `db.select().from(table)`, so a raw column would either leak into every API
 * response or — if kept out of the runtime table — be proposed as a DROP by
 * the next dev push.
 *
 * Both halves exist: the column is added to the
 * runtime table (so push and SQLite rebuilds keep it) AND removed where rows
 * become entries (so no API ever sees it). Neither half is optional, and the
 * second is why these are called HIDDEN rather than merely added.
 *
 * ## Why nullable-or-defaulted is a hard rule
 *
 * Existing rows already exist. A `NOT NULL` column with no default cannot be
 * added to a populated table on any dialect, so the migration fails on exactly
 * the installations that have data — the ones least able to absorb a failed
 * deploy. Checked at resolve time so it fails at boot, on an empty dev
 * database, rather than in production.
 *
 * @module domains/schema/extension/extension-columns
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";

import type { ColumnBuilder, ResolvedColumn } from "./dsl";
import type { SchemaOwner } from "./types";

/**
 * Core tables that may take extension columns and indexes.
 *
 * Deliberately short, and chosen by what an extension could BREAK rather than
 * by what someone might want. These five carry application data: users, media,
 * jobs and the two logs.
 *
 * Everything else is refused — RBAC, tokens, the schema ledger, the owner
 * registry, locks and outboxes — because a column on one of those sits inside
 * the machinery that decides access or applies migrations. An extension that
 * broke RBAC would fail open, and one that broke the ledger would leave a
 * database nobody could migrate.
 */
export const EXTENDABLE_CORE_TABLES: ReadonlySet<string> = new Set([
  "users",
  "media",
  "nextly_jobs",
  "audit_log",
  "activity_log",
]);

/** Where a column is being added, which decides which rules apply. */
export type ExtensionTarget =
  | { kind: "own" }
  | { kind: "entity"; slug: string }
  | { kind: "core"; table: string }
  | { kind: "foreign"; owner: SchemaOwner };

function refuse(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/**
 * Whether a column can be added to a table that already has rows.
 *
 * The check is on the COLUMN rather than on the table's row count, because
 * the answer must be the same on an empty development database and a
 * populated production one — otherwise the rule passes where it is tested and
 * fails where it matters.
 */
export function assertAddableToExistingRows(
  column: ResolvedColumn,
  tableName: string
): void {
  if (!leavesExistingRowsEmpty(column)) return;
  if (column.generated !== undefined) return;

  refuse(
    `${tableName}.${column.key}`,
    `Column "${column.key}" is NOT NULL with no default, so it cannot be added to a table that already has rows. Make it nullable, or give it a default.`
  );
}

/**
 * Whether a column added to a table that has rows leaves those rows without
 * the value it requires: NOT NULL, and nothing to fill them with.
 *
 * The one statement of the rule, read by `assertAddableToExistingRows` for a
 * column contributed to somebody else's table, and by `migrate:create
 * --plugin` for a column added to any table the plugin's earlier migrations
 * created — where whether the column is new is known only from the previous
 * module. Asked of the column, never of the row count, for the reason above.
 */
export function leavesExistingRowsEmpty(column: {
  nullable: boolean;
  default?: unknown;
}): boolean {
  return !column.nullable && column.default === undefined;
}

/**
 * Whether this caller may add columns to this target.
 *
 * Core tables are allowlisted rather than blocklisted: a new core table is
 * added by Nextly, and a blocklist would silently make it extendable the day
 * it appeared.
 */
export function assertMayAddColumns(
  target: ExtensionTarget,
  tableName: string,
  caller: SchemaOwner,
  /** Precomputed by the caller's scope: plugin-on-dependency. */
  mayContributeForeign = false
): void {
  const who = caller.kind === "plugin" ? `plugin "${caller.id}"` : "the app";

  switch (target.kind) {
    case "own":
      return;

    case "entity":
      // Allowed for plugins and the app alike: the column is hidden from the
      // entry API, so it cannot change what a collection returns.
      return;

    case "core":
      if (EXTENDABLE_CORE_TABLES.has(target.table)) return;
      refuse(
        `${tableName}`,
        `"${target.table}" is a core table that may not be extended. A column there would sit inside the machinery that decides access or applies migrations. Extendable core tables: ${[...EXTENDABLE_CORE_TABLES].sort().join(", ")}.`
      );
      break;

    case "foreign":
      // Element-level ownership: the column is hidden from the entry
      // API and rides the CONTRIBUTOR's migration stream, recorded per
      // element — so the app may extend any plugin's table, and a plugin a
      // dependency's, the same way either may index one.
      if (
        mayContributeForeign ||
        (caller.kind === "app" && target.owner.kind === "plugin")
      ) {
        return;
      }
      refuse(
        `${tableName}`,
        `${who} may not add columns to "${tableName}", which belongs to ${target.owner.kind === "plugin" ? `plugin "${target.owner.id}"` : "the app"}.${caller.kind === "plugin" ? " Name the owner in dependsOn (or optionalDependsOn) to extend its tables." : ""}`
      );
  }
}

/**
 * The storage an override gives a field's column: the kind it renders as, and
 * the size that kind takes. Kinds are the field descriptor's own, so the
 * desired table and the runtime table render an overridden column through
 * the functions that render every field column.
 */
export interface OverrideStorage {
  kind: "text" | "longText" | "shortText" | "integer" | "bigint" | "decimal";
  length?: number;
  precision?: number;
  scale?: number;
}

/** A field column, as the draft seeds it, that an override is judged against. */
export interface OverriddenColumn {
  kind: string;
  precision?: number;
  scale?: number;
}

/** What `overrideColumn` reads of a builder: its storage and what else it says. */
type OverrideBuilder = Pick<
  ColumnBuilder,
  | "kind"
  | "nullable"
  | "length"
  | "precision"
  | "scale"
  | "default"
  | "generated"
  | "onUpdate"
  | "enumValues"
  | "primaryKey"
  | "references"
>;

/** The kinds a string field's column has, by the builder that made its table. */
const STRING_COLUMN_KINDS: ReadonlySet<string> = new Set([
  "text",
  "longText",
  "shortText",
]);

/**
 * The storage of a string target. `col.varchar(n)` becomes the bounded
 * kind a field declaring a width gets, so the width is enforced on
 * PostgreSQL too, where a declared table's `varchar` renders as `text`: an
 * override to a width is asked for so that the width holds.
 */
function stringTarget(builder: OverrideBuilder): OverrideStorage | undefined {
  switch (builder.kind) {
    case "text":
      return { kind: "text" };
    case "longText":
      return { kind: "longText" };
    case "shortText":
      return { kind: "shortText", length: 255 };
    case "varchar":
      return { kind: "shortText", length: builder.length ?? 255 };
    default:
      return undefined;
  }
}

/**
 * The storage an app's override gives a field's column, or a refusal.
 *
 * App only, and storage only: the column's type and the size that type
 * takes. Its name, nullability, default and keys stay the field's, so a
 * builder saying anything about them is refused rather than half-applied.
 *
 * The targets are listed per kind rather than per family, so what would
 * change the VALUES is kept out: a `char` pads them, a `uuid` refuses text
 * that is not one, an `enum` adds a check. A string may narrow, since the
 * apply judges that by the stored data; a number may only widen from the
 * field's own storage, since nothing judges a numeric narrowing by its data.
 */
export function resolveColumnOverride(
  column: OverriddenColumn,
  builder: OverrideBuilder,
  tableName: string,
  columnName: string
): OverrideStorage {
  const path = `${tableName}.${columnName}`;
  assertStorageOnly(builder, path, columnName);

  if (STRING_COLUMN_KINDS.has(column.kind)) {
    const target = stringTarget(builder);
    if (target !== undefined) return target;
    refuseTarget(path, columnName, column.kind, builder.kind, [
      "col.text()",
      "col.longText()",
      "col.shortText()",
      "col.varchar(n)",
    ]);
  }

  if (column.kind === "integer") {
    if (builder.kind === "integer" || builder.kind === "bigint") {
      return { kind: builder.kind };
    }
    if (builder.kind === "smallint") {
      refuse(
        path,
        `Column "${columnName}" holds whole numbers as an integer, and smallint is narrower. An override may only widen a number, since nothing checks the stored values fit a narrower one.`
      );
    }
    refuseTarget(path, columnName, column.kind, builder.kind, [
      "col.integer()",
      "col.bigint()",
    ]);
  }

  if (column.kind === "decimal") {
    if (builder.kind !== "decimal") {
      refuseTarget(path, columnName, column.kind, builder.kind, [
        "col.decimal(precision, scale)",
      ]);
    }
    return decimalTarget(column, builder, path, columnName);
  }

  refuse(
    path,
    `Column "${columnName}" is ${describeKind(column.kind)}, which has no other storage an override may choose. Overrides change a string field's, a whole-number field's or a decimal field's column.`
  );
}

/** A decimal target, which may keep or grow the digits on each side of the point. */
function decimalTarget(
  column: OverriddenColumn,
  builder: OverrideBuilder,
  path: string,
  columnName: string
): OverrideStorage {
  const fromPrecision = column.precision ?? 10;
  const fromScale = column.scale ?? 2;
  const toPrecision = builder.precision ?? fromPrecision;
  const toScale = builder.scale ?? fromScale;
  if (
    toScale < fromScale ||
    toPrecision - toScale < fromPrecision - fromScale
  ) {
    refuse(
      path,
      `Column "${columnName}" is decimal(${String(fromPrecision)}, ${String(fromScale)}), and decimal(${String(toPrecision)}, ${String(toScale)}) keeps fewer digits on one side of the point. An override may only widen a number, since nothing checks the stored values fit a narrower one.`
    );
  }
  return { kind: "decimal", precision: toPrecision, scale: toScale };
}

/** Refuse a builder that says anything beyond the column's storage. */
function assertStorageOnly(
  builder: OverrideBuilder,
  path: string,
  columnName: string
): void {
  const extras = [
    builder.nullable ? "nullable" : undefined,
    builder.default !== undefined ? "a default" : undefined,
    builder.generated !== undefined ? "a generated value" : undefined,
    builder.onUpdate !== undefined ? "an update stamp" : undefined,
    builder.enumValues !== undefined ? "enum values" : undefined,
    builder.primaryKey === true ? "a primary key" : undefined,
    builder.references !== undefined ? "a reference" : undefined,
  ].filter((extra): extra is string => extra !== undefined);
  if (extras.length === 0) return;
  refuse(
    path,
    `An override changes only the storage of "${columnName}"; this one also sets ${extras.join(", ")}. Whether the column is required, its default and its keys stay the field's: change the field instead.`
  );
}

function refuseTarget(
  path: string,
  columnName: string,
  fromKind: string,
  toKind: string,
  allowed: readonly string[]
): never {
  refuse(
    path,
    `Column "${columnName}" is ${describeKind(fromKind)}, and cannot be overridden to ${toKind}: it may become ${allowed.join(", ")}. An override changes the storage within the column's value family, and a ${toKind} would change what the field's values are.`
  );
}

/** A column kind, as a refusal names it. */
function describeKind(kind: string): string {
  if (STRING_COLUMN_KINDS.has(kind)) return "a string";
  switch (kind) {
    case "integer":
      return "a whole number";
    case "decimal":
      return "a decimal";
    case "double":
      return "a floating-point number (its only other storage, real, loses precision)";
    case "boolean":
      return "a boolean";
    case "timestamp":
      return "a date";
    case "json":
      return "JSON";
    default:
      return `of kind ${kind}`;
  }
}

/** Refuse an override from anyone but the app. */
export function assertMayOverride(
  caller: SchemaOwner,
  tableName: string,
  columnName: string
): void {
  if (caller.kind === "app") return;
  refuse(
    `${tableName}.${columnName}`,
    `Only the app may override a column's storage. Plugin "${caller.id}" would be changing what every reader of that field gets back.`
  );
}
