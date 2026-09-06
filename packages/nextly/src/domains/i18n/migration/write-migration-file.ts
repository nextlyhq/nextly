import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { entityHeaderLine } from "../../schema/migrate-create/format-file";

import { buildLocalizationDownSql } from "./generate-down";
import { buildLocalizationUpSql } from "./generate-up";
import { formatLocalizationIntent } from "./migration-intent";
import type { I18nTransitionKind } from "./transition-state";
import type { CompanionMigrationSpec } from "./types";

/** UTC `YYYYMMDD_HHMMSS_mmm` (matches format-file.ts `formatTimestamp`). */
function formatTimestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}_${p(
      d.getUTCMilliseconds(),
      3
    )}`
  );
}

export interface WriteLocalizationMigrationOpts {
  /** `enable` moves data into the companion; `disable` restores + archives + drops. */
  direction: "enable" | "disable";
  /** injectable clock for deterministic file names in tests. */
  now: Date;
}

/**
 * Writes a raw `.sql` migration (UP + DOWN) into `migrationsDir` with **no** paired
 * `meta/<name>.snapshot.json`, so the file-migration runner executes it **verbatim**
 * (see `migrate.ts` `runFileMigrations`, the snapshot-less branch) — the only path that
 * runs the cross-table `INSERT ... SELECT` the localization backfill needs.
 *
 * The enable/disable directions are inverses, so `disable` simply swaps UP/DOWN.
 *
 * @returns the absolute path of the written `.sql` file.
 */
/**
 * Header marker stamped on every localization/companion migration. These files
 * are snapshot-less by design (they carry cross-table seed SQL run verbatim), so
 * migrate:check uses this marker to skip the snapshot-pairing checks instead of
 * flagging them MISSING_SNAPSHOT.
 */
export const LOCALIZATION_MIGRATION_MARKER = "-- Generated: localization";

export function writeLocalizationMigrationFile(
  migrationsDir: string,
  spec: CompanionMigrationSpec,
  opts: WriteLocalizationMigrationOpts
): string {
  const enableUp = buildLocalizationUpSql(spec);
  const enableDown = buildLocalizationDownSql(spec);
  const up = opts.direction === "enable" ? enableUp : enableDown;
  const down = opts.direction === "enable" ? enableDown : enableUp;

  const slug = `${opts.direction}_localization_${spec.collection}`;
  const baseName = `${formatTimestamp(opts.now)}_${slug}`;
  const header =
    `-- Migration: ${baseName}\n` +
    `-- Collections: ${spec.collection}\n` +
    `${LOCALIZATION_MIGRATION_MARKER} ${opts.direction} (i18n)\n`;
  const content = `${header}\n-- UP\n${up}\n\n-- DOWN\n${down}\n`;

  const path = resolve(migrationsDir, `${baseName}.sql`);
  writeFileSync(path, content, "utf-8");
  return path;
}

export interface WriteCompanionMigrationOpts {
  /**
   * `enable` = create+seed+drop; `create-only` = bare CREATE for a fresh collection;
   * `disable` = restore default onto main + archive other languages + drop the companion.
   */
  kind: "enable" | "create-only" | "disable";
  /**
   * Which kind of entity the companion belongs to. Recorded because the transition marker is
   * keyed by kind as well as slug — a collection, a single and a field group may share a slug,
   * and the file has to name which one it is about.
   */
  entity: I18nTransitionKind;
  /** Pre-planned UP SQL (from `planCompanionMigration`). */
  upSql: string;
  /** Pre-planned DOWN SQL (from `planCompanionMigration`). */
  downSql: string;
  /** injectable clock for deterministic file names in tests. */
  now: Date;
}

/**
 * Write a snapshot-less companion `.sql` migration from a pre-planned
 * `planCompanionMigration` result. Like {@link writeLocalizationMigrationFile}, it writes
 * **no** paired `meta/<name>.snapshot.json` so the file-migration runner executes it
 * verbatim (the only path that runs the cross-table `INSERT ... SELECT` seed).
 *
 * Callers (migrate:create) pass the UP/DOWN SQL the planner produced so the file's shape
 * matches the planned transition (create-only vs enable) exactly.
 *
 * @returns the absolute path of the written `.sql` file.
 */
export function writeCompanionMigrationFile(
  migrationsDir: string,
  spec: CompanionMigrationSpec,
  opts: WriteCompanionMigrationOpts
): string {
  const verb =
    opts.kind === "enable"
      ? "enable"
      : opts.kind === "disable"
        ? "disable"
        : "create";
  const slug = `${verb}_localization_${spec.collection}`;
  const baseName = `${formatTimestamp(opts.now)}_${slug}`;
  // The statements below are one route to the goal — the right one for a database that has had
  // nothing done to it yet. Recording the goal itself lets the apply path choose a different route
  // when the target database has already come part of the way.
  const header =
    `-- Migration: ${baseName}\n` +
    // Named by KIND. A single or a field group filed under `-- Collections:`
    // is read into the wrong set, and the sweep that asks whether this entity
    // is still waiting looks in its own kind's set and finds nothing.
    `${entityHeaderLine(opts.entity, spec.collection)}\n` +
    `${LOCALIZATION_MIGRATION_MARKER} companion (${opts.kind}) (i18n)\n` +
    `${formatLocalizationIntent({ kind: opts.kind, entity: opts.entity, spec })}\n`;
  const content = `${header}\n-- UP\n${opts.upSql}\n\n-- DOWN\n${opts.downSql}\n`;

  const path = resolve(migrationsDir, `${baseName}.sql`);
  writeFileSync(path, content, "utf-8");
  return path;
}
