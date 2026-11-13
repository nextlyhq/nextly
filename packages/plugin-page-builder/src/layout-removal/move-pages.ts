/**
 * Remove Layout, moving its pages first: every page that names the Layout on
 * its only row or its working draft is put on the site default, and then the
 * Layout is deleted or unpublished as Remove Layout does it.
 *
 * ## What moves
 *
 * Every page naming the Layout, wherever it names it: its live copy and every
 * draft, cleared (`layout: null`) in one field rewrite (`movePageOffLayout`),
 * as the person moving them and attributed to the Page Builder, with the
 * reason in the page's history. Each draft stays a draft and the page's status
 * is unchanged, so an author's unfinished edit is neither lost nor published.
 *
 * Their own access decides each page. Changing a live copy needs the right to
 * publish the page, so where they may update a page but not publish it, only
 * its working draft (or its unpublished row) is cleared, as a save of it is,
 * and its live copy is left. A page they may not edit at all is left and
 * reported, never written past their rights.
 *
 * ## When the Layout goes
 *
 * Once nothing off a live copy names the Layout, it is removed as Remove
 * Layout does it. A live copy left naming it (one the person may not publish)
 * does not stop the removal: it draws the site default once the Layout is
 * gone, as the dialog said before they started, and the finished move names
 * those pages, so someone who may publish them knows where to look. The
 * page's next publish clears a deleted Layout from it
 * (`page-reference-guard.ts`).
 *
 * ## Ticks, polled by the dialog
 *
 * A site can have more pages on a Layout than one request should write, so
 * the move runs as ticks. The dialog's first call starts it: the fence row is
 * put up (`marked`), the default is refused, and the row moves to `moving`.
 * The answer carries the row's token, and the dialog calls again with it for
 * as long as it stays open. Each tick:
 *
 * 1. checks the row is still this person's move, at `moving`, with the token
 *    they hold; a move that stopped answers so, and writes nothing;
 * 2. scans the pages again, renewing the lease as it reads;
 * 3. moves up to {@link PAGES_PER_TICK} of the pages after the dialog's
 *    cursor, starting no new write once {@link TICK_BUDGET_MS} have passed;
 * 4. records how many are left on the row (`pagesLeft`), a compare-and-set on
 *    the token that is also the lease's renewal;
 * 5. when nothing off a live row names the Layout any more, moves the row to
 *    `checked` and finishes as Remove Layout does (`finishRemoval`), its final
 *    scan looking past live rows. When the only pages left are ones that could
 *    not be moved, the fence comes down and they are named, with why.
 *
 * The cursor is the last page the previous tick tried, so a page that was
 * refused is not tried again on every tick. It is only an optimisation: a
 * cursor the dialog skips ahead leaves pages unmoved, and they stop the
 * removal at the final scan.
 *
 * ## A move that stops
 *
 * The dialog closing, or its Stop, ends the ticks. Stop takes the fence down
 * at once; a dialog that just went away leaves the row to its lease, and the
 * sweep then removes it (`settle.ts`). Either way the Layout is kept, and the
 * pages already moved stay moved. The person who started the move may start
 * it again at once, taking up their own row; anyone else waits out the lease.
 *
 * While the row exists the page side of the fence refuses any page write that
 * would newly choose the Layout, so no page joins it mid-move.
 *
 * @module layout-removal/move-pages
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { defaultIsUsable } from "../default-layout/store";

import {
  namesItOffTheLiveRow,
  readableTitles,
  scanLayoutReferences,
  type PageReference,
} from "./layout-references";
import {
  movePageOffLayout,
  type PageFieldRewrite,
} from "./page-reference-guard";
import {
  advanceOrRefuse,
  conflict,
  finishRemoval,
  leaseKeeper,
  mark,
  refuseIfDefault,
  requireRemovable,
  stopOnRefusal,
  type RemoveAnswer,
  type RemoveLayoutDeps,
} from "./remove-layout";
import type { RemovalAction } from "./store";
import {
  ALREADY_BEING_REMOVED,
  CANT_EDIT_PAGE,
  liveCopiesLeftSentence,
  MOVE_STOPPED,
  movedOffLayoutReason,
  NO_USABLE_DEFAULT,
  PAGE_KEPT_CHANGING,
  PAGE_NOT_SAVED,
} from "./words";

/**
 * The most pages one tick moves. Each move is a page save, its hooks and
 * version included; this many keeps a tick to a few seconds on an ordinary
 * database, so the dialog's bar moves often and Stop takes effect soon.
 */
export const PAGES_PER_TICK = 25;

/**
 * How long a tick keeps starting page saves, from its start. Well inside the
 * time a host gives one request, and far inside the lease, so a slow database
 * makes ticks smaller rather than making them time out. A tick always tries at
 * least one page, so every tick moves the work on.
 */
