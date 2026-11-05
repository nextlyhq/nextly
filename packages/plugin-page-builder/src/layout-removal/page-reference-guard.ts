/**
 * The page side of the Layout fence: no page write puts a page on a Layout
 * that Remove Layout is taking down.
 *
 * ## Refuse exactly the writes that ADD a reference
 *
 * `beforeCreate` and `beforeUpdate` on the pages collection. A write that
 * names a fenced Layout is refused unless the page already names it: a title
 * edit on a page that sits on the Layout keeps its reference, and the unchanged
 * `layout` key is dropped from the write so nothing downstream judges it. What
 * the page "already names" is its working draft's value when it has one, since
 * that is what a status-less save replaces; otherwise the stored row's. So a
 * save from a stale copy that names the Layout again, after the page's draft
 * moved off it, is refused as the addition it is.
 *
 * `beforeUpdate`, not `beforeChange`: the unchanged key has to be gone before
 * validation, where the floor below would otherwise refuse it.
 *
 * ## The floor, for writes that skip hooks
 *
 * The `layout` field's own `validate` (`layoutFenceFloor`) refuses ANY value
 * naming a fenced Layout. Hook-running writes reach it only with a value they
 * change, since the hook drops an unchanged one; a write that skips hooks
 * meets it with every value it sends. A fence that cannot be read, or does
 * not answer in time, refuses.
 *
 * ## Inside a caller's transaction
 *
 * Core's batch writers run these hooks inside a transaction they own and hand
 * them its `executor`. The hook reads the fence on that executor, never the
 * pool, which would check out a second connection that may wait on the one
 * the transaction holds; and it refuses ANY value naming a fenced Layout,
 * since what the page already names cannot be read there safely. The floor is
 * handed no transaction, so its own read goes through the pool; it is bounded
 * in time and refuses rather than waiting on the transaction it is part of.
 *
 * ## A write already in flight when the fence went up
 *
 * A page save whose hook ran before the fence and whose commit lands after the
 * removal's last scan names a Layout on its way out. Both sides look again
 * after their own commit, so whichever commits second sees the other:
 *
 * - here, after a page write commits, a page naming a Layout whose removal is
 *   past its final check has that Layout cleared;
 * - the removal, after its own write, scans again and clears the same.
 *
 * Cleared means the unpublished page's row, or a published page's working
 * draft, names no Layout: the page falls to the site default. A published
 * page's live row is left as it is, since no write changes a live row without
 * publishing the draft beside it; a live row naming a removed Layout already
 * draws the site default.
 *
 * @module layout-removal/page-reference-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import { relationId } from "../default-layout/store";
import { documentVersionOf, withVersionFrom } from "../document-version";

import { confirmedGone, unlessGone } from "./layout-references";
import type { LayoutRemoval, LayoutRemovalStore } from "./store";
import { pageLayoutRefusal, type FencedLayoutState } from "./words";

/** Why a page's Layout was cleared, as the server log records it. */
export const IN_FLIGHT_CLEARED = "layout-being-removed";

/** The plugin context this needs, named structurally. */
export interface PageReferenceGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** The parts of a page hook context these handlers read. */
interface PageHookContext {
  operation?: unknown;
  data?: unknown;
  originalData?: unknown;
  executor?: unknown;
  req?: { nextly?: unknown };
}

/** The Direct API calls the page side makes. */
type PageReads = Pick<Nextly, "find" | "findByID" | "update">;

/** What the guard needs. */
export interface PageReferenceGuardArgs {
  ctx: PageReferenceGuardContext;
  /** The RESOLVED pages slug: a host may rename it. */
  pages: string;
  store: () => LayoutRemovalStore;
  /**
   * The fence read on a caller's transaction, from the executor core hands the
   * hooks it runs inside one; `null` when the executor is not one it can use.
   */
  inTransaction: (
    executor: unknown
  ) => Pick<LayoutRemovalStore, "removalOf"> | null;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** Where a fenced Layout stands, as a page write is told. */
export function fencedStateOf(removal: LayoutRemoval): FencedLayoutState {
  if (removal.step !== "removed") return "removing";
  return removal.action === "unpublish" ? "unpublished" : "deleted";
}

/** The refusal a page write naming a fenced Layout meets, on its field. */
function refusal(removal: LayoutRemoval): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "layout",
        code: "LAYOUT_BEING_REMOVED",
        message: pageLayoutRefusal(fencedStateOf(removal)),
      },
    ],
    logContext: { reason: "page-layout-fenced", layoutId: removal.layoutId },
  });
}

