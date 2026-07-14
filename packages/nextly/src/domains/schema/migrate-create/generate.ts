// F11 PR 3: orchestrator for `nextly migrate:create`.
//
// Pure orchestration — no I/O beyond the snapshot-io and file-write
// helpers. Composes:
//
//   1. Load latest snapshot from migrations/meta/ (or EMPTY_SNAPSHOT).
//   2. Build desired snapshot from nextly.config.ts (collections,
//      singles, components, optional user_ext).
//   3. diffSnapshots(prev, cur) → Operation[].
//   4. RegexRenameDetector.detect(ops) → RenameCandidate[].
//   5. Prompt operator via clack (or auto-accept/decline non-interactively).
//   6. Apply rename decisions to operations:
//      - Accept: replace matching (drop_column, add_column) pair with
//        a rename_column op.
//      - Decline: leave as drop + add.
//   7. Generate per-statement SQL via sql-templates/.
//   8. Write paired migrations/<ts>_<slug>.sql + migrations/meta/<ts>_<slug>.snapshot.json.
//
// Returns null when no operations remain (after rename collapsing).
// CLI exits with code 2 in that case ("no changes detected" — distinct
// from exit 1 for actual errors so CI scripts can tell apart).

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import {
  planCompanionMigration,
  type CompanionMigrationPlan,
} from "../../i18n/migration/plan-companion-migration";
import type { CompanionMigrationSpec } from "../../i18n/migration/types";
import { writeCompanionMigrationFile } from "../../i18n/migration/write-migration-file";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "../pipeline/diff/build-from-fields";
import { diffSnapshots } from "../pipeline/diff/diff";
import type {
  NextlySchemaSnapshot,
  Operation,
  RenameColumnOp,
  TableSpec,
} from "../pipeline/diff/types";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";
import { RegexRenameDetector } from "../pipeline/rename-detector";
import { generateSQL } from "../pipeline/sql-templates/index";

import { buildInverseOperations } from "./down-generator";
import { formatMigrationFile, formatTimestamp, slugify } from "./format-file";
import { promptRenames, type RenameDecision } from "./prompt-renames";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  writeSnapshot,
} from "./snapshot-io";

/**
 * Minimal field shape we read from `nextly.config.ts`. Mirrors the
 * MinimalFieldDef in build-from-fields.ts.
 */
export interface MinimalConfigField {
  name: string;
  type: string;
  required?: boolean;
  // Forwarded so the column-type classifier (field-column-descriptor.ts)
  // emits `json` for hasMany / polymorphic relationships instead of a single
  // `text` id column. Stripping these previously mis-typed those columns.
  hasMany?: boolean;
  relationTo?: string | string[];
  // Forwarded so the desired-index builder (build-from-fields.ts) emits the
  // unique/plain index for this field (Stage C1).
  unique?: boolean;
  index?: boolean;
  // Forwarded so localized fields are omitted from the main table's desired
  // state and relocated to the companion `_locales` table (i18n M3b-2).
  localized?: boolean;
}

/**
 * Minimal collection / single / component shape we read from
 * `nextly.config.ts`. The full ConfigCollection has many more
 * attributes; we only need slug + tableName + fields + status for
 * diffing.
 */
export interface MinimalConfigEntity {
  slug: string;
  tableName: string;
  fields: MinimalConfigField[];
  /**
   * Whether the entity has Nextly's built-in Draft/Published lifecycle
   * enabled (`defineCollection({ status: true })` /
   * `defineSingle({ status: true })`). When true, the desired snapshot
   * includes the system `status` column so migrate:create emits the
   * column on first sync, and migrate:check correctly detects drift
   * when this flag flips. Components don't carry status — leave unset.
   */
  status?: boolean;
  /**
   * Whether content-localization is enabled for this collection, single, OR component
   * (`defineCollection({ localized: true })` / `defineSingle` / `defineComponent`). When
   * true, fields resolved as translatable are omitted from the main-table desired snapshot
   * and relocated to the migration-owned companion `_locales` table (i18n Option B).
   */
  localized?: boolean;
}

