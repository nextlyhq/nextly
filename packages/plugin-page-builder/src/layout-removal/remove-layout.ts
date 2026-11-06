/**
 * Remove Layout: the one way a Layout is deleted or unpublished.
 *
 * ## The steps, in order
 *
 * 0. **Read the Layout as the remover**, their access enforced: one they may
 *    not read answers as missing, before anything is read past their access.
 * 1. **Dry run.** Read the default and scan the pages; answer what stands in
 *    the way, writing nothing.
 * 2. **Mark.** Insert the fence row. From now on the Layout cannot become the
 *    default, and nothing else can delete or unpublish it.
 * 3. **Check the default**, read AFTER the mark committed: a promotion that
 *    committed first is seen here, and one that commits later sees the mark
 *    and refuses itself. The default is refused, saying to choose another.
 * 4. **Final scan**, under the fence. Any page naming the Layout stops the
 *    removal, live rows included: nothing here moves a page, so a removal
 *    with pages would change how those pages look with nobody asked. An
 *    unfinished scan stops it too. A removal that moved its pages first
 *    (`move-pages.ts`) looks past live rows here: the person confirmed that
 *    those pages switch to the site default once the Layout is gone.
 * 5. **Copy.** The default is read once more, then the Layout's live row and
 *    working draft are stored with their version on the row, at `final`.
 * 6. **Remove**, as the person, through the Direct API, so their own rights
 *    decide. The write carries the row's token, which the guard requires.
 *    When the Layout changed since the copy, the guard refuses and the copy is
 *    taken again, a bounded number of times. A write that rejects after it
 *    committed is recognised by reading the Layout again, and settled.
 * 7. **Settle**: the check after the write (`settle.ts`).
 *
 * Every step change is a compare-and-set on the row's token, so a request a
 * later one took over changes nothing. Anything that stops the removal before
 * its write takes the fence down again.
 *
 * @module layout-removal/remove-layout
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "../default-layout/store";
import { documentVersionOf, withVersionFrom } from "../document-version";

import { readLayoutCopy } from "./layout-copy";
import {
  namesItOffTheLiveRow,
  readableTitles,
  scanLayoutReferences,
  type PageReference,
  type PersonReads,
} from "./layout-references";
import { LAYOUT_REMOVAL_CONTEXT_KEY } from "./layout-removal-guard";
import type { MoveProgress } from "./move-pages";
import type { RestoreDeps } from "./restore";
import {
  settleRemoval,
  undoUnpublishIfPagesNameIt,
  writeLanded,
} from "./settle";
import type { RemovalAction } from "./store";
import {
  ALREADY_BEING_REMOVED,
  CHANGED_WHILE_REMOVING,
  DEFAULT_LAYOUT_REFUSAL,
  KEPT_AS_DEFAULT,
  NOT_PUBLISHED,
  pagesUseItRefusal,
  stillUsedAfterDelete,
} from "./words";

/** How many times a removal takes its copy again for a Layout that changed. */
const COPY_ATTEMPTS = 3;

/** What one removal needs. */
export interface RemoveLayoutDeps extends RestoreDeps {
  readonly nextly: DefaultLayoutDirectApi;
  readonly slugs: DefaultLayoutSlugs & { readonly pages: string };
  /** The person removing it: who is recorded, and how their writes run. */
  readonly person: { readonly userId: string | null; readonly as: PersonReads };
  readonly now: () => Date;
  readonly newToken: () => string;
  /** The scan's page-read budget; the default is `PAGE_READ_BUDGET`. */
  readonly budget?: number;
}

/** One request to remove a Layout. */
export interface RemoveRequest {
  readonly layoutId: string;
  readonly action: RemovalAction;
  readonly dryRun: boolean;
}

/**
 * Where a page naming the Layout names it, as the dialog tags it: on its live
 * row alone (`published`), on its only row (`unpublished`), or on a published
 * page's working draft, its live row naming it or not (`edited`).
 */
export type CheckedPageState = "published" | "unpublished" | "edited";

/** One page in the way, as the person may see it. */
export interface CheckedPage {
  readonly id: string;
  readonly title: string;
  readonly state: CheckedPageState;
}

