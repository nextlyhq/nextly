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

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { buildDesiredTableFromFields } from "../pipeline/diff/build-from-fields.js";
import { diffSnapshots } from "../pipeline/diff/diff.js";
import type {
  NextlySchemaSnapshot,
  Operation,
  RenameColumnOp,
  TableSpec,
} from "../pipeline/diff/types.js";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces.js";
import { RegexRenameDetector } from "../pipeline/rename-detector.js";
import { generateSQL } from "../pipeline/sql-templates/index.js";

import {
  formatMigrationFile,
  formatTimestamp,
  slugify,
} from "./format-file.js";
import { promptRenames, type RenameDecision } from "./prompt-renames.js";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  writeSnapshot,
} from "./snapshot-io.js";

/**
 * Minimal field shape we read from `nextly.config.ts`. Mirrors the
 * MinimalFieldDef in build-from-fields.ts.
 */
export interface MinimalConfigField {
  name: string;
  type: string;
  required?: boolean;
}

/**
 * Minimal collection / single / component shape we read from
 * `nextly.config.ts`. The full ConfigCollection has many more
 * attributes; we only need slug + tableName + fields for diffing.
 */
export interface MinimalConfigEntity {
  slug: string;
  tableName: string;
  fields: MinimalConfigField[];
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

/**
 * Run the migrate:create orchestration. Returns null if no operations
 * remain (config matches latest snapshot — exit code 2 in the CLI).
 */
export async function generateMigration(
  args: GenerateArgs
): Promise<GenerateResult | null> {
  const metaDir = resolve(args.migrationsDir, "meta");

  // 1. Load previous state.
  const previous = await loadLatestSnapshot(metaDir);
  const previousSnapshot = previous?.data.snapshot ?? EMPTY_SNAPSHOT;

  // 2. Build desired snapshot from config.
  const desiredSnapshot = buildDesiredSnapshotFromConfig(
    args.collections,
    args.singles,
    args.components,
    args.dialect
  );

  // 3. Diff.
  let operations = diffSnapshots(previousSnapshot, desiredSnapshot);
  if (operations.length === 0) {
    return null;
  }

  // 4. Rename detection.
  const detector = new RegexRenameDetector();
  const candidates = detector.detect(operations, args.dialect);

  // 5. Prompt.
  const decisions = await promptRenames(candidates, {
    nonInteractive: args.nonInteractive,
    autoAccept: args.autoAcceptRenames,
  });

  // 6. Apply rename decisions.
  operations = applyRenameDecisions(operations, decisions);
  if (operations.length === 0) {
    return null;
  }

  // 7. Generate SQL per op.
  const sqlStatements = operations.map(op => generateSQL(op, args.dialect));

  // 8. Compose file content + write both files.
  const collectionSlugs = args.collections.map(c => c.slug).sort();
  const singleSlugs = args.singles.map(c => c.slug).sort();
  const componentSlugs = args.components.map(c => c.slug).sort();
  const sqlContent = formatMigrationFile({
    name: args.name,
    dialect: args.dialect,
    sqlStatements,
    collections: collectionSlugs,
    singles: singleSlugs,
    components: componentSlugs,
    hasUserExt: false, // F11 PR 3 doesn't model user_ext in migrate:create yet (out of scope).
    now: args.now,
  });

  const baseName = `${formatTimestamp(args.now ?? new Date())}_${slugify(args.name)}`;
  await mkdir(args.migrationsDir, { recursive: true });
  const sqlPath = resolve(args.migrationsDir, `${baseName}.sql`);
  await writeFile(sqlPath, sqlContent, "utf-8");

  const snapshotPath = await writeSnapshot(
    metaDir,
    baseName,
    desiredSnapshot,
    sqlContent
  );

  return {
    sqlPath,
    snapshotPath,
    operationCount: operations.length,
    renamesAccepted: decisions.filter(d => d.accepted).length,
  };
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
    tables.push(buildDesiredTableFromFields(c.tableName, c.fields, dialect));
  }
  for (const c of singles) {
    tables.push(buildDesiredTableFromFields(c.tableName, c.fields, dialect));
  }
  for (const c of components) {
    tables.push(buildDesiredTableFromFields(c.tableName, c.fields, dialect));
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