const TICK_BUDGET_MS = 4000;

/** One tick of a move, as the route is asked for it. */
export interface MoveRequest {
  readonly layoutId: string;
  readonly action: RemovalAction;
  /** The move's token, from its first tick's answer; absent to start one. */
  readonly token?: string;
  /** The last page the previous tick tried; this one tries those after it. */
  readonly after?: string;
  /** Stop the move now, keeping the Layout and every page already moved. */
  readonly stop?: boolean;
}

/** A page a move could not move, as the person may see it. */
export interface UnmovedPage {
  readonly id: string;
  readonly title: string;
  /** Why, when this tick tried it; `null` for one an earlier tick tried. */
  readonly reason: string | null;
}

/** Pages whose live copy a move left naming the Layout, as the person may see them. */
export interface LiveCopiesLeft {
  readonly pages: readonly { readonly id: string; readonly title: string }[];
  /** How many more of them the person may not read. */
  readonly unreadable: number;
}

/** Where a move stands after a tick. */
export type MoveProgress =
  | {
      readonly state: "moving";
      readonly token: string;
      /** Pages this tick moved. */
      readonly moved: number;
      /** Pages still to move, refused ones included. */
      readonly left: number;
      /** The cursor for the next tick. */
      readonly after: string;
      /** Pages this tick could not move, as the person may see them. */
      readonly refused: readonly UnmovedPage[];
    }
  | {
      readonly state: "done";
      readonly moved: number;
      /**
       * Published pages whose live copy still names the Layout, as the person
       * may see them: ones they may edit but not publish, whose drafts moved.
       * They show the site default until someone who may publish them chooses
       * another Layout. Absent when there are none.
       */
      readonly liveLeft?: LiveCopiesLeft;
    }
  | { readonly state: "stopped"; readonly moved: number }
  | {
      readonly state: "refused";
      readonly moved: number;
      /** The pages still naming the Layout off a live row. */
      readonly pages: readonly UnmovedPage[];
      /** How many more of them the person may not read. */
      readonly unreadable: number;
      /** False when the scan could not read every page. */
      readonly complete: boolean;
    };

/** A tick's answer: the envelope's message, and the move in its item. */
function answer(
  request: MoveRequest,
  message: string,
  move: MoveProgress
): RemoveAnswer {
  return {
    message,
    item: {
      layoutId: request.layoutId,
      action: request.action,
      dryRun: false,
      move,
    },
  };
}

/** Why a page's save refused the move, in words the person can act on. */
function reasonOf(error: unknown): string {
  // A page they may not read answers as missing: they can't edit it either.
  if (
    NextlyError.isCode(error, "FORBIDDEN") ||
    NextlyError.isCode(error, "NOT_FOUND")
  ) {
    return CANT_EDIT_PAGE;
  }
  // Saved by someone else on every read the rewrite was made from.
  if (NextlyError.isCode(error, "STALE_VERSION")) return PAGE_KEPT_CHANGING;
  // A conflict's message is public by contract, and says what is in the way
  // (a colleague editing the page, say).
  if (NextlyError.isCode(error, "CONFLICT") && error instanceof Error) {
    return error.message;
  }
  return PAGE_NOT_SAVED;
}

/** What one tick's page saves did. */
interface TickRun {
  readonly tried: PageReference[];
  /** Pages a write changed; a page tried and not refused is settled either way. */
  readonly moved: number;
  readonly refused: Map<string, string>;
}

/**
 * Move pages from `ahead`, in order, as the person, by the bounds on
 * {@link PAGES_PER_TICK} and {@link TICK_BUDGET_MS}.
 */
