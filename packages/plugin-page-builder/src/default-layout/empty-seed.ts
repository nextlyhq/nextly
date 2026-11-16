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
 * pages are left on it, and the move waits: the draft may be discarded. A
 * seed whose row holds a header or footer is a set like any other, and the
 * move is done.
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
 * Where the seeded set stands: `empty` while neither its row nor its working
 * draft names a component in its areas; `filling` while only its working
 * draft does (someone is giving it a header or footer, and may yet discard
 * that); `filled` once its row does; `gone` when no seed is recorded or its
 * row no longer exists. The one answer the move and the write normalisation
 * share.
 */
type SeedState =
  | { readonly kind: "empty"; readonly id: string }
  | { readonly kind: "filling" }
  | { readonly kind: "filled" }
  | { readonly kind: "gone" };

/** Where the seed the settings record stands, as {@link SeedState} says. */
async function seedState(
  nextly: EmptySeedReads,
  slugs: DefaultLayoutSlugs,
  only?: string
): Promise<SeedState> {
  const { seededLayout: seed } = await readLayoutSettings(nextly, slugs);
  // Asked about one set: the seed is read only when it is that set.
  if (seed === null || (only !== undefined && seed !== only)) {
    return { kind: "gone" };
  }
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
  if (row === undefined) return { kind: "gone" };
  if (regionsOf(row).length > 0) return { kind: "filled" };
  // Its working draft, which only a read by id overlays.
  const latest: unknown = await nextly.findByID({
    collection: slugs.layouts,
    id: seed,
    draft: true,
    depth: 0,
    overrideAccess: true,
  });
  return regionsOf(latest as { areas?: unknown } | undefined).length > 0
    ? { kind: "filling" }
    : { kind: "empty", id: seed };
}

/** The seeded set's id while it is empty, or null. */
export async function emptySeedOf(
  nextly: EmptySeedReads,
  slugs: DefaultLayoutSlugs
): Promise<string | null> {
  const state = await seedState(nextly, slugs);
  return state.kind === "empty" ? state.id : null;
}

/**
 * Whether set `id` is the seed while it is empty, reading the seed only when
 * `id` is the one the settings record.
 */
export async function namesEmptySeed(
  nextly: EmptySeedReads,
  slugs: DefaultLayoutSlugs,
  id: string
): Promise<boolean> {
  return (await seedState(nextly, slugs, id)).kind === "empty";
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
  const state = await seedState(deps.nextly, deps.slugs);
  // No seed, or one with a published header or footer: no page is stuck on
  // an empty one, and the write normalisation keeps it that way.
  if (state.kind === "gone" || state.kind === "filled") return finish(deps, 0);
  // Only its draft holds an area: its pages stay while someone fills it, and
  // the move is not done, since that draft may yet be discarded.
  if (state.kind === "filling") {
    return { kind: "pass", moved: 0, finished: false };
  }
  const pass = await movePagesOffSeed(deps, state.id);
  if (!pass.complete)
    return { kind: "pass", moved: pass.moved, finished: false };
  return finish(deps, pass.moved);
}

/**
 * Every page naming `seed` moved off it, as far as one pass goes, and said
 * in the log: how many moved, and when the pass did not reach every page.
 */
async function movePagesOffSeed(
  deps: EmptySeedMoveDeps,
  seed: string
): Promise<{ moved: number; complete: boolean }> {
  const scan = await scanLayoutReferences({
    nextly: deps.nextly,
    pages: deps.pagesSlug,
    layoutId: seed,
    // Unbounded: the scan's working-draft reads start from the first
    // published page on every run, so a bounded scan on a larger site would
    // stop at the same place on every pass and never finish. This reads each
    // page once, as a job no request waits on, and only until it finishes.
    budget: Number.POSITIVE_INFINITY,
  });
  let moved = 0;
  let refused = 0;
  for (const page of scan.references) {
    const outcome = await movePageOffSeed(deps, page.id, seed);
    if (outcome === "moved") moved += 1;
    if (outcome === "refused") refused += 1;
  }
  if (moved > 0) deps.warn(movedLine(moved), { seededLayout: seed, moved });
  const complete = scan.complete && refused === 0;
  if (!complete) {
    deps.warn(
      "[page-builder] the move of pages off the empty seeded header & footer set did not finish; the next jobs pass carries on",
      {
        seededLayout: seed,
        moved,
        savedMeanwhile: refused,
        unread: scan.unread.length,
      }
    );
  }
  return { moved, complete };
}

/** The log line saying how many pages a pass moved. */
function movedLine(moved: number): string {
  const [pages, they] = moved === 1 ? ["page", "it"] : ["pages", "they"];
  return `[page-builder] moved ${moved} ${pages} to the site default, because ${they} named the empty seeded header & footer set`;
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
