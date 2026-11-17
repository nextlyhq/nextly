/**
 * What the in-place picker is asked and handed: where it adds, what opened
 * it, and the sources it offers blocks from (the Add panel's own).
 *
 * @module insert-picker-types
 */

import type { BlockNode, OpPosition } from "@nextlyhq/blocks-engine";

import type { InsertOffersInputs } from "./insert-panel-offers";
import type { Measurable } from "./insert-panel-summon";
import type { InsertPanelProps } from "./insert-panel-types";

/**
 * A place the author chose to add at: inside a container (its "+"), in the
 * gap right after a block (a "+" between blocks), or any other position (the
 * page's top level, or before a container's first block).
 */
export type InsertPlace =
  | { readonly inside: string }
  | { readonly after: string }
  | { readonly at: OpPosition };

/**
 * Where the picker adds:
 *
 * - `rule`: opened with "/" from the selection (or from nothing selected);
 *   each block goes where the one placement rule puts it, as in the Add
 *   panel, and the line follows the highlight;
 * - `place`: opened from a control with a place of its own; every block is
 *   judged against that one place, and one it refuses is not offered.
 */
export type InsertPickerTarget =
  | { readonly kind: "rule" }
  | { readonly kind: "place"; readonly place: InsertPlace };

/** One opening of the picker. */
export interface InsertPickerRequest {
  readonly target: InsertPickerTarget;
  /** What the picker is drawn beside. */
  readonly anchor: Measurable;
  /** Where focus goes back when the picker closes without adding. */
  readonly opener: HTMLElement | null;
  /** Counted per opening, so opening again starts a fresh search. */
  readonly count: number;
}

/** What the picker is handed besides the request. */
export interface InsertPickerProps
  extends Omit<InsertOffersInputs, "inside" | "after" | "at" | "enabled"> {
  /** The opening to draw, or `null` while the picker is closed. */
  readonly request: InsertPickerRequest | null;
  /** Told when the picker closes, whether or not it added a block. */
  readonly onClose: () => void;
  /**
   * "Browse all blocks and sections →": the host opens the Add panel with the
   * picker's target, so a block clicked there lands where it would have here.
   */
  readonly onBrowseAll: (target: InsertPickerTarget) => void;
  /**
   * Opens a block's text for typing, answering whether it could: the same
   * verb Enter runs on a selected block. A block added from the picker is
   * opened this way when it has text; otherwise focus goes to the canvas
   * with the new block selected.
   */
  readonly onEditText?: (nodeId: string) => boolean;
  /** Category headings first in the search's results, as the Add panel's. */
  readonly categoryOrder?: InsertPanelProps["categoryOrder"];
  /** Block names first within a category, as the Add panel's. */
  readonly blockOrder?: InsertPanelProps["blockOrder"];
}

/** How an opening of the picker ended. */
export type PickerOutcome =
  | { readonly kind: "inserted"; readonly node: BlockNode }
  | { readonly kind: "dismissed"; readonly returnFocus: boolean }
  | { readonly kind: "browse" };
