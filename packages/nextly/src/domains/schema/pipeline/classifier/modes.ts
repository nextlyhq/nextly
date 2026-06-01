/**
 * Mode-aware classification of a schema diff (spec §4.6.1).
 *
 * Three named modes decide whether each operation runs:
 *   - dev-additive    (HMR boot-apply): apply additive ops, skip+warn destructive.
 *   - dev-loose       (db:sync):        apply everything.
 *   - production-strict (migrate Phase 1): refuse if any destructive op is present.
 *
 * "Destructive" = the set the gate refuses/skips: drops, type changes,
 * NOT-NULL on existing rows, and additive columns that are NOT NULL with no
 * default (would fail at apply time). Matches the legacy `classifyForCodeFirst`
 * detection, generalized over the three modes.
 *
 * @module domains/schema/pipeline/classifier/modes
 * @since v0.0.3-alpha (Plan C2)
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";

export type ClassifierMode = "dev-additive" | "dev-loose" | "production-strict";

export type ClassifyResult =
  | { verdict: "apply"; applied: Operation[]; skipped: Operation[] }
  | { verdict: "refuse"; reasons: string[] };

/** True for operations the gate refuses (production-strict) / skips (dev-additive). */
function isDestructive(op: Operation): boolean {
  switch (op.type) {
    case "drop_table":
    case "drop_column":
    case "change_column_type":
      return true;
    case "change_column_nullable":
      // Adding NOT NULL to an existing column fails on rows without a value.
      return op.toNullable === false;
    case "add_column":
      // A NOT NULL column with no default fails at apply time.
      return op.column.nullable === false && op.column.default == null;
    default:
      return false;
  }
}

function reasonFor(op: Operation): string {
  switch (op.type) {
    case "drop_table":
      return `drops table '${op.tableName}'`;
    case "drop_column":
      return `drops column '${op.tableName}.${op.columnName}'`;
    case "change_column_type":
      return `changes column '${op.tableName}.${op.columnName}' type from '${op.fromType}' to '${op.toType}'`;
    case "change_column_nullable":
      return `adds NOT NULL to column '${op.tableName}.${op.columnName}' (would fail on existing rows)`;
    case "add_column":
      return `adds NOT NULL column '${op.tableName}.${op.column.name}' with no default (would fail on existing rows)`;
    default:
      return `operation '${op.type}'`;
  }
}

/**
 * Classify a diff for the given mode. `_dialect` is accepted for parity with
 * the diff/classifier API (per-dialect nuance may be added later).
 */
export function classifyForMode(
  operations: Operation[],
  _dialect: SupportedDialect,
  mode: ClassifierMode
): ClassifyResult {
  if (operations.length === 0) {
    return { verdict: "apply", applied: [], skipped: [] };
  }

  switch (mode) {
    case "dev-loose":
      return { verdict: "apply", applied: [...operations], skipped: [] };

    case "dev-additive": {
      const applied: Operation[] = [];
      const skipped: Operation[] = [];
      for (const op of operations) {
        (isDestructive(op) ? skipped : applied).push(op);
      }
      return { verdict: "apply", applied, skipped };
    }

    case "production-strict": {
      const reasons = operations.filter(isDestructive).map(reasonFor);
      if (reasons.length > 0) return { verdict: "refuse", reasons };
      return { verdict: "apply", applied: [...operations], skipped: [] };
    }

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unsupported classifier mode: ${String(_exhaustive)}`);
    }
  }
}
