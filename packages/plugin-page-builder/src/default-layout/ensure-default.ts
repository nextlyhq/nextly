/**
 * Make sure the site has a usable default Layout: the seed, and its repair.
 *
 * A site always has one published default. A fresh site gets a seeded set
 * called "Main" holding a starter header and footer (`starter-seed`), so its
 * first page already looks like a website; a site that draws its header and
 * footer in code gets Main with no areas. When the default stops being
 * usable — deleted or unpublished by a path the guards could not see, such as
 * an import that skips hooks — this re-points it at the seed, publishing the
 * seed again or re-creating it if it is gone.
 *
 * ## The seed is known by id, never by name
 *
 * The settings Single records the id of the Layout this seeded. Nothing here
 * matches a Layout by title or slug, so an author's own "Main" is never
 * adopted, renamed or republished: when one holds the seed's name, the seed
 * takes the next free one.
 *
 * ## The starter, once
 *
 * Only the first-ever seed makes the starter: no seed was ever recorded, and
 * no starter either. A repair that re-seeds a lost default creates an empty
 * set, so a site that deleted its starter on purpose never gets it back. The
 * order is the starter's two components, then the set naming them, then the
 * starter's record, then the settings. The record's row is the claim between
 * two processes seeding at once: the run whose insert lands made the site's
 * one starter, and the other removes its set and components and stops. A
 * failure at any step removes what the run made and rethrows, so the sweep
 * tries again with nothing half-made left behind.
 *
 * ## Idempotent
 *
 * It runs on every boot and as a recurring sweep, so a second run on a healthy
 * site reads two rows and writes nothing. Two runs racing on a site with no seed
 * pick the same free slug, and the slug's unique constraint refuses the second
 * create; that run fails and the next sweep finds the first one's seed.
 *
 * Within one process, runs are joined rather than raced: the boot's seed, a
 * sweep and a repair queued by a Layout write can all start at once, and a run that
 * started while another was in flight waits for that one's answer. Between
 * processes the slug's constraint is what holds, and the settings are read
 * again just before a seed is created, so a run that lost the race to another
 * process's completed seed does not create a second.
 *
 * @module default-layout/ensure-default
 */
import {
  defineJob,
  NextlyError,
  type JobDefinition,
} from "@nextlyhq/plugin-sdk";

import { asOverwrite } from "../document-version";
import { restoreMissingDefault } from "../layout-removal/restore";
import { settleLayoutRemovals } from "../layout-removal/settle";
import type { LayoutRemovalStore } from "../layout-removal/store";
import { deleteUnrecordedLayout } from "../layout-removal/system-remove";

import { moveEmptySeedPages, type EmptySeedParts } from "./empty-seed";
import { seedSlug, seedTitle } from "./seed-names";
import type { StarterRecord } from "./starter-record";
import {
  createStarterComponents,
  removeStarterComponents,
  type StarterParts,
} from "./starter-seed";
import {
  layoutExists,
  publishedLayoutIds,
  readLayoutSettings,
  relationId,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
  type LayoutSettings,
} from "./store";
import { takenNames } from "./taken-names";

/** The job that runs the repair: queued by the guards and kept as a sweep. */
const DEFAULT_LAYOUT_JOB = "page-builder:default-layout";

/**
 * The dedupe key a queued repair carries, so a burst of writes that each find
 * the default unusable leaves one repair waiting rather than one per write.
 */
const REPAIR_DEDUPE_KEY = `${DEFAULT_LAYOUT_JOB}:repair`;

/**
 * How many slugs the seed tries when the database refuses one the scan saw as
 * free. Bounded, so a store that refuses every slug fails the run instead of
 * looping; the sweep tries again later.
 */
const SEED_SLUG_ATTEMPTS = 5;

/**
 * What the repair needs: the Direct API, the resolved slugs, the Layout
 * removals' fence (whose copies it restores from) and a log.
 */
