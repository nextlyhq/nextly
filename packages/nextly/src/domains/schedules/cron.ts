/**
 * Cron expressions, read in a time zone.
 *
 * @module domains/schedules/cron
 * @experimental
 */
import { NextlyError } from "../../errors";

/** A parsed five-field cron expression. */
export interface CronExpression {
  /** The expression as written. */
  readonly source: string;
}

/** Parse `source`. */
export function parseCron(source: string): CronExpression {
  throw NextlyError.validation({
    errors: [
      {
        path: "cron",
        code: "invalid_cron",
        message: `Not read yet: ${source}`,
      },
    ],
  });
}

/** Whether `name` is a time zone this runtime knows. */
export function isTimeZone(_name: string): boolean {
  return false;
}

/** The first time `cron` fires after `after`, in `timeZone`. */
export function nextFireAfter(
  _cron: CronExpression,
  _after: Date,
  _timeZone = "UTC"
): Date | null {
  return null;
}

/** The latest time `cron` fired at or before `at`, in `timeZone`. */
export function latestFireAtOrBefore(
  _cron: CronExpression,
  _at: Date,
  _timeZone = "UTC"
): Date | null {
  return null;
}