/** The Direct API the hook's request carries, or null. */
function directApiOf(hook: PageHookContext): PageReads | null {
  const nextly = hook.req?.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as PageReads)
    : null;
}

/** The page as it stands: its working draft when it has one, else its row. */
async function currentPage(
  nextly: Pick<Nextly, "find" | "findByID">,
  pages: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const read: unknown = await unlessGone(
    nextly.findByID({
      collection: pages,
      id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    }),
    () => confirmedGone(nextly, pages, id)
  );
  return typeof read === "object" && read !== null
    ? (read as Record<string, unknown>)
    : null;
}

/**
 * The Layout the page names now: its working draft's, read by id, when it has
 * one; otherwise the stored row's (`originalData`, the live row).
 */
async function storedLayoutOf(
  hook: PageHookContext,
  pages: string
): Promise<string | null> {
  const id = relationId(hook.originalData);
  const nextly = directApiOf(hook);
  if (id !== null && nextly !== null) {
    const current = await currentPage(nextly, pages, id);
    if (current?._isWorkingDraft === true) return relationId(current.layout);
  }
  const original = hook.originalData as { layout?: unknown } | undefined;
  return relationId(original?.layout);
}

/**
 * The before-write check, by the rule in the module docblock. Answers the data
 * to write without an unchanged `layout`, or `undefined` to leave it as sent.
 */
async function refuseAddedReference(
  hook: PageHookContext,
  args: PageReferenceGuardArgs,
  creating: boolean
): Promise<Record<string, unknown> | undefined> {
  const data = hook.data;
  if (typeof data !== "object" || data === null) return undefined;
  if (!Object.hasOwn(data, "layout")) return undefined;
  const next = relationId((data as { layout?: unknown }).layout);
  if (next === null) return undefined;
  if (hook.executor !== undefined) {
    return judgeInTransaction(hook.executor, next, args);
  }
  const removal = await args.store().removalOf(next);
  if (removal === null) return undefined;
  const stored = creating ? null : await storedLayoutOf(hook, args.pages);
  if (stored !== next) throw refusal(removal);
  const kept: Record<string, unknown> = { ...data };
  delete kept.layout;
  return kept;
}

/**
 * The before-write check inside a caller's transaction: the fence read on the
 * transaction's own connection, and any value naming a fenced Layout refused,
 * since what the page already names cannot be read there safely. An executor
 * it cannot read through leaves the write to the floor.
 */
async function judgeInTransaction(
  executor: unknown,
  next: string,
  args: PageReferenceGuardArgs
): Promise<undefined> {
  const fence = args.inTransaction(executor);
  if (fence === null) return undefined;
  const removal = await fence.removalOf(next);
  if (removal !== null) throw refusal(removal);
  return undefined;
}

/** Whether a removal is past the point where it can still stop. */
function pastItsFinalCheck(removal: LayoutRemoval): boolean {
  return (
    removal.step === "final" ||
    removal.step === "removed" ||
    removal.step === "restoring"
  );
}

/**
 * Clear `layoutId` from the page `pageId`, where it can be cleared without
 * publishing anything: the working draft of a published page, or the row of an
 * unpublished one. Answers whether it cleared anything. The write leaves the
 * status out, so a published page's live row is untouched.
 */
export async function clearPageReference(
  nextly: PageReads,
  pages: string,
  pageId: string,
  layoutId: string
): Promise<boolean> {
  const current = await currentPage(nextly, pages, pageId);
  if (current === null || relationId(current.layout) !== layoutId) {
    return false;
  }
  const isDraft = current._isWorkingDraft === true;
  if (!isDraft && current.status === "published") return false;
  // A page deleted since the read has nothing left to clear. Sent with the
  // version the page was read at above, so a save of the page between that
  // read and this write refuses it rather than being undone.
  const cleared = await unlessGone(
    nextly.update({
      collection: pages,
      id: pageId,
      data: withVersionFrom({ layout: null }, documentVersionOf(current)),
      overrideAccess: true,
    }),
    () => confirmedGone(nextly, pages, pageId)
  );
  return cleared !== null;
}

