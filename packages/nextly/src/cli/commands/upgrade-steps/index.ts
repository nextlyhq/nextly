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


/** Bringing each configured language code's rows into its standard form. */
const localisationCodesStep: UpgradeStep = {
  title: "convert language codes to their standard form",
  pending: async context =>
    (await import("./localisation-codes")).codesToConvert(context),
  run: async context =>
    (await import("./localisation-codes")).convertLanguageCodes(context),
  report: async context =>
    (await import("./localisation-codes")).codesReport(context),
};

/** Giving every pending change its key, keeping the later of two saves in one language. */
const localisationKeysStep: UpgradeStep = {
  title: "give every pending change its key",
  pending: async context =>
    (await import("./localisation-keys")).draftsToKey(context),
  run: async context =>
    (await import("./localisation-keys")).keyPendingChanges(context),
  report: async context =>
    (await import("./localisation-keys")).draftKeysReport(context),
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

/** Dating every translation with no stamp from its language's version history. */
const localisationStampsStep: UpgradeStep = {
  title: "date translations from their version history",
  pending: async context =>
    (await import("./localisation-stamps")).entitiesToStamp(context),
  run: async context =>
    (await import("./localisation-stamps")).stampTranslations(context),
  report: async context =>
    (await import("./localisation-stamps")).stampsReport(context),
};

/** Listing the archived translations no entity can be found for: nothing to change, only to check. */
const localisationArchiveStep: UpgradeStep = {
  title: "list archived translations of no known entity",
  pending: () => Promise.resolve(0),
  run: () => Promise.resolve(0),
  report: async context =>
    (await import("./localisation-archive")).unclaimedArchiveReport(context),
};

/**
 * The steps bringing an earlier release's content into the localisation model, in the order they
 * must run: codes first, so every later step reads and writes the standard code; pending changes
 * keyed before they are split, so the split sees one draft per language; values moved before the
 * drafts are split against them; translations dated last, from the history the steps before left.
 */
export const LOCALISATION_DATA_STEPS: readonly UpgradeStep[] = [
  localisationCodesStep,
  localisationKeysStep,
  localisationValuesStep,
  localisationDraftsStep,
  localisationStampsStep,
  localisationArchiveStep,
];

/** The steps `nextly migrate` runs once its migrations have applied, in order. */
export const MIGRATE_DATA_STEPS: readonly UpgradeStep[] = [
  storedPasswordsStep,
  versionPasswordsStep,
  retiredManageStep,
  // After the migrations, so the version history has every column the localisation steps write.
  ...LOCALISATION_DATA_STEPS,
];
