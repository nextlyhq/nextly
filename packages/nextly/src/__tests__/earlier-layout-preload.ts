/**
 * Loaded with `--import` into a CLI child a test starts (`runNextly`), before the CLI itself, when
 * the test file runs on the earlier layout (`storage-layout`): it puts the child on that layout
 * through the same test-only hook, so a command run as a shell runs it lays tables out as the
 * suite expects, and runs `nextly migrate` without the localisation data steps. Test-only: under `__tests__`, outside the published package, and reached by no
 * configuration or environment variable. A child started without it runs per-language storage,
 * as every installation does.
 *
 * @module __tests__/earlier-layout-preload
 */
import {
  LOCALISATION_DATA_STEPS,
  MIGRATE_DATA_STEPS,
} from "../cli/commands/upgrade-steps";
import type { UpgradeStep } from "../cli/commands/upgrade-step";
import { setPerLanguageStorage } from "../domains/i18n/per-language-storage";

setPerLanguageStorage(false);
// And `nextly migrate` without the localisation data steps, as an older suite ran it on dev before
// they existed (`storage-layout`'s `migrateDataStepsView`, for a child): this process ends with the
// command, so nothing is left for anyone after it.
const steps = MIGRATE_DATA_STEPS as UpgradeStep[];
for (let index = steps.length - 1; index >= 0; index--) {
  if (LOCALISATION_DATA_STEPS.includes(steps[index]!)) steps.splice(index, 1);
}
