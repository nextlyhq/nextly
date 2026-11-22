/**
 * The step of `nextly i18n:convert-zoned-dates` converting each translated date column an earlier release made with a
 * time zone on PostgreSQL (`findZonedDateColumns`) to a plain `timestamp`, as the main table keeps
 * a date, each value keeping the date Nextly showed.
 *
 * A command of its own rather than a step of `nextly migrate`, which runs before the new release serves:
 * an instance of an earlier release still running writes a date in a non-default language as its
 * own local time, and a converted column would keep that shifted. The command is run once the release
 * serves every instance. Run again, it finds nothing to convert.
 *
 * @module cli/commands/upgrade-steps/zoned-dates
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  convertZonedDateColumns,
  findZonedDateColumns,
} from "../../../domains/i18n/runtime/zoned-date-companions";
import type { UpgradeStepContext } from "../upgrade-step";

/** The CLI hands every step its DrizzleAdapter, which reads the registry and the catalog. */
const adapterOf = (context: UpgradeStepContext) =>
  context.adapter as unknown as DrizzleAdapter;

/** How many translated date columns are still to convert. */
export async function zonedDatesToConvert(
  context: UpgradeStepContext
): Promise<number> {
  return (await findZonedDateColumns(adapterOf(context))).length;
}

/** Converts them, logging each column and the time zone its values were read in. */
export async function convertZonedDates(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = adapterOf(context);
  return convertZonedDateColumns(
    adapter,
    await findZonedDateColumns(adapter),
    context.log
  );
}
