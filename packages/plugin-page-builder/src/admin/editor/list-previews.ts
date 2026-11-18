/**
 * The lists the canvas previews: those an author chose to see empty, and
 * those tagged as still showing what they store.
 *
 * Those of the document being edited. A list is named by its node id, which
 * is its own document's, and a header or footer edited in place draws in the
 * page's render context: joining the two documents' choices would let one
 * list's choice reach another of the same id. So while a region is edited its
 * own previews are the ones drawn, a list in it previewed empty from Layers
 * or the inspector drawn so, and the page's own choices return at Done.
 *
 * @module admin/editor/list-previews
 */
import type { EditorState } from "@nextlyhq/builder/shell";

type ListPreviews = Pick<
  EditorState,
  "listsShowingEmpty" | "listsStillShowing"
>;

/** The list previews of the document being edited, `active`. */
export function listPreviewsOf(shown: ListPreviews): ListPreviews {
  return {
    ...(shown.listsShowingEmpty === undefined
      ? {}
      : { listsShowingEmpty: shown.listsShowingEmpty }),
    ...(shown.listsStillShowing === undefined
      ? {}
      : { listsStillShowing: shown.listsStillShowing }),
  };
}
