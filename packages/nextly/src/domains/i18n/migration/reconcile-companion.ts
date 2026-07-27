import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { isFieldLocalized } from "../classify-fields";

import { ddlType, q } from "./ddl-types";
import { deriveCompanionSpec } from "./derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { buildLocalizationDownStatements } from "./generate-down";
import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpStatements,
} from "./generate-up";

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
  /**
   * Whether the EXISTING companion physically has the `_status` column. Only meaningful when
   * `companionExists`. When provided and it disagrees with `status`, the reconcile ADDs `_status`
   * (Draft/Published toggled on after the companion was created) or DROPs it (toggled off), so a
   * later status change on an already-localized entity keeps the companion in step. The caller
   * introspects it; omit it to leave `_status` untouched (backwards-compatible default).
   */
  companionHasStatus?: boolean;
  /**
   * Default locale code. When supplied, ADDing `_status` also back-fills the DEFAULT-locale
   * companion row's `_status` from the main row's `status`, so the default locale (whose status
   * IS the main row's) does not get stranded at the column default `'draft'` while the main row is
   * already published. Omit to skip the back-fill (e.g. a migrate path with no live default locale).
   */
  defaultLocale?: string;
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

  // Reconcile the per-locale `_status` column when Draft/Published was toggled AFTER the
  // companion already existed (the create branch above already bakes it in per `status`). Only
  // acts when the caller supplied the companion's current status-column state.
  if (args.companionHasStatus !== undefined) {
    if (status && !args.companionHasStatus) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} ADD COLUMN ${q("_status", dialect)} VARCHAR(20) NOT NULL DEFAULT 'draft'`
      );
      // The ADD COLUMN seeds EVERY existing companion row at 'draft', including
      // the default-locale row — but the default locale's status IS the main
      // row's, which may already be 'published'. Back-fill it from main so a
      // later default-locale publish is a real draft→published transition (and
      // fires its webhook) rather than a no-op against a wrongly-draft companion.
      // Only the default-locale row: other locales are genuinely per-locale and
      // correctly start at 'draft'. The subquery targets a different table (main)
      // than the one updated, so it is valid on Postgres, MySQL and SQLite.
      if (args.defaultLocale !== undefined) {
        const literalLocale = args.defaultLocale.replace(/'/g, "''");
        stmts.push(
          `UPDATE ${q(companionTable, dialect)} SET ${q("_status", dialect)} = ` +
            `(SELECT ${q("status", dialect)} FROM ${q(tableName, dialect)} ` +
            `WHERE ${q(tableName, dialect)}.${q("id", dialect)} = ${q(companionTable, dialect)}.${q("_parent", dialect)}) ` +
            `WHERE ${q(companionTable, dialect)}.${q("_locale", dialect)} = '${literalLocale}'`
        );
      }
    } else if (!status && args.companionHasStatus) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} DROP COLUMN ${q("_status", dialect)}`
      );
    }
  }
  return stmts;
}

/** Which localization transition a reconcile is performing. */
export interface CompanionTransitionArgs {
  slug: string;
  tableName: string;
  dialect: SupportedDialect;
  /** Default locale — the language seeded onto/restored from the companion. */
  defaultLocale: string;
  /** Desired Draft/Published state (companion `_status`). */
  status: boolean;
  /** Localization state BEFORE this save (persisted). */
  wasLocalized: boolean;
  /** Localization state AFTER this save (requested). */
  isLocalized: boolean;
  /** All user fields BEFORE this save (used to pick the localized set for a disable). */
  oldFields: CompanionFieldLike[];
  /** All user fields AFTER this save (used to pick the localized set for enable/field-change). */
  newFields: CompanionFieldLike[];
  /** Whether the companion `<tableName>_locales` table currently exists. */
  companionExists: boolean;
  /** Whether the existing companion physically has `_status` (see ReconcileCompanionArgs). */
  companionHasStatus?: boolean;
}

/** The plan produced by {@link buildCompanionTransitionStatements}. */
export interface CompanionTransitionPlan {
  /** DDL/DML statements to run in order (no trailing `;`). */
  statements: string[];
  /** true when the plan writes to `nextly_i18n_archive` → the caller must ensure it exists first. */
  needsArchive: boolean;
  /** true when the companion table no longer exists afterwards (disable) → skip re-registration. */
  companionDropped: boolean;
}

