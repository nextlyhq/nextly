/**
 * Open the editor at the section its address names.
 *
 * The entry screen lists a page's sections and links each to the builder at
 * that section, so an author who wants to change the fourth one lands on it
 * rather than hunting for it in the canvas or in Layers. Arriving there means
 * three things: the section is selected, Layers is open showing it, and the
 * canvas has scrolled it into view.
 *
 * ## Once, on the way in
 *
 * The address is read when the editor opens and acted on once. Re-applying it
 * on later renders would pull the author back to that section every time they
 * selected or scrolled elsewhere.
 *
 * ## A section the page no longer has opens nothing
 *
 * The link may be older than the page — a tab left open, a bookmark, a
 * colleague's deletion. The editor then opens as it would without one: nothing
 * selected and nothing said, since there is nothing the author can do about
 * it that the open page does not already show.
 *
 * ## The scroll waits for the canvas
 *
 * The canvas mounts after the editor and draws after the site's styles
 * arrive, so the section may not be on screen when it is selected. The scroll
 * is retried as the canvas changes, and stops the first time it lands.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/use-open-at-section
 */
import { walkNodes, type BlockDocument } from "@nextlyhq/blocks-engine";
import { revealNode, type LeftPanel } from "@nextlyhq/builder";
import type { EditorState } from "@nextlyhq/builder/shell";
import { useEffect, useRef } from "react";

export interface OpenAtSectionArgs {
  /** The section the address names, or `undefined` where it names none. */
  sectionId: string | undefined;
  /** The editor, for the document it holds and the way to select in it. */
  editor: {
    document: Pick<BlockDocument, "nodes">;
    select: EditorState["select"];
  };
  /** The canvas's root element, or `null` until it has mounted. */
  canvas: HTMLElement | null;
  /** Opens one of the editor's left panels. */
  requestPanel: (panel: LeftPanel) => void;
}

/**
 * Whether the document holds a block of this id, at any depth: a section is a
 * top-level block, and a report's link names the block holding a binding,
 * wherever it sits.
 */
function holds(document: Pick<BlockDocument, "nodes">, id: string): boolean {
  let found = false;
  walkNodes(document.nodes, node => {
    if (node.id === id) found = true;
  });
  return found;
}

export function useOpenAtSection({
  sectionId,
  editor,
  canvas,
  requestPanel,
}: OpenAtSectionArgs): void {
  /*
   * The section to scroll to, decided once: `undefined` until the selection
   * below runs, then the id, then `null` once it has landed or there was none
   * to land. A ref, because nothing renders from it.
   */
  const pending = useRef<string | null | undefined>(undefined);
  // The arguments the editor OPENED with, which are the only ones this acts
  // on: see the module docblock. Held from the first render so a later one
  // cannot re-run the selection with its own.
  const opened = useRef({ sectionId, editor, requestPanel });

  useEffect(() => {
    if (pending.current !== undefined) return;
    const {
      sectionId: id,
      editor: atOpen,
      requestPanel: open,
    } = opened.current;
    // A section is a block at the top of the page; an id naming anything else
    // names no section the entry screen offered.
    if (id === undefined || !holds(atOpen.document, id)) {
      pending.current = null;
      return;
    }
    pending.current = id;
    atOpen.select(id);
    open("layers");
  }, []);

  useEffect(() => {
    const id = pending.current;
    if (canvas === null || typeof id !== "string") return;
    const stops: (() => void)[] = [];
    const stop = (): void => {
      for (const each of stops.splice(0)) each();
    };
    const landed = (): void => {
      pending.current = null;
      keepInViewWhileSettling(canvas, id, stops, stop);
    };
    if (revealNode(canvas, id)) {
      landed();
      return stop;
    }
    // Not drawn yet: try again whenever the canvas's content changes, and stop
    // watching the first time it lands or when the canvas goes away. Built
    // from the canvas's own window, the realm of the nodes it watches, which
    // is a frame's when the canvas is rendered in one.
    const Mutations = canvas.ownerDocument.defaultView?.MutationObserver;
    if (typeof Mutations !== "function") return stop;
    const observer = new Mutations(() => {
      if (!revealNode(canvas, id)) return;
      observer.disconnect();
      landed();
    });
    observer.observe(canvas, { childList: true, subtree: true });
    stops.push(() => observer.disconnect());
    return stop;
  }, [canvas]);
}

/**
 * How long the editor is given to settle around the section, in ms.
 *
 * Exported for the test that waits it out, so the two cannot disagree.
 */
export const SETTLE_MS = 2000;

/**
 * Bring a block into view and keep it there while the editor settles around
 * it, as the address the editor opens at does once its block is on screen:
 * for the editor's other ways to a block, such as the bindings report's
 * Select. Returns what stops it early; it
 * stops by itself once the author takes over or the editor has settled.
 */
export function revealWhileSettling(
  canvas: HTMLElement,
  id: string
): () => void {
  const stops: (() => void)[] = [];
  const stop = (): void => {
    for (const each of stops.splice(0)) each();
  };
  revealNode(canvas, id);
  keepInViewWhileSettling(canvas, id, stops, stop);
  return stop;
}

/** What an author does to take over: scroll, point, or type. */
const TAKE_OVER = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

/**
 * Keep the section in view while the editor finishes laying out around it.
 *
 * Opening Layers adds a panel a render or two after the first scroll and
 * narrows the canvas; the text above the section reflows and can carry it back
 * out of view. So the section is revealed again whenever the canvas resizes,
 * until the author takes over — the first scroll, click or key is theirs, and
 * pulling them back would fight them — or the editor has had time to settle.
 */
function keepInViewWhileSettling(
  canvas: HTMLElement,
  id: string,
  stops: (() => void)[],
  stop: () => void
): void {
  const view = canvas.ownerDocument.defaultView;
  if (view === null) return;
  if (typeof view.ResizeObserver !== "undefined") {
    const observer = new view.ResizeObserver(() => {
      revealNode(canvas, id);
    });
    observer.observe(canvas);
    stops.push(() => observer.disconnect());
  }
  const timer = view.setTimeout(stop, SETTLE_MS);
  stops.push(() => view.clearTimeout(timer));
  for (const target of takeOverWindows(view)) {
    for (const type of TAKE_OVER) {
      target.addEventListener(type, stop, { capture: true });
      stops.push(() =>
        target.removeEventListener(type, stop, { capture: true })
      );
    }
  }
}

/**
 * Every window the author can take over from: the canvas's, and the editor's
 * around it when the canvas is in a frame of its own.
 *
 * A click, key or wheel over the editor's panels is delivered to the editor's
 * window and never reaches the frame's, so listening on the canvas's alone
 * would keep pulling the author back while they work in a panel. Reached
 * through `frameElement`, which is `null` for a top-level window and for a
 * frame whose parent this page may not read, so no window is listened on
 * that could refuse it.
 */
function takeOverWindows(view: Window): Window[] {
  const around = view.frameElement?.ownerDocument.defaultView ?? null;
  return around === null || around === view ? [view] : [view, around];
}