/** What stands in the way of a removal, as the person may see it. */
export interface RemovalCheck {
  readonly isDefault: boolean;
  readonly pages: readonly CheckedPage[];
  readonly unreadable: number;
  readonly complete: boolean;
  /** The pages collection, as renamed, so a page can be linked to. */
  readonly pagesCollection: string;
  /**
   * How many of those pages, named or only counted, have a LIVE row naming
   * the Layout: the published pages that switch to the site default once it
   * is gone, rather than being moved.
   */
  readonly liveRows: number;
  /**
   * The site default Layout the pages would move to, by the title the person
   * may read; `null` when the site has none or they may not read it.
   */
  readonly siteDefault: string | null;
}

/** What the route answers with, inside the mutation envelope's `item`. */
export interface RemoveResult {
  readonly layoutId: string;
  readonly action: RemovalAction;
  readonly dryRun: boolean;
  /** Present on a dry run. */
  readonly check?: RemovalCheck;
  /** Present on a tick of a move (`move-pages.ts`). */
  readonly move?: MoveProgress;
  /**
   * After a delete: the pages a publish made while it ran left naming the
   * Layout on their live row, as the person may see them. They show the site
   * default until published with another Layout.
   */
  readonly stillUsedBy?: {
    readonly pages: readonly { readonly id: string; readonly title: string }[];
    readonly unreadable: number;
  };
}

/** The answer: the envelope's message and item. */
export interface RemoveAnswer {
  readonly message: string;
  readonly item: RemoveResult;
}

/** A conflict an author can act on. */
export function conflict(
  message: string,
  reason: string,
  layoutId: string
): Error {
  return NextlyError.conflict({
    reason: "state",
    message,
    logContext: { reason, layoutId },
  });
}

/**
 * Refuse a Layout the remover may not read, or that does not exist, and an
 * unpublish of one not published.
 *
 * The one read made as the remover, with their access enforced, so a row rule
 * that hides this Layout from them is judged before anything is read past it:
 * a hidden Layout answers as missing, and nothing about its default status or
 * its pages is looked up for them. The write itself is judged by its own gate.
 */
export async function requireRemovable(
  deps: RemoveLayoutDeps,
  request: Pick<RemoveRequest, "layoutId" | "action">
): Promise<void> {
  const found = await deps.nextly.find({
    collection: deps.slugs.layouts,
    where: { id: { equals: request.layoutId } },
    status: "all",
    limit: 1,
    depth: 0,
    select: { status: true },
    ...deps.person.as,
  });
  const row = found.items[0] as { status?: unknown } | undefined;
  if (row === undefined) throw NextlyError.notFound();
  if (request.action === "unpublish" && row.status !== "published") {
    throw conflict(
      NOT_PUBLISHED,
      "layout-removal-not-published",
      request.layoutId
    );
  }
}

/** How the dialog tags a page, from where it names the Layout. */
function stateOf(reference: PageReference): CheckedPageState {
  if (reference.place === "unpublished") return "unpublished";
  if (reference.place === "draft" || reference.draftToo === true) {
    return "edited";
  }
  return "published";
}

