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
 * A site whose configuration states a model (`pageBuilder({ siteStyle: {
 * spacingMode } })`) has chosen already: the step records nothing, and the
 * configured model applies until an owner chooses one under Design.
 *
 * ## What counts as an existing site
 *
 * Any block document, wherever it lives: a row of any collection that holds a
 * blocks field the builder opens, drafts included, whether the collection is
 * the plugin's (pages, components, patterns), the host's code or one built in
 * the Schema Builder; a Single of that kind that stores a non-empty blocks
 * document, live or as its working draft; or a Layout. Which collections and
 * Singles hold blocks is read from the same registry survey the editor's
 * style route asks, so the two cannot come to disagree about where blocks
 * live. Each collection costs one query of one row: an entry is one row
 * whatever languages it has content in, so its existence answers for all of
 * them. A Single is one document per language, so it is read in each of the
 * site's configured languages, live and as its working draft.
 *
 * The Layout the default-Layout seed created does not count: the boot seeds
 * one on a fresh site, so counting it would call every new site an existing
 * one. The seed is known by the id the settings Single records, never by name.
 *
 * That record is written after the seed is created, so between the two another
 * instance's seed is a Layout nothing names yet. When a Layout is the only
 * content found and the settings record no seed, the step decides nothing and
 * writes nothing (`deferred`); its own sweep job runs it again on every jobs
 * pass, and decides once the default-Layout repair has recorded the seed. Any
 * other block document is never seeded, so it decides at once.
 *
 * @module spacing-mode-at-start
 */
import { isSpacingMode, type SpacingMode } from "@nextlyhq/blocks-engine";
import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import { readLayoutSettings } from "./default-layout/store";
import type { SpacingModeStore } from "./spacing-mode-store";
import { storedValuesAt } from "./stored-blocks-values";
import { readStoredJson } from "./stored-json";

/** The RESOLVED slugs the step reads: a host may rename either. */
export interface SpacingModeSlugs {
  readonly layouts: string;
  /** The default-Layout settings Single, which records the seed's id. */
  readonly settings: string;
}

/**
 * Where the site's block documents may live, by the registry's survey: each
 * collection holding a blocks field the builder opens, and each such Single
 * with the form paths of its blocks fields (`hero.body`).
 */
export interface BlocksSurvey {
  readonly collections: readonly string[];
  /**
   * The site's configured languages, empty when it is not localized. A
   * Single is read in each, since its document may exist in one alone.
   */
  readonly locales: readonly string[];
  readonly singles: readonly {
    readonly slug: string;
    readonly paths: readonly string[];
  }[];
}

/** What the step needs. */
export interface SpacingModeAtStartDeps {
  readonly nextly: Pick<Nextly, "find" | "findSingle">;
  readonly store: Pick<SpacingModeStore, "read" | "adoptIfUnset">;
  readonly slugs: SpacingModeSlugs;
  /** Where block documents may live, asked once per run that has to decide. */
  readonly survey: () => Promise<BlocksSurvey>;
  /**
   * The model the host's configuration states, when it states one: the
   * site's choice, so the step records nothing.
   */
  readonly configured?: SpacingMode;
  /**
   * Expire the cached pages that read the site style, once a model is
   * recorded: a page cached before the step ran was drawn under no model.
   */
  readonly expire?: () => Promise<void>;
}

/**
 * The model the host's configuration states (`pageBuilder({ siteStyle: {
 * spacingMode } })`), or `undefined` when it states none or a value that is
 * not a model.
 */
export function configuredSpacingMode(
  siteStyle: { readonly spacingMode?: unknown } | undefined
): SpacingMode | undefined {
  const stated = siteStyle?.spacingMode;
  return isSpacingMode(stated) ? stated : undefined;
}

/** What the site is, for the one decision this step makes. */
export type SiteVerdict = "existing" | "fresh" | "undecided";

/**
 * What one run did. `kept`: a model was already recorded, by an earlier run or
 * by the owner, or another instance recorded one while this run decided.
 * `classic` / `gaps`: this run recorded that model. `deferred`: nothing could
 * be decided yet, and nothing was written. `configured`: the host's
 * configuration states a model, so nothing was read or written.
 */
export type SpacingModeOutcome =
  | "kept"
  | "deferred"
  | "configured"
  | SpacingMode;

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

/** The run in flight in this process, or `null` when none is. */
export function spacingModeRunInFlight(): Promise<SpacingModeOutcome> | null {
  return inFlight;
}

/**
 * The longest a read waits for a decision in flight before answering without
 * one. The decision's own queries are bounded (one row per collection, two
 * reads per Single and language), so this only stops a stalled database from
 * holding a page render for good.
 */
const SPACING_DECISION_WAIT_MS = 30_000;

/**
 * The recorded model, waiting for a decision this process is making when
 * none is recorded yet.
 *
 * On an existing site's first start the step runs after the boot, unawaited,
 * and a page can be rendered before it has recorded `classic`: read alone,
 * that render sees no model, draws container gaps and may be cached. So a
 * read that finds no model and a decision `pending` waits for it (bounded by
 * {@link SPACING_DECISION_WAIT_MS}) and reads again. A decision that fails,
 * or none pending, leaves the answer as it was: no model.
 */
