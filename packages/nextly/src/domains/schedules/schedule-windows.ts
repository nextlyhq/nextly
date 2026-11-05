/**
 * A plugin schedule's windows.
 *
 * @module domains/schedules/schedule-windows
 * @experimental
 */
import type { CollectedSchedule } from "./collect-schedules";

/** What a jobs pass asks of the schedules. */
export interface ScheduleWindows {
  sweep(now: Date): Promise<void>;
  prune(before: Date, limit: number): Promise<number>;
}

/** The windows of `schedules`. */
export function scheduleWindows(
  _db: unknown,
  _schedules: readonly CollectedSchedule[],
  _options: { enqueue?: (...args: never[]) => Promise<{ id: string }> } = {}
): ScheduleWindows {
  return { sweep: () => Promise.resolve(), prune: () => Promise.resolve(0) };
}
