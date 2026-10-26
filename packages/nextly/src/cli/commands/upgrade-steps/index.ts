/**
 * The steps of `nextly upgrade`, in the order they run.
 *
 * Each brings one part of an existing database up to date, and each is
 * idempotent (see `UpgradeStep` in `../upgrade-step.ts`). A new step is a
 * module in this folder exporting an `UpgradeStep`, added to the end of this
 * list: the upgrade asks every step what it would change before running any,
 * so a step needs no knowledge of the others.
 *
 * @module cli/commands/upgrade-steps
 */

import type { UpgradeStep } from "../upgrade-step";

import { schemaEventsStep } from "./schema-events";
import { storedPasswordsStep } from "./stored-passwords";

export const UPGRADE_STEPS: readonly UpgradeStep[] = [
  schemaEventsStep,
  storedPasswordsStep,
];
