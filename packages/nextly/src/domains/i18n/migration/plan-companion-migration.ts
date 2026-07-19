import { buildLocalizationDownSql } from "./generate-down";
import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpSql,
} from "./generate-up";
import type { CompanionMigrationSpec } from "./types";

/** The shape of a planned companion migration. */
export interface CompanionMigrationPlan {
  /**
   * - `enable`: the previous main table held the localized columns → seed the companion from
   *   them and drop them from main (M1's create+seed+drop). Reversible.
   * - `create-only`: a fresh localized collection whose main table never held the columns →
   *   just CREATE the companion (no seed, no drop). Reversible.
   * - `none`: the companion already exists / nothing to relocate → emit nothing.
   */
  kind: "enable" | "create-only" | "none";
  upSql: string;
  downSql: string;
}

export interface PlanCompanionArgs {
  spec: CompanionMigrationSpec;
  /** Column names present on the main table in the PREVIOUS committed snapshot. */
  prevMainColumnNames: string[];
  /** Whether the companion table already existed in the previous snapshot. */
  companionExisted: boolean;
}

/**
 * Decide the companion migration shape for a localized collection, comparing the previous
 * snapshot against the new localized spec. Pure — no DB access. The `downSql` reverses the
 * companion creation (drop it), restoring the main columns for the enable case.
 */
export function planCompanionMigration(
  args: PlanCompanionArgs
): CompanionMigrationPlan {
  const { spec, prevMainColumnNames, companionExisted } = args;

  if (companionExisted) {
    return { kind: "none", upSql: "", downSql: "" };
  }

  const prev = new Set(prevMainColumnNames);
  // Enable transition: the previous main table carried the localized columns and they need
  // relocating (seed + drop). If none of the localized columns were on the previous main
  // table, this is a fresh localized collection → create-only.
  const hadLocalizedColumns = spec.columns.some(c => prev.has(c.name));

  if (hadLocalizedColumns) {
    return {
      kind: "enable",
      upSql: buildLocalizationUpSql(spec),
      downSql: buildLocalizationDownSql(spec),
    };
  }

  return {
    kind: "create-only",
    upSql: buildCompanionCreateOnlySql(spec),
    // Reverse of a bare CREATE is a DROP TABLE (no data to restore — main never had it).
    downSql: `DROP TABLE ${spec.dialect === "mysql" ? `\`${spec.companionTable}\`` : `"${spec.companionTable}"`};`,
  };
}
