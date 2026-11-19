/**
 * The editor's change check: whether anything the canvas reads was saved
 * elsewhere since the canvas read it, asked as one small question.
 *
 * The canvas keeps what it reads for as long as what it asks stays the same
 * (`canvas-sources`). A save made in this editor drops that at once
 * ({@link useDropKeptReadsOnSave}). For a save made anywhere else, this asks
 * the plugin's change check, which answers one mark for every source the
 * canvas reads:
 * - on opening, no ask: the canvas's first reads carry the mark, taken just
 *   before they read their sources, so a save landing while they read makes
 *   the next check differ. Where they carry none, or the check asks about
 *   more than they marked, it is asked once they are in and drawn, so
 *   opening the builder waits on nothing for it, and a save made in the
 *   moment between shows with the next save to the same source;
 * - once whenever what the canvas kept is dropped, for the same reason;
 * - then a minute after the last check settled while the builder's tab is
 *   visible,
 *   and once when the tab becomes visible again, so a change shows at once
 *   on coming back;
 * - never on the minute while the tab is hidden.
 *
 * A different mark drops what the canvas kept, and it asks again for what
 * it draws. A check that fails changes nothing; the next one asks again.
 *
 * What the canvas kept lives as long as the editor: closing it, signing
 * out, or the sources the canvas reads changing drops it, so no answer read
 * before the marks were taken is ever compared with them.
 *
 * @module admin/editor/canvas-source-check
 */
import {
  useDocumentActions,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef } from "react";

import {
  CANVAS_SOURCES_CHANGED_ROUTE_PATH,
  type CanvasSourcesChangedRequest,
  type CanvasSourcesChangedResponse,
} from "../../canvas-bindings-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  canvasSourcesChanged,
  onCanvasSourcesChanged,
} from "../canvas-sources";

/** The longest the canvas goes without asking while its tab is visible. */
export const SOURCE_CHECK_EVERY_MS = 60_000;

/** Ask the change check for the mark of the sources `ask` names. */
export type AskSourcesMark = (
  ask: CanvasSourcesChangedRequest
) => Promise<string>;

/** The change check, through the plugin's route. */
async function askRoute(ask: CanvasSourcesChangedRequest): Promise<string> {
  const body = await writePluginRoute<CanvasSourcesChangedResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: CANVAS_SOURCES_CHANGED_ROUTE_PATH,
    method: "POST",
    body: ask,
  });
  if (typeof body?.stamp !== "string") {
    throw new Error("The canvas's change check could not be read.");
  }
  return body.stamp;
}

/**
 * Runs `run` once the browser has drawn the next frame, so what the commit
 * before it rendered is on screen first; answers how to call it off.
 */
function afterNextPaint(run: () => void): () => void {
  if (typeof requestAnimationFrame !== "function") {
    const handle = setTimeout(run, 0);
    return () => clearTimeout(handle);
  }
  // The second frame's callback runs after the first frame painted.
  let handle = requestAnimationFrame(() => {
    handle = requestAnimationFrame(run);
  });
  return () => cancelAnimationFrame(handle);
}

/**
 * Whether the canvas's first reads are in: its bindings answered for this
 * ask and this person, or at once for a page that reads none.
 */
export function firstReadsInOf(request: unknown, bound: unknown): boolean {
  return request === undefined || bound !== undefined;
}

/**
 * Keep the canvas's kept reads in step with saves made elsewhere, for the
 * sources `asked` names, as `userId`. Asks nothing for a page that reads no
 * source, or while the signed-in person is not known.
 *
 * `firstReadsIn` says the canvas's first reads have answered. A fresh open
 * takes its first mark just after they are drawn, so the builder draws
 * without waiting on the check. The mark is read a moment after the reads,
 * so a save made elsewhere in that moment shows only with the next save to
 * the same source. If the first reads never answer, the minute's ask takes
 * the mark instead, so the check never stops.
 *
 * `firstMark` is the mark those first reads carried, taken before they read
 * their sources: the first mark then, asking nothing for it, and exact, so a
 * save landing while they read makes the next check differ. Without one the
 * first mark is asked just after the draw, as above.
 */