export interface GenerateArgs {
  /** Slug-cased migration name (CLI's --name=<value>). */
  name: string;
  dialect: SupportedDialect;
  /** Absolute path to the `migrations/` directory. */
  migrationsDir: string;
  /** From `nextly.config.ts`. */
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  /**
   * UI-built metadata-row upserts (spec §4.12.7), keyed by data-table name.
   * Each is appended to the generated SQL when an operation touches its table.
   */
  metadataUpserts?: { tableName: string; sql: string }[];
  /**
   * Default locale for localized collections (from `config.localization.defaultLocale`).
   * Used as the `_locale` value when seeding existing rows into the companion table on
   * an enable transition. Defaults to `"en"` when omitted.
   */
  defaultLocale?: string;
  /** Skip interactive prompts (non-TTY / CI). */
  nonInteractive?: boolean;
  /** Only meaningful with nonInteractive=true. Default = decline. */
  autoAcceptRenames?: boolean;
  /**
   * Override the timestamp for tests. Production callers omit and get
   * `new Date()`.
   */
  now?: Date;
}

export interface GenerateResult {
  sqlPath: string;
  snapshotPath: string;
  /** Operation count AFTER rename collapsing. */
  operationCount: number;
  /** Number of rename candidates the operator confirmed. */
  renamesAccepted: number;
}

/** The table an operation acts on (for correlating metadata upserts). */
function operationTableName(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return op.table.name;
    case "rename_table":
      return op.toName;
    default:
      return op.tableName;
  }
}

/**
 * Run the migrate:create orchestration. Returns null if no operations
 * remain (config matches latest snapshot — exit code 2 in the CLI).
 */
