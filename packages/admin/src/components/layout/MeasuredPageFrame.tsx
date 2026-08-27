"use client";

import type { ReactNode } from "react";

import { useSuppressedChrome } from "./ChromeSuppression";
import { CONTENT_PAGE_MEASURE } from "./content-measure";
import { PageContainer } from "./page-container";

interface MeasuredPageFrameProps {
  /**
   * Rendered above the content, but only when the page keeps its frame. An
   * immersive surface has no page to put a trail on.
   *
   * Optional because the default entry form carries its own header chrome and
   * renders no trail here; the slot is still present in the tree so both
   * callers reconcile identically. `null` says the same thing as omitting it.
   */
  breadcrumbs?: ReactNode;
  /**
   * The content bounds its own column, so the page must not bound it again.
   *
   * True for a view that seats chrome BESIDE its fields — the entry editor's
   * document rail is a fixed-width sibling of the field column, and under a
   * page-level cap the two share it, so the rail's width is spent out of the
   * author's. Such a view takes the panel and applies the measure to its
   * fields alone.
   *
   * Left false for everything else, and that is the point rather than
   * caution: a view with no rail gains nothing from the panel and a
   * plugin-supplied one would have its layout changed without asking. The
   * page keeps the content measure unless the content says it owns it.
   */
  contentCarriesMeasure?: boolean;
  children: ReactNode;
}

/**
 * The frame a measured content page renders in, decided in ONE place.
 *
 * An entry surface may take the window — a registered custom view, or a takeover
 * FIELD such as the page builder's, which asks from inside the default form.
 * The page frame is the innermost layer of admin chrome, so it is dropped from
 * here rather than from the layout:
 * suppressing the sidebars alone would leave the view stopping 32px short of
 * every edge with a breadcrumb above it, which reads as a bug.
 *
 * The view asks for this on mount, so this reacts to what it asked for rather
 * than deciding on its behalf. Nothing here knows which views are immersive,
 * which is the point — a list of them would drift as plugins added routes,
 * silently, because a missing entry still renders.
 *
 * Entries and Singles both use it, and entry create and edit route the SAME
 * registered component while also rendering the default form, so the decision
 * cannot live in any one of those places: a
 * copy in one is a copy that can disagree, and did — a view that took the
 * window while editing was framed and capped while creating the same record.
 *
 * The default form matters as much as the custom one. `BlocksField` suppresses
 * `pageFrame` from inside it, and a page that declares a measure without
 * honouring that would hand the page builder a measured column to work in.
 *
 * A framed view is page CONTENT, so the measure is the page's, declared here —
 * unless the view says it bounds its own, which is what `contentCarriesMeasure`
 * states. A view that quietly declared a width anyway would sit inside this
 * container's inset and add a second one to it, which is the disagreement the
 * shell exists to end; saying so is what keeps the two from both applying.
 *
 * Framed and immersive remain the whole FRAME vocabulary. The measure is a
 * separate question, and it has three answers rather than two: the page bounds
 * the content, the content bounds itself, or there is no frame to bound it.
 *
 * The measure is `wide`, not the form measure. Both are reading widths and the
 * difference is what is being read. A settings form is a short column of
 * labelled controls and nothing else. An entry is a document: its fields
 * include rich text, media and repeated groups, and it shares its column with
 * the document rail, so the rail's width comes out of the author's. At the form
 * measure that leaves the widest field under half the column, and controls that
 * lay out horizontally — an editor toolbar, the header's actions — wrap onto
 * extra rows or drop their labels for icons.
 */
export function MeasuredPageFrame({
  breadcrumbs,
  contentCarriesMeasure = false,
  children,
}: MeasuredPageFrameProps) {
  const framed = !useSuppressedChrome().has("pageFrame");

  // One tree in both states, differing only in props.
  //
  // The request arrives from an effect, so the frame necessarily changes AFTER
  // the view has mounted. Returning a different tree for the immersive case
  // replaces the subtree at that position, and React unmounts and remounts the
  // view: its state initialisers rerun, its mount-time fetches fire twice, and
  // the very request that changed the frame is made again. Keeping the
  // container and the trail slot in place — hidden rather than absent — leaves
  // the view at a stable reconciliation position, so the frame changes around
  // it and it never moves.
  //
  // `display: contents` is what removes the frame without removing the box:
  // the container's own grid, padding and background stop applying while its
  // children lay out exactly as if it were not there. An immersive view
  // therefore reaches every edge, which is the whole point of asking.
  // The slot is always in the tree so both callers reconcile identically, but
  // an empty one carries no gap: the default entry form passes no trail, and a
  // wrapper keeping its margin around nothing would push that editor down by
  // the height of a breadcrumb that is not there.
  // `== null` deliberately, covering `null` as well as `undefined`: a caller
  // whose trail is conditional renders `null`, and that is the same statement
  // — there is nothing to put a gap around.
  const trailClass = framed
    ? breadcrumbs == null
      ? undefined
      : "mb-6"
    : "hidden";

  return (
    <PageContainer
      width={contentCarriesMeasure ? "full" : CONTENT_PAGE_MEASURE}
      className={framed ? undefined : "contents"}
    >
      <div className={trailClass}>{breadcrumbs}</div>
      {children}
    </PageContainer>
  );
}
