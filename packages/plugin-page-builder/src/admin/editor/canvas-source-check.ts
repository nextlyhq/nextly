/**
 * The editor's change check: whether anything the canvas reads was saved
 * elsewhere since the canvas read it, asked as one small question.
 *
 * The canvas keeps what it reads for as long as what it asks stays the same
 * (`canvas-sources`). A save made in this editor drops that at once
 * ({@link useDropKeptReadsOnSave}). For a save made anywhere else, this asks
 * the plugin's change check, which answers one mark for every source the
 * canvas reads:
 * - once when the canvas opens, whether or not its tab is in sight, so the
 *   mark compared with is taken with the canvas's first reads;
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
 * out, or the canvas starting to read a source it did not read before drops
 * it, so no answer read before the marks were taken is ever compared with
 * them.
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

/** Whether `next` names a source `previous` did not. */
function namesNewSource(
  previous: CanvasSourcesChangedRequest,
  next: CanvasSourcesChangedRequest
): boolean {
  const named = (ask: CanvasSourcesChangedRequest) =>
    new Set([
      JSON.stringify(ask.source),
      `locale:${ask.locale ?? ""}`,
      ...ask.singles.map(slug => `single:${slug}`),
      ...ask.lists.map(slug => `list:${slug}`),
      ...(ask.follows?.entry ?? []).map(field => `follow::${field}`),
      ...Object.entries(ask.follows?.singles ?? {}).flatMap(([slug, fields]) =>
        fields.map(field => `follow:${slug}:${field}`)
      ),
    ]);
  const before = named(previous);
  return [...named(next)].some(source => !before.has(source));
}

/**
 * Keep the canvas's kept reads in step with saves made elsewhere, for the
 * sources `asked` names, as `userId`. Asks nothing for a page that reads no
 * source, or while the signed-in person is not known.
 */
export function useCanvasSourceCheck(
  asked: CanvasSourcesChangedRequest | undefined,
  userId: string | null,
  ask: AskSourcesMark = askRoute
): void {
  // The sources by name: an edit that leaves them the same asks nothing new.
  const key =
    asked === undefined || userId === null ? "" : JSON.stringify(asked);
  // The sources the last check named, across asks: a source read for the
  // first time may have been kept from before this editor watched it.
  const previous = useRef<CanvasSourcesChangedRequest | undefined>(undefined);
  useEffect(() => {
    if (key === "") return;
    const sources = JSON.parse(key) as CanvasSourcesChangedRequest;
    let cancelled = false;
    let inFlight = false;
    // The mark last read; `undefined` until one is, and after the canvas's
    // reads were dropped for another reason, until the check that drop asks.
    let known: string | undefined;
    let telling = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    const check = async (whenHidden: boolean) => {
      if (cancelled || inFlight) return;
      if (!whenHidden && document.visibilityState === "hidden") return;
      inFlight = true;
      clearTimeout(next);
      try {
        const mark = await ask(sources);
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
      known = undefined;
      void check(true);
    });
    const before = previous.current;
    previous.current = sources;
    if (before !== undefined && namesNewSource(before, sources)) {
      // What was kept for the new source predates every mark: drop it, which
      // asks the check again through the listener above.
      canvasSourcesChanged();
    } else {
      void check(true);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(next);
      document.removeEventListener("visibilitychange", onVisible);
      stopHearing();
    };
  }, [key, ask]);
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
