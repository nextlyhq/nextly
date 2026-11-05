/**
 * The schedules plugins declare, collected for the jobs pass.
 *
 * @module domains/schedules/collect-schedules
 * @experimental
 */
import type { CollectedJob } from "../../plugins/jobs/collect-jobs";
import type { PluginDefinition } from "../../plugins/plugin-context";

import type { CronExpression } from "./cron";

/** One schedule, read and checked. */
export interface CollectedSchedule {
  readonly key: string;
  readonly plugin: string;
  readonly slug: string;
  readonly cron: CronExpression;
  readonly timeZone: string;
  readonly job: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Collect every enabled plugin's schedules. */
export function collectSchedules(
  _plugins: readonly PluginDefinition[],
  _jobs: readonly CollectedJob[]
): CollectedSchedule[] {
  return [];
}
