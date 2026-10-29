/**
 * The steps of `nextly upgrade`, in the order they run.
 *
 * Each brings one part of an existing database up to date, and each is
 * idempotent (see `UpgradeStep` in `../upgrade-step.ts`). A new step is a
 * module in this folder exporting an `UpgradeStep`, added to the end of this
 * list: each step is counted and run before the next is counted, so a later
 * step sees what the earlier ones repaired and needs no other knowledge of
 * them. A step whose work loads much is declared here instead, loading its
 * module only when the upgrade asks it: every module this list imports loads
 * with the CLI, and with every test of it.
 *
 * @module cli/commands/upgrade-steps
 */

import type { UpgradeStep } from "../upgrade-step";

import { schemaEventsStep } from "./schema-events";
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

export const UPGRADE_STEPS: readonly UpgradeStep[] = [
  schemaEventsStep,
  storedPasswordsStep,
  versionPasswordsStep,
  retiredManageStep,
];
