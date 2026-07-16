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
   * - `disable`: the entity was localized in the previous snapshot and is not anymore →
   *   restore the default locale onto main, archive the other languages, drop the companion
   *   (spec §5.3, locked decision #6). Reversible (its DOWN re-enables).
   * - `none`: the companion already exists / nothing to relocate → emit nothing.
   */
  kind: "enable" | "create-only" | "disable" | "none";
  upSql: string;
  downSql: string;
}

export interface PlanCompanionArgs {
  spec: CompanionMigrationSpec;
  /** Column names present on the main table in the PREVIOUS committed snapshot. */
  prevMainColumnNames: string[];
  /** Whether the companion table already existed in the previous snapshot. */
  companionExisted: boolean;
  /**
   * i18n H5 — whether the entity is localized in the NEW config. Defaults to `true` (the
   * historical behavior: this planner was only ever called for localized entities).
   */
  localized?: boolean;
  /**
   * i18n H5 — whether the PREVIOUS committed snapshot explicitly recorded this entity as
   * localized (`TableSpec.localized === true`). Only an explicit `true` here can produce a
   * DISABLE plan, so a pre-marker snapshot (undefined) never triggers a destructive
   * transition.
   */
  previouslyLocalized?: boolean;
}

/**
 * Decide the companion migration shape for a collection, comparing the previous snapshot
 * against the new localized spec. Pure — no DB access. The `downSql` reverses the `upSql`,
 * so every plan is rollback-able.
 */
export function planCompanionMigration(
  args: PlanCompanionArgs
): CompanionMigrationPlan {
  const { spec, prevMainColumnNames, companionExisted } = args;
  const localized = args.localized ?? true;

  // i18n H5 — DISABLE (spec §5.3): localization was on and is now off. The transition is
  // gated on the previous snapshot's explicit marker, never inferred from column shape,
  // because "the main table gained columns" is also what a plain field-add looks like.
  if (!localized) {
    if (args.previouslyLocalized !== true) {
      return { kind: "none", upSql: "", downSql: "" };
    }
    return {
      // UP restores the default locale onto main, archives non-default translations into
      // `nextly_i18n_archive`, then drops the companion. DOWN is the inverse (re-enable).
      kind: "disable",
      upSql: buildLocalizationDownSql(spec),
      downSql: buildLocalizationUpSql(spec),
    };
  }

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