export interface EnsureDefaultDeps {
  readonly nextly: DefaultLayoutDirectApi;
  readonly slugs: DefaultLayoutSlugs;
  /** The RESOLVED pages slug, whose pages a removal's check after its write clears. */
  readonly pagesSlug: string;
  readonly removals: LayoutRemovalStore;
  /** Where the repair says why it acted. Called only when it changed something. */
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  /**
   * What the one-time move of pages off the empty seed writes with, which the
   * sweep runs after the repair until it has finished. The installed plugin
   * always supplies it (`installDefaultLayout`); a run built without it, as
   * the repair's own tests build one, repairs the default and moves nothing.
   */
  readonly emptySeed?: EmptySeedParts;
  /**
   * What a fresh site's first seed makes its starter header and footer with.
   * Absent where the site draws its header and footer in code, whose seed is
   * an empty set, and in a run built without it, as the repair's own tests
   * build one.
   */
  readonly starter?: StarterParts;
}

/**
 * What one run did. `kept`: the default was usable. `restored`: the default
 * named a Layout a removal deleted while a promotion raced it, and that Layout
 * was restored from the removal's copy under a new id. `repointed`: the default
 * now names the existing seed (published again if it was not). `seeded`: a new
 * seed was created and made the default.
 */
export type EnsureOutcome = "kept" | "restored" | "repointed" | "seeded";

/** The run in flight in this process, which a concurrent caller joins. */
let inFlight: Promise<EnsureOutcome> | null = null;

