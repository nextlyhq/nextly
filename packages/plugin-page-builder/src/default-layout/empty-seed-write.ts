/**
 * No page write stores the empty seeded set: one naming it stores "Site
 * default" (no set) instead.
 *
 * The other half of the one-time move (`empty-seed`): once the stored pages
 * are moved, this keeps a REST or Direct API write, an admin save, a
 * duplicated page or a batch write from putting one back on the seed while
 * the seed holds no header and no footer. The page's "No header or footer"
 * switch is left as sent, so a page switched off stays switched off.
 *
 * ## Before the write
 *
 * `beforeChange` on the pages collection, registered after the page side of
 * the set-removal fence, so it runs after validation (the fence's floor on the
 * `layout` field has judged the value as sent) and after that fence's own
 * `beforeChange`, which clears a deleted set from a publish. The value is
 * stored as `null`. A seed that cannot be read leaves the value as sent,
 * logged, rather than failing the save.
 *
 * ## Inside a caller's transaction
 *
 * Core's batch writers run these hooks inside a transaction they own (the path
 * an import or a script takes). The seed can be read there only through the
 * pool, which may wait on the connection that transaction holds, so the write
 * is left as sent and the page is moved once the transaction commits
 * (`afterCommit`), as the one-time move moves one: by core's field rewrite, as
 * the system, publishing nothing. A save of the page in between refuses that
 * rewrite; the save itself passed through this hook.
 *
 * A write that runs no hooks at all is not normalised.
 *
 * @module default-layout/empty-seed-write
 */
import type { Nextly } from "nextly";

import {
  emptySeedOf,
  movePageOffSeed,
  namesEmptySeed,
  type EmptySeedParts,
  type EmptySeedReads,
} from "./empty-seed";
import { relationId, type DefaultLayoutSlugs } from "./store";

/** The plugin context this needs, named structurally. */
interface WriteHookContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** The parts of a page hook context the normalisation reads. */
interface PageHookContext {
  data?: unknown;
  originalData?: unknown;
  executor?: unknown;
  req?: { nextly?: unknown };
  afterCommit?: (effect: () => unknown) => Promise<void>;
}

/** What the normalisation needs. */
export interface EmptySeedWriteArgs {
  readonly ctx: WriteHookContext;
  /** The RESOLVED pages slug. */
  readonly pages: string;
  readonly slugs: DefaultLayoutSlugs;
  readonly emptySeed: EmptySeedParts;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** The Direct API the hook's request carries, or the booted instance's. */
async function directApiOf(hook: PageHookContext): Promise<EmptySeedReads> {
  const carried = hook.req?.nextly;
  if (typeof carried === "object" && carried !== null) {
    return carried as Pick<Nextly, "find" | "findByID" | "findSingle">;
  }
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  return getCachedNextly();
}

/** The set a write sends for `layout`, or null when it sends none. */
function namedBy(hook: PageHookContext): string | null {
  const data = hook.data;
  if (typeof data !== "object" || data === null) return null;
  if (!Object.hasOwn(data, "layout")) return null;
  return relationId((data as { layout?: unknown }).layout);
}

/**
 * The data to write with `layout: null` when it names the empty seed, or
 * `undefined` to leave it as sent.
 */
async function normalisedChoice(
  hook: PageHookContext,
  args: EmptySeedWriteArgs
): Promise<Record<string, unknown> | undefined> {
  const named = namedBy(hook);
  if (named === null || hook.executor !== undefined) return undefined;
  try {
    const nextly = await directApiOf(hook);
    if (!(await namesEmptySeed(nextly, args.slugs, named))) return undefined;
  } catch (error) {
    // The seed could not be read: the save keeps its choice rather than
    // failing for a check that only tidies it.
    args.warn(
      "[page-builder] could not check a saved page's header & footer set against the empty seed; it keeps its choice",
      {
        layoutId: named,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return undefined;
  }
  return { ...(hook.data as Record<string, unknown>), layout: null };
}

/**
 * After a write inside a caller's transaction that named a set: once it
 * commits, move the page off the seed if that set is the empty seed.
 */
async function moveAfterCommit(
  hook: PageHookContext,
  args: EmptySeedWriteArgs
): Promise<void> {
  const named = namedBy(hook);
  const pageId = relationId(hook.data) ?? relationId(hook.originalData);
  if (named === null || pageId === null || hook.executor === undefined) {
    return;
  }
  await hook.afterCommit?.(async () => {
    const nextly = await directApiOf(hook);
    const seed = await emptySeedOf(nextly, args.slugs);
    if (seed !== named) return;
    const outcome = await movePageOffSeed(
      { nextly, pagesSlug: args.pages, emptySeed: args.emptySeed },
      pageId,
      seed
    );
    if (outcome === "moved") {
      args.warn(
        "[page-builder] a page written in a batch named the empty seeded header & footer set, so it now uses the site default",
        { pageId, seededLayout: seed }
      );
    }
  });
}

/** Register the normalisation on the pages collection, by its RESOLVED slug. */
export function registerEmptySeedWriteHook(args: EmptySeedWriteArgs): void {
  const { ctx, pages } = args;
  ctx.hooks.on("beforeChange", pages, context =>
    normalisedChoice(context as PageHookContext, args)
  );
  ctx.hooks.on("afterCreate", pages, context =>
    moveAfterCommit(context as PageHookContext, args)
  );
  ctx.hooks.on("afterUpdate", pages, context =>
    moveAfterCommit(context as PageHookContext, args)
  );
}
