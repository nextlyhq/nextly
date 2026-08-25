"use client";

import type { ReactNode } from "react";

import { useSuppressedChrome } from "./ChromeSuppression";
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
 * honouring that would hand the page builder a 56rem column to work in.
 *
 * A framed view is page CONTENT, so the measure is the page's, declared here.
 * A view that declared its own would sit inside this container's padding and
 * add a second inset to it, which is the disagreement the shell exists to end.
 * Framed and immersive are the whole vocabulary; there is no third case for a
 * width to answer.
 */
export function MeasuredPageFrame({
  breadcrumbs,
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
    <PageContainer width="form" className={framed ? undefined : "contents"}>
      <div className={trailClass}>{breadcrumbs}</div>
      {children}
    </PageContainer>
  );
}
