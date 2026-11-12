/**
 * How long a schema change waits for a table another database session is using: one try's bound
 * and the total bound of every try together.
 *
 * Both are whole seconds. One try runs from 1 to 3,600, which every database can hold (MySQL's
 * `lock_wait_timeout` takes whole seconds only, from 1). The total runs from the one try's value to
 * 86,400. The command line (`--lock-timeout`, `--lock-timeout-total`) wins over the environment
 * (`NEXTLY_LOCK_TIMEOUT`, `NEXTLY_LOCK_TIMEOUT_TOTAL`), bound by bound, and both win over the
 * defaults of 5 and 90 seconds. A value outside its range is refused before anything changes, on
 * every database alike; no value turns the bound off.
 *
 * These bound only the wait for a busy table, never the wait for the schema lock itself, which has
 * its own minute.
 *
 * @module domains/schema/busy-table/bounds
 */
import { NextlyError } from "../../../errors/nextly-error";

import {
  DEFAULT_TOTAL_SECONDS,
  DEFAULT_TRY_SECONDS,
  MAX_TOTAL_SECONDS,
  MAX_TRY_SECONDS,
} from "./bounds-values";

/** One try's bound and the total, in milliseconds. */
export interface BusyTableBounds {
  readonly tryMs: number;
  readonly totalMs: number;
}

/** About 5 seconds a try, about 90 in all: seven tries with the pauses between them. */
export const DEFAULT_BUSY_TABLE_BOUNDS: BusyTableBounds = {
  tryMs: DEFAULT_TRY_SECONDS * 1000,
  totalMs: DEFAULT_TOTAL_SECONDS * 1000,
};

/** A whole number of seconds as an operator types it: digits only, no sign, point or exponent. */
const WHOLE_SECONDS = /^[0-9]+$/;

/** The command-line values, as commander hands them over: strings, or absent. */
export interface BusyTableFlags {
  readonly lockTimeout?: string;
  readonly lockTimeoutTotal?: string;
}

/** Where a value came from, as the refusal names it. */
interface Source {
  readonly name: string;
  readonly value: string;
}

/** The flag's value where it was given, else the environment's, else undefined. */
function sourceOf(
  flag: string | undefined,
  flagName: string,
  env: NodeJS.ProcessEnv,
  envName: string
): Source | undefined {
  if (flag !== undefined) return { name: flagName, value: flag };
  const fromEnv = env[envName];
  return fromEnv === undefined ? undefined : { name: envName, value: fromEnv };
}

/** `source`'s value in seconds, refused unless it is a whole number from `min` to `max`. */
function seconds(
  source: Source,
  min: number,
  max: number,
  range: string
): number {
  const value = WHOLE_SECONDS.test(source.value)
    ? Number(source.value)
    : Number.NaN;
  if (Number.isSafeInteger(value) && value >= min && value <= max) return value;
  throw NextlyError.invalidInput({
    message:
      `${source.name} is ${JSON.stringify(source.value)}, which is not a whole number of seconds ` +
      `from ${range}. It bounds the wait for a busy table, not for the schema lock. Nothing was ` +
      "changed.",
    logContext: { reason: "busy-table-bound-invalid", setting: source.name },
  });
}

/**
 * The bounds a schema change waits for a busy table with, from `flags` over `env` over the
 * defaults. Throws `INVALID_INPUT` for a value outside its range, before anything has changed.
 */
export function busyTableBounds(input: {
  flags?: BusyTableFlags;
  env: NodeJS.ProcessEnv;
}): BusyTableBounds {
  const { flags = {}, env } = input;
  const trySource = sourceOf(
    flags.lockTimeout,
    "--lock-timeout",
    env,
    "NEXTLY_LOCK_TIMEOUT"
  );
  const trySeconds =
    trySource === undefined
      ? DEFAULT_TRY_SECONDS
      : seconds(
          trySource,
          1,
          MAX_TRY_SECONDS,
          `1 to ${String(MAX_TRY_SECONDS)}`
        );
  const totalSource = sourceOf(
    flags.lockTimeoutTotal,
    "--lock-timeout-total",
    env,
    "NEXTLY_LOCK_TIMEOUT_TOTAL"
  );
  const totalRange = `${String(trySeconds)} (one try) to ${String(MAX_TOTAL_SECONDS)}`;
  const totalSeconds =
    totalSource === undefined
      ? // A one try set past the default total, with no total given, raises the total to match:
        // one long try runs. A total given below the one try is still refused.
        Math.max(DEFAULT_TOTAL_SECONDS, trySeconds)
      : seconds(totalSource, trySeconds, MAX_TOTAL_SECONDS, totalRange);
  return { tryMs: trySeconds * 1000, totalMs: totalSeconds * 1000 };
}