export async function generateMigration(
  args: GenerateArgs
): Promise<GenerateResult | null> {
  const metaDir = resolve(args.migrationsDir, "meta");
  // Single clock for the whole run so the main file and its companions share a
  // deterministic base timestamp (companions get a strictly-later one below).
  const now = args.now ?? new Date();

  // 1. Load previous state.
  const previous = await loadLatestSnapshot(metaDir);
  const previousSnapshot = previous?.data.snapshot ?? EMPTY_SNAPSHOT;

  // 2. Build desired snapshot from config. Localized collections omit their
  //    translatable columns here (they live in the companion `_locales` table).
  const desiredSnapshot = buildDesiredSnapshotFromConfig(
    args.collections,
    args.singles,
    args.components,
    args.dialect
  );

  // 2a. Plan companion `_locales` migrations for localized collections, singles, AND
  //     components (i18n Option B: companions are migration-owned, emitted as
  //     snapshot-less .sql). All three derive their companion the same way — from the
  //     entity's table name — so a single planner call over the merged list covers them.
  const companionPlans = planCompanionMigrations(
    [...args.collections, ...args.singles, ...args.components],
    previousSnapshot,
    args.dialect,
    args.defaultLocale ?? "en"
  );

  // 3. Diff.
  let operations = diffSnapshots(previousSnapshot, desiredSnapshot);

  // 3a. On an ENABLE transition the diff wants to DROP the localized columns
  //     from the main table — but the companion migration already relocates them
  //     (create + seed + drop). Strip those drops so we don't drop twice.
  operations = stripRelocatedDrops(operations, companionPlans);

  const hasCompanions = companionPlans.length > 0;
  if (operations.length === 0 && !hasCompanions) {
    return null;
  }

  // 4-6. Rename detection + prompt + apply — only meaningful when the main table
  //      itself changed. A localization-only run has no main-table ops to rename.
  let decisions: RenameDecision[] = [];
  if (operations.length > 0) {
    const detector = new RegexRenameDetector();
    const candidates = detector.detect(operations, args.dialect);
    decisions = await promptRenames(candidates, {
      nonInteractive: args.nonInteractive,
      autoAccept: args.autoAcceptRenames,
    });
    operations = applyRenameDecisions(operations, decisions);
  }
  if (operations.length === 0 && !hasCompanions) {
    return null;
  }

  // 7. Generate UP SQL per op.
  const sqlStatements = operations.map(op => generateSQL(op, args.dialect));

  // 7a. Generate DOWN SQL by inverting the RESOLVED ops (renames preserved).
  // Inverting the resolved ops — not re-diffing — keeps a forward rename as a
  // reverse rename rather than a data-losing drop+add. Object-removing ops
  // recover their original spec from previousSnapshot.
  const inverseOps = buildInverseOperations(operations, previousSnapshot);
  const downSqlStatements = inverseOps.map(op => generateSQL(op, args.dialect));

  // 7b. Append UI metadata-row upserts for any touched UI-built table (§4.12.7).
  if (args.metadataUpserts && args.metadataUpserts.length > 0) {
    const touched = new Set(operations.map(operationTableName));
    for (const m of args.metadataUpserts) {
      if (touched.has(m.tableName)) sqlStatements.push(m.sql);
    }
  }

  // 8. Compose file content + write both files.
  const collectionSlugs = args.collections.map(c => c.slug).sort();
  const singleSlugs = args.singles.map(c => c.slug).sort();
  const componentSlugs = args.components.map(c => c.slug).sort();
  const sqlContent = formatMigrationFile({
    name: args.name,
    dialect: args.dialect,
    sqlStatements,
    downSqlStatements,
    collections: collectionSlugs,
    singles: singleSlugs,
    components: componentSlugs,
    hasUserExt: false, // F11 PR 3 doesn't model user_ext in migrate:create yet (out of scope).
    now,
  });

  const baseName = `${formatTimestamp(now)}_${slugify(args.name)}`;
  await mkdir(args.migrationsDir, { recursive: true });
  const sqlPath = resolve(args.migrationsDir, `${baseName}.sql`);
  await writeFile(sqlPath, sqlContent, "utf-8");

  const snapshotPath = await writeSnapshot(
    metaDir,
    baseName,
    desiredSnapshot,
    sqlContent
  );

  // 9. Emit the snapshot-less companion `.sql` files AFTER the main migration.
  //    A fresh companion's FK references the main table, so it must sort/run
  //    strictly after the main file — give each a timestamp a few ms later.
  companionPlans.forEach(({ spec, plan }, i) => {
    writeCompanionMigrationFile(args.migrationsDir, spec, {
      kind: plan.kind === "enable" ? "enable" : "create-only",
      upSql: plan.upSql,
      downSql: plan.downSql,
      now: new Date(now.getTime() + i + 1),
    });
  });

  return {
    sqlPath,
    snapshotPath,
    operationCount: operations.length,
    renamesAccepted: decisions.filter(d => d.accepted).length,
  };
}

/** A localized collection's derived companion spec paired with its planned migration. */
interface CompanionPlanEntry {
  spec: CompanionMigrationSpec;
  plan: CompanionMigrationPlan;
}

/**
 * Plan the companion `_locales` migration for every localized entity (collection, single, OR
 * component), comparing the previous committed snapshot's main table against the new localized
 * spec. All three share the same shape — a main table with an `id` PK — so the companion
 * (`<table>_locales`, FK → main.id) is derived identically from the entity's table name.
 *
 * The transition is derived purely from the previous snapshot (companions are NOT stored in
 * snapshots — they are migration-owned):
 *   - previous main table absent           → fresh entity  → create-only companion.
 *   - previous main table HELD the columns → enabling now  → create + seed + drop.
 *   - previous main table lacked them      → already localized → none (companion exists).
 */
