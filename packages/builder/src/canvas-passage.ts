/**
 * The component placement's exposed passage the canvas is editing in place,
 * as the inspector is told it.
 *
 * One rich-text editor serves the canvas and the inspector's fields, so a
 * field opened on the passage the canvas holds would take it from under the
 * author's caret. The inspector holds that field instead, and says where the
 * passage is being edited.
 *
 * @module canvas-passage
 */
import * as React from "react";

/** A placement's exposed passage, by the placement and the exposure. */
export interface CanvasPassage {
  readonly placementId: string;
  readonly exposureId: string;
}

/** The passage the canvas is editing, or `null` while it edits none. */
export const CanvasPassageContext: React.Context<CanvasPassage | null> =
  React.createContext<CanvasPassage | null>(null);
