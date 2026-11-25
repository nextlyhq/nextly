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

/**
 * What the version history's password removal repairs (`UpgradeStep.group`): the values pending
 * changes and versions hold, which a step splitting or comparing them reads (`UpgradeStep.reads`).
 */
const VERSION_SNAPSHOTS = "version snapshots";

/**
 * What each localisation step repairs (`UpgradeStep.group`), and so which later counts wait for it
 * (`UpgradeStep.reads`). Every step reads the codes the conversion writes. The values move reads
 * the main tables, the translations tables and their transition records, which keying the pending
 * changes never touches, so it waits for the conversion alone. The draft split reads the keys, the
 * values it is split against and what pending changes hold (`VERSION_SNAPSHOTS`), which the version
 * history's password removal changes; the dating and the archive list read every step before them.
 */
const LOCALISATION_CODES = "localisation codes";
const PENDING_CHANGE_KEYS = "pending change keys";
const VALUES_PER_LANGUAGE = "values per language";
const PENDING_CHANGE_PARTS = "pending change parts";
const TRANSLATION_DATES = "translation dates";
/** Every group the localisation steps repair. */
const LOCALISATION = [
  LOCALISATION_CODES,
  PENDING_CHANGE_KEYS,
  VALUES_PER_LANGUAGE,
  PENDING_CHANGE_PARTS,
  TRANSLATION_DATES,
] as const;

/** Hashing the passwords an earlier release stored as given. */
const storedPasswordsStep: UpgradeStep = {
  title: "hash passwords stored before this release",
  pending: async context =>
    (await import("./stored-passwords")).storedPasswordsWork.pending(context),
  run: async context =>
    (await import("./stored-passwords")).storedPasswordsWork.run(context),
};

/** Removing the passwords an earlier release kept in version history. */
export const versionPasswordsStep: UpgradeStep = {
  group: VERSION_SNAPSHOTS,
  title: "remove passwords kept in version history",
  pending: async context =>
    (await import("./version-passwords")).versionPasswordsWork.pending(context),
  run: async context =>
    (await import("./version-passwords")).versionPasswordsWork.run(context),
};

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
  group: LOCALISATION_CODES,
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
  group: PENDING_CHANGE_KEYS,
  reads: [LOCALISATION_CODES, PENDING_CHANGE_KEYS],
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
  group: VALUES_PER_LANGUAGE,
  reads: [LOCALISATION_CODES, VALUES_PER_LANGUAGE],
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
  group: PENDING_CHANGE_PARTS,
  // It splits and compares the values pending changes hold, which the password removal changes.
  reads: [
    LOCALISATION_CODES,
    PENDING_CHANGE_KEYS,
    VALUES_PER_LANGUAGE,
    PENDING_CHANGE_PARTS,
    VERSION_SNAPSHOTS,
  ],
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
  group: TRANSLATION_DATES,
  reads: LOCALISATION,
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
  reads: LOCALISATION,
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
