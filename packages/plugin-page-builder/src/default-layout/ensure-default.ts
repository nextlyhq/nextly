/**
 * Make sure the site has a usable default Layout: the seed, and its repair.
 *
 * A site always has one published default. A fresh site gets a seeded
 * "Default (site)" Layout with no areas, which draws pages with no regions
 * until an author fills it or chooses another. When the default stops being
 * usable — deleted or unpublished by a path the guards could not see, such as
 * an import that skips hooks — this re-points it at the seed, publishing the
 * seed again or re-creating it if it is gone.
 *
 * ## The seed is known by id, never by name
 *
 * The settings Single records the id of the Layout this seeded. Nothing here
 * matches a Layout by title or slug, so an author's own "Default" or
 * "Default (site)" is never adopted, renamed or republished: when one holds the
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
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { defineJob, type JobDefinition } from "nextly";

import { seedSlug, seedTitle } from "./seed-names";
import {
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

/** What the repair needs: the Direct API, the resolved slugs and a log. */
export interface EnsureDefaultDeps {
  readonly nextly: DefaultLayoutDirectApi;
  readonly slugs: DefaultLayoutSlugs;
  /** Where the repair says why it acted. Called only when it changed something. */
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * What one run did. `kept`: the default was usable. `repointed`: the default
 * now names the existing seed (published again if it was not). `seeded`: a new
 * seed was created and made the default.
 */
export type EnsureOutcome = "kept" | "repointed" | "seeded";

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
  return published.has(seed) || (await exists(deps, seed));
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
    await deps.nextly.update({
      collection: deps.slugs.layouts,
      id: seed,
      data: { status: "published" },
      overrideAccess: true,
    });
  }
  await writeLayoutSettings(deps.nextly, deps.slugs, { defaultLayout: seed });
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
  const latest = await readLayoutSettings(deps.nextly, deps.slugs);
  if (
    latest.seededLayout !== null &&
    latest.seededLayout !== settings.seededLayout
  ) {
    return "kept";
  }

  const created = await createSeed(deps);
  await writeLayoutSettings(deps.nextly, deps.slugs, {
    seededLayout: created,
    defaultLayout: created,
  });
  deps.warn(
    settings.seededLayout === null
      ? "[page-builder] the site had no usable default Layout, so a 'Default (site)' Layout was created and made the default"
      : "[page-builder] the seeded default Layout no longer exists, so it was created again and made the default",
    {
      previous: settings.defaultLayout,
      previousSeed: settings.seededLayout,
      seededLayout: created,
    }
  );
  return "seeded";
}

/** Whether a Layout row exists at all, whatever its lifecycle state. */
async function exists(deps: EnsureDefaultDeps, id: string): Promise<boolean> {
  const found = await deps.nextly.find({
    collection: deps.slugs.layouts,
    where: { id: { equals: id } },
    status: "all",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  return found.items.length > 0;
}

/**
 * Create the seed under the first title and the first slug no Layout holds.
 *
 * Every stored Layout is read, whatever its state, because a draft holds its
 * slug's unique value as firmly as a published one does. Paged to the end, so
 * a clash past the first page still moves the seed's name.
 */
async function createSeed(deps: EnsureDefaultDeps): Promise<string> {
  const titles = new Set<string>();
  const slugs = new Set<string>();
  for (let page = 1; ; page += 1) {
    const found = await deps.nextly.find({
      collection: deps.slugs.layouts,
      status: "all",
      limit: NAME_SCAN_PAGE_SIZE,
      page,
      // A fixed order, so the pages partition the rows.
      sort: "id",
      depth: 0,
      overrideAccess: true,
    });
    for (const row of found.items) {
      const { title, slug } = row as { title?: unknown; slug?: unknown };
      if (typeof title === "string") titles.add(title);
      if (typeof slug === "string") slugs.add(slug);
    }
    if (!found.meta.hasNext) break;
  }

  const created = await deps.nextly.create({
    collection: deps.slugs.layouts,
    data: {
      title: seedTitle(titles),
      slug: seedSlug(slugs),
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
 * default on every pass without a timer of its own.
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
      await ensureDefaultLayout(await deps());
    },
  });
}
