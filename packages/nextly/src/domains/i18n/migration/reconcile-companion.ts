import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { VersionScopeKind } from "../../../schemas/versions/types";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { isFieldLocalized } from "../classify-fields";

import { ddlType, lit, q } from "./ddl-types";
import { deriveCompanionSpec } from "./derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { buildLocalizationDownStatements } from "./generate-down";
import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpStatements,
  COMPANION_UPDATED_AT_COLUMN,
  companionUpdatedAtDdl,
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
   * Which builder made the main table. A companion column mirrors the main table's, so it is
   * described as whatever built that one; deciding it locally left a translatable field bounded on
   * the companion while the same declaration was unbounded on the main table.
   */
  builtBy: ColumnOrigin;

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
   * Whether the EXISTING companion physically has the `_updated_at` column (i18n B2). Only
   * meaningful when `companionExists`.
   *
   * Three-valued on purpose. `false` means introspection looked and the column is not there, so
   * the reconcile ADDs it and seeds it from version history. `undefined` means the caller did not
   * look, which is NOT the same claim — emitting an unconditional `ADD COLUMN` for a caller that
   * never introspected would fail on every companion that already has it, and `ADD COLUMN` is not
   * idempotent on any of the three dialects.
   */
  companionHasUpdatedAt?: boolean;
  /**
   * Which version scope this entity's history is recorded under, enabling the `_updated_at`
   * back-fill (i18n B2). Omit to ADD the column without seeding it.
   *
   * Omission is the honest default rather than a shortcut: a FIELD GROUP has no version scope, so
   * there is no per-locale history to read and NULL — UNKNOWN — is the true answer for it. B2
   * covers collections only: nothing surfaces the signal for a Single, so seeding one would
   * populate a column no screen reads. Extending it is this argument gaining one more caller.
   */
  versionScope?: VersionScopeKind;
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
/**
 * Seed `_updated_at` on an existing companion from version history (i18n B2).
 *
 * Returns nothing without a `versionScope`, and that is how "collections only" is expressed:
 * `nextly_versions` records `collection`, `single` and `page`, but a FIELD GROUP has no version
 * scope at all, so there is no history to read and the column correctly stays NULL.
 *
 * ## Why this back-fill and not a simpler one
 *
 * `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP`, or a copy from `main.updated_at`, would give every
 * row of a parent the SAME value. Source and target then compare EQUAL, so every stale
 * translation on the site reads as fresh — the feature would ship reporting a clean backlog on
 * exactly the sites that need it, and nothing would look wrong. Version history is the only
 * source that differs PER LOCALE, which is the entire requirement.
 *
 * ## Why it is safe to run unattended, when `_status`'s back-fill is not
 *
 * The `_status` pair below refuses to run outside a supervised migration because ADD-then-
 * back-fill cannot be retried from physical shape alone: if the ADD lands and the UPDATE does
 * not, every later run sees the column present, concludes the table is in step, and leaves
 * published content reading as draft.
 *
 * This pair does not have that weakness. A partial apply leaves NULL, NULL means UNKNOWN, and
 * UNKNOWN is already a state the staleness comparison answers safely — it never reports "fine".
 * `WHERE _updated_at IS NULL` makes the UPDATE idempotent, so a later run finishes the job
 * rather than skipping it. The failure degrades to the answer the design already gives instead
 * of to a false one.
 *
 * ## What it seeds from, and the limit that follows
 *
 * "This locale had a durable version", NOT "this locale's translatable content changed" — and
 * those differ. A version row records what the document WAS, not which columns moved, so a
 * shared-field-only edit made while in the source language looks here like a source content
 * change and can flag a translation that is in fact current.
 *
 * The largest such case is already excluded rather than tolerated: the publish path records its
 * version with `locale: null`, and this statement requires `versions.locale = <companion>._locale`,
 * so a publish contributes to no locale's stamp. What remains is the shared-field edit.
 *
 * Not fixed, because the fix is not available at this layer: distinguishing a version that
 * changed companion content needs a comparison between consecutive snapshots, which is not one
 * portable UPDATE across PostgreSQL, MySQL and SQLite — and three dialect-specific JSON
 * traversals inside the statement whose failure mode is silently plausible timestamps is a worse
 * trade than the error they remove.
 *
 * Accepted rather than avoided, and the alternative is worth naming: seeding nothing leaves
 * pre-migration chronology unknown, so an established site sees an empty worklist on the day it
 * upgrades and fills in only as each language is next saved — the feature not working for exactly
 * the content that has had time to go stale. The error kept in its place is bounded to rows that
 * predate the migration, runs in one direction, and clears the moment that language is saved.
 *
 * ## What it deliberately does not do
 *
 * ## Durable versions only, because the runtime counts only durable writes
 *
 * `version_no IS NOT NULL` excludes working drafts and autosaves, and the exclusion is what keeps
 * this statement answering the same question the write path does. The collection write path gates
 * its companion upsert on `!storeAsWorkingDraft`, so a held draft never reaches the companion at
 * all — while it does leave a version row behind. Counting those rows here would seed a source
 * locale's timestamp from an edit the companion never received, so a target translated before
 * that draft would be reported stale by the migration and NOT by an identical draft written after
 * it. Same document, same facts, different answer depending on when the upgrade ran.
 *
 * `nextly_versions.locale` is NULL for a snapshot taken while the document was not localized,
 * and such a snapshot holds the DEFAULT language's content — so those rows are arguably evidence
 * for the default locale's timestamp. They are not read here: matching them could only raise the
 * SOURCE side of the comparison, which is the side that makes a row stale, and manufacturing a
 * "needs review" out of a pre-localization snapshot is a worse failure than leaving the value
 * unknown. Stated rather than merely omitted, so a later author decides it with the fact rather
 * than rediscovering it.
 */