async function moveSome(
  deps: MoveDeps,
  layout: { readonly id: string; readonly reason: string },
  ahead: readonly PageReference[],
  startedAt: number
): Promise<TickRun> {
  const layoutId = layout.id;
  const run: TickRun = {
    tried: [],
    moved: 0,
    refused: new Map(),
  };
  let moved = 0;
  for (const reference of ahead) {
    if (run.tried.length >= PAGES_PER_TICK) break;
    const spent = deps.now().getTime() - startedAt;
    if (run.tried.length > 0 && spent >= TICK_BUDGET_MS) break;
    run.tried.push(reference);
    try {
      const cleared = await movePageOffLayout(
        deps.nextly,
        deps.slugs.pages,
        reference.id,
        layoutId,
        {
          rewrite: deps.rewrite,
          reason: layout.reason,
          writeAs: deps.person.as,
        }
      );
      if (cleared) moved += 1;
    } catch (error) {
      run.refused.set(reference.id, reasonOf(error));
      deps.warn("[page-builder] a page could not be moved off a Layout", {
        pageId: reference.id,
        layoutId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ...run, moved };
}

/** `references` the person may read, each with why it could not move. */
async function unmoved(
  deps: RemoveLayoutDeps,
  references: readonly PageReference[],
  reasons: ReadonlyMap<string, string>
): Promise<{ pages: UnmovedPage[]; unreadable: number }> {
  const named = await readableTitles({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    references,
    asPerson: deps.person.as,
  });
  return {
    pages: named.readable.map(page => ({
      ...page,
      reason: reasons.get(page.id) ?? null,
    })),
    unreadable: named.unreadable,
  };
}

/**
 * What a move needs beyond a removal: whether the person holds the grants the
 * removal's final write is judged by, asked before any page moves.
 */
export interface MoveDeps extends RemoveLayoutDeps {
  readonly mayRemove: (action: RemovalAction) => Promise<boolean>;
  /** The field rewrite, made as the person and attributed to the Page Builder. */
  readonly rewrite: PageFieldRewrite;
}

/**
 * Refuse while the site has no published default: a page cleared now would
 * draw no header or footer at all, not the site default the dialog promises.
 * The one test of a usable default, as the repair and make-default ask it.
 */
async function requireUsableDefault(
  deps: RemoveLayoutDeps,
  layoutId: string
): Promise<void> {
  if (!(await defaultIsUsable(deps.nextly, deps.slugs))) {
    throw conflict(
      NO_USABLE_DEFAULT,
      "layout-move-no-usable-default",
      layoutId
    );
  }
}

/** By id, the order the cursor walks in. */
function byId(a: PageReference, b: PageReference): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Whether the row is still this person's move, at `moving`, under `token`.
 * Another person's row under the token is refused: the starter alone runs
 * their move, and that check comes before any page is written.
 */
async function stillMoving(
  deps: RemoveLayoutDeps,
  request: MoveRequest,
  token: string
): Promise<boolean> {
  const removal = await deps.store.removalOf(request.layoutId);
  if (removal === null || removal.token !== token) return false;
  if (removal.startedBy === null || removal.startedBy !== deps.person.userId) {
    throw conflict(
      ALREADY_BEING_REMOVED,
      "layout-move-not-the-starter",
      request.layoutId
    );
  }
  return removal.step === "moving" && removal.action === request.action;
}

/** Start a move: the fence up, the default refused, the row at `moving`. */
async function start(
  deps: RemoveLayoutDeps,
  request: MoveRequest
): Promise<string> {
  const token = deps.newToken();
  await mark(deps, request, token, true);
  await stopOnRefusal(deps, request.layoutId, token, async () => {
    await refuseIfDefault(deps, request.layoutId);
    await requireUsableDefault(deps, request.layoutId);
    await advanceOrRefuse(deps, {
      layoutId: request.layoutId,
      token,
      from: "marked",
      to: "moving",
    });
  });
  return token;
}

/**
 * Nothing off a live copy names the Layout: remove it as Remove Layout does,
 * and name the published pages whose live copy still names it.
 */
async function finish(
  deps: RemoveLayoutDeps,
  request: MoveRequest,
  token: string,
  moved: number
): Promise<RemoveAnswer> {
  await advanceOrRefuse(deps, {
    layoutId: request.layoutId,
    token,
    from: "moving",
    to: "checked",
    set: { pagesLeft: 0 },
  });
  const removed = await finishRemoval(
    deps,
    { layoutId: request.layoutId, action: request.action, dryRun: false },
    token,
    true
  );
  const liveLeft = removed.item.stillUsedBy;
  const left =
    liveLeft === undefined ? 0 : liveLeft.pages.length + liveLeft.unreadable;
  const message =
    request.action === "delete"
      ? "The pages were moved to the site default, and the Layout was deleted."
      : "The pages were moved to the site default, and the Layout was unpublished.";
  return answer(
    request,
    left === 0 ? message : `${message} ${liveCopiesLeftSentence(left)}`,
    {
      state: "done",
      moved,
      ...(liveLeft === undefined || left === 0 ? {} : { liveLeft }),
    }
  );
}

/** The pages a tick finds, in the cursor's order, and what it does with them. */
interface TickPlan {
  /** Every page naming the Layout, live copies included: each is tried. */
  readonly all: readonly PageReference[];
  /** Those after the cursor: the ones this tick tries. */
  readonly ahead: readonly PageReference[];
}

/**
 * The pages that still stop the removal after this tick: those naming the
 * Layout off a live copy that no tick has settled. A page this tick tried and
 * did not refuse is settled, whatever it came to: moved, already moved, or
 * one whose live copy the person may not publish, which is left to draw the
 * site default.
 */
function stillInTheWay(plan: TickPlan, run: TickRun): PageReference[] {
  const settled = new Set(
    run.tried.filter(ref => !run.refused.has(ref.id)).map(ref => ref.id)
  );
  return plan.all
    .filter(namesItOffTheLiveRow)
    .filter(ref => !settled.has(ref.id));
}

/** One tick of a held move, by the steps in the module docblock. */
async function tick(
  deps: MoveDeps,
  request: MoveRequest,
  token: string,
  title: string
): Promise<RemoveAnswer> {
  const { layoutId } = request;
  const startedAt = deps.now().getTime();
  // Asked again on every tick, before any page moves: the default can be
  // unpublished while a move runs. The fence comes down with the refusal.
  await stopOnRefusal(deps, layoutId, token, () =>
    requireUsableDefault(deps, layoutId)
  );
  const scan = await scanLayoutReferences({
    nextly: deps.nextly,
    pages: deps.slugs.pages,
    layoutId,
    ...(deps.budget === undefined ? {} : { budget: deps.budget }),
    onProgress: leaseKeeper(deps, layoutId, token, "moving"),
  });
  const all = [...scan.references].sort(byId);
  const { after } = request;
  const plan: TickPlan = {
    all,
    ahead: all.filter(ref => after === undefined || ref.id > after),
  };
  const run = await moveSome(
    deps,
    {
      id: layoutId,
      reason: movedOffLayoutReason(title, request.action),
    },
    plan.ahead,
    startedAt
  );
  const inTheWay = stillInTheWay(plan, run);
  const left = inTheWay.length;

  const recorded = await deps.store.advance({
    layoutId,
    token,
    from: "moving",
    to: "moving",
    set: { pagesLeft: left },
  });
  if (!recorded) {
    return answer(request, MOVE_STOPPED, {
      state: "stopped",
      moved: run.moved,
    });
  }
  if (left === 0 && scan.complete) {
    return finish(deps, request, token, run.moved);
  }
  const last = run.tried[run.tried.length - 1];
  if (run.tried.length < plan.ahead.length && last !== undefined) {
    const refused = await unmoved(
      deps,
      run.tried.filter(ref => run.refused.has(ref.id)),
      run.refused
    );
    return answer(request, "Moving pages to the site default.", {
      state: "moving",
      token,
      moved: run.moved,
      left,
      after: last.id,
      refused: refused.pages,
    });
  }
  return refuseTheRest(deps, request, token, {
    run,
    inTheWay,
    complete: scan.complete,
  });
}

/**
 * Every page after the cursor was tried, and some still name the Layout off a
 * live copy: the fence comes down, keeping the Layout and every page moved,
 * and the pages left are named, with why where this tick learned it.
 */
async function refuseTheRest(
  deps: RemoveLayoutDeps,
  request: MoveRequest,
  token: string,
  found: {
    readonly run: TickRun;
    readonly inTheWay: readonly PageReference[];
    readonly complete: boolean;
  }
): Promise<RemoveAnswer> {
  const { run } = found;
  await deps.store.stop(request.layoutId, token);
  const left = await unmoved(deps, found.inTheWay, run.refused);
  return answer(
    request,
    found.complete
      ? "Some pages couldn't be moved, so the Layout was not removed."
      : "Not every page could be checked, so the Layout was not removed.",
    {
      state: "refused",
      moved: run.moved,
      pages: left.pages,
      unreadable: left.unreadable,
      complete: found.complete,
    }
  );
}

/** Stop the person's own move now, keeping the Layout and the pages moved. */
async function stop(
  deps: RemoveLayoutDeps,
  request: MoveRequest
): Promise<RemoveAnswer> {
  const { token } = request;
  if (token !== undefined && (await stillMoving(deps, request, token))) {
    await deps.store.stop(request.layoutId, token);
  }
  return answer(request, MOVE_STOPPED, { state: "stopped", moved: 0 });
}

/** One tick of a move: start it, carry it on, or stop it. */
export async function movePages(
  deps: MoveDeps,
  request: MoveRequest
): Promise<RemoveAnswer> {
  const { title } = await requireRemovable(deps, request);
  if (request.stop === true) return stop(deps, request);
  // A precondition, so it runs before the fence and every page write, on
  // every tick: a person who may not delete or unpublish this Layout would
  // otherwise have each page moved and then be refused at the final write.
  // Stop needs no grant, since it only takes the person's own fence down.
  if (!(await deps.mayRemove(request.action))) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "layout-move-needs-removal-grant",
        layoutId: request.layoutId,
        action: request.action,
      },
    });
  }
  if (request.token === undefined) {
    return tick(deps, request, await start(deps, request), title);
  }
  if (!(await stillMoving(deps, request, request.token))) {
    return answer(request, MOVE_STOPPED, { state: "stopped", moved: 0 });
  }
  return tick(deps, request, request.token, title);
}
