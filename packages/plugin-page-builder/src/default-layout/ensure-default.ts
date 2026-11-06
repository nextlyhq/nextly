/**
 * Make sure the site has a usable default Layout: the seed, and its repair.
 *
 * A site always has one published default. A fresh site gets a seeded
 * "Site layout" Layout with no areas, which draws pages with no regions
 * until an author fills it or chooses another. When the default stops being
 * usable — deleted or unpublished by a path the guards could not see, such as
 * an import that skips hooks — this re-points it at the seed, publishing the
 * seed again or re-creating it if it is gone.
 *
 * ## The seed is known by id, never by name
 *
 * The settings Single records the id of the Layout this seeded. Nothing here
 * matches a Layout by title or slug, so an author's own "Default" or
 * "Site layout" is never adopted, renamed or republished: when one holds the
 * seed's name, the seed takes the next free one.
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

import { seedSlug, seedTitle } from "./seed-names";
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

/** The job that runs the repair: queued by the guards and kept as a sweep. */
const DEFAULT_LAYOUT_JOB = "page-builder:default-layout";

/**
 * The dedupe key a queued repair carries, so a burst of writes that each find
 * the default unusable leaves one repair waiting rather than one per write.
 */
const REPAIR_DEDUPE_KEY = `${DEFAULT_LAYOUT_JOB}:repair`;

/** How many Layouts one page of the name scan reads. */
const NAME_SCAN_PAGE_SIZE = 100;

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

  const created = await createSeed(deps, settings.seededLayout);
  // Another run's seed landed while this one was creating: it is the seed.
  if (created === null) return "kept";
  await recordSeed(deps, created, settings.defaultLayout);
  deps.warn(
    settings.seededLayout === null
      ? "[page-builder] the site had no usable default Layout, so a Layout called 'Site layout' was created and made the default"
      : "[page-builder] the seeded default Layout no longer exists, so it was created again and made the default",
    {
      previous: settings.defaultLayout,
      previousSeed: settings.seededLayout,
      seededLayout: created,
    }
  );
  return "seeded";
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
 */
async function recordSeed(
  deps: EnsureDefaultDeps,
  created: string,
  observed: string | null
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
    // Through the Layout fence, as every delete of a Layout must be.
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
  observedSeed: string | null
): Promise<string | null> {
  const { titles, slugs } = await takenNames(deps);
  for (let attempt = 1; ; attempt += 1) {
    const slug = seedSlug(slugs);
    try {
      return await createNamed(deps, seedTitle(titles), slug);
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      // The refusal may be another run's seed taking this very slug: then the
      // settings now record it, and creating under the next slug would leave
      // two seeds. Checked before any retry, and answered with `null`.
      if (await anotherRunSeeded(deps, observedSeed)) return null;
      if (attempt >= SEED_SLUG_ATTEMPTS) {
        throw NextlyError.conflict({
          reason: "state",
          message: "The default Layout could not be given a free address.",
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

/** Every stored Layout's title and slug, read as the only columns asked for. */
async function takenNames(
  deps: EnsureDefaultDeps
): Promise<{ titles: Set<string>; slugs: Set<string> }> {
  const titles = new Set<string>();
  const slugs = new Set<string>();
  for (let page = 1; ; page += 1) {
    const found = await deps.nextly.find({
      collection: deps.slugs.layouts,
      status: "all",
      limit: NAME_SCAN_PAGE_SIZE,
      page,
      // A fixed order, so the pages partition the rows. Sorting by id needs
      // no id in the selection.
      sort: "id",
      depth: 0,
      // The scan compares names and nothing else.
      select: { title: true, slug: true },
      overrideAccess: true,
    });
    for (const row of found.items) {
      const { title, slug } = row as { title?: unknown; slug?: unknown };
      if (typeof title === "string") titles.add(title);
      if (typeof slug === "string") slugs.add(slug);
    }
    if (!found.meta.hasNext) return { titles, slugs };
  }
}

/** Create the seed Layout under one title and slug, answering its id. */
async function createNamed(
  deps: EnsureDefaultDeps,
  title: string,
  slug: string
): Promise<string> {
  const created = await deps.nextly.create({
    collection: deps.slugs.layouts,
    data: {
      title,
      slug,
      // No areas: a seed that named components would be choosing a header for
      // the site. Empty, it draws pages with no regions until someone fills it.
      areas: [],
      status: "published",
    },
    overrideAccess: true,
  });
  const id = relationId(created.item);
  if (id === null) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "The default Layout was created but could not be identified.",
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
    },
  });
}