/** The pages naming the Layout, as the person may see them. */
async function checkPages(
  deps: RemoveLayoutDeps,
  layoutId: string,
  options: {
    readonly onProgress?: () => Promise<void>;
    /** Leave out pages that name it only on their live row. */
    readonly offTheLiveRow?: boolean;
  } = {}
): Promise<Omit<RemovalCheck, "isDefault" | "siteDefault">> {
  const scan = await scanLayoutReferences({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    layoutId,
    ...(deps.budget === undefined ? {} : { budget: deps.budget }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });
  const references =
    options.offTheLiveRow === true
      ? scan.references.filter(namesItOffTheLiveRow)
      : scan.references;
  const named = await readableTitles({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    references,
    asPerson: deps.person.as,
  });
  const states = new Map(references.map(ref => [ref.id, stateOf(ref)]));
  return {
    pages: named.readable.map(page => ({
      ...page,
      state: states.get(page.id) ?? "published",
    })),
    unreadable: named.unreadable,
    complete: scan.complete,
    pagesCollection: deps.slugs.pages,
    liveRows: references.filter(ref => ref.place === "live").length,
  };
}

/**
 * The title of the site default Layout `id`, as the person reads it, or null
 * when there is none or they may not read it.
 */
async function siteDefaultTitle(
  deps: RemoveLayoutDeps,
  id: string | null
): Promise<string | null> {
  if (id === null) return null;
  const found = await deps.nextly.find({
    collection: deps.slugs.layouts,
    where: { id: { equals: id } },
    status: "all",
    limit: 1,
    depth: 0,
    select: { title: true },
    ...deps.person.as,
  });
  const title = (found.items[0] as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title !== "" ? title : null;
}

/** Whether the settings Single names `layoutId` as the default now. */
async function isDefault(
  deps: RemoveLayoutDeps,
  layoutId: string
): Promise<boolean> {
  return (
    (await readLayoutSettings(deps.nextly, deps.slugs)).defaultLayout ===
    layoutId
  );
}

/** Step 1: what would stop the removal, writing nothing. */
async function dryRun(
  deps: RemoveLayoutDeps,
  request: RemoveRequest
): Promise<RemoveAnswer> {
  const { defaultLayout } = await readLayoutSettings(deps.nextly, deps.slugs);
  const check: RemovalCheck = {
    isDefault: defaultLayout === request.layoutId,
    ...(await checkPages(deps, request.layoutId)),
    siteDefault:
      defaultLayout === request.layoutId
        ? null
        : await siteDefaultTitle(deps, defaultLayout),
  };
  const blocked =
    check.isDefault ||
    check.pages.length + check.unreadable > 0 ||
    !check.complete;
  return {
    message: blocked
      ? "This Layout can't be removed yet."
      : "This Layout can be removed.",
    item: { ...request, check },
  };
}

/**
 * Step 2: put the fence up, or say another removal holds it. A move may take
 * up its own starter's stopped move again (`resumeMove`).
 */
export async function mark(
  deps: RemoveLayoutDeps,
  request: Pick<RemoveRequest, "layoutId" | "action">,
  token: string,
  resumeMove = false
): Promise<void> {
  const marked = await deps.store.mark({
    layoutId: request.layoutId,
    action: request.action,
    token,
    startedBy: deps.person.userId,
    now: deps.now(),
    ...(resumeMove ? { resumeMove } : {}),
  });
  if (marked.kind === "busy") {
    throw conflict(
      ALREADY_BEING_REMOVED,
      "layout-removal-busy",
      request.layoutId
    );
  }
}

/** Steps 3 and 5's default check: refuse while the Layout is the default. */
export async function refuseIfDefault(
  deps: RemoveLayoutDeps,
  layoutId: string
): Promise<void> {
  if (await isDefault(deps, layoutId)) {
    throw conflict(DEFAULT_LAYOUT_REFUSAL, "layout-removal-default", layoutId);
  }
}

/** Move the row on, or refuse: another request took the fence over. */
export async function advanceOrRefuse(
  deps: RemoveLayoutDeps,
  change: Parameters<RemoveLayoutDeps["store"]["advance"]>[0]
): Promise<void> {
  if (!(await deps.store.advance(change))) {
    throw conflict(
      ALREADY_BEING_REMOVED,
      "layout-removal-taken-over",
      change.layoutId
    );
  }
}

/** How often a scan under the fence renews the row's lease. */
const LEASE_RENEWAL_MS = 60_000;

/**
 * Renew the row's lease at `step` as a scan goes, at most once a minute, so a
 * removal busy with a long scan never looks stopped to the sweep or to a later
 * removal.
 */
export function leaseKeeper(
  deps: RemoveLayoutDeps,
  layoutId: string,
  token: string,
  step: "checked" | "moving"
): () => Promise<void> {
  let renewedAt = deps.now().getTime();
  return async () => {
    const now = deps.now().getTime();
    if (now - renewedAt < LEASE_RENEWAL_MS) return;
    renewedAt = now;
    await deps.store.renew(layoutId, token, step);
  };
}

/**
 * Step 4: refuse while any page names the Layout, or the scan stopped short.
 * After a move, a page naming it only on its live row is not counted.
 */
async function finalScan(
  deps: RemoveLayoutDeps,
  layoutId: string,
  token: string,
  movedPages: boolean
): Promise<void> {
  const pages = await checkPages(deps, layoutId, {
    onProgress: leaseKeeper(deps, layoutId, token, "checked"),
    offTheLiveRow: movedPages,
  });
  if (pages.complete && pages.pages.length + pages.unreadable === 0) return;
  throw conflict(
    pagesUseItRefusal({
      titles: pages.pages.map(page => page.title),
      unreadable: pages.unreadable,
      complete: pages.complete,
    }),
    "layout-removal-pages-use-it",
    layoutId
  );
}

/**
 * Step 6's write, as the person, carrying the row's token. An unpublish sends
 * `rev`, the version the copy was read at, so a save of the Layout since the
 * copy refuses it; a delete removes the row whatever it holds.
 */
async function write(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  token: string,
  rev: string | undefined
): Promise<void> {
  const common = {
    collection: deps.slugs.layouts,
    id: request.layoutId,
    ...deps.person.as,
    context: { [LAYOUT_REMOVAL_CONTEXT_KEY]: token },
  };
  if (request.action === "delete") {
    await deps.nextly.delete(common);
  } else {
    await deps.nextly.update({
      ...common,
      data: withVersionFrom({ status: "draft" }, rev),
    });
  }
}

/**
 * Whether a refused write was refused because the Layout changed since the
 * copy: the Layout read again has another version. Decided by reading, not by
 * the refusal's own details, which core replaces on the way out of a hook.
 */
async function movedSinceTheCopy(
  deps: RemoveLayoutDeps,
  layoutId: string,
  version: string,
  error: unknown
): Promise<boolean> {
  if (!NextlyError.isCode(error, "CONFLICT")) return false;
  const now = await readLayoutCopy(deps.nextly, deps.slugs.layouts, layoutId);
  return now !== null && now.version !== version;
}

/**
 * A rejected write can still have committed: a failure after the commit (a
 * release re-check, say) reaches the caller as an error. So the Layout is read
 * again, as the system. If the write took effect, the removal goes on to its
 * check after the write, keeping its copy for a promotion that raced it; only
 * when nothing changed is the error passed on, and the fence taken down.
 */
async function passOnUnlessItLanded(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  error: unknown
): Promise<void> {
  if (!(await writeLanded(deps, request))) throw error;
  deps.warn(
    "[page-builder] a Layout removal's write failed after it committed; the removal goes on to its check after the write",
    {
      layoutId: request.layoutId,
      action: request.action,
      error: error instanceof Error ? error.message : String(error),
    }
  );
}

/** Steps 5 and 6: take the copy and write, again if the Layout moved. */
async function copyThenRemove(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  token: string
): Promise<void> {
  const { layoutId } = request;
  for (let attempt = 0; attempt < COPY_ATTEMPTS; attempt += 1) {
    await refuseIfDefault(deps, layoutId);
    const taken = await readLayoutCopy(
      deps.nextly,
      deps.slugs.layouts,
      layoutId
    );
    if (taken === null) throw NextlyError.notFound();
    await advanceOrRefuse(deps, {
      layoutId,
      token,
      from: attempt === 0 ? "checked" : "final",
      to: "final",
      set: { copy: taken.copy, copyVersion: taken.version },
    });
    try {
      await write(deps, request, token, documentVersionOf(taken.copy.live));
      return;
    } catch (error) {
      // A write refused as made from an out-of-date version was refused
      // because the Layout was saved since the copy, even when the save left
      // its content as it was: the copy is taken again, as for any move.
      if (
        !NextlyError.isCode(error, "STALE_VERSION") &&
        !(await movedSinceTheCopy(deps, layoutId, taken.version, error))
      ) {
        await passOnUnlessItLanded(deps, request, error);
        return;
      }
    }
  }
  throw conflict(
    CHANGED_WHILE_REMOVING,
    "layout-removal-kept-changing",
    layoutId
  );
}

/**
 * Step 7, for an unpublish: the look after the write that the sweep also runs
 * ({@link undoUnpublishIfPagesNameIt}). When it put the Layout back, the
 * removal answers as blocked by the pages it found, having changed nothing.
 */
async function undoIfPagesNameIt(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  token: string,
  movedPages: boolean
): Promise<void> {
  const { layoutId } = request;
  const scan = await undoUnpublishIfPagesNameIt(
    { ...deps, pagesSlug: deps.slugs.pages },
    layoutId,
    token,
    movedPages
  );
  if (scan === null) return;
  const named = await readableTitles({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    references: scan.references,
    asPerson: deps.person.as,
  });
  throw conflict(
    pagesUseItRefusal({
      titles: named.readable.map(page => page.title),
      unreadable: named.unreadable,
      complete: scan.complete,
    }),
    "layout-removal-page-published-meanwhile",
    layoutId
  );
}

/**
 * The pages still naming a deleted Layout on their live row, as the person
 * may see them, and the sentence that says so; null when there are none.
 */
async function stillUsedAfterTheDelete(
  deps: RemoveLayoutDeps,
  layoutId: string,
  live: readonly PageReference[]
): Promise<{
  message: string;
  stillUsedBy: NonNullable<RemoveResult["stillUsedBy"]>;
} | null> {
  if (live.length === 0) return null;
  const named = await readableTitles({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    references: live,
    asPerson: deps.person.as,
  });
  deps.warn(
    "[page-builder] a deleted Layout is still named by published pages; they show the site default until published with another Layout",
    { layoutId, pages: live.map(page => page.id) }
  );
  return {
    message: stillUsedAfterDelete({
      titles: named.readable.map(page => page.title),
      unreadable: named.unreadable,
    }),
    stillUsedBy: { pages: named.readable, unreadable: named.unreadable },
  };
}

/**
 * Step 7: the check after the write. After a move, the pages whose live row
 * still names a deleted Layout are the ones the person was told switch to the
 * site default, so they are not reported again.
 */
async function settle(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  token: string,
  movedPages: boolean
): Promise<RemoveAnswer> {
  const { layoutId } = request;
  if (request.action === "unpublish") {
    await undoIfPagesNameIt(deps, request, token, movedPages);
  }
  const moved = await deps.store.advance({
    layoutId,
    token,
    from: "final",
    to: "removed",
  });
  const removal = moved ? await deps.store.removalOf(layoutId) : null;
  // A row moved by anyone else after the write is the repair restoring it.
  if (removal === null || removal.token !== token) {
    throw conflict(
      KEPT_AS_DEFAULT,
      "layout-removal-restored-elsewhere",
      layoutId
    );
  }
  const settled = await settleRemoval(
    { ...deps, pagesSlug: deps.slugs.pages },
    removal
  );
  if (settled.outcome === "restored") {
    throw conflict(KEPT_AS_DEFAULT, "layout-removal-raced-promotion", layoutId);
  }
  const still = movedPages
    ? null
    : await stillUsedAfterTheDelete(deps, layoutId, settled.live);
  if (still !== null) {
    return {
      message: still.message,
      item: { ...request, stillUsedBy: still.stillUsedBy },
    };
  }
  return {
    message:
      request.action === "delete"
        ? "The Layout was deleted."
        : "The Layout was unpublished.",
    item: { ...request },
  };
}

/**
 * Run `work` under `token`'s fence, taking the fence down when it throws:
 * nothing was removed then. Fenced by token, so a fence another request took
 * over is left as it is.
 */
export async function stopOnRefusal(
  deps: RemoveLayoutDeps,
  layoutId: string,
  token: string,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    await deps.store.stop(layoutId, token).catch(() => false);
    throw error;
  }
}

/**
 * Steps 4 to 7 for a fence at `checked`: the final scan, the copy and the
 * write, then the check after it. `movedPages` says the removal moved its
 * pages first, so live rows are looked past.
 */
export async function finishRemoval(
  deps: RemoveLayoutDeps,
  request: RemoveRequest,
  token: string,
  movedPages: boolean
): Promise<RemoveAnswer> {
  await stopOnRefusal(deps, request.layoutId, token, async () => {
    await finalScan(deps, request.layoutId, token, movedPages);
    await copyThenRemove(deps, request, token);
  });
  return settle(deps, request, token, movedPages);
}

/** Remove one Layout by the steps in the module docblock. */
export async function removeLayout(
  deps: RemoveLayoutDeps,
  request: RemoveRequest
): Promise<RemoveAnswer> {
  await requireRemovable(deps, request);
  if (request.dryRun) return dryRun(deps, request);

  const token = deps.newToken();
  await mark(deps, request, token);
  await stopOnRefusal(deps, request.layoutId, token, async () => {
    await refuseIfDefault(deps, request.layoutId);
    await advanceOrRefuse(deps, {
      layoutId: request.layoutId,
      token,
      from: "marked",
      to: "checked",
    });
  });
  return finishRemoval(deps, request, token, false);
}
