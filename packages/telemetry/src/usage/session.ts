import { detectArch, detectOs, detectPackageManager } from "../environment.js";

import { detectAgent, type DetectAgentOptions } from "./agent.js";
import { nodeMajor } from "./builders.js";
import {
  type SITE_ROLES,
  CATALOG_VERSION,
  DISTINCT_ID_PATTERNS,
  type ToolsSource,
  type UsageEventFor,
  type UsageEventProperties,
  type UsageSource,
} from "./catalog.js";
import { isSwitchedOn, type Env } from "./env-flags.js";
import { resolveSiteUsage, type SiteDecision } from "./guard-site.js";
import { resolveToolsUsage, type ToolsDecision } from "./guard-tools.js";
import { createSender, type UsageProject, type WireEvent } from "./sender.js";
import { basePropertiesFor, checkEvent } from "./validate.js";

// A run's usage data, from the guard's decision to the last flush. The
// decision is made once, when the session opens, from the environment and the
// stored setting alone, before anything could open a connection. A session
// that is off never creates a sender, so nothing in it can reach the network.
//
// Each event gets the base properties of its source here, never from the
// caller, and is checked against the catalog before it is queued.
//
// `NEXTLY_TELEMETRY_DEBUG=1` prints each event that would be sent and sends
// nothing: to standard error from the installer and the CLI, to the server
// log from a site. `NEXTLY_TELEMETRY_PROJECT=test` marks the run's events for
// the test project.

export interface UsageSession<E extends string, D> {
  /** Whether usage data is on for this run, and if not, which rule said so. */
  readonly decision: D;
  capture<K extends E & UsageEventFor<UsageSource>>(
    event: K,
    properties: UsageEventProperties<K>
  ): void;
  /** Sends what was captured. At most 2 seconds; never rejects. */
  flush(): Promise<void>;
}

interface CommonOptions {
  /** The running Nextly version (the installer's own, in the installer). */
  nextlyVersion: string;
  /** Defaults to `process.env`. */
  env?: Env;
  /** For tests: the ingest address. */
  endpoint?: string;
  /** For tests: the network call. */
  fetch?: typeof fetch;
  /** For tests: a shorter send budget. */
  timeoutMs?: number;
  /** Where debug mode prints. Defaults by source (see above). */
  debugWrite?: (line: string) => void;
  /** For tests: the clock. */
  now?: () => Date;
}

export interface ToolsUsageOptions<S extends ToolsSource = ToolsSource>
  extends CommonOptions {
  /** Which tool runs: its session accepts only that tool's events. */
  source: S;
  /** The machine's random id (`readMachineUsage().anonymousId`). */
  distinctId: string;
  /** The machine's own setting (`readMachineUsage().enabled`). */
  machineEnabled: boolean;
  /** For tests: agent detection's file check. */
  agentFileExists?: DetectAgentOptions["fileExists"];
}

export interface SiteUsageOptions extends CommonOptions {
  /** The site's random site ID. */
  siteId: string;
  /** The site's role. */
  role: (typeof SITE_ROLES)[number];
  /** The site's "Share anonymous usage data" switch. */
  switchOn: boolean;
}

export type ToolsUsageSession<S extends ToolsSource = ToolsSource> =
  UsageSession<UsageEventFor<S>, ToolsDecision>;
export type SiteUsageSession = UsageSession<
  UsageEventFor<"site">,
  SiteDecision
>;

/** The line debug mode prints for one event. */
function debugLine(event: string, properties: object): string {
  return `nextly usage data (debug, not sent): ${event} ${JSON.stringify(properties)}`;
}

function inertSession<D>(decision: D): UsageSession<never, D> {
  return {
    decision,
    capture() {
      // Off: nothing is recorded, so nothing can be sent.
    },
    flush: () => Promise.resolve(),
  };
}

function liveSession<E extends string, D>(
  source: UsageSource,
  decision: D,
  distinctId: string,
  base: Record<string, unknown>,
  opts: CommonOptions,
  defaultDebugWrite: (line: string) => void
): UsageSession<E, D> {
  const env = opts.env ?? process.env;
  const debug = isSwitchedOn(env.NEXTLY_TELEMETRY_DEBUG);
  const debugWrite = opts.debugWrite ?? defaultDebugWrite;
  const project: UsageProject =
    env.NEXTLY_TELEMETRY_PROJECT?.trim().toLowerCase() === "test"
      ? "test"
      : "production";
  // Debug mode never creates a sender, so it cannot send by mistake.
  const sender = debug
    ? null
    : createSender({
        project,
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
  const now = opts.now ?? (() => new Date());
  // A machine's id from the tools, a site's from a site: never the other.
  const validId = new RegExp(
    DISTINCT_ID_PATTERNS[source === "site" ? "site" : "tools"]
  ).test(distinctId);
  // Every base property is the session's alone: a caller's value for one, even
  // an optional one the session left out (`agent` on a person's run), is
  // dropped rather than merged.
  const baseSpec = basePropertiesFor(source);
  const baseKeys = new Set([
    ...Object.keys(baseSpec.required),
    ...Object.keys(baseSpec.optional),
  ]);

  return {
    decision,
    capture(event, properties) {
      if (!validId) return;
      // Plain JavaScript can pass anything; only an object has properties.
      if (typeof properties !== "object" || properties === null) return;
      const own = Object.fromEntries(
        Object.entries(properties).filter(([key]) => !baseKeys.has(key))
      );
      const checked = checkEvent(source, event, { ...own, ...base });
      if (!checked) return;
      if (!sender) {
        debugWrite(debugLine(event, checked));
        return;
      }
      const wire: WireEvent = {
        event,
        distinct_id: distinctId,
        properties: checked,
        timestamp: now().toISOString(),
      };
      sender.enqueue(wire);
    },
    flush: () => (sender ? sender.flush() : Promise.resolve()),
  };
}

/** Opens the installer's or the CLI's usage data for one run. */
export function openToolsUsage<S extends ToolsSource>(
  opts: ToolsUsageOptions<S>
): ToolsUsageSession<S> {
  const env = opts.env ?? process.env;
  const decision = resolveToolsUsage({
    env,
    machineEnabled: opts.machineEnabled,
  });
  if (!decision.on) return inertSession(decision);

  const runBy = detectAgent(
    env,
    opts.agentFileExists ? { fileExists: opts.agentFileExists } : {}
  );
  const base: Record<string, unknown> = {
    source: opts.source,
    catalog_version: CATALOG_VERSION,
    nextly_version: opts.nextlyVersion,
    run_by: runBy.run_by,
    ...(runBy.agent ? { agent: runBy.agent } : {}),
    os: detectOs(),
    arch: detectArch(),
    package_manager: detectPackageManager(env),
    node_major: nodeMajor(process.versions.node),
  };
  return liveSession(opts.source, decision, opts.distinctId, base, opts, line =>
    process.stderr.write(`${line}\n`)
  );
}

/** Opens a running site's usage data. */
export function openSiteUsage(opts: SiteUsageOptions): SiteUsageSession {
  const env = opts.env ?? process.env;
  const decision = resolveSiteUsage({ env, switchOn: opts.switchOn });
  if (!decision.on) return inertSession(decision);

  const base: Record<string, unknown> = {
    source: "site",
    catalog_version: CATALOG_VERSION,
    nextly_version: opts.nextlyVersion,
    role: opts.role,
  };
  return liveSession("site", decision, opts.siteId, base, opts, line =>
    console.log(line)
  );
}