function planCompanionMigrations(
  entities: MinimalConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  defaultLocale: string
): CompanionPlanEntry[] {
  const entries: CompanionPlanEntry[] = [];
  for (const c of entities) {
    // i18n H5 (known limitation): the DISABLE transition (localized `true → false`) is not
    // auto-migrated here. migrate:create compares the config against the previous committed
    // snapshot, which — by design — does not record companion `_locales` tables, so a former
    // companion cannot be reliably detected at this layer. A snapshot-only heuristic would
    // false-positive on the common "add fields to a non-localized collection" case and block
    // legitimate migrations, which is worse than the rare disable. Disabling localization
    // therefore leaves the companion data in place (not restored to main, not archived); the
    // archive/restore machinery exists (write-migration-file `direction:"disable"` +
    // buildLocalizationDownSql) and must currently be run manually. Wiring this safely needs the
    // migration snapshot to carry a per-collection `localized` marker — tracked as follow-up.
    if (c.localized !== true) continue;
    const spec = deriveCompanionSpec({
      slug: c.slug,
      dbName: c.tableName,
      fields: c.fields,
      dialect,
      defaultLocale,
      collectionLocalized: true,
      status: c.status === true, // i18n M6: companion gets a per-locale `_status` column
    });
    if (!spec) continue;

    const prevTable = previousSnapshot.tables.find(
      t => t.name === spec.mainTable
    );
    const prevMainColumnNames = prevTable
      ? prevTable.columns.map(col => col.name)
      : [];
    // If the table existed but the localized columns are already gone, a prior
    // migration created the companion → nothing to do (companionExisted).
    const hadLocalizedColumns = spec.columns.some(col =>
      prevMainColumnNames.includes(col.name)
    );
    const companionExisted = prevTable !== undefined && !hadLocalizedColumns;

    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames,
      companionExisted,
    });
    if (plan.kind !== "none") entries.push({ spec, plan });
  }
  return entries;
}

/**
 * Remove the main-table `drop_column` operations that a companion ENABLE migration already
 * performs (create + seed + drop). Without this, the localized columns would be dropped twice
 * — once by the main migration's diff, once by the companion — and the second drop fails.
 */
function stripRelocatedDrops(
  operations: Operation[],
  companionPlans: CompanionPlanEntry[]
): Operation[] {
  const relocated = new Set<string>();
  for (const { spec, plan } of companionPlans) {
    if (plan.kind !== "enable") continue; // create-only has no main-table drops
    for (const col of spec.columns) {
      relocated.add(`${spec.mainTable}::${col.name}`);
    }
  }
  if (relocated.size === 0) return operations;
  return operations.filter(
    op =>
      !(
        op.type === "drop_column" &&
        relocated.has(`${op.tableName}::${op.columnName}`)
      )
  );
}

/**
 * Build a NextlySchemaSnapshot from the config's collections + singles +
 * components. Each entity becomes a TableSpec via the shared
 * buildDesiredTableFromFields helper used by the apply pipeline — keeps
 * the desired-snapshot shape consistent across consumers.
 *
 * F11 PR 4: exported (was internal in PR 3) so `migrate:check` can build
 * the desired snapshot for the drift check without spinning up the full
 * generateMigration orchestrator.
 */
export function buildDesiredSnapshotFromConfig(
  collections: MinimalConfigEntity[],
  singles: MinimalConfigEntity[],
  components: MinimalConfigEntity[],
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  const tables: TableSpec[] = [];
  for (const c of collections) {
    // Why: forward the entity's Draft/Published flag so the snapshot
    // includes the system status column when enabled. Mirrors the same
    // forwarding pushschema-pipeline.ts already does for the diff path.
    // `localized` omits translatable columns (they live in the companion).
    tables.push(
      buildDesiredTableFromFields(c.tableName, c.fields, dialect, {
        hasStatus: c.status === true,
        localized: c.localized === true,
      })
    );
  }
  for (const c of singles) {
    // i18n: singles localize identically to collections — the companion is
    // `single_<slug>_locales` (deriveCompanionSpec derives it from the table name).
    // Omit translatable columns from the main table; the companion (planned below)
    // holds them.
    tables.push(
      buildDesiredTableFromFields(c.tableName, c.fields, dialect, {
        hasStatus: c.status === true,
        localized: c.localized === true,
      })
    );
  }
  for (const c of components) {
    // Components use the component builder (system columns _parent_id,
    // _parent_table, _parent_field, _order, _component_type — not the
    // collection slug/title), matching what the apply pipeline builds. Using
    // the collection builder here produced a snapshot that diverged from the
    // real component table and broke `migrate:resolve --applied`.
    // i18n: a localized component omits its translatable columns too — they live
    // in the companion `comp_<slug>_locales` (planned below).
    tables.push(
      buildDesiredTableFromComponentFields(c.tableName, c.fields, dialect, {
        localized: c.localized === true,
      })
    );
  }
  return { tables };
}

