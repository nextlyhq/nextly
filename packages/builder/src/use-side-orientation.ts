/**
 * How the selected node's element runs, re-read whenever the canvas moves.
 *
 * Its own module, and owned by the inspector WRAPPER rather than by the style
 * panel, for the reason `use-rendered-tag` gives about the same canvas: the
 * panel that decides which control shows a value should not also hold a
 * subscription to the DOM. Passed down as an answer, exactly as `cascade` and
 * `renderedTag` are.
 *
 * OBSERVED rather than read once on a dependency change, and that is not
 * belt-and-braces. The canvas mounts only after styles have loaded while the
 * inspector stays mounted throughout, and a block whose `render` returns a
 * promise commits a Suspense fallback first and its real root later — in both
 * cases the marked element does not exist when an effect first runs, and a
 * one-shot read would report "orientation unknown" forever and quietly keep the
 * box from ever being drawn. `observeRenderedTree` is what answers all of that,
 * and it is the same observer the tag reader and the canvas's own marker walk
 * use, so there is one account of what counts as the tree changing.
 *
 * @module use-side-orientation
 */
import * as React from "react";

import type { EditorState } from "./editor-state";
import { observeRenderedTree } from "./rendered-tree";
import { orientationOf, type SideOrientation } from "./side-orientation";

/**
 * Resolve how the selected block's element runs, or `undefined`.
 *
 * `undefined` means NOT KNOWN rather than left-to-right, and a caller must keep
 * those apart: a box drawn on an unknown orientation is a positional claim with
 * nothing behind it.
 *
 * @param canvasRoot - the canvas root the page is drawn under
 * @param selectedId - the block being edited
 * @param document - the editor's document, so a commit re-reads
 * @returns the element's writing mode and direction, or `undefined`
 */
export function useSideOrientation(
  canvasRoot: HTMLElement | null | undefined,
  selectedId: string | null,
  document: EditorState["document"]
): SideOrientation | undefined {
  const [orientation, setOrientation] = React.useState<
    SideOrientation | undefined
  >(undefined);

  React.useEffect(() => {
    // Compared by VALUE before storing, here and in the observer. The canvas
    // mutates on every keystroke that reaches it, and storing a fresh object
    // each time would re-render the whole inspector per character for an answer
    // that had not moved.
    const read = () => {
      const next = orientationOf(canvasRoot, selectedId);
      setOrientation(current =>
        current?.writingMode === next?.writingMode &&
        current?.direction === next?.direction
          ? current
          : next
      );
    };
    read();

    if (canvasRoot == null) return;
    return observeRenderedTree(canvasRoot, read);
  }, [canvasRoot, selectedId, document]);

  return orientation;
}
