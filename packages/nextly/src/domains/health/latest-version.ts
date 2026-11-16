/**
 * Whether the running Nextly is the newest release in its channel, for System
 * health.
 *
 * ## The channel is the installed version's own
 *
 * A prerelease compares with the npm dist-tag its identifier names
 * (`0.0.2-alpha.73` with `alpha`), and a stable version with `latest`. A
 * newer release on another channel is never an update to this one: an alpha
 * site is not told to move to a stable line, nor a stable site to an alpha.
 *
 * ## It never says "latest" without a read that succeeded
 *
 * The registry is read once, with a short timeout, and the answer is kept for
 * a while (a failure for less long, so a site that comes back online learns
 * soon). A read that fails, times out, answers something that is not the
 * registry's shape, or names no tag for the channel is `"unknown"`, which the
 * card shows as "Couldn't check for updates" and counts as nothing.
 *
 * The read sends nothing about the site: an anonymous GET of one public
 * document.
 *
 * @module domains/health/latest-version
 */

import semver from "semver";
import { z } from "zod";

import { processHeld } from "../widgets/process-held";

import type { LatestVersion } from "./health-types";

export type { LatestVersion } from "./health-types";

/** Where the `nextly` package's dist-tags are read. */
export const DIST_TAGS_URL =
  "https://registry.npmjs.org/-/package/nextly/dist-tags";

/** How long one read may take before it is given up as unknown. */
const LATEST_VERSION_TIMEOUT_MS = 3_000;

/** How long an answer the registry gave is kept. */
const ANSWER_KEPT_MS = 60 * 60 * 1000;

/** How long a failed read is kept before the registry is asked again. */
const FAILURE_KEPT_MS = 10 * 60 * 1000;

/** What the registry answers: each dist-tag and the version it names. */
const DistTags = z.record(z.string(), z.string());

/**
 * The dist-tag a version's channel is published under: its prerelease
 * identifier (`alpha` for `0.0.2-alpha.73`), or `latest` for a stable
 * version. `undefined` for a string that is not a version.
 */
export function releaseChannel(version: string): string | undefined {
  const parsed = semver.parse(version);
  if (parsed === null) return undefined;
  const [identifier] = parsed.prerelease;
  if (identifier === undefined) return "latest";
  return typeof identifier === "string" ? identifier : undefined;
}

/**
 * The installed version against the channel's tag, from tags the registry
 * answered. Unknown when the version has no channel or the channel no tag.
 */
export function compareWithChannel(
  installed: string,
  tags: Readonly<Record<string, string>>
): LatestVersion {
  const channel = releaseChannel(installed);
  if (channel === undefined || !Object.hasOwn(tags, channel)) {
    return { status: "unknown" };
  }
  const newest = tags[channel];
  if (semver.valid(newest) === null) return { status: "unknown" };
  // A build newer than the tag (a release being published, a local build) is
  // not behind anything.
  return semver.gte(installed, newest)
    ? { status: "latest", version: installed }
    : { status: "update", version: newest };
}

/**
 * How the registry is reached: `fetch`, the clock the cache is kept by, and
 * how long a read may take ({@link LATEST_VERSION_TIMEOUT_MS} unless given).
 */
export interface LatestVersionDeps {
  fetch: typeof globalThis.fetch;
  now: () => number;
  timeoutMs?: number;
}

/** The registry's tags, or `undefined` when the read did not succeed in time. */
async function readDistTags(
  deps: LatestVersionDeps
): Promise<Record<string, string> | undefined> {
  try {
    const response = await deps.fetch(DIST_TAGS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? LATEST_VERSION_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const parsed = DistTags.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The kept answer, and the read in flight, for the whole process. */
interface Kept {
  tags?: Record<string, string>;
  /** When the kept answer, or kept failure, stops being used. */
  until?: number;
  inFlight?: Promise<Record<string, string> | undefined>;
}

const kept = processHeld(
  "nextly.health.latestVersion",
  (): Kept => ({}),
  (held): held is Kept => typeof held === "object" && held !== null
);

/** Forgets the kept answer, so the next call reads the registry. */
export function forgetLatestVersion(): void {
  delete kept.tags;
  delete kept.until;
  delete kept.inFlight;
}

/**
 * The installed version against its channel's newest release, from the
 * registry's dist-tags, read at most once per period and shared by every
 * caller while a read is in flight.
 */
export async function readLatestVersion(
  installed: string,
  deps: LatestVersionDeps = { fetch: globalThis.fetch, now: Date.now }
): Promise<LatestVersion> {
  if (kept.until === undefined || deps.now() >= kept.until) {
    kept.inFlight ??= readDistTags(deps).then(tags => {
      kept.tags = tags;
      kept.until =
        deps.now() + (tags === undefined ? FAILURE_KEPT_MS : ANSWER_KEPT_MS);
      delete kept.inFlight;
      return tags;
    });
    await kept.inFlight;
  }
  return kept.tags === undefined
    ? { status: "unknown" }
    : compareWithChannel(installed, kept.tags);
}
