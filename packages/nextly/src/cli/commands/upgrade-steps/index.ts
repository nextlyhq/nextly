/**
 * The steps over data an earlier release stored: those `nextly migrate` runs
 * once its migrations have applied, in the order they run, and the one
 * `nextly i18n:convert-zoned-dates` runs.
 *
 * Each brings one part of an existing database up to date, and each is
 * idempotent (see `UpgradeStep` in `../upgrade-step.ts`). A new step is a
 * module in this folder exporting an `UpgradeStep`, added to the end of
 * `MIGRATE_DATA_STEPS`: each step is counted and run before the next is counted, so a later
 * step sees what the earlier ones repaired and needs no other knowledge of
 * them. A step whose work loads much is declared here instead, loading its
 * module only when a run asks it: every module this list imports loads
 * with the CLI, and with every test of it.
 *
 * @module cli/commands/upgrade-steps
 */

import type { UpgradeStep } from "../upgrade-step";

import { storedPasswordsStep } from "./stored-passwords";
import { versionPasswordsStep } from "./version-passwords";

/** Converting roles that hold a retired `manage-` permission. */
const retiredManageStep: UpgradeStep = {
  title: "give roles holding a retired manage permission the plain permissions",
  pending: async context =>
    (await import("./retired-manage")).rolesToConvert(context),
  run: async context =>
    (await import("./retired-manage")).convertRoles(context),
};

/**
 * Converting translated date columns an earlier release made with a time
 * zone: the one step of `nextly i18n:convert-zoned-dates`, run once the
 * release serves every instance, and so never by `nextly migrate`.
 */
export const zonedDatesStep: UpgradeStep = {
  title: "convert translated date columns kept with a time zone",
  pending: async context =>
    (await import("./zoned-dates")).zonedDatesToConvert(context),
  run: async context =>
    (await import("./zoned-dates")).convertZonedDates(context),
};

/** The steps `nextly migrate` runs once its migrations have applied, in order. */
export const MIGRATE_DATA_STEPS: readonly UpgradeStep[] = [
  storedPasswordsStep,
  versionPasswordsStep,
  retiredManageStep,
];
