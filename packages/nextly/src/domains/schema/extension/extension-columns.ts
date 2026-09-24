/**
 * Columns added to a table somebody else owns.
 *
 * Part A refused these outright. It was the right call while nothing hid them
 * from the entry API: an entity read is `db.select().from(table)`, so a raw
 * column would either leak into every API response or — if kept out of the
 * runtime table — be proposed as a DROP by the next dev push.
 *
 * They are allowed now because both halves exist: the column is added to the
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

import type { ResolvedColumn } from "./dsl";
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
  if (column.nullable) return;
  if (column.default !== undefined) return;
  if (column.generated !== undefined) return;

  refuse(
    `${tableName}.${column.key}`,
    `Column "${column.key}" is NOT NULL with no default, so it cannot be added to a table that already has rows. Make it nullable, or give it a default.`
  );
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
      // Element-level ownership (C7): the column is hidden from the entry
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
 * Whether an override is allowed, and whether it preserves the value type.
 *
 * App only. An override changes the STORAGE of a field's column — Payload's
 * `varchar('city', { length: 10 })` case — and a plugin doing that to somebody
 * else's field would change what every reader of it gets back.
 *
 * The compatibility rule is about the VALUE, not the storage word: text may
 * become a narrower text, an integer a wider integer. Crossing families would
 * make the field's own validation describe a column that cannot hold what it
 * accepts.
 */
const VALUE_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["text", "longText", "shortText", "varchar", "char", "uuid", "enum"]),
  new Set(["integer", "bigint", "smallint"]),
  new Set(["double", "real", "decimal"]),
  new Set(["boolean"]),
  new Set(["timestamp"]),
  new Set(["json"]),
  new Set(["bytes"]),
];

export function assertOverrideCompatible(
  fromKind: string,
  toKind: string,
  tableName: string,
  columnName: string
): void {
  const family = VALUE_FAMILIES.find(set => set.has(fromKind));
  if (family?.has(toKind) === true) return;

  refuse(
    `${tableName}.${columnName}`,
    `A column of kind "${fromKind}" cannot be overridden to "${toKind}": the field's validation would describe a column that cannot hold what it accepts. Overrides may change storage within a value family, not across one.`
  );
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
