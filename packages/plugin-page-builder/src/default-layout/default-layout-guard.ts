/**
 * Refusing to delete or unpublish the site's default Layout.
 *
 * Every page that names no Layout is drawn inside the default, so taking it
 * away changes every such page at once. The refusal tells the author what to do
 * instead: choose another default first, from the Layouts list.
 *
 * ## Before the write, and again after it
 *
 * The `before*` phases can still say no, so the refusal lives there. They read
 * the settings Single before the write commits, and a make-default racing the
 * write can point the default at this Layout between that read and the commit.
 * So the `after*` phases look once more: when the write left the default
 * unusable, they queue the repair, which re-points it at the seed. An after-hook
 * throw becomes a warning on a write that already committed, so they never
 * throw; they log.
 *
 * ## Inside a caller's transaction
 *
 * Core's atomic batch writers run these hooks inside a transaction they own and
 * hand them its `executor`. The Direct API takes no executor, so a read here
 * would check out a second connection that may wait on the one the transaction
 * holds, and on SQLite waits behind the transaction that is waiting for it.
 *
 * So inside one, the guard FAILS CLOSED without reading: every delete of a
 * Layout, and every update that unpublishes a published one, is refused, since
 * whether it is the default cannot be checked safely there. The admin's and the
 * REST bulk actions are unaffected: they write item by item with no caller
 * transaction, and each item is checked as a single write is. The after-hooks
 * likewise return without reading inside a transaction: with those writes
 * refused, nothing a transaction can do takes the default away.
 *
 * @module default-layout/default-layout-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { DEFAULT_LAYOUT_REFUSAL } from "../layout-removal/words";

import { queueDefaultLayoutRepair } from "./ensure-default";
import {
  defaultIsUsable,
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./store";

/** What a delete or unpublish inside a caller's transaction is told. */
const BATCH_REFUSAL =
  "To keep the site's default protected, delete or unpublish Layouts one at a time, not in a batch.";

/** The plugin context this needs, named structurally. */
export interface DefaultLayoutGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** The parts of a hook context these handlers read. */
interface LayoutHookContext {
  data?: unknown;
  originalData?: unknown;
  executor?: unknown;
  req?: { nextly?: unknown };
}

/** Register the guard on the Layouts collection, by its RESOLVED slug. */
export function registerDefaultLayoutGuard(args: {
  ctx: DefaultLayoutGuardContext;
  slugs: DefaultLayoutSlugs;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}): void {
  const { ctx, slugs, warn } = args;

  ctx.hooks.on("beforeDelete", slugs.layouts, async context => {
    const hook = context as LayoutHookContext;
    await refuseIfDefault(hook, slugs, relationId(hook.data));
  });

  ctx.hooks.on("beforeUpdate", slugs.layouts, async context => {
    const hook = context as LayoutHookContext;
    if (!unpublishes(hook)) return;
    await refuseIfDefault(hook, slugs, relationId(hook.originalData));
  });

  ctx.hooks.on("afterDelete", slugs.layouts, async context => {
    await repairIfUnusable(context as LayoutHookContext, slugs, warn);
  });

  ctx.hooks.on("afterUpdate", slugs.layouts, async context => {
    const hook = context as LayoutHookContext;
    // Only a write that left this row unpublished can have taken the default
    // away; every other save of a Layout is skipped without a read.
    if (statusOf(hook.data) === "published") return;
    await repairIfUnusable(hook, slugs, warn);
  });
}

/**
 * Whether this update unpublishes a published Layout.
 *
 * Only an explicit status other than `published` does. A save that leaves the
 * status out keeps the published row live and stores a pending edit beside it,
 * which takes nothing away from the pages drawn inside it.
 */
function unpublishes(hook: LayoutHookContext): boolean {
  const next = statusOf(hook.data);
  return (
    statusOf(hook.originalData) === "published" &&
    next !== undefined &&
    next !== "published"
  );
}

/** A row's `status`, or undefined when the row does not carry one. */
function statusOf(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const status = (row as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

/**
 * Refuse a delete or unpublish inside a caller's transaction, without reading:
 * see the module docblock. Checked before anything else the guard does.
 */
function refuseInsideATransaction(hook: LayoutHookContext): void {
  if (hook.executor === undefined) return;
  throw NextlyError.conflict({
    reason: "state",
    message: BATCH_REFUSAL,
    logContext: { reason: "default-layout-batch-refused" },
  });
}

/** Refuse the write when `id` is the site's default. */
async function refuseIfDefault(
  hook: LayoutHookContext,
  slugs: DefaultLayoutSlugs,
  id: string | null
): Promise<void> {
  refuseInsideATransaction(hook);
  if (id === null) return;
  const nextly = directApiOf(hook);
  if (nextly === null) return;
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  if (defaultLayout !== id) return;
  throw NextlyError.conflict({
    reason: "state",
    message: DEFAULT_LAYOUT_REFUSAL,
    logContext: { reason: "default-layout-protected", layoutId: id },
  });
}

/**
 * Queue the repair when the default is no longer usable. Never throws: this
 * runs after a committed write, and the sweep repairs whatever this misses.
 */
async function repairIfUnusable(
  hook: LayoutHookContext,
  slugs: DefaultLayoutSlugs,
  warn: (message: string, meta?: Record<string, unknown>) => void
): Promise<void> {
  // No read inside a caller's transaction: the before-check refused every
  // write there that could take the default away (see the module docblock).
  if (hook.executor !== undefined) return;
  const nextly = directApiOf(hook);
  if (nextly === null) return;
  try {
    if (await defaultIsUsable(nextly, slugs)) return;
    await queueDefaultLayoutRepair(nextly);
    warn(
      "[page-builder] a Layout write left the site's default missing or unpublished; a repair is queued",
      { layoutId: relationId(hook.data) }
    );
  } catch (error) {
    warn(
      "[page-builder] could not check the site's default Layout after a Layout write; the sweep will",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/** The Direct API the hook's request carries, or null. */
function directApiOf(hook: LayoutHookContext): DefaultLayoutDirectApi | null {
  const nextly = hook.req?.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as DefaultLayoutDirectApi)
    : null;
}