/**
 * Replace accepted (drop_column, add_column) pairs with a rename_column
 * op. Declined decisions and unmatched ops pass through unchanged.
 *
 * F11 PR 3 review fix #2: dedupe accepted decisions so each drop column
 * and each add column appears in at most one rename. Without this, the
 * rename detector's Cartesian product (N drops × N adds per table) plus
 * the per-candidate prompt loop could produce overlapping accepts —
 * e.g. accepting both (title→name) and (title→label) would emit two
 * RENAME COLUMN ops on the same source column, the second of which
 * fails at apply because `title` no longer exists.
 *
 * Strategy: first-acceptance-wins. Iterate accepted decisions in
 * detector-emit order; skip any whose drop column or add column has
 * already been claimed by a prior accept. The skipped decision's
 * drop+add ops stay in the operation list (treated as a normal drop+add)
 * — that's the safest fallback because the operator can re-run
 * migrate:create after editing the file if they wanted a different
 * pairing.
 */
function applyRenameDecisions(
  ops: Operation[],
  decisions: RenameDecision[]
): Operation[] {
  const accepted = decisions.filter(d => d.accepted);
  if (accepted.length === 0) return ops;

  // Index accepted candidates with first-acceptance-wins dedup.
  const acceptedDrops = new Set<string>();
  const acceptedAdds = new Set<string>();
  const effectiveAccepts: RenameDecision[] = [];
  for (const d of accepted) {
    const c = d.candidate;
    const dropKey = `${c.tableName}::${c.fromColumn}`;
    const addKey = `${c.tableName}::${c.toColumn}`;
    if (acceptedDrops.has(dropKey) || acceptedAdds.has(addKey)) {
      // Overlapping accept — skip. The drop+add ops stay in the
      // operation list and become a normal DROP+ADD pair.
      continue;
    }
    acceptedDrops.add(dropKey);
    acceptedAdds.add(addKey);
    effectiveAccepts.push(d);
  }

  // Filter out the matching drop_column / add_column pairs. TS narrows
  // `op` from the discriminated union via `op.type === "drop_column"`,
  // so no explicit cast is needed.
  const remaining: Operation[] = [];
  for (const op of ops) {
    if (op.type === "drop_column") {
      if (acceptedDrops.has(`${op.tableName}::${op.columnName}`)) {
        continue;
      }
    }
    if (op.type === "add_column") {
      if (acceptedAdds.has(`${op.tableName}::${op.column.name}`)) {
        continue;
      }
    }
    remaining.push(op);
  }

  // Append rename_column ops for each effective acceptance.
  for (const d of effectiveAccepts) {
    const c = d.candidate;
    const renameOp: RenameColumnOp = {
      type: "rename_column",
      tableName: c.tableName,
      fromColumn: c.fromColumn,
      toColumn: c.toColumn,
      fromType: c.fromType,
      toType: c.toType,
    };
    remaining.push(renameOp);
  }

  return remaining;
}

/**
 * Test seam: expose `applyRenameDecisions` for unit tests so we can
 * verify the rename-collapsing logic without spawning the full pipeline.
 */
export function applyRenameDecisionsForTest(
  ops: Operation[],
  decisions: RenameDecision[]
): Operation[] {
  return applyRenameDecisions(ops, decisions);
}

/**
 * Test seam for the candidate-detection step.
 */
export function buildDesiredSnapshotFromConfigForTest(
  collections: MinimalConfigEntity[],
  singles: MinimalConfigEntity[],
  components: MinimalConfigEntity[],
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  return buildDesiredSnapshotFromConfig(
    collections,
    singles,
    components,
    dialect
  );
}

export type { RenameCandidate };
