/**
 * The editor's change check: whether anything the canvas reads was saved
 * elsewhere since the canvas read it, asked as one small question.
 *
 * The canvas keeps what it reads for as long as what it asks stays the same
 * (`canvas-sources`). A save made in this editor drops that at once
 * ({@link useDropKeptReadsOnSave}). For a save made anywhere else, this asks
 * the plugin's change check, which answers one mark for every source the
 * canvas reads:
 * - once when the canvas opens, for the mark to compare with;
 * - then at most once a minute while the builder's tab is visible, and once
 *   when the tab becomes visible again, so a change shows at once on coming
 *   back;
 * - never while the tab is hidden.
 *
 * A different mark drops what the canvas kept, and it asks again for what
 * it draws. A check that fails changes nothing; the next one asks again.
 *
 * @module admin/editor/canvas-source-check
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef } from "react";

import {
  CANVAS_SOURCES_CHANGED_ROUTE_PATH,
  sourcesChangedAskOf,
  type CanvasBindingsRequest,
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
 * Keep the canvas's kept reads in step with saves made elsewhere, for the
 * sources `request` reads, as `userId`. Asks nothing for a page that reads
 * no source, or while the signed-in person is not known.
 */
export function useCanvasSourceCheck(
  request: CanvasBindingsRequest | undefined,
  userId: string | null,
  ask: AskSourcesMark = askRoute
): void {
  // The sources by name: an edit that leaves them the same asks nothing new.
  const key =
    request === undefined || userId === null
      ? ""
      : JSON.stringify(sourcesChangedAskOf(request));
  useEffect(() => {
    if (key === "") return;
    const asked = JSON.parse(key) as CanvasSourcesChangedRequest;
    let cancelled = false;
    let inFlight = false;
    // The mark last read; `undefined` until one is, and after the canvas's
    // reads were dropped for another reason, so the next mark is taken as
    // it stands rather than dropping them a second time.
    let known: string | undefined;
    let telling = false;
    const stopHearing = onCanvasSourcesChanged(() => {
      if (!telling) known = undefined;
    });
    const check = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") {
        return;
      }
      inFlight = true;
      try {
        const mark = await ask(asked);
        if (cancelled) return;
        const changed = known !== undefined && mark !== known;
        known = mark;
        if (changed) {
          telling = true;
          try {
            canvasSourcesChanged();
          } finally {
            telling = false;
          }
        }
      } catch {
        // A failed check changes nothing: the next one asks again.
      } finally {
        inFlight = false;
      }
    };
    void check();
    const every = setInterval(() => void check(), SOURCE_CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      stopHearing();
    };
  }, [key, ask]);
}

/**
 * Drop what the canvas kept as soon as this editor saves: the page's own
 * entry is among what it reads. `savedAt` is the editor's last save; its
 * first value, the document as opened, drops nothing.
 */
export function useDropKeptReadsOnSave(savedAt: unknown): void {
  const opened = useRef(savedAt);
  useEffect(() => {
    if (savedAt === opened.current) return;
    opened.current = savedAt;
    canvasSourcesChanged();
  }, [savedAt]);
}