/** The page and the Layout a committed page write names, or null. */
function inFlightWrite(
  hook: PageHookContext
): { named: string; pageId: string; nextly: PageReads } | null {
  // Inside a caller's transaction the floor refused every fenced value.
  if (hook.executor !== undefined) return null;
  const named = relationId((hook.data as { layout?: unknown } | null)?.layout);
  const pageId = relationId(hook.data) ?? relationId(hook.originalData);
  const nextly = directApiOf(hook);
  if (named === null || pageId === null || nextly === null) return null;
  return { named, pageId, nextly };
}

/** Clear the page's Layout when its removal is past its final check. */
async function clearIfRemoved(
  write: { named: string; pageId: string; nextly: PageReads },
  args: PageReferenceGuardArgs,
  phase: "afterCreate" | "afterUpdate"
): Promise<void> {
  const { named, pageId, nextly } = write;
  const removal = await args.store().removalOf(named);
  if (removal === null || !pastItsFinalCheck(removal)) return;
  if (!(await clearPageReference(nextly, args.pages, pageId, named))) return;
  args.warn(
    "[page-builder] a page write in flight was cleared to the site default because its Layout is being removed",
    { pageId, layoutId: named, phase, reason: IN_FLIGHT_CLEARED }
  );
}

/** The after-write look, by the rule in the module docblock. Never throws. */
async function clearInFlight(
  hook: PageHookContext,
  args: PageReferenceGuardArgs,
  phase: "afterCreate" | "afterUpdate"
): Promise<void> {
  const write = inFlightWrite(hook);
  if (write === null) return;
  try {
    await clearIfRemoved(write, args, phase);
  } catch (error) {
    args.warn(
      "[page-builder] could not check a saved page against a Layout removal; the removal's own check after its write will",
      {
        pageId: write.pageId,
        layoutId: write.named,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

/** Register the page side on the pages collection, by its RESOLVED slug. */
export function registerPageReferenceGuard(args: PageReferenceGuardArgs): void {
  const { ctx, pages } = args;
  ctx.hooks.on("beforeCreate", pages, context =>
    refuseAddedReference(context as PageHookContext, args, true)
  );
  ctx.hooks.on("beforeUpdate", pages, context =>
    refuseAddedReference(context as PageHookContext, args, false)
  );
  ctx.hooks.on("afterCreate", pages, context =>
    clearInFlight(context as PageHookContext, args, "afterCreate")
  );
  ctx.hooks.on("afterUpdate", pages, context =>
    clearInFlight(context as PageHookContext, args, "afterUpdate")
  );
}

/** How long the floor waits for the fence before refusing. */
const FLOOR_READ_TIMEOUT_MS = 5000;

/** `read`, or a rejection once `ms` pass without an answer. */
function withinTime<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the fence did not answer")), ms);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

/**
 * The `layout` field's floor, by the rule in the module docblock. `store` is
 * read per call: the field is declared before the plugin is installed, and
 * until it is there is no fence to read, so every value passes.
 *
 * The read is bounded in time. A field's check is handed no transaction, so
 * inside a caller's one it reads through the pool; where the transaction holds
 * the only free connection that read would wait on itself. A fence that does
 * not answer in time refuses, as one that cannot be read does.
 */
export function layoutFenceFloor(
  store: () => Pick<LayoutRemovalStore, "removalOf"> | undefined,
  options: { timeoutMs?: number } = {}
): (value: unknown) => Promise<string | true> {
  const timeoutMs = options.timeoutMs ?? FLOOR_READ_TIMEOUT_MS;
  return async value => {
    const id = relationId(value);
    if (id === null) return true;
    const fence = store();
    if (fence === undefined) return true;
    try {
      const removal = await withinTime(fence.removalOf(id), timeoutMs);
      return removal === null
        ? true
        : pageLayoutRefusal(fencedStateOf(removal));
    } catch {
      // Unreadable, or not in time: refused, so a write that skips hooks
      // cannot slip a page onto a Layout being removed while the fence is out
      // of reach.
      return pageLayoutRefusal("removing");
    }
  };
}
