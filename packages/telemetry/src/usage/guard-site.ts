import { isMarkerSet, personOffVariable, type Env } from "./env-flags.js";

// When a running Nextly site stays off. Kept apart from the tools' guard on
// purpose: that guard treats Vercel, Netlify and Render as deploy builds,
// which would silence every hosted site. A site sends while its "Share
// anonymous usage data" switch is on, unless a person's variable is set on
// the server, and never under a test runner or with `CI` set, so the
// project's own test runs and the team's CI never count as a site.
//
// The switch is passed in: this package knows nothing of a site's database.

/**
 * Variables test runners set in the processes they start. `NODE_ENV=test` is
 * checked as well.
 */
export const TEST_RUNNER_MARKERS: readonly string[] = [
  "VITEST",
  "VITEST_WORKER_ID",
  "JEST_WORKER_ID",
  "TEST_WORKER_INDEX",
];

/** Why a site is off, as a fixed reason. */
export type SiteOffReason =
  | "DO_NOT_TRACK"
  | "NEXTLY_TELEMETRY_DISABLED"
  | "switch-off"
  | "test-runner"
  | "ci";

export type SiteDecision =
  | { on: true; reason: null }
  | { on: false; reason: SiteOffReason };

export interface SiteGuardInput {
  /** The server's environment. */
  env: Env;
  /** The site's "Share anonymous usage data" switch. */
  switchOn: boolean;
}

function isTestRun(env: Env): boolean {
  if (env.NODE_ENV?.trim().toLowerCase() === "test") return true;
  return TEST_RUNNER_MARKERS.some(name => isMarkerSet(env[name]));
}

/**
 * Decides whether a site may send. A server variable is named first, since
 * it locks the switch in the admin and the admin names the variable.
 */
export function resolveSiteUsage(input: SiteGuardInput): SiteDecision {
  const { env, switchOn } = input;
  const variable = personOffVariable(env);
  if (variable) return { on: false, reason: variable };
  if (!switchOn) return { on: false, reason: "switch-off" };
  if (isTestRun(env)) return { on: false, reason: "test-runner" };
  if (isMarkerSet(env.CI)) return { on: false, reason: "ci" };
  return { on: true, reason: null };
}