/**
 * i18n: decide the runtime companion statements for ANY localization change on an EXISTING
 * entity — the data-preserving counterpart of {@link buildCompanionReconcileStatements}, shared
 * by the collection/single/component Schema-Builder toggle paths (which have no `nextly migrate`
 * step, so the data move must run live).
 *
 *  - ENABLE (was off → on): seed the companion's default-locale rows from the existing main
 *    columns, then drop those columns from main (no data loss). A fresh localized entity whose
 *    main table never held the columns just CREATEs the companion.
 *  - DISABLE (was on → off): restore the default locale onto main, archive the other languages
 *    into `nextly_i18n_archive`, then drop the companion (recoverable via `nextly i18n:restore`).
 *  - FIELD CHANGE (stayed localized): ADD/DROP the changed localized columns and reconcile
 *    `_status`.
 *  - No transition (stayed non-localized): nothing.
 */
export function buildCompanionTransitionStatements(
  args: CompanionTransitionArgs
): CompanionTransitionPlan {
  const {
    slug,
    tableName,
    dialect,
    defaultLocale,
    status,
    wasLocalized,
    isLocalized,
    oldFields,
    newFields,
    companionExists,
  } = args;

  const none: CompanionTransitionPlan = {
    statements: [],
    needsArchive: false,
    companionDropped: false,
  };

  // ENABLE — relocate the existing main columns into a seeded companion.
  if (!wasLocalized && isLocalized) {
    const localizedNew = newFields.filter(f => isFieldLocalized(f, true));
    const spec = deriveCompanionSpec({
      slug,
      dbName: tableName,
      fields: localizedNew,
      dialect,
      defaultLocale,
      collectionLocalized: true,
      status,
    });
    // No translatable columns yet (or an already-present companion from a partial apply): fall
    // back to the plain reconcile, which CREATEs an empty companion or no-ops.
    if (!spec || companionExists) {
      return {
        statements: buildCompanionReconcileStatements({
          slug,
          tableName,
          oldLocalized: [],
          newLocalized: localizedNew,
          dialect,
          status,
          companionExists,
        }),
        needsArchive: false,
        companionDropped: false,
      };
    }
    // `wasLocalized` is false here, so a physical column a pre-save field produced can only
    // live on the main table. Resolve the OLD fields through the same descriptor that built
    // `spec.columns` and keep the new localized columns whose physical column already exists:
    // a field named `subTitle` is stored as `sub_title`, a `component` field emits no column
    // at all, and a relationship stores under a different name, so matching raw field names
    // would seed from (and drop) columns main never had. A field added in this save has no
    // old column and gets a companion column only.
    const oldColumnNames = new Set(
      oldFields
        .map(f => fieldToLocalizedColumnSpec(f, dialect)?.name)
        .filter((n): n is string => typeof n === "string")
    );
    spec.columnsOnMain = spec.columns
      .map(c => c.name)
      .filter(n => oldColumnNames.has(n));
    return {
      statements: buildLocalizationUpStatements(spec),
      needsArchive: false,
      companionDropped: false,
    };
  }

  // DISABLE — restore the default locale onto main, archive the rest, drop the companion.
  if (wasLocalized && !isLocalized) {
    const localizedOld = oldFields.filter(f => isFieldLocalized(f, true));
    const spec = deriveCompanionSpec({
      slug,
      dbName: tableName,
      fields: localizedOld,
      dialect,
      defaultLocale,
      collectionLocalized: true,
      status,
    });
    // Nothing to restore (no companion, or the entity had no translatable columns).
    if (!spec || !companionExists) return none;
    return {
      statements: buildLocalizationDownStatements(spec),
      needsArchive: true,
      companionDropped: true,
    };
  }

  // FIELD CHANGE while staying localized — ADD/DROP the changed localized columns + reconcile
  // `_status`.
  if (wasLocalized && isLocalized) {
    const oldLocalized = oldFields.filter(f => isFieldLocalized(f, true));
    const newLocalized = newFields.filter(f => isFieldLocalized(f, true));
    return {
      statements: buildCompanionReconcileStatements({
        slug,
        tableName,
        oldLocalized,
        newLocalized,
        dialect,
        status,
        companionExists,
        companionHasStatus: args.companionHasStatus,
        // Carry the default locale so a newly-added `_status` back-fills the
        // default-locale companion row from the main row's status.
        defaultLocale,
      }),
      needsArchive: false,
      companionDropped: false,
    };
  }

  return none;
}
