/**
 * Pages that name the empty seeded set follow the site default instead.
 *
 * The seed is created with no header and no footer, and older pickers listed
 * it by its own name beside "Site default". A page that picked it there stores
 * the seed's id, so it stays blank when the site default changes to a set
 * that has a header and footer. Two parts fix that in the stored data, and
 * the rule that draws a page (`resolvePageLayout`) is left as it is:
 *
 * - a one-time move, run after the boot's seed and on each pass of the
 *   default-set sweep until it has finished once, which rewrites every page
 *   naming the empty seed to name no set ("Site default");
 * - a write normalisation (`empty-seed-write`), so no later write stores the
 *   seed's id on a page while the seed is still empty.
 *
 * ## What "empty" means
 *
 * The seed's row and its working draft name no component in their areas. A
 * working draft that adds a header means someone is filling the seed, so its
 * pages are left on it.
 *
 * ## How the move writes
 *
 * Through core's field rewrite, as the system: the page's live copy and every
 * pending draft that names the seed, in one transaction, from the version the
 * move read. Nothing is published, each draft stays a draft, and no person is
 * credited: the page's history records one entry naming the Page Builder,
 * with {@link MOVE_REASON}. A page saved between the read and the rewrite
 * refuses it (`STALE_VERSION`); the move leaves it for the next pass, which
 * reads it again.
 *
 * ## Once
 *
 * A pass that read every page and moved every one it found records the time
 * in the plugin's own options table, and from then on each pass reads only
 * that row. A pass cut short (the scan's read budget, a refused rewrite)
 * records nothing, and the next pass picks up whatever still names the seed.
 *
 * @module default-layout/empty-seed
 */
import { regionsOf } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type FieldRewriteRequest,
  type FieldRewriteResult,
} from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { documentVersionOf } from "../document-version";
import { scanLayoutReferences } from "../layout-removal/layout-references";
import { siteOptions } from "../schema/tables";
import { readSiteOption } from "../site-option-read";