/** Make the site's default usable, by the rule in the module docblock. */
export function ensureDefaultLayout(
  deps: EnsureDefaultDeps
): Promise<EnsureOutcome> {
  if (inFlight !== null) return inFlight;
  const run = ensureOnce(deps).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** One run of the check and, where needed, the repair. */
async function ensureOnce(deps: EnsureDefaultDeps): Promise<EnsureOutcome> {
  const settings = await readLayoutSettings(deps.nextly, deps.slugs);
  const asked = [settings.defaultLayout, settings.seededLayout].filter(
    (id): id is string => id !== null
  );
  // One read answers both questions: whether the default is published, and
  // whether the recorded seed is.
  const published = await publishedLayoutIds(deps.nextly, deps.slugs, asked);

  if (isPublished(settings.defaultLayout, published)) return "kept";
  // Before falling back to the seed: a default that names a Layout a removal
  // deleted under a racing promotion comes back from the removal's copy, so
  // the author's choice of default is kept. Only for a Layout that is gone; a
  // Layout that still exists is never written from a copy.
  if (
    settings.defaultLayout !== null &&
    (await restoreMissingDefault(
      { ...deps, store: deps.removals },
      settings.defaultLayout
    )) !== null
  ) {
    return "restored";
  }
  const seed = settings.seededLayout;
  if (seed !== null && (await seedStillExists(deps, seed, published))) {
    return repointToSeed(deps, seed, settings.defaultLayout, published);
  }
  return reseed(deps, settings);
}

/** Whether `id` is set and among the published ids. */
function isPublished(
  id: string | null,
  published: ReadonlySet<string>
): id is string {
  return id !== null && published.has(id);
}

/** Whether the recorded seed's row still exists, published or not. */
async function seedStillExists(
  deps: EnsureDefaultDeps,
  seed: string,
  published: ReadonlySet<string>
): Promise<boolean> {
  return (
    published.has(seed) || (await layoutExists(deps.nextly, deps.slugs, seed))
  );
}

/**
 * Point the default back at the existing seed, publishing it again first if
 * it is not published.
 */
async function repointToSeed(
  deps: EnsureDefaultDeps,
  seed: string,
  previous: string | null,
  published: ReadonlySet<string>
): Promise<EnsureOutcome> {
  if (!published.has(seed)) {
    // The repair publishes the seed it owns whatever it holds now: an
    // overwrite by intent.
    await deps.nextly.update({
      collection: deps.slugs.layouts,
      id: seed,
      data: asOverwrite({ status: "published" }),
      overrideAccess: true,
    });
  }
  const before = await settingsBeforeRepair(deps, previous);
  if (!before.stillDefault) return "kept";
  // No person chose this default, so nobody is credited with it.
  await writeLayoutSettings(deps.nextly, deps.slugs, before.latest, {
    defaultLayout: seed,
    defaultLayoutChangedBy: null,
  });
  deps.warn(
    "[page-builder] the default Layout was missing or not published, so the default now names the seeded Layout again",
    { previous, seededLayout: seed }
  );
  return "repointed";
}

/**
 * Create a new seed and make it the default, unless another process seeded
 * since `settings` was read.
 */
async function reseed(
  deps: EnsureDefaultDeps,
  settings: LayoutSettings
): Promise<EnsureOutcome> {
  // Read again just before creating: another process may have seeded since
  // the first read, and its seed is the one to keep.
  // A newer default chosen since then is kept too.
  const latest = await readLayoutSettings(deps.nextly, deps.slugs);
  if (
    (latest.seededLayout !== null &&
      latest.seededLayout !== settings.seededLayout) ||
    latest.defaultLayout !== settings.defaultLayout
  ) {
    return "kept";
  }

  const starter = await seedStarter(deps, settings);
  let created: string | null;
  try {
    created = await createSeed(deps, settings.seededLayout, starter.areas);
  } catch (error) {
    await starter.undo();
    throw error;
  }
  // Another run's seed landed while this one was creating: it is the seed.
  if (created === null) {
    await starter.undo();
    return "kept";
  }
  if (!(await starter.claim(created))) {
    // Another process made the site's starter first, and its seed is the
    // one to keep: this run removes what it made and stops.
    await removeSeed(deps, created);
    await starter.undo();
    return "kept";
  }
  await recordSeed(deps, created, settings.defaultLayout, async () => {
    await starter.release();
    await starter.undo();
  });
  deps.warn(seedWords(settings, starter.made), {
    previous: settings.defaultLayout,
    previousSeed: settings.seededLayout,
    seededLayout: created,
    ...(starter.made === null
      ? {}
      : {
          starterHeader: starter.made.header.id,
          starterFooter: starter.made.footer.id,
        }),
  });
  return "seeded";
}

/** What a seed makes beside its set: the starter, or nothing. */
interface SeedStarter {
  /** The starter's two components, or null when this seed makes none. */
  readonly made: StarterRecord | null;
  /** The set's areas: the starter's header and footer, or none. */
  readonly areas: readonly { area: string; component: string }[];
  /** Record the starter as the site's one; false when another run did first. */
  claim(created: string): Promise<boolean>;
  /** Remove the starter's record, best effort. */
  release(): Promise<void>;
  /** Remove the starter's components, best effort. */
  undo(): Promise<void>;
}

/** Nothing beside the set: a re-seed, or a site drawing its own. */
const NO_STARTER: SeedStarter = {
  made: null,
  areas: [],
  claim: () => Promise.resolve(true),
  release: () => Promise.resolve(),
  undo: () => Promise.resolve(),
};

/**
 * Make the starter's components when this seed is to have them, answering
 * what to name in the set and how to record or undo them.
 */
async function seedStarter(
  deps: EnsureDefaultDeps,
  settings: LayoutSettings
): Promise<SeedStarter> {
  const starter = await starterToMake(deps, settings);
  if (starter === null) return NO_STARTER;
  const made = await createStarterComponents({ ...deps, starter });
  const ids = [made.header.id, made.footer.id];
  return {
    made,
    areas: areasOf(made),
    claim: created => claimStarter(deps, starter, made, created),
    release: () =>
      starter.record.release(made).catch((error: unknown) => {
        deps.warn(
          "[page-builder] the starter's record from a seed that did not finish could not be removed",
          { error: error instanceof Error ? error.message : String(error) }
        );
      }),
    undo: () => removeStarterComponents({ ...deps, starter }, ids),
  };
}

/** What the log says a seed did. */
function seedWords(
  settings: LayoutSettings,
  made: StarterRecord | null
): string {
  if (settings.seededLayout !== null) {
    return "[page-builder] the seeded default header & footer set no longer exists, so an empty one was created and made the default";
  }
  return made === null
    ? "[page-builder] the site had no usable default header & footer set, so an empty set called 'Main' was created and made the default"
    : "[page-builder] the site had no usable default header & footer set, so a set called 'Main' with a starter header and footer was created and made the default";
}

/**
 * The starter to make with this seed, or null: only for the first-ever seed
 * (no seed recorded, no starter recorded) on a site whose header and footer
 * the page builder draws.
 */
async function starterToMake(
  deps: EnsureDefaultDeps,
  settings: LayoutSettings
): Promise<StarterParts | null> {
  const starter = deps.starter;
  if (starter === undefined || settings.seededLayout !== null) return null;
  return (await starter.record.read()) === null ? starter : null;
}

/** The seed's areas: the starter's header and footer. */
function areasOf(
  made: StarterRecord
): readonly { area: string; component: string }[] {
  return [
    { area: "header", component: made.header.id },
    { area: "footer", component: made.footer.id },
  ];
}

/**
 * Record the starter as the site's one, answering whether this run's insert
 * landed. A failure that is not a lost race removes the set and the starter
 * and rethrows.
 */
async function claimStarter(
  deps: EnsureDefaultDeps,
  starter: StarterParts,
  made: StarterRecord,
  created: string
): Promise<boolean> {
  try {
    return await starter.record.claim(made);
  } catch (error) {
    await removeSeed(deps, created);
    await removeStarterComponents({ ...deps, starter }, [
      made.header.id,
      made.footer.id,
    ]);
    throw error;
  }
}

/**
 * Delete a set this run created and recorded nowhere, best effort: a failure
 * is logged for someone to delete it by hand. Through the Layout fence, as
 * every delete of a set must be.
 */
async function removeSeed(
  deps: EnsureDefaultDeps,
  created: string
): Promise<void> {
  await deleteUnrecordedLayout(
    {
      nextly: deps.nextly,
      store: deps.removals,
      layouts: deps.slugs.layouts,
    },
    created
  ).catch((cleanup: unknown) => {
    deps.warn(
      "[page-builder] a seeded default Layout could not be recorded or removed; delete it by hand",
      {
        seededLayout: created,
        error: cleanup instanceof Error ? cleanup.message : String(cleanup),
      }
    );
  });
}

/**
 * The settings read again just before the repair writes over them, and
 * whether they still name `observed` as the default.
 *
 * A make-default that lands while the repair runs owns the default, and
 * writing the seed over it would undo that request. The repair's write sends
 * this read's version, so a make-default landing between the read and the
 * write refuses the write instead of being overwritten; the run then fails
 * and the next one finds the new default usable.
 */
async function settingsBeforeRepair(
  deps: EnsureDefaultDeps,
  observed: string | null
): Promise<{ latest: LayoutSettings; stillDefault: boolean }> {
  const latest = await readLayoutSettings(deps.nextly, deps.slugs);
  return { latest, stillDefault: latest.defaultLayout === observed };
}

/**
 * Record a just-created seed as the default, or remove it again.
 *
 * The create and this write are separate, so when this one fails the seed is
 * recorded nowhere: no later run could find it by id, and it would sit in the
 * Layouts list for good beside the next run's seed. So the created Layout is
 * deleted as the system (best effort, and logged when even that fails) and
 * the failure rethrown, which fails the run for the sweep to retry. The delete
 * goes through the Layout fence, as every Layout's delete must: the seed is
 * not the default, since the write failed, and no page can name it yet.
 *
 * The seed is made the default only while the default is still `observed`,
 * the unusable one this run set out to replace; a make-default that landed
 * while the seed was being created keeps its choice, and the seed is recorded
 * as the seed alone (see {@link settingsBeforeRepair}).
 *
 * `undo` removes whatever else this run made for the seed (the starter and
 * its record), after the set itself is gone.
 */
async function recordSeed(
  deps: EnsureDefaultDeps,
  created: string,
  observed: string | null,
  undo: () => Promise<void>
): Promise<void> {
  try {
    const before = await settingsBeforeRepair(deps, observed);
    await writeLayoutSettings(deps.nextly, deps.slugs, before.latest, {
      seededLayout: created,
      // A default the repair chooses credits no person.
      ...(before.stillDefault
        ? { defaultLayout: created, defaultLayoutChangedBy: null }
        : {}),
    });
  } catch (error) {
    await removeSeed(deps, created);
    await undo();
    throw error;
  }
}

/**
 * Create the seed under the first title and the first slug no Layout holds.
 *
 * Every stored Layout is read, whatever its state, because a draft holds its
 * slug's unique value as firmly as a published one does. Paged to the end, so
 * a clash past the first page still moves the seed's name.
 *
 * The database can still refuse the slug the scan found free: MySQL compares
 * slugs without case or accents, so `Site-Layout` holds `site-layout` there.
 * A refusal as a duplicate adds the slug to the taken set and tries the next
 * numbered one, a bounded number of times; past that the run fails, and the
 * sweep tries again later. A refusal that came from another run seeding at the
 * same moment answers `null` instead: that run's seed is adopted.
 */
async function createSeed(
  deps: EnsureDefaultDeps,
  observedSeed: string | null,
  areas: readonly { area: string; component: string }[]
): Promise<string | null> {
  const { titles, slugs } = await takenNames(deps.nextly, deps.slugs.layouts);
  for (let attempt = 1; ; attempt += 1) {
    const slug = seedSlug(slugs);
    try {
      return await createNamed(deps, seedTitle(titles), slug, areas);
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      // The refusal may be another run's seed taking this very slug: then the
      // settings now record it, and creating under the next slug would leave
      // two seeds. Checked before any retry, and answered with `null`.
      if (await anotherRunSeeded(deps, observedSeed)) return null;
      if (attempt >= SEED_SLUG_ATTEMPTS) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "The default header & footer set could not be given a free address.",
          logContext: {
            reason: "default-layout-seed-slug-exhausted",
            attempts: attempt,
            lastSlug: slug,
          },
        });
      }
      slugs.add(slug);
    }
  }
}