function buildUpdatedAtBackfill(args: {
  companionTable: string;
  slug: string;
  dialect: SupportedDialect;
  versionScope: VersionScopeKind | undefined;
}): string[] {
  const { companionTable, slug, dialect, versionScope } = args;
  if (versionScope === undefined) return [];
  const comp = q(companionTable, dialect);
  const versions = q(VERSIONS_TABLE, dialect);
  return [
    `UPDATE ${comp} SET ${q(COMPANION_UPDATED_AT_COLUMN, dialect)} = ` +
      `(SELECT MAX(${versions}.${q("created_at", dialect)}) FROM ${versions} ` +
      `WHERE ${versions}.${q("scope_kind", dialect)} = ${lit(versionScope)} ` +
      `AND ${versions}.${q("scope_slug", dialect)} = ${lit(slug)} ` +
      `AND ${versions}.${q("entry_id", dialect)} = ${comp}.${q("_parent", dialect)} ` +
      `AND ${versions}.${q("locale", dialect)} = ${comp}.${q("_locale", dialect)} ` +
      `AND ${versions}.${q("version_no", dialect)} IS NOT NULL) ` +
      `WHERE ${comp}.${q(COMPANION_UPDATED_AT_COLUMN, dialect)} IS NULL`,
  ];
}

export function buildCompanionReconcileStatements(
  args: ReconcileCompanionArgs
): string[] {
  const {
    slug,
    tableName,
    oldLocalized,
    newLocalized,
    dialect,
    status,
    builtBy,
  } = args;
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
      builtBy,
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
    const col = fieldToLocalizedColumnSpec(f, dialect, builtBy);
    if (col) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} ADD COLUMN ${q(col.name, dialect)} ${ddlType(col, dialect)}`
      );
    }
  }
  for (const f of oldLocalized) {
    if (newNames.has(f.name)) continue;
    const col = fieldToLocalizedColumnSpec(f, dialect, builtBy);
    if (col) {
      stmts.push(
        `ALTER TABLE ${q(companionTable, dialect)} DROP COLUMN ${q(col.name, dialect)}`
      );
    }
  }

  // i18n B2: add `_updated_at` to a companion that predates it, and seed it from version history.
  //
  // Only acts when the caller told us what the live table has. `undefined` means "not
  // introspected", which is not the same as "absent" — emitting an unconditional ADD for a caller
  // that never looked would fail on every companion that already has the column.
  if (args.companionHasUpdatedAt === false) {
    stmts.push(
      `ALTER TABLE ${q(companionTable, dialect)} ADD COLUMN ${companionUpdatedAtDdl(dialect)}`
    );
  }
  // 🔴 The back-fill is emitted whenever a version scope is known, NOT only alongside the ADD —
  // and separating the two is the whole point.
  //
  // Pairing them made the column's PRESENCE stand for the back-fill having run, and those are
  // different facts. If the ADD commits and the UPDATE does not, every later run introspects the
  // column, concludes the companion is in step, and never seeds it: existing rows stay unknown
  // permanently and staleness silently never fires for that collection — the exact failure this
  // feature exists to remove, reintroduced by its own migration.
  //
  // No probe can rescue the paired form, which is why the answer is to re-issue rather than to
  // detect. After a SUCCESSFUL back-fill, every row whose locale had no durable history is still
  // NULL — so "are there NULLs?" cannot tell a back-fill that never ran from one that ran and
  // found nothing. There is no physical signal to read.
  //
  // Re-issuing is safe in every state because `WHERE _updated_at IS NULL` makes it monotonic: it
  // can only fill a value that is absent, never move one a real write has set. So the statement is
  // recovery when the first attempt failed, a no-op when it succeeded, and a late seed when
  // history has appeared since. The cost is one guarded UPDATE per localized entity per sync,
  // which is a command an operator runs, not a request path.
  if (args.companionHasUpdatedAt !== undefined) {
    stmts.push(
      ...buildUpdatedAtBackfill({
        companionTable,
        slug,
        dialect,
        versionScope: args.versionScope,
      })
    );
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
  /**
   * Which builder made the main table. A companion column mirrors the main table's, so it is
   * described as whatever built that one.
   */
  builtBy: ColumnOrigin;
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
  /**
   * Localized columns the MAIN table still physically carries.
   *
   * Only the disable direction reads it. Unattended provisioning may seed a companion without
   * dropping the columns it copied from, so a later disable can meet a main table that still has
   * them: re-adding one fails, and skipping the restore because it is present reverts content to
   * whatever it held before the entity was localized.
   *
   * Omitted means "none of them", which is the shape a transition produced by an explicit toggle
   * or a migration file leaves behind.
   */
  existingMainColumns?: readonly string[];
  /**
   * Whether the entity had Draft/Published BEFORE this change.
   *
   * A history fact, unlike {@link CompanionTransitionArgs.existingMainColumns}, which describes
   * only the database in front of you and is deliberately stripped from the migration artefact.
   * That distinction is what makes this the right signal for the disable restore: it is equally
   * true for a database that has only ever replayed migrations.
   *
   * It answers exactly what that restore needs — did main carry `status` and the companion
   * `_status` before this save. Deriving it from the DESIRED status instead would emit a copy from
   * a `_status` the old companion never had, into a `status` main has not been given yet, because a
   * disable deliberately runs the companion transition before the shared ALTER that adds it.
   *
   * REQUIRED rather than optional, and that is the point. An optional history signal is one a
   * caller can omit without noticing, and the copy it gates then silently stops happening for that
   * caller alone — which is exactly how this went wrong once already. `undefined` is not a
   * shorthand for "no status"; a caller that genuinely has none says `false`.
   */
  wasStatus: boolean;
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
    builtBy,
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
      builtBy,
    });
    // No translatable columns yet (or an already-present companion from a partial apply): fall
    // back to the plain reconcile, which CREATEs an empty companion or no-ops.
    if (!spec || companionExists) {
      return {
        statements: buildCompanionReconcileStatements({
          slug,
          tableName,
          builtBy,
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
        .map(f => fieldToLocalizedColumnSpec(f, dialect, builtBy)?.name)
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
      builtBy,
    });
    // Nothing to restore (no companion, or the entity had no translatable columns).
    if (!spec || !companionExists) return none;
    return {
      statements: buildLocalizationDownStatements(spec, {
        existingMainColumns: args.existingMainColumns,
        // The PHYSICAL shape, not the desired one. `status` describes what the collection is being
        // saved as, and a save that disables localization and enables Draft/Published at once
        // would have this restore read a `_status` the old companion never had — and main receive
        // it before the shared ALTER that adds `status`, because a disable deliberately runs the
        // companion transition first. Both columns have to be there already.
        // The column has to be there BEFORE this save and still be there after.
        //
        // Before, because the copy reads the companion's `_status` and writes main's `status`, and
        // neither exists for an entity that did not have Draft/Published. `existingMainColumns`
        // cannot answer that: it is built from localized user fields, so it never contains
        // `status`, and it is cleared for the artefact so a migration file cannot depend on local
        // introspection.
        //
        // After, because turning Draft/Published off in the same save drops main's `status`, and
        // whether that ALTER lands before or after this plan differs by flow — the single schema
        // path runs it first, the collection path runs it second. Restoring into a column that is
        // being removed is pointless in both, and fatal in the one that removes it first.
        restoreStatus: args.wasStatus === true && status === true,
      }),
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
        builtBy,
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

/**
 * The transition as a replayable migration artefact, and — only when they differ — as the
 * statements this particular database needs.
 *
 * A migration file is replayed against databases that have only ever run migrations, so its
 * content must follow from history alone. `existingMainColumns` comes from introspecting the
 * database in front of you, and unattended provisioning retains the columns it copied into a
 * companion, so a development database can sit in a shape no sequence of migrations produces.
 * Baking that in emits a disable which skips re-adding columns the target database dropped, and
 * the restore then addresses columns that are not there.
 *
 * Both plans come from one call site so the artefact cannot accidentally be built from local
 * introspection. `local` is omitted when the two agree — every case but a disable meeting retained
 * columns — so a caller holding one plan cannot pick the wrong one.
 */
export function buildCompanionTransitionPlans(
  args: CompanionTransitionArgs & {
    /** What THIS database carries. Never reaches the artefact. */
    existingMainColumns?: readonly string[];
  }
): { artefact: CompanionTransitionPlan; local?: CompanionTransitionPlan } {
  const artefact = buildCompanionTransitionStatements({
    ...args,
    existingMainColumns: undefined,
  });
  if (!args.existingMainColumns?.length) return { artefact };

  const local = buildCompanionTransitionStatements(args);
  const same =
    local.statements.length === artefact.statements.length &&
    local.statements.every((s, i) => s === artefact.statements[i]);
  return same ? { artefact } : { artefact, local };
}