import {
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./store";

/** The options-table row that records when the move finished. */
export const EMPTY_SEED_MOVED_OPTION = "empty-seed-pages-moved";

/** Why each moved page changed, as its history keeps it. */
export const MOVE_REASON =
  "Moved to the site default: this page named the empty seeded header & footer set.";

/** Where the move's finish is recorded. */
export interface EmptySeedMark {
  /** When the move finished, or null while it has not. */
  read(): Promise<string | null>;
  /** Record that the move finished at `at`. */
  write(at: string): Promise<void>;
}

/** Which database, so a lost race to insert the row is recognised. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The mark, as one row of the plugin's own options table. */
export function emptySeedMark(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "table">,
  dialect: Dialect
): EmptySeedMark {
  return {
    read: () => readSiteOption(db, EMPTY_SEED_MOVED_OPTION),
    write: async at => {
      try {
        await db.insert(siteOptions, {
          name: EMPTY_SEED_MOVED_OPTION,
          value: at,
        });
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
        // Another process finished first: the move is done either way.
        await db
          .update(siteOptions, { value: at })
          .where(eq(db.table(siteOptions).name, EMPTY_SEED_MOVED_OPTION));
      }
    },
  };
}

/** What the move needs beside the Direct API, from the installed plugin. */
export interface EmptySeedParts {
  readonly mark: EmptySeedMark;
  /**
   * The plugin's own field rewrite, made as the system, so each page's
   * history names the Page Builder.
   */
  readonly rewrite: (
    request: FieldRewriteRequest
  ) => Promise<FieldRewriteResult>;
}

/** The reads the seed check makes. */
export type EmptySeedReads = Pick<
  DefaultLayoutDirectApi,
  "find" | "findByID" | "findSingle"
>;

/**
 * The seeded set's id while it holds no header and no footer, in its row and
 * in its working draft; null when the site has no seed, the seed is gone, or
 * it holds an area. The one answer the move and the write normalisation share.
 */
export async function emptySeedOf(
  nextly: EmptySeedReads,
  slugs: DefaultLayoutSlugs
): Promise<string | null> {
  const { seededLayout } = await readLayoutSettings(nextly, slugs);
  if (seededLayout === null) return null;
  return (await seedIsEmpty(nextly, slugs, seededLayout)) ? seededLayout : null;
}

/**
 * Whether set `id` is the seed while it is empty, as {@link emptySeedOf}
 * answers, reading the seed only when `id` is the one the settings record.
 */
export async function namesEmptySeed(
  nextly: EmptySeedReads,
  slugs: DefaultLayoutSlugs,
  id: string
): Promise<boolean> {
  const { seededLayout } = await readLayoutSettings(nextly, slugs);
  return seededLayout === id && (await seedIsEmpty(nextly, slugs, id));
}

/** Whether set `seed` exists and neither its row nor its draft names an area. */
async function seedIsEmpty(
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findByID">,
  slugs: Pick<DefaultLayoutSlugs, "layouts">,
  seed: string
): Promise<boolean> {
  // The row: the live set when it is published, its only row when not.
  const found = await nextly.find({
    collection: slugs.layouts,
    where: { id: { equals: seed } },
    status: "all",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const row = found.items[0] as { areas?: unknown } | undefined;
  if (row === undefined || regionsOf(row).length > 0) return false;
  // Its working draft, which only a read by id overlays.
  const latest: unknown = await nextly.findByID({
    collection: slugs.layouts,
    id: seed,
    draft: true,
    depth: 0,
    overrideAccess: true,
  });
  return regionsOf(latest as { areas?: unknown } | undefined).length === 0;
}

/** What the move needs. */
export interface EmptySeedMoveDeps {
  readonly nextly: EmptySeedReads;
  readonly slugs: DefaultLayoutSlugs;
  /** The RESOLVED pages slug. */
  readonly pagesSlug: string;
  readonly emptySeed: EmptySeedParts;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  /** The clock the finish is recorded by; the real one unless a test sets it. */
  readonly now?: () => Date;
}

/**
 * What one pass did. `done-before`: the move had already finished, and only
 * its mark was read. Otherwise `moved` pages were moved, and `finished` says
 * whether the pass recorded the move as done.
 */
export type EmptySeedOutcome =
  | { readonly kind: "done-before" }
  | {
      readonly kind: "pass";
      readonly moved: number;
      readonly finished: boolean;
    };

/** The pass in flight in this process, which a concurrent caller joins. */
let inFlight: Promise<EmptySeedOutcome> | null = null;

/**
 * One pass of the move, by the rule in the module docblock. The boot's seed
 * and the sweep can start one at once; the second joins the first.
 */
export function moveEmptySeedPages(
  deps: EmptySeedMoveDeps
): Promise<EmptySeedOutcome> {
  if (inFlight !== null) return inFlight;
  const run = moveOnce(deps).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** One pass, unjoined. */
async function moveOnce(deps: EmptySeedMoveDeps): Promise<EmptySeedOutcome> {
  if ((await deps.emptySeed.mark.read()) !== null) {
    return { kind: "done-before" };
  }
  const seed = await emptySeedOf(deps.nextly, deps.slugs);
  // No empty seed, so no page can be stuck on one, and the write
  // normalisation keeps it that way.
  if (seed === null) return finish(deps, 0);

  const scan = await scanLayoutReferences({
    nextly: deps.nextly,
    pages: deps.pagesSlug,
    layoutId: seed,
  });
  let moved = 0;
  let refused = 0;
  for (const page of scan.references) {
    const outcome = await movePageOffSeed(deps, page.id, seed);
    if (outcome === "moved") moved += 1;
    if (outcome === "refused") refused += 1;
  }
  if (moved > 0) {
    deps.warn(
      `[page-builder] moved ${moved} ${moved === 1 ? "page" : "pages"} to the site default, because ${moved === 1 ? "it" : "they"} named the empty seeded header & footer set`,
      { seededLayout: seed, moved }
    );
  }
  if (!scan.complete || refused > 0) {
    return { kind: "pass", moved, finished: false };
  }
  return finish(deps, moved);
}

/** Record the move as done, answering the pass that finished it. */
async function finish(
  deps: EmptySeedMoveDeps,
  moved: number
): Promise<EmptySeedOutcome> {
  const now = deps.now ?? (() => new Date());
  await deps.emptySeed.mark.write(now().toISOString());
  return { kind: "pass", moved, finished: true };
}

/**
 * Rewrite page `pageId`'s `layout` from `seed` to no set, on every copy that
 * names it; a copy naming another set keeps that choice. `refused` for a page
 * saved since it was read, which a later pass reads again.
 */
export async function movePageOffSeed(
  deps: Pick<EmptySeedMoveDeps, "nextly" | "pagesSlug" | "emptySeed">,
  pageId: string,
  seed: string
): Promise<"moved" | "unchanged" | "refused"> {
  let current: unknown;
  try {
    current = await deps.nextly.findByID({
      collection: deps.pagesSlug,
      id: pageId,
      draft: true,
      depth: 0,
      overrideAccess: true,
    });
  } catch (error) {
    // Deleted since the scan listed it: nothing left to move.
    if (NextlyError.isCode(error, "NOT_FOUND")) return "unchanged";
    throw error;
  }
  const version = documentVersionOf(current);
  if (version === undefined) return "refused";
  try {
    const done = await deps.emptySeed.rewrite({
      collection: deps.pagesSlug,
      id: pageId,
      field: "layout",
      expectedVersion: version,
      set: {
        // A copy holding nothing answers `null`, which the rewrite reads as
        // unchanged rather than as a missing answer.
        from: value => (relationId(value) === seed ? null : (value ?? null)),
      },
      reason: MOVE_REASON,
    });
    return done.copies.length > 0 ? "moved" : "unchanged";
  } catch (error) {
    if (NextlyError.isCode(error, "STALE_VERSION")) return "refused";
    throw error;
  }
}
