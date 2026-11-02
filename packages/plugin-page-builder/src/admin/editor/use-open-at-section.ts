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
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { revealNode } from "@nextlyhq/builder";
import type { EditorState, LeftPanel } from "@nextlyhq/builder/shell";
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
    if (id === undefined || !atOpen.document.nodes.some(n => n.id === id)) {
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
    if (revealNode(canvas, id)) {
      pending.current = null;
      return;
    }
    // Not drawn yet: try again whenever the canvas's content changes, and stop
    // watching the first time it lands or when the canvas goes away.
    const observer = new MutationObserver(() => {
      if (!revealNode(canvas, id)) return;
      pending.current = null;
      observer.disconnect();
    });
    observer.observe(canvas, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [canvas]);
}
