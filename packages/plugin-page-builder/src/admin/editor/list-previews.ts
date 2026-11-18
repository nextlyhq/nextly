/**
 * The lists the canvas previews: those an author chose to see empty, and
 * those tagged as still showing what they store.
 *
 * The page's own, and while a header or footer is edited in place, the
 * region's as well: its frame draws in the page's render context, so a list
 * in the header previewed empty from Layers or the inspector is drawn empty
 * there, while the page's own choices stay as they were.
 *
 * @module admin/editor/list-previews
 */
import type { EditorState } from "@nextlyhq/builder/shell";
import { useMemo } from "react";

type ListPreviews = Pick<
  EditorState,
  "listsShowingEmpty" | "listsStillShowing"
>;

/** The page's list previews joined with the edited region's. */
export function useListPreviews(
  page: ListPreviews,
  active: ListPreviews
): ListPreviews {
  const empty = useMemo(
    () => joined(page.listsShowingEmpty, active.listsShowingEmpty),
    [page.listsShowingEmpty, active.listsShowingEmpty]
  );
  const still = useMemo(
    () => joinedTags(page.listsStillShowing, active.listsStillShowing),
    [page.listsStillShowing, active.listsStillShowing]
  );
  return {
    ...(empty === undefined ? {} : { listsShowingEmpty: empty }),
    ...(still === undefined ? {} : { listsStillShowing: still }),
  };
}

function joined(
  page: ReadonlySet<string> | undefined,
  active: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (active === undefined || active === page || active.size === 0) {
    return page;
  }
  return new Set([...(page ?? []), ...active]);
}

function joinedTags(
  page: ReadonlyMap<string, string> | undefined,
  active: ReadonlyMap<string, string> | undefined
): ReadonlyMap<string, string> | undefined {
  if (active === undefined || active === page || active.size === 0) {
    return page;
  }
  return new Map([...(page ?? []), ...active]);
}
