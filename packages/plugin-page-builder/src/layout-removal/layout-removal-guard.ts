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
 *   row and its working draft both, read again through the reader the copy
 *   was taken with. A Layout edited after the copy is refused; the removal
 *   reads the version again, finds it moved, and takes the copy again.
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
 * ## Edits while a removal runs
 *
 * Every other update of the Layout, a publish included, is refused while its
 * removal holds it (from the mark until the write, inside the lease), so an
 * edit cannot land between the copy and the delete and be lost with it. A
 * settled removal and one older than its lease hold nothing.
 *
 * ## Publishing a Layout again
 *
 * An unpublish removal leaves its row as a tombstone, so the Layout cannot be
 * made the default while it is unpublished. Publishing it again drops the
 * tombstone.
 *
 * ## What this does not reach
 *
 * A write that skips hooks (a batch with `skipHooks`): it can unpublish a
 * Layout, the default or one pages use, past every check here, a known limit
 * of every guard a plugin registers. Core's all-languages lifecycle
 * (`POST …/entries/:id/unpublish-all` and `publish-all`) runs the collection's
 * hooks as a status change of one language does, so it meets these checks.
 * What a hook-less write leaves is repaired afterwards: the default repair
 * points an unusable default at a published Layout, and the removal sweep
 * drops an unpublish tombstone whose Layout such a write published again
 * (`settle.ts`).
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

import { readLayoutCopy, type CopyReads } from "./layout-copy";
import {
  holdsTheLayout,
  type LayoutRemoval,
  type LayoutRemovalStore,
  type RemovalAction,
} from "./store";
import { LAYOUT_EDIT_DURING_REMOVAL, REMOVE_LAYOUT_REFUSAL } from "./words";

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

/** The fence reads the guard makes, on either connection. */
export type FenceReads = Pick<
  LayoutRemovalStore,
  "removalOf" | "releaseTombstone"
>;

/** What the guard needs. */
export interface LayoutRemovalGuardArgs {
  ctx: LayoutRemovalGuardContext;
  layouts: string;
  store: () => LayoutRemovalStore;
  /**
   * The fence, reached through a caller's transaction, or `null` when the
   * executor it hands over is not one the fence can be read through.
   */
  inTransaction: (executor: unknown) => FenceReads | null;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

/** Register the guard on the Layouts collection, by its RESOLVED slug. */
export function registerLayoutRemovalGuard(args: LayoutRemovalGuardArgs): void {
  const { ctx, layouts, store } = args;

  ctx.hooks.on("beforeDelete", layouts, async context => {
    const hook = context as LayoutHookContext;
    await admitRemoval({ hook, layouts, store: store(), action: "delete" });
  });

  // `beforeChange`, not `beforeUpdate`: it runs after every `beforeUpdate`
  // hook, so a status another hook sets is the status judged.
  ctx.hooks.on("beforeChange", layouts, async context => {
    const hook = context as LayoutHookContext;
    if (unpublishes(hook)) {
      await admitRemoval({
        hook,
        layouts,
        store: store(),
        action: "unpublish",
      });
      return;
    }
    await refuseEditDuringRemoval(hook, args);
  });

  ctx.hooks.on("afterUpdate", layouts, async context => {
    await releaseOnPublish(context as LayoutHookContext, args);
  });
}

/** The fence as this hook may read it: its own connection, or the caller's transaction. */
function fenceFor(
  hook: LayoutHookContext,
  args: LayoutRemovalGuardArgs
): FenceReads | null {
  return hook.executor === undefined
    ? args.store()
    : args.inTransaction(hook.executor);
}

/**
 * Refuse any other update of a Layout while its removal holds it, so no edit
 * lands between the removal's copy and its delete. The removal's own write,
 * carrying its token, is let through. Inside a caller's transaction the fence
 * is read through that transaction; one it cannot be read through is refused.
 */
async function refuseEditDuringRemoval(
  hook: LayoutHookContext,
  args: LayoutRemovalGuardArgs
): Promise<void> {
  const id = editedLayout(hook);
  if (id === null) return;
  const fence = fenceFor(hook, args);
  if (fence === null) throw editRefusal("layout-edit-fence-unreadable", id);
  const removal = await fence.removalOf(id);
  if (removal === null || !holdsTheLayout(removal, nowOf(args))) return;
  if (hook.context?.[LAYOUT_REMOVAL_CONTEXT_KEY] === removal.token) return;
  throw editRefusal("layout-edit-during-removal", id);
}

/** The Layout an update edits, or null for any other write. */
function editedLayout(hook: LayoutHookContext): string | null {
  if (hook.operation !== undefined && hook.operation !== "update") return null;
  return relationId(hook.originalData);
}

/** The time a check is judged at. */
function nowOf(args: LayoutRemovalGuardArgs): Date {
  return args.now === undefined ? new Date() : args.now();
}

/** The refusal a Layout edit meets while its removal runs. */
function editRefusal(reason: string, layoutId: string): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: LAYOUT_EDIT_DURING_REMOVAL,
    logContext: { reason, layoutId },
  });
}

/**
 * Publishing a Layout again drops an unpublish removal's tombstone, through
 * the caller's transaction when the write ran in one, so it is dropped exactly
 * when the publish commits. Never throws: the write already committed.
 */
async function releaseOnPublish(
  hook: LayoutHookContext,
  args: LayoutRemovalGuardArgs
): Promise<void> {
  if (statusOf(hook.data) !== "published") return;
  const id = relationId(hook.data) ?? relationId(hook.originalData);
  if (id === null) return;
  const fence = fenceFor(hook, args);
  try {
    if (fence === null) throw new TypeError("no readable transaction");
    await fence.releaseTombstone(id);
  } catch (error) {
    args.warn(
      "[page-builder] a published Layout's unpublish record could not be cleared; it cannot be made the default until it is",
      {
        layoutId: id,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
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

/**
 * Whether the Layout still has the version its copy was taken at. Read again
 * through the same reader the copy was taken with (`readLayoutCopy`), never
 * from the hook's own row: that is the stored row as the database names it,
 * and a version over every authored field is only comparable between two
 * reads of the same shape.
 */
async function stillAsCopied(
  hook: LayoutHookContext,
  layouts: string,
  id: string,
  removal: LayoutRemoval
): Promise<boolean> {
  const nextly = directApiOf(hook);
  if (nextly === null) return false;
  const now = await readLayoutCopy(nextly, layouts, id);
  return now !== null && now.version === removal.copyVersion;
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
  if (!(await stillAsCopied(hook, layouts, removal.layoutId, removal))) {
    throw refusal(VERSION_MOVED, id);
  }
}
