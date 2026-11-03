/**
 * A Layout's own delete and unpublish go through Remove Layout, or not at all.
 *
 * Remove Layout fences the Layout, checks it is not the default and that no
 * page names it, takes a copy, and only then deletes or unpublishes it. Any
 * other delete or unpublish of a Layout would skip every one of those checks,
 * so this refuses them, naming the way to do it.
 *
 * ## What is let through
 *
 * A write is let through only when ALL hold:
 *
 * - its hook context carries a removal token (set by the server-side caller
 *   of the Direct API, never read from a request body);
 * - the Layout's fence row holds that token, at its `final` step;
 * - the row's action is this write's (a delete, or an unpublish);
 * - the Layout still has the version the row's copy was taken at, its live
 *   row and its working draft both. A Layout edited after the copy is refused
 *   with a reason the removal recognises, and it takes the copy again.
 *
 * ## Registered after the default guard
 *
 * So a write that would take the site's default away is told that first:
 * choosing another default is what the author has to do, whichever way they
 * remove the Layout.
 *
 * ## Inside a caller's transaction
 *
 * Refused without reading, as the default guard refuses there: the batch
 * writers hand their hooks an executor this plugin's reads cannot join, and a
 * read on a second connection can wait on the one the transaction holds.
 *
 * ## Publishing a Layout again
 *
 * An unpublish removal leaves its row as a tombstone, so the Layout cannot be
 * made the default while it is unpublished. Publishing it again drops the
 * tombstone.
 *
 * ## What this does not reach
 *
 * A write that skips hooks (a batch with `skipHooks`), and the all-languages
 * unpublish, which runs no collection hooks. Both are known limits of every
 * guard a plugin registers.
 *
 * @module layout-removal/layout-removal-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { relationId } from "../default-layout/store";
import {
  statusOf,
  unpublishes,
  type UnpublishHookContext,
} from "../unpublish-write";

import { versionOf, workingDraftOf, type CopyReads } from "./layout-copy";
import type { LayoutRemoval, LayoutRemovalStore, RemovalAction } from "./store";
import { REMOVE_LAYOUT_REFUSAL } from "./words";

/**
 * The hook-context key a removal's own write carries its token under.
 * Namespaced by plugin so no other caller's key collides with it.
 */
export const LAYOUT_REMOVAL_CONTEXT_KEY = "pageBuilder.layoutRemoval";

/** The log reason a refusal for a moved version carries, for the removal. */
export const VERSION_MOVED = "layout-removal-version-moved";

/** The plugin context this needs, named structurally. */
export interface LayoutRemovalGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** The parts of a hook context the guard reads. */
interface LayoutHookContext extends UnpublishHookContext {
  context?: Record<string, unknown>;
  executor?: unknown;
  req?: { nextly?: unknown };
}

/** Register the guard on the Layouts collection, by its RESOLVED slug. */
export function registerLayoutRemovalGuard(args: {
  ctx: LayoutRemovalGuardContext;
  layouts: string;
  store: () => LayoutRemovalStore;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}): void {
  const { ctx, layouts, store, warn } = args;

  ctx.hooks.on("beforeDelete", layouts, async context => {
    const hook = context as LayoutHookContext;
    await admitRemoval({ hook, layouts, store: store(), action: "delete" });
  });

  // `beforeChange`, not `beforeUpdate`: it runs after every `beforeUpdate`
  // hook, so a status another hook sets is the status judged.
  ctx.hooks.on("beforeChange", layouts, async context => {
    const hook = context as LayoutHookContext;
    if (!unpublishes(hook)) return;
    await admitRemoval({ hook, layouts, store: store(), action: "unpublish" });
  });

  ctx.hooks.on("afterUpdate", layouts, async context => {
    const hook = context as LayoutHookContext;
    // No read inside a caller's transaction, and none for a save that leaves
    // the Layout unpublished.
    if (hook.executor !== undefined) return;
    if (statusOf(hook.data) !== "published") return;
    const id = relationId(hook.data) ?? relationId(hook.originalData);
    if (id === null) return;
    try {
      await store().releaseTombstone(id);
    } catch (error) {
      warn(
        "[page-builder] a published Layout's unpublish record could not be cleared; it cannot be made the default until it is",
        {
          layoutId: id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  });
}

/** The refusal every write that is not a removal's own meets. */
function refusal(reason: string, layoutId: string | null): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: REMOVE_LAYOUT_REFUSAL,
    logContext: { reason, layoutId },
  });
}

/** The Direct API the hook's request carries, or null. */
function directApiOf(hook: LayoutHookContext): CopyReads | null {
  const nextly = hook.req?.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as CopyReads)
    : null;
}

/**
 * The removal this write claims to be, when the claim holds: its token is the
 * fence row's, the row is at `final`, and the row's action is this write's.
 * Otherwise null.
 */
async function claimedRemoval(
  hook: LayoutHookContext,
  store: LayoutRemovalStore,
  id: string,
  action: RemovalAction
): Promise<LayoutRemoval | null> {
  const token = hook.context?.[LAYOUT_REMOVAL_CONTEXT_KEY];
  if (typeof token !== "string") return null;
  const removal = await store.removalOf(id);
  return removal !== null &&
    removal.token === token &&
    removal.step === "final" &&
    removal.action === action
    ? removal
    : null;
}

/** Whether the Layout still has the version its copy was taken at. */
async function stillAsCopied(
  hook: LayoutHookContext,
  layouts: string,
  live: Record<string, unknown>,
  removal: LayoutRemoval
): Promise<boolean> {
  const nextly = directApiOf(hook);
  if (nextly === null) return false;
  const draft = await workingDraftOf(nextly, layouts, removal.layoutId);
  return versionOf(live, draft) === removal.copyVersion;
}

/** Let the write through only by the rule in the module docblock. */
async function admitRemoval(args: {
  hook: LayoutHookContext;
  layouts: string;
  store: LayoutRemovalStore;
  action: RemovalAction;
}): Promise<void> {
  const { hook, layouts, store, action } = args;
  // The row as stored: a delete hands the entry, an update the live row.
  const live = action === "delete" ? hook.data : hook.originalData;
  const id = relationId(live);
  if (hook.executor !== undefined) {
    throw refusal("layout-removal-inside-transaction", id);
  }
  const removal =
    id === null ? null : await claimedRemoval(hook, store, id, action);
  if (removal === null) throw refusal("layout-removal-not-through-remove", id);
  if (
    !(await stillAsCopied(
      hook,
      layouts,
      live as Record<string, unknown>,
      removal
    ))
  ) {
    throw refusal(VERSION_MOVED, id);
  }
}
