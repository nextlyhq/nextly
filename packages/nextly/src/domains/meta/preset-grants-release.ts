/**
 * The Nextly release that set the preset roles' grants.
 *
 * The presets are rules in the release (`auth/role-presets`), and two
 * releases can resolve them to different grants over the same permissions,
 * with no app migration between them to tell the two apart. So the database
 * records the newest release that set every preset role's grants, and a run
 * from an older release leaves them as they are rather than setting them back
 * to its own rules.
 *
 * Stored as one `nextly_meta` row, `{ release }`, written by `nextly migrate`
 * in the transaction that sets every preset role's grants and by nothing
 * else: a development start keeps setting the grants and neither reads nor
 * writes it. This module is the only one that spells the row's key, and the
 * one place that decides how a running release stands against it.
 *
 * @module domains/meta/preset-grants-release
 */
import { AsyncLocalStorage } from "node:async_hooks";

import semver from "semver";

import type { MetaService } from "./services/meta-service";

/** The `nextly_meta` key the release is stored under. */
const PRESET_GRANTS_RELEASE_KEY = "preset_grants_release";

/**
 * The release a stored value names, or undefined for anything that is not a
 * version: such a row is treated as no record and replaced by the next run
 * that sets the grants. Read whichever form the driver hands back, the
 * decoded object or its JSON text.
 */
function decodeRelease(raw: unknown): string | undefined {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { release } = value as Record<string, unknown>;
  return typeof release === "string" && semver.valid(release) !== null
    ? release
    : undefined;
}

/**
 * The recorded release, or undefined where none is recorded or the row holds
 * no version. On a transaction's `executor` with `lock`, the row is read
 * locked for update, so the decision taken from it holds until the
 * transaction ends.
 */
export async function readPresetGrantsRelease(
  meta: MetaService,
  executor?: unknown,
  options: { lock?: boolean } = {}
): Promise<string | undefined> {
  const entry = await meta.getEntry<unknown>(
    PRESET_GRANTS_RELEASE_KEY,
    executor,
    options
  );
  return entry.present ? decodeRelease(entry.value) : undefined;
}

/**
 * Record `release` on `executor`, the Drizzle handle of the transaction that
 * set every preset role's grants, so the record commits or rolls back with
 * them.
 */
export async function recordPresetGrantsRelease(
  meta: MetaService,
  executor: unknown,
  release: string
): Promise<void> {
  await meta.set(PRESET_GRANTS_RELEASE_KEY, { release }, executor);
}

/** What a run from the running release does with the preset grants. */
export type PresetGrantsStanding =
  /**
   * Set every preset role's grants. `record` is the release to record with
   * them, or undefined where the recorded one stays as it is.
   */
  | { kind: "set"; record: string | undefined }
  /** Leave every preset role's grants as they are: `recorded` is newer. */
  | { kind: "leave"; recorded: string };

/**
 * How the running release stands against the recorded one. Versions compare
 * by semantic version, so `0.10.0` is newer than `0.9.0` and a prerelease is
 * older than its release. Only an older release leaves the grants; the same
 * release sets them and records nothing new, and a newer one sets them and
 * records itself, so the record keeps the newest release seen. A running
 * release that is not a version cannot be placed against a recorded one, so
 * it leaves the grants where there is a record, and records nothing.
 */
export function presetGrantsStanding(
  recorded: string | undefined,
  running: string
): PresetGrantsStanding {
  const runningValid = semver.valid(running) !== null;
  if (recorded === undefined) {
    return { kind: "set", record: runningValid ? running : undefined };
  }
  if (!runningValid) return { kind: "leave", recorded };
  const order = semver.compare(running, recorded);
  if (order < 0) return { kind: "leave", recorded };
  return { kind: "set", record: order > 0 ? running : undefined };
}

/** A run that records the release with the preset grants it sets. */
export interface PresetGrantsRecording {
  /** The running Nextly release. */
  readonly release: string;
  /** The recorded release, where the run left the grants to it. */
  leftTo?: string;
}

const recording = new AsyncLocalStorage<PresetGrantsRecording>();

/**
 * Run `run` with the preset seeding inside it recording `release` with the
 * grants it sets, in the same transaction, and leaving them as they are
 * where a newer release is recorded (`seedRolePresets`). Returns what `run`
 * returned, and the recorded release where the grants were left to it.
 *
 * A scope rather than a parameter: the seeding is reached through the
 * permission seeding a start shares, which takes no such option, and a
 * development start, outside any scope, keeps setting the grants without
 * reading or writing the record.
 */
export async function withPresetGrantsRecorded<T>(
  release: string,
  run: () => Promise<T>
): Promise<{ result: T; leftTo: string | undefined }> {
  const scope: PresetGrantsRecording = { release };
  const result = await recording.run(scope, run);
  return { result, leftTo: scope.leftTo };
}

/** The recording scope the calling flow is in, or undefined outside one. */
export function presetGrantsRecording(): PresetGrantsRecording | undefined {
  return recording.getStore();
}
