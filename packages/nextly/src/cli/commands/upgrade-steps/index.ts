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

/** Converting translated date columns an earlier release made with a time zone. */
const zonedDatesStep: UpgradeStep = {
  title: "convert translated date columns kept with a time zone",
  pending: async context =>
    (await import("./zoned-dates")).zonedDatesToConvert(context),
  run: async context =>
    (await import("./zoned-dates")).convertZonedDates(context),
};

/** Storing every entity's translatable values per language. */
const localisationValuesStep: UpgradeStep = {
  title: "store translatable values per language",
  pending: async context =>
    (await import("./localisation-values")).entitiesWithValuesToMove(context),
  run: async context =>
    (await import("./localisation-values")).moveValuesPerLanguage(context),
  report: async context =>
    (await import("./localisation-values")).valuesMoveReport(context),
};

/** Keeping every pending change by part, split against what is live. */
const localisationDraftsStep: UpgradeStep = {
  title: "split pending changes into shared and language drafts",
  pending: async context =>
    (await import("./localisation-drafts")).documentsWithDraftsToSplit(context),
  run: async context =>
    (await import("./localisation-drafts")).splitDraftsByPart(context),
  report: async context =>
    (await import("./localisation-drafts")).draftsSplitReport(context),
};

export const UPGRADE_STEPS: readonly UpgradeStep[] = [
  schemaEventsStep,
  storedPasswordsStep,
  versionPasswordsStep,
  retiredManageStep,
  zonedDatesStep,
  localisationValuesStep,
  localisationDraftsStep,
];
