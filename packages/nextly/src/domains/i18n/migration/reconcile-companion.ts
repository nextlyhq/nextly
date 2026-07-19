import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { ddlType, q } from "./ddl-types";
import { deriveCompanionSpec } from "./derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { buildCompanionCreateOnlySql } from "./generate-up";

/** Minimal field shape the companion reconciler needs. Structurally compatible with FieldDefinition. */
export interface CompanionFieldLike {
  name: string;
  type: string;
  localized?: boolean;
}

export interface ReconcileCompanionArgs {
  /** Collection slug (used for the companion spec / index names). */
  slug: string;
  /** Main data table name, e.g. `dc_posts`. The companion is `<tableName>_locales`. */
  tableName: string;
  /** Translatable fields present BEFORE this change (already resolved as localized). */
  oldLocalized: CompanionFieldLike[];
  /** Translatable fields present AFTER this change (already resolved as localized). */
  newLocalized: CompanionFieldLike[];
  dialect: SupportedDialect;
  /** Whether the collection has Draft/Published → companion carries a per-locale `_status`. */
  status: boolean;
  /**
   * Whether the companion `<tableName>_locales` table already exists in the live DB.
   * The caller performs the existence check (e.g. `adapter.tableExists`) so this helper
   * stays pure and unit-testable.
   */
  companionExists: boolean;
}

/**
 * i18n: build the DDL that evolves a localized collection's companion `<table>_locales`
 * table to match its translatable fields — the single source of truth shared by every
 * schema path (the builder-canvas apply pipeline and the programmatic update path).
 *
 * The companion is intentionally excluded from the drizzle-kit push/diff (managed-tables
 * `isCompanionTable`), so it MUST be provisioned out-of-band by this helper:
 *   - companion missing → emit the create-only CREATE TABLE (returns "" if there are no
 *     translatable fields yet, e.g. a localized collection created with no localized field).
 *   - companion present → ADD newly-translatable columns and DROP removed ones.
 *
 * Returns "" when there is nothing to do, so callers can guard with `if (sql)`.
 */
export function buildCompanionReconcileSql(
  args: ReconcileCompanionArgs
): string {
  return buildCompanionReconcileStatements(args)
    .map(stmt => `${stmt};`)
    .join("\n");
}

/**
 * Statement-array form of {@link buildCompanionReconcileSql}: each element is one complete DDL
 * statement WITHOUT a trailing `;`. Runtime executors iterate these and run them individually,
 * which is more robust than splitting the joined string on `;` (a semicolon inside a future
 * column default or comment would otherwise fragment a statement). Empty when nothing to do.
 */
export function buildCompanionReconcileStatements(
  args: ReconcileCompanionArgs
): string[] {
  const { slug, tableName, oldLocalized, newLocalized, dialect, status } = args;
  const companionTable = `${tableName}_locales`;

  if (!args.companionExists) {
    // First translatable field on this collection (or fresh localized create): materialize
    // the whole companion. deriveCompanionSpec returns null when there are no localized
    // fields, in which case there is nothing to create yet.
    const spec = deriveCompanionSpec({
      slug,
      dbName: tableName,
      fields: newLocalized,
      dialect,
      defaultLocale: "en", // unused for the create-only statement (no seed rows)
      collectionLocalized: true,
      status,
    });
    // The create-only helper terminates with `;`; strip it so this stays a bare statement.
    return spec ? [buildCompanionCreateOnlySql(spec).replace(/;\s*$/, "")] : [];
  }

  // Companion already exists — diff the localized columns and ADD/DROP the delta.
  const oldNames = new Set(oldLocalized.map(f => f.name));
  const newNames = new Set(newLocalized.map(f => f.name));
  const stmts: string[] = [];

  for (const f of newLocalized) {
    if (oldNames.has(f.name)) continue;
    const col = fieldToLocalizedColumnSpec(f, dialect);
    if (col) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} ADD COLUMN ${q(col.name, dialect)} ${ddlType(col, dialect)}`
      );
    }
  }
  for (const f of oldLocalized) {
    if (newNames.has(f.name)) continue;
    const col = fieldToLocalizedColumnSpec(f, dialect);
    if (col) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} DROP COLUMN ${q(col.name, dialect)}`
      );
    }
  }
  return stmts;
}
