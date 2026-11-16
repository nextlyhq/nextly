/**
 * What the Add panel is handed: its props, and how far the pattern and
 * component libraries have loaded.
 *
 * @module insert-panel-types
 */

import type {
  AnyBlockDefinition,
  BlockNode,
  ComponentLookup,
  NestingSource,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { InsertDragEntry } from "./canvas-drag";
import type { EditorState } from "./editor-state";
import type { InsertEntry, SavedComponent, SavedPattern } from "./inserter";

/**
 * Where one tier of the host's library read stands, as the panel says it.
 *
 * `ready` covers a tier still in flight as well as one that arrived whole: an
 * empty tier that will fill in a moment is not one to explain, and a notice
 * that flashed on every open would be one an author learns to read past.
 *
 * `stale` and `unavailable` are both a read that failed, told apart by what
 * the host still holds. A host that reads afresh on every open keeps its last
 * answer while it does, so a failure can leave tiles standing — and beside
 * tiles, "none are offered" is false. What is true of them is that they may
 * be out of date, which is the sentence a stale tier gets.
 */
export type LibraryTierState = "ready" | "cut" | "stale" | "unavailable";

export interface InsertPanelProps {
  /**
   * The editor whose document this inserts into.
   *
   * The whole state rather than a document and an `apply` separately, because
   * the panel needs the selection and the document to agree with the `apply`
   * it calls. Passed apart, a caller can hand a document from one render and an
   * `apply` bound to another, and the insert lands at a position computed
   * against a document that no longer exists.
   */
  editor: EditorState;
  /**
   * The blocks to offer. Defaults to everything registered.
   *
   * Read ONCE per mount rather than subscribed to: the registry is global
   * mutable state with no change notification, so there is nothing to subscribe
   * to. A plugin registering while the panel is open is not reflected until it
   * remounts, which is the honest behaviour rather than a stale cache — and it
   * is why the version to stamp travels on the entry rather than being looked
   * up again at insert time.
   */
  definitions?: readonly AnyBlockDefinition[];
  /**
   * Saved patterns to offer, under the Sections tab. Defaults to none.
   *
   * Supplied rather than fetched, for the reason `definitions` is: this panel
   * draws what it is given and reads nothing. A pattern lives in a plugin's
   * collection, and how a host loads that — a route, a cache, a preloaded
   * page — is the host's question, not one the palette should answer.
   *
   * Rows the planner could not place are dropped when the catalogue is built,
   * so a caller may hand over whatever its query returned.
   */
  patterns?: readonly SavedPattern[];
  /**
   * The site's component definitions to offer, as one "Your components" group
   * in the Blocks tab. Defaults to none.
   *
   * Supplied rather than fetched, for the reason `patterns` is. Placing one
   * writes a single instance node pointing at the definition; nothing from the
   * definition is copied into the page.
   */
  components?: readonly SavedComponent[];
  /**
   * The lookup the CANVAS resolves instances against, keyed by definition id.
   *
   * A definition may itself hold instances of other components, at its root
   * included, and the panel judges where a tile may go from the block types
   * that will actually land — so each offered definition is first resolved
   * through this, exactly as the canvas resolves the page. The canvas's own
   * lookup rather than one rebuilt from `components`, so the tile and the
   * drawing cannot read two different maps. A row is offered only when this
   * holds its definition, and judged by that copy: the placed instance is
   * resolved against this lookup, so a row it lacks would land as a missing
   * component. Defaults to an empty lookup, which offers no component.
   */
  componentDefinitions?: ComponentLookup;
  /**
   * Where each tier of the host's library read stands, when it is not simply
   * here.
   *
   * A library has a ceiling, and a read that reached it left rows out; a read
   * can also fail outright, or fail to refresh what it had. The panel SAYS
   * each beside the tiles it offers, because the alternative is silence in
   * two places at once: an author searching here for a component that is not
   * offered, and an instance of it on the canvas drawn as could-not-be-loaded
   * with nothing to say whether the library was cut, could not be read, or
   * the component was deleted. A failed read is the state with a remedy, so
   * it is offered beside it.
   */
  library?: {
    readonly patterns?: LibraryTierState;
    readonly components?: LibraryTierState;
    /** Ask the host to read again. Offered beside a stale or unavailable tier. */
    readonly retry?: () => void;
  };
  /** How nesting is resolved. Defaults to the live registry. */
  nesting?: NestingSource;
  /**
   * Category headings to offer first, in order.
   *
   * Supplied by the host rather than ranked here: categories are free strings
   * any plugin may contribute, and a panel that hardcoded an order would rank
   * the first-party library above whatever a user installed. Unranked
   * categories still appear, after these.
   */
  categoryOrder?: readonly string[];
  /**
   * Block names to offer first within their category, in order; the rest
   * follow by label. Supplied by the host for the same reason as
   * `categoryOrder`.
   */
  blockOrder?: readonly string[];
  /** Notified after a successful insert, with the node that was added. */
  onInsert?: (node: BlockNode) => void;
  /**
   * Begins a drag carrying an entry, when the host has a canvas to drop onto.
   *
   * Optional, and its absence changes nothing: the rows still insert on click,
   * which is the route WCAG 2.2 SC 2.5.7 requires and the one this only ever
   * supplements. A panel mounted without a canvas — a story, a test — simply
   * has nothing to drag onto.
   *
   * The node is built HERE, by a thunk the drag calls at the release, because
   * this panel's definitions are one snapshot taken per mount. Resolving the
   * type again inside the drag would read the registry a second time, and the
   * row an author dragged could then differ from the subtree that lands.
   */
  beginInsertDrag?: (
    event: React.PointerEvent<HTMLElement>,
    entry: InsertDragEntry
  ) => void;
  /**
   * The container to add INSIDE, by id, when the author chose it with its
   * "+": every block goes there, whatever its kind. Absent, where a block
   * goes is the selection's and the block's to decide.
   *
   * A prop rather than read from the selection, because a layout block added
   * with a container selected goes after it: going inside, for any block, is
   * a gesture of its own, and only the host knows the author made it.
   */
  inside?: string;
  /**
   * The block to add right AFTER, by id, when the author chose the gap below
   * it with its "+": every block goes in that gap ("Adding between Hero and
   * Pricing"), even where the rule would put a block inside the selection.
   */
  after?: string;
  /**
   * Draws a preview of an entry for the popover beside the panel, when the
   * host has one (a block's example, rendered). Answering nothing falls back
   * to the entry's mark, drawn large.
   *
   * The host's because drawing a block is the renderer's job, which this panel
   * does not hold.
   */
  renderPreview?: (entry: InsertEntry) => React.ReactNode;
  /**
   * How many times an add control on the canvas has asked for this panel,
   * counted by the host. Each new count is a press the panel answers, so the
   * author sees it heard them whether it just opened or was already open: the
   * search takes focus, the list goes back to the top, and the line naming
   * the place is highlighted for a moment. `undefined` while no press waits,
   * as when the panel is opened from the rail.
   */
  summoned?: number;
  /** Told each count the panel has answered, so the host asks no more. */
  onSummoned?: (count: number) => void;
}