/** Whether the settings now record a seed other than the one this run saw. */
async function anotherRunSeeded(
  deps: EnsureDefaultDeps,
  observedSeed: string | null
): Promise<boolean> {
  const { seededLayout } = await readLayoutSettings(deps.nextly, deps.slugs);
  return seededLayout !== null && seededLayout !== observedSeed;
}

/** Create the seed Layout under one title and slug, answering its id. */
async function createNamed(
  deps: EnsureDefaultDeps,
  title: string,
  slug: string,
  areas: readonly { area: string; component: string }[]
): Promise<string> {
  const created = await deps.nextly.create({
    collection: deps.slugs.layouts,
    data: {
      title,
      slug,
      // The starter's header and footer on a fresh site; none on a re-seed or
      // where the site draws its own, which then draws pages with no regions
      // until someone fills the set.
      areas: [...areas],
      status: "published",
    },
    overrideAccess: true,
  });
  const id = relationId(created.item);
  if (id === null) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "The default header & footer set was created but could not be identified.",
      logMessage: "create returned no usable id for the seeded default Layout",
      logContext: { reason: "default-layout-seed-no-id" },
    });
  }
  return id;
}

/**
 * Queue a repair, best effort.
 *
 * Called where a write may have left the default unusable and the caller cannot
 * repair it inline (an after-hook on a Layout write). The sweep keeps one repair queued
 * anyway, so a failure here is logged by the caller and never surfaces.
 */