export function useCanvasSourceCheck(
  asked: CanvasSourcesChangedRequest | undefined,
  userId: string | null,
  ask: AskSourcesMark = askRoute,
  firstReadsIn = true,
  firstMark?: string
): void {
  // The sources by name: an edit that leaves them the same asks nothing new.
  const key =
    asked === undefined || userId === null ? "" : JSON.stringify(asked);
  // The sources the last check named, across asks. A mark is one for all the
  // sources asked about, so marks for different sources cannot be compared:
  // a changed ask drops what was kept, and its first mark is taken with the
  // reads that drop asks for.
  const previous = useRef("");
  // Opening: no mark is taken yet, and the first waits for the first reads.
  const opening = useRef(true);
  // The open ask's first mark once the first reads are in: the one they
  // carried, or one asked of the check.
  const takeFirstMark = useRef<((carried?: string) => void) | undefined>(
    undefined
  );
  useEffect(() => {
    if (key === "") return;
    const sources = JSON.parse(key) as CanvasSourcesChangedRequest;
    let cancelled = false;
    let inFlight = false;
    // The mark last read; `undefined` until one is, and after the canvas's
    // reads were dropped for another reason, until the check that drop asks.
    let known: string | undefined;
    // The check that was to take the mark compared with failed, so what was
    // kept may be older than the next mark read: that one drops it.
    let baselineMissed = false;
    let telling = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    const check = async (whenHidden: boolean) => {
      if (cancelled || inFlight) return;
      if (!whenHidden && document.visibilityState === "hidden") return;
      // Any ask takes a mark, so the open's own first mark is no longer owed.
      opening.current = false;
      inFlight = true;
      clearTimeout(next);
      try {
        const mark = await ask(sources);
        if (cancelled) return;
        const changed = known === undefined ? baselineMissed : mark !== known;
        known = mark;
        baselineMissed = false;
        if (changed) {
          telling = true;
          try {
            canvasSourcesChanged();
          } finally {
            telling = false;
          }
        }
      } catch {
        // A failed check changes nothing: the next one asks again. Had it
        // been the one to take the first mark, the next one drops what was
        // kept rather than take its mark as the first.
        if (known === undefined) baselineMissed = true;
      } finally {
        inFlight = false;
        // The minute counts from when this check settled, whatever asked
        // for it, so a check slower than a minute never stops the next.
        if (!cancelled) {
          clearTimeout(next);
          next = setTimeout(() => void check(false), SOURCE_CHECK_EVERY_MS);
        }
      }
    };
    // Dropped for another reason (a save here, another canvas's check): the
    // canvas reads again now, so the mark is taken again now too.
    const stopHearing = onCanvasSourcesChanged(() => {
      if (telling) return;
      opening.current = false;
      known = undefined;
      baselineMissed = false;
      void check(true);
    });
    const before = previous.current;
    previous.current = key;
    if (before !== "" && before !== key) {
      // What was kept predates every mark of the new ask: drop it, which
      // asks the check again through the listener above.
      canvasSourcesChanged();
    } else if (!opening.current) {
      void check(true);
    } else {
      // Should the first reads never answer, the minute's ask takes the mark.
      next = setTimeout(() => void check(false), SOURCE_CHECK_EVERY_MS);
    }
    // On a fresh open the first mark waits for the first reads (below).
    takeFirstMark.current = carried => {
      if (carried === undefined) {
        void check(true);
        return;
      }
      if (cancelled || inFlight || known !== undefined) return;
      known = carried;
      baselineMissed = false;
      // The minute counts from the mark, as from a check that settled.
      clearTimeout(next);
      next = setTimeout(() => void check(false), SOURCE_CHECK_EVERY_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      takeFirstMark.current = undefined;
      clearTimeout(next);
      document.removeEventListener("visibilitychange", onVisible);
      stopHearing();
    };
  }, [key, ask]);
  // The first mark of a fresh open, once the canvas's first reads are in and
  // drawn; after it, the answers coming in again ask nothing on their own.
  useEffect(() => {
    if (key === "" || !firstReadsIn || !opening.current) return;
    if (firstMark !== undefined) {
      opening.current = false;
      takeFirstMark.current?.(firstMark);
      return;
    }
    return afterNextPaint(() => {
      if (!opening.current) return;
      opening.current = false;
      takeFirstMark.current?.();
    });
  }, [key, firstReadsIn, firstMark]);
  // Signed out: nothing kept for the person who was may answer again.
  const signedIn = useRef(userId !== null);
  useEffect(() => {
    if (userId === null && signedIn.current) canvasSourcesChanged();
    signedIn.current = userId !== null;
  }, [userId]);
  // Closed: what this editor kept goes with it, so the next editor's first
  // marks are taken with its own first reads.
  useEffect(() => () => canvasSourcesChanged(), []);
}

/**
 * Drop what the canvas kept as soon as this editor stores the document: the
 * page's own entry is among what it reads. Told by when the document was
 * last stored in this session, so a store with no change of its own still
 * drops, and nothing before the first store does.
 */
export function useDropKeptReadsOnSave(): void {
  const storedAt = useDocumentActions()?.storedAt ?? null;
  const seen = useRef(storedAt?.getTime() ?? null);
  useEffect(() => {
    const at = storedAt?.getTime() ?? null;
    if (at === null || at === seen.current) return;
    seen.current = at;
    canvasSourcesChanged();
  }, [storedAt]);
}
