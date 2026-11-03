/**
 * The one-time step that keeps an existing site on the spacing it was built
 * with.
 *
 * Container gaps replaced the margins blocks used to carry, which moves every
 * page a site already has. So a site that had content before that change is
 * recorded once as `classic`, which compiles its pages exactly as before, and a
 * site with nothing yet is recorded as `gaps`, the model new sites start on.
 * Either way the answer is written once and never again by this step: content
 * added later does not change it, and an owner's choice is never replaced (see
 * `spacing-mode-store` for why the single insert guarantees both).
 *
 * ## What counts as an existing site
 *
 * Any page, component or Layout, drafts included, except the Layout the
 * default-Layout seed created: the boot seeds one on a fresh site, so counting
 * it would call every new site an existing one. The seed is known by the id
 * the settings Single records, never by name.
 *
 * That record is written after the seed is created, so between the two another
 * instance's seed is a Layout nothing names yet. When a Layout is the only
 * content found and the settings record no seed, the step decides nothing and
 * writes nothing (`deferred`); its own sweep job runs it again on every jobs
 * pass, and decides once the default-Layout repair has recorded the seed. Pages and components are never seeded, so either one
 * decides at once.
 *
 * @module spacing-mode-at-start
 */
import type { SpacingMode } from "@nextlyhq/blocks-engine";
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import { readLayoutSettings } from "./default-layout/store";
import type { SpacingModeStore } from "./spacing-mode-store";

/** The RESOLVED slugs the step reads: a host may rename any of them. */
export interface SpacingModeSlugs {
  readonly pages: string;
  readonly components: string;
  readonly layouts: string;
  /** The default-Layout settings Single, which records the seed's id. */
  readonly settings: string;
}

/** What the step needs. */
export interface SpacingModeAtStartDeps {
  readonly nextly: Pick<Nextly, "find" | "findSingle">;
  readonly store: Pick<SpacingModeStore, "read" | "adoptIfUnset">;
  readonly slugs: SpacingModeSlugs;
}

/** What the site is, for the one decision this step makes. */
export type SiteVerdict = "existing" | "fresh" | "undecided";

/**
 * What one run did. `kept`: a model was already recorded, by an earlier run or
 * by the owner, or another instance recorded one while this run decided.
 * `classic` / `gaps`: this run recorded that model. `deferred`: nothing could
 * be decided yet, and nothing was written.
 */
export type SpacingModeOutcome = "kept" | "deferred" | SpacingMode;

/**
 * The model each decided verdict records: the one replaceable step that says
 * WHAT is written. An existing site keeps the spacing it was built with; a
 * fresh one starts on container gaps.
 */
export function spacingModeFor(
  verdict: Exclude<SiteVerdict, "undecided">
): SpacingMode {
  return verdict === "existing" ? "classic" : "gaps";
}

/** The run in flight in this process, which a concurrent caller joins. */
let inFlight: Promise<SpacingModeOutcome> | null = null;

/**
 * Record the site's spacing model if none is recorded yet, by the rule in the
 * module docblock.
 *
 * Within one process, a run started while another is in flight waits for that
 * one's answer: the boot and the sweep can start together. Between processes
 * the store's single insert is what holds.
 */
export function settleSpacingModeAtStart(
  deps: SpacingModeAtStartDeps
): Promise<SpacingModeOutcome> {
  if (inFlight !== null) return inFlight;
  const run = settleSpacingModeOnce(deps).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/**
 * One run, not joined with any other: read, decide, and record with one
 * insert. What two processes each run; within a process, call
 * {@link settleSpacingModeAtStart}.
 */
export async function settleSpacingModeOnce(
  deps: SpacingModeAtStartDeps
): Promise<SpacingModeOutcome> {
  // Most runs end here: every boot after the first finds the row.
  if ((await deps.store.read()) !== null) return "kept";
  const verdict = await siteVerdict(deps);
  if (verdict === "undecided") return "deferred";
  const mode = spacingModeFor(verdict);
  // Refused when another instance or the owner recorded one meanwhile, and
  // then that one stands.
  return (await deps.store.adoptIfUnset(mode)) ? mode : "kept";
}

/** Whether a collection holds any row but `exceptId`, drafts included. */
async function holdsAny(
  nextly: SpacingModeAtStartDeps["nextly"],
  collection: string,
  exceptId: string | null = null
): Promise<boolean> {
  const found = await nextly.find({
    collection,
    ...(exceptId === null ? {} : { where: { id: { not_equals: exceptId } } }),
    status: "all",
    limit: 1,
    depth: 0,
    // Existence is the whole answer; no column of the row is read.
    select: { id: true },
    overrideAccess: true,
  });
  return found.items.length > 0;
}

/**
 * Whether the site already had content: pages and components first, since
 * neither is ever seeded, then Layouts other than the recorded seed.
 */
export async function siteVerdict(
  deps: Pick<SpacingModeAtStartDeps, "nextly" | "slugs">
): Promise<SiteVerdict> {
  const { nextly, slugs } = deps;
  if (await holdsAny(nextly, slugs.pages)) return "existing";
  if (await holdsAny(nextly, slugs.components)) return "existing";
  const { seededLayout } = await readLayoutSettings(nextly, {
    layouts: slugs.layouts,
    settings: slugs.settings,
  });
  const otherLayout = await holdsAny(nextly, slugs.layouts, seededLayout);
  if (!otherLayout) return "fresh";
  // A Layout with no seed recorded may be a seed another instance created and
  // has not recorded yet: undecided until the record lands.
  return seededLayout === null ? "undecided" : "existing";
}

/** The sweep that retries the step until a model is recorded. */
const SPACING_MODE_JOB = "page-builder:spacing-mode";

/**
 * The step as a sweep, so a run the boot could not finish, or one that had to
 * defer, is tried again on every jobs pass without a timer of its own. Once a
 * model is recorded each pass is one indexed read.
 *
 * A job of its own rather than a step of the default-Layout sweep, so a
 * failure in either leaves the other running. The deps are resolved per run,
 * for the reason the default-Layout job gives: the Direct API is not
 * resolvable when the job is defined.
 */
export function spacingModeJob(
  deps: () => Promise<SpacingModeAtStartDeps>
): JobDefinition {
  return defineJob({
    slug: SPACING_MODE_JOB,
    sweep: true,
    handler: async () => {
      await settleSpacingModeAtStart(await deps());
    },
  });
}

/**
 * Run the step once the boot has finished, never throwing: a throw from
 * `onReady` fails the boot, and the sweep runs the same step on every jobs
 * pass, so a run that could not happen here is not lost.
 */
export async function settleSpacingModeAfterBoot(
  deps: () => Promise<SpacingModeAtStartDeps>,
  warn: (message: string, meta?: Record<string, unknown>) => void
): Promise<void> {
  try {
    await settleSpacingModeAtStart(await deps());
  } catch (error) {
    warn(
      "[page-builder] the site's spacing model could not be recorded at start; the jobs sweep will try again",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}