export async function queueDefaultLayoutRepair(
  nextly: Pick<DefaultLayoutDirectApi, "jobs">
): Promise<{ deduped: boolean }> {
  // The queue's answer is returned so a caller can tell a fresh repair from
  // one already waiting under the same dedupe key.
  return nextly.jobs.queue({
    task: DEFAULT_LAYOUT_JOB,
    input: null,
    dedupeKey: REPAIR_DEDUPE_KEY,
  });
}

/**
 * The repair as a job, kept queued as a sweep so the jobs runner checks the
 * default on every pass without a timer of its own. Each pass first finishes
 * or clears the Layout removals a stopped request left part-way, since one of
 * those may be what left the default unusable.
 *
 * Once the default is usable, the pass also moves pages off the empty seed,
 * until that move has finished once (`empty-seed`); after that it reads one
 * row and stops.
 *
 * The deps are resolved per run, through the plugin's installed context, for
 * the reason the usage backfill gives: the Direct API is not resolvable when
 * the job is defined.
 */
export function defaultLayoutJob(
  deps: () => Promise<EnsureDefaultDeps>
): JobDefinition {
  return defineJob({
    slug: DEFAULT_LAYOUT_JOB,
    sweep: true,
    handler: async () => {
      const resolved = await deps();
      await settleLayoutRemovals({
        ...resolved,
        store: resolved.removals,
      });
      await ensureDefaultLayout(resolved);
      const { emptySeed } = resolved;
      if (emptySeed !== undefined) {
        await moveEmptySeedPages({ ...resolved, emptySeed });
      }
    },
  });
}