export async function readJoiningDecision(
  store: Pick<SpacingModeStore, "read">,
  pending: () => PromiseLike<unknown> | null,
  waitMs: number = SPACING_DECISION_WAIT_MS
): Promise<SpacingMode | null> {
  const recorded = await store.read();
  if (recorded !== null) return recorded;
  const decision = pending();
  if (decision === null) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.resolve(decision).then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return store.read();
}

/**
 * One run, not joined with any other: read, decide, and record with one
 * insert. What two processes each run; within a process, call
 * {@link settleSpacingModeAtStart}.
 */
export async function settleSpacingModeOnce(
  deps: SpacingModeAtStartDeps
): Promise<SpacingModeOutcome> {
  // A configured model is the site's choice; recording an inferred one would
  // replace it, since a stored model outranks the configured tier.
  if (deps.configured !== undefined) return "configured";
  // Most runs end here: every boot after the first finds the row.
  if ((await deps.store.read()) !== null) return "kept";
  const verdict = await siteVerdict(deps);
  if (verdict === "undecided") return "deferred";
  const mode = spacingModeFor(verdict);
  // Refused when another instance or the owner recorded one meanwhile, and
  // then that one stands.
  if (!(await deps.store.adoptIfUnset(mode))) return "kept";
  await deps.expire?.();
  return mode;
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

/** Whether a stored blocks value is a document holding at least one block. */
function holdsBlocks(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { nodes } = value as { nodes?: unknown };
  return Array.isArray(nodes) && nodes.length > 0;
}

/**
 * Whether a Single stores a non-empty blocks document at any of `paths`, in
 * its live document or its working draft, in any of `locales` (or the one
 * document of a site that is not localized). Bounded: two reads per locale.
 * Read without creating a missing document, so asking never writes one.
 */
async function singleHoldsBlocks(
  nextly: SpacingModeAtStartDeps["nextly"],
  slug: string,
  paths: readonly string[],
  locales: readonly string[]
): Promise<boolean> {
  const languages: readonly (string | undefined)[] =
    locales.length === 0 ? [undefined] : locales;
  for (const locale of languages) {
    for (const draft of [false, true]) {
      const doc: unknown = await nextly.findSingle({
        slug,
        depth: 0,
        status: "all",
        ...(locale === undefined ? {} : { locale }),
        ...(draft ? { draft: true } : {}),
        overrideAccess: true,
        createIfMissing: false,
      });
      // Every row's value, for a field inside a repeater's rows.
      if (paths.some(path => storedValuesAt(doc, path).some(holdsBlocks))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether the site already had content: a block document in any collection
 * or Single the survey names, then Layouts other than the recorded seed.
 */
export async function siteVerdict(
  deps: Pick<SpacingModeAtStartDeps, "nextly" | "slugs" | "survey">
): Promise<SiteVerdict> {
  const { nextly, slugs } = deps;
  const survey = await deps.survey();
  for (const collection of survey.collections) {
    // Layouts are asked below, where the seed is left out. No locale: an
    // entry's row exists whatever languages its content is in.
    if (collection === slugs.layouts) continue;
    if (await holdsAny(nextly, collection)) return "existing";
  }
  for (const single of survey.singles) {
    if (
      await singleHoldsBlocks(nextly, single.slug, single.paths, survey.locales)
    ) {
      return "existing";
    }
  }
  const { seededLayout } = await readLayoutSettings(nextly, {
    layouts: slugs.layouts,
    settings: slugs.settings,
  });
  const otherLayout = await holdsAny(nextly, slugs.layouts, seededLayout);
  if (!otherLayout) return "fresh";
  if (seededLayout !== null) return "existing";
  // No seed recorded: the Layout may be a seed another instance created and
  // has not recorded yet, which waits for that record. Only what such a seed
  // looks like waits; any other Layout is the site's own, such as a default an
  // earlier version set, for which no record will ever land.
  return (await mayBeUnrecordedSeed(nextly, slugs.layouts))
    ? "undecided"
    : "existing";
}

/** How long after its create an empty Layout may be a seed not yet recorded. */
const SEED_RECORD_WINDOW_MS = 5 * 60_000;

/**
 * Whether the site's Layouts are what another instance's seed is before its
 * record lands: one Layout, no area filled, created moments ago.
 */
async function mayBeUnrecordedSeed(
  nextly: SpacingModeAtStartDeps["nextly"],
  layouts: string
): Promise<boolean> {
  // Two rows at most, read whole: the answer needs only whether a second
  // exists, and the first one's areas and creation time, which a row may
  // carry under either spelling of the timestamp.
  const found = await nextly.find({
    collection: layouts,
    status: "all",
    limit: 2,
    depth: 0,
    overrideAccess: true,
  });
  if (found.items.length !== 1) return false;
  const row = found.items[0];
  const areas = readStoredJson(row.areas);
  if (Array.isArray(areas) && areas.length > 0) return false;
  const created = new Date(
    (row.createdAt ?? row.created_at) as string | number | Date
  ).getTime();
  return (
    Number.isFinite(created) && Date.now() - created < SEED_RECORD_WINDOW_MS
  );
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
