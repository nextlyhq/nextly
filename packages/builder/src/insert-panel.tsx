"use client";

/**
 * The inserter: what an author can add, and adding it.
 *
 * **Draws what `inserter` decides and decides nothing itself.** Every question
 * with an answer worth testing — what may be offered here, what a query
 * matches, where the block lands, what node to build — lives in that module,
 * where it can be asserted without a DOM. This file is the surface: focus,
 * keyboard, markup and the words an author reads.
 *
 * **Interaction is composed from `@nextlyhq/ui`'s command primitives rather
 * than rebuilt.** They already own the roving focus, the ARIA listbox wiring
 * and the type-ahead that the command palette uses, so an inserter with its own
 * keyboard handling would be a second implementation of the same widget that
 * drifts from it the first time either is corrected — and the two sit one panel
 * apart in the same editor.
 *
 * `shouldFilter={false}` is the load-bearing half of that composition. cmdk
 * filters by default, so leaving it on would put a SECOND filter beside
 * `filterEntries` — two answers to "does this row match", disagreeing about
 * block names and keywords, with the tested one silently overruled.
 *
 * ## The layout is two-dimensional and the KEYBOARD is not
 *
 * Tiles sit in a grid, and Down still moves to the next tile rather than the
 * one below. That reads as an oversight and is a deliberate retreat from the
 * opposite, which was built and removed.
 *
 * The primitives publish a `listbox`, whose keyboard model is one-dimensional
 * by definition: a screen reader announces "option 4 of 18" and Down means the
 * next option. Moving by a ROW instead makes the announcement a lie — Down
 * silently skips two — so a grid keyboard is only honest alongside a grid
 * accessibility tree, with rows, cells and coordinates.
 *
 * That tree is not something this file can add on top. `aria-activedescendant`
 * and the scroll-into-view are driven from the primitives' own navigation, and
 * a controlled `value` set from outside updates neither: the highlight and
 * this panel's popover would follow while the announced option and the scroll
 * position stayed where they were. Owning them instead means owning roving
 * focus and the ARIA wiring — the second implementation of this widget that
 * the paragraphs above exist to refuse.
 *
 * So the grid is a LAYOUT. Reading order is left to right and then down, which
 * is the order the primitives already move in, and search is what makes a long
 * palette reachable without arrowing at all.
 *
 * ## A refused tile stays, and stays reachable
 *
 * A tile the place refuses — by the placement rule or by a lock — is drawn
 * greyed with its reason, rather than left out: an author who cannot see a
 * block has no way to learn where it would go. It is NOT the primitives'
 * `disabled`, and carries no `aria-disabled`, because the primitives skip
 * every item marked so when the arrow keys move: a keyboard author could then
 * never reach the reason. It is marked `data-refused` for the eye, its reason
 * leads its accessible description, and choosing it inserts nothing.
 *
 * @module insert-panel
 */

import {
  allBlocks,
  asPermittedList,
  COMPONENT_INSTANCE_TYPE,
  findNode,
  permittedLabel,
  placementSiteIn,
  planInsertPattern,
  registryNestingSource,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type NestingSource,
  type NestingVerdict,
  type OpPosition,
  type PlacementSources,
  type PlacementVerdict,
} from "@nextlyhq/blocks-engine";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useCommandHighlight,
} from "@nextlyhq/ui";
import { CornerDownRight } from "lucide-react";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { InsertDragEntry } from "./canvas-drag";
import { isElement } from "./dom-kind";
import {
  placementWording,
  refusalWording,
  type RefusalWording,
} from "./drag-refusal";
import type { EditorState } from "./editor-state";
import { EDITOR_WORDS } from "./editor-words";
import {
  entryContentRefusal,
  offeredIn,
  withEntryContentField,
} from "./entry-content-rules";
import {
  blockLabel,
  blockSourceFor,
  catalogFrom,
  categoryHeading,
  componentEntriesFrom,
  entryVerdictAt,
  filterEntries,
  insertionCandidates,
  insertionFor,
  nodeForComponentEntry,
  nodeForEntry,
  paletteGroups,
  patternEntriesFrom,
  registrySlotSource,
  slotsShowingEmpty,
  UNCATEGORISED,
  type BlockInsertEntry,
  type ComponentInsertEntry,
  type EntryPlacement,
  type InsertGroup,
  type InsertionCandidate,
  type InsertEntry,
  type PatternInsertEntry,
  type SavedComponent,
  type SavedPattern,
} from "./inserter";
import { layerLabel } from "./layers";
import { lockRefusalWording, type LockRefusalFacts } from "./lock-refusal";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp } from "./op-vocabulary";
import { usePreviewedCollection } from "./previewed-entry";

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
   * "+". Absent, a block goes after the selection (or at the end of the page).
   *
   * A prop rather than read from the selection, because selecting a container
   * and adding still builds the page downward, beside it: going inside is a
   * gesture of its own, and only the host knows the author made it.
   */
  inside?: string;
  /**
   * Draws a preview of an entry for the popover beside the panel, when the
   * host has one (a block's example, rendered). Answering nothing falls back
   * to the entry's mark, drawn large.
   *
   * The host's because drawing a block is the renderer's job, which this panel
   * does not hold.
   */
  renderPreview?: (entry: InsertEntry) => React.ReactNode;
}

/** The panel's two tabs: blocks and the site's components, and patterns. */
type PanelTab = "blocks" | "sections";

/** Each tab's own word, as a sentence reads it, from the editor's words. */
const TAB_WORDS: Readonly<Record<PanelTab, string>> = {
  blocks: EDITOR_WORDS.blocks.toLowerCase(),
  sections: EDITOR_WORDS.sections.toLowerCase(),
};

/** What the search says it searches, per tab. */
const SEARCH_PLACEHOLDERS: Readonly<Record<PanelTab, string>> = {
  blocks: `Search ${TAB_WORDS.blocks} and ${EDITOR_WORDS.components.toLowerCase()}`,
  sections: `Search ${TAB_WORDS.sections}`,
};

/** Which tab an entry is offered in. Patterns are Sections; the rest Blocks. */
function tabOf(entry: InsertEntry): PanelTab {
  return entry.kind === "pattern" ? "sections" : "blocks";
}

/**
 * One entry as the panel offers it at the current place: where a click puts
 * it, or why it cannot go there.
 */
export type EntryOffer =
  | {
      readonly entry: InsertEntry;
      readonly place: InsertionCandidate;
      /**
       * Whether the place is past the one the placement line names, because
       * that one refuses this entry: the tile then says where it goes.
       */
      readonly climbed: boolean;
      readonly refusal?: undefined;
    }
  | {
      readonly entry: InsertEntry;
      readonly place?: undefined;
      readonly climbed?: undefined;
      readonly refusal: string;
    };

/**
 * How many tiles sit in a row.
 *
 * A CONSTANT rather than a count derived from the panel's measured width:
 * measuring would need the layout to have happened before anything could read
 * it. Three because the panel opens at 300px and its padding and gaps leave
 * about 85px per tile there — a glyph and a short word. It is also what keeps
 * the grid from REFLOWING while the author drags the panel's edge, which would
 * move a tile out from under the cursor mid-drag.
 *
 * LAYOUT ONLY. No keyboard behaviour derives from it, and that is deliberate
 * rather than an omission: arrow keys stepping by a row would contradict the
 * listbox semantics the palette announces. See this module's documentation.
 */
const GRID_COLUMNS = 3;

/**
 * The lookup a host that supplies none is judged under: nothing resolves.
 *
 * One shared instance rather than a `new Map()` per render, because the
 * catalogue memo is keyed on it and a fresh empty map each render would
 * rebuild the catalogue on every keystroke of the filter.
 */
const NO_DEFINITIONS: ComponentLookup = new Map();
/** No offers, while they are not being looked at. */
const NO_OFFERS: ReadonlyMap<string, EntryOffer> = new Map();

/**
 * That a tier of the library was cut, or could not be read, said where an
 * author looks for what is missing.
 *
 * `status` regions rather than alerts: each is a standing fact about this
 * read, present from the moment the panel opens, and an alert would interrupt
 * a screen reader mid-sentence to announce something that is not an event.
 * Drawn above the tiles so they are read BEFORE an author searches in vain —
 * a note at the end of a long list is one they reach after giving up.
 *
 * Named per tier, because the remedy the author reaches for differs: a pattern
 * left out is one they cannot insert, while a component left out is also one
 * already on the page drawing as could-not-be-loaded, and that second half is
 * the sentence nothing else says. A tier that could not be read at all gets
 * its own sentence and the retry, because that is a state with a remedy the
 * author can reach from here — and a tier that could not be RE-read gets a
 * third, since beside the tiles it left standing the second would be false.
 */
export function LibraryNotices({
  library,
  tier,
}: {
  library: InsertPanelProps["library"];
  /** The tier the surface offers: patterns as sections, or components. */
  tier: LibraryTier;
}): React.JSX.Element {
  return (
    <>
      <CutNotice tiers={tiersIn(library, "cut", tier)} />
      <StaleNotice
        tiers={tiersIn(library, "stale", tier)}
        retry={library?.retry}
      />
      <UnavailableNotice
        tiers={tiersIn(library, "unavailable", tier)}
        retry={library?.retry}
      />
    </>
  );
}

/** A tier of the host's library, as a notice names it. */
export type LibraryTier = "patterns" | "components";

/** The tiers a ceiling cut, and what a cut component means for the page. */
function CutNotice({
  tiers,
}: {
  tiers: string | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The library is larger than the editor can load at once, so some {tiers}{" "}
      are not offered here.
      {tiers.includes("components")
        ? " A component left out shows as “could not be loaded” on the page."
        : null}
    </p>
  );
}

/**
 * The tiers whose last answer could not be refreshed. The tiles stand, so
 * what is said of them is that they may be out of date — and of a component
 * on the page, that it draws as it was.
 */
function StaleNotice({
  tiers,
  retry,
}: {
  tiers: string | undefined;
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The site’s {tiers} could not be reloaded, so those offered may be out of
      date.
      {tiers.includes("components")
        ? " A component already on the page draws as it was."
        : null}{" "}
      <RetryButton retry={retry} />
    </p>
  );
}

/** The tiers that could not be read at all, and what that means for the page. */
function UnavailableNotice({
  tiers,
  retry,
}: {
  tiers: string | undefined;
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The site’s {tiers} could not be loaded, so none are offered here.
      {tiers.includes("components")
        ? " A component already on the page shows as “could not be loaded”."
        : null}{" "}
      <RetryButton retry={retry} />
    </p>
  );
}

/** The one remedy a failed read has, when the host supplied it. */
function RetryButton({
  retry,
}: {
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (retry === undefined) return null;
  return (
    <button type="button" className="nx-insert-panel__retry" onClick={retry}>
      Try again
    </button>
  );
}

/**
 * The surface's own tier when it is in one state, as the word a sentence
 * names it with — or nothing. Each surface reports only the tier it offers,
 * so it never reports content that could not appear in it.
 */
function tiersIn(
  library: InsertPanelProps["library"],
  state: LibraryTierState,
  tier: LibraryTier
): LibraryTier | undefined {
  return library?.[tier] === state ? tier : undefined;
}

/**
 * The tier a tab offers: components among the blocks, patterns as sections.
 */
function tierOf(tab: PanelTab): LibraryTier {
  return tab === "sections" ? "patterns" : "components";
}

/**
 * What a press does, for the pointer that has no other way to ask.
 *
 * A press moves the highlight, so the popover beside the panel describes the
 * tile under the finger before it lifts. That is the affordance a touch author
 * could not discover: on a pointer that cannot hover, the only way to read a
 * tile looked like the way to take it.
 *
 * WHAT IT DOES NOT CLAIM. An earlier wording offered "slide off to cancel",
 * and that is not reliably true: the canvas sits beside this panel and IS a
 * drop target, so a finger sliding horizontally out of the tile can start a
 * palette drag and insert on release. Only a release over nothing declines,
 * and which regions those are depends on the layout the host mounted. Both
 * clauses here hold wherever the panel is mounted — pressing reads, lifting
 * commits — and an author who knows lifting commits can hold and think.
 *
 * SHOWN FROM THE POINTER THAT WAS ACTUALLY USED, not from a media query.
 * `(pointer: coarse)` describes the PRIMARY pointer, so a touchscreen laptop
 * driven by its trackpad reports `fine` and hides this from the author the
 * moment they reach up and touch the screen. The pointer type on the event is
 * the input in hand rather than the one the device is classified by, and it
 * has the side benefit of appearing exactly when it is relevant: after the
 * first press, which is when the question arises.
 *
 * `aria-hidden`, deliberately. It describes a POINTER gesture, and a screen
 * reader on a touch device does not activate a control by lifting a finger
 * from it — the guidance would be wrong for exactly the people an accessible
 * name is for. The block's description reaches them through each tile's own
 * `aria-describedby` regardless.
 */
function TouchGestureHint({
  shown,
}: {
  shown: boolean;
}): React.JSX.Element | null {
  if (!shown) return null;
  return (
    <p aria-hidden className="nx-insert-panel__gesture-hint">
      Press to read · lift to insert
    </p>
  );
}

/**
 * The entry a command value names, among those in view, or nothing.
 *
 * Scoped to the GROUPS rather than to the whole catalog, because a filter can
 * remove the highlighted entry between renders, and describing something the
 * author cannot see is worse than describing nothing. No fallback to the first
 * entry: the popover describes a tile the author moved to, never one the
 * primitives happened to mark when the list drew.
 */
function highlightedEntry(
  groups: readonly InsertGroup<InsertEntry>[],
  tokens: ReadonlyMap<string, string>,
  active: string
): InsertEntry | undefined {
  if (active === "") return undefined;
  for (const group of groups) {
    for (const entry of group.entries) {
      if (tokens.get(entry.id) === active) return entry;
    }
  }
  return undefined;
}

/**
 * Anything a popover can be anchored to: the tile, or nowhere while there is
 * no tile in the document to measure.
 */
interface Measurable {
  getBoundingClientRect(): DOMRect;
}

/** The anchor for a popover with no tile under it: a point at the origin. */
const NOWHERE: Measurable = {
  getBoundingClientRect: () => new DOMRect(),
};

/**
 * The tile in the panel carrying a command value.
 *
 * Found by comparing the attribute rather than through a selector, because a
 * value is an id from `useId` and a selector would need it escaped.
 */
function tileElement(
  root: HTMLElement | null,
  token: string | undefined
): HTMLElement | null {
  if (root === null || token === undefined) return null;
  for (const item of root.querySelectorAll<HTMLElement>("[cmdk-item]")) {
    if (item.getAttribute("data-value") === token) return item;
  }
  return null;
}

/**
 * The popover beside the panel, describing the tile the author moved to.
 *
 * Rendered INSIDE the palette, because that is where the highlight lives:
 * `useCommandHighlight` reads the palette's own store, so this follows a
 * pointer, an arrow key and a filter alike without the panel keeping a second
 * copy of which tile is current.
 *
 * Controlled, and open only once the author has moved through the tiles
 * (`shown`): the primitives mark their first item the moment the list draws,
 * and a popover opened on that would describe a tile nobody pointed at.
 *
 * `aria-hidden`, and it never takes focus: everything it says is the tile's
 * own accessible description already, so a screen reader hears it on the
 * tile, and focus has to stay in the search for typing and the arrow keys to
 * keep working. Anchored to the tile itself, so it sits beside the one it
 * describes as the highlight moves down the grid.
 */
function TilePopover({
  shown,
  groups,
  tokens,
  offers,
  root,
  renderPreview,
  document,
  onDismiss,
}: {
  shown: boolean;
  groups: readonly InsertGroup<InsertEntry>[];
  tokens: ReadonlyMap<string, string>;
  offers: ReadonlyMap<string, EntryOffer>;
  root: React.RefObject<HTMLDivElement | null>;
  renderPreview: InsertPanelProps["renderPreview"];
  document: BlockDocument;
  onDismiss: () => void;
}): React.JSX.Element | null {
  const highlighted = useCommandHighlight();
  const entry = shown
    ? highlightedEntry(groups, tokens, highlighted)
    : undefined;
  const anchor = React.useRef<Measurable>(NOWHERE);
  // Pointed at the tile after the commit has drawn it and BEFORE the anchor's
  // own effect reads it: layout effects run ahead of passive ones, so the
  // popover measures the tile it describes rather than the one before it.
  React.useLayoutEffect(() => {
    anchor.current =
      entry === undefined
        ? NOWHERE
        : (tileElement(root.current, tokens.get(entry.id)) ?? NOWHERE);
  });
  if (entry === undefined) return null;
  const offer = offers.get(entry.id);
  const refusal = offer?.refusal;
  const preview = renderPreview?.(entry);
  return (
    <Popover
      open
      // Escape, or a press or focus outside the panel, closes it until the
      // author moves through the tiles again.
      onOpenChange={open => {
        if (!open) onDismiss();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        aria-hidden="true"
        className="nx-insert-popover"
        // Focus stays in the search, where typing and the arrow keys work.
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        // A press on a tile is how touch reads one, and focus stays in the
        // search, so nothing inside the panel dismisses the popover.
        onInteractOutside={event => {
          const target = event.target;
          // Asked through dom-kind, which answers for a node from any
          // window, the canvas frame's included.
          if (isElement(target) && root.current?.contains(target)) {
            event.preventDefault();
          }
        }}
      >
        <div className="nx-insert-popover__preview">
          {preview ?? <BlockIconMark icon={entry.icon} size={28} />}
        </div>
        <b className="nx-insert-popover__name">{entry.label}</b>
        {entry.description === "" ? null : (
          <span className="nx-insert-popover__description">
            {entry.description}
          </span>
        )}
        {offer?.climbed === true ? (
          <span className="nx-insert-popover__place">
            <CornerDownRight aria-hidden="true" size={12} />
            <span>{placementWords("Goes", document, offer.place)}</span>
          </span>
        ) : null}
        <span
          className="nx-insert-popover__hint"
          data-refused={refusal === undefined ? undefined : "true"}
        >
          {refusal ?? howToAdd(entry)}
        </span>
      </PopoverContent>
    </Popover>
  );
}

/**
 * How a tile is added. A pattern cannot be dragged: it is a forest placed as
 * a group, with no one node a drag carries. A block and a component are each
 * one node, a component's an instance pointing at its definition.
 */
function howToAdd(entry: InsertEntry): string {
  return entry.kind === "pattern"
    ? "Click to add"
    : "Click to add · drag to place";
}

/**
 * The line under the search that says where the next block goes: where the
 * highlighted tile goes, or at rest the FIRST place a click may use — the
 * one an author expects. Following the highlight names a place before the
 * click wherever a tile goes further than that first place: past a region
 * that refuses it, or inside the selected container as the last resort.
 *
 * A polite live region at rest, because it changes with every selection and
 * an assertive one would interrupt a screen reader mid-sentence each time.
 * Not while it follows the highlight: the highlighted tile's own description
 * already says where it goes, so announcing the line too would say it twice
 * on every arrow key. The block is named as Layers names it, an author's own
 * name first, so the line agrees with the tree beside it.
 */
function PlacementLine({
  document,
  first,
  shown,
  groups,
  tokens,
  offers,
}: {
  document: BlockDocument;
  first: InsertionCandidate;
  shown: boolean;
  groups: readonly InsertGroup<InsertEntry>[];
  tokens: ReadonlyMap<string, string>;
  offers: ReadonlyMap<string, EntryOffer>;
}): React.JSX.Element {
  const highlighted = useCommandHighlight();
  const entry = shown
    ? highlightedEntry(groups, tokens, highlighted)
    : undefined;
  const place =
    (entry === undefined ? undefined : offers.get(entry.id)?.place) ?? first;
  return (
    <p
      className="nx-insert-panel__placement"
      aria-live={entry === undefined ? "polite" : "off"}
    >
      <CornerDownRight aria-hidden="true" size={14} />
      <span>{placementWords("Adding", document, place)}</span>
    </p>
  );
}

/**
 * Where a place is, in words: "after", "inside" or "at the end of the page",
 * and the block it is beside or in, named as Layers names it.
 */
function placeParts(
  document: BlockDocument,
  candidate: InsertionCandidate
): { where: string; name?: string } {
  if (candidate.kind === "document-end") {
    return { where: "at the end of the page" };
  }
  const inside = candidate.kind === "inside";
  const id = inside ? candidate.insideId : candidate.afterId;
  const node = id === undefined ? undefined : findNode(document.nodes, id);
  // The guard is over an id the candidate was built from this same document,
  // so it holds; the words still say something true if it ever does not.
  return {
    where: inside ? "inside" : "after",
    name: node === undefined ? "the selected block" : layerLabel(node),
  };
}

/** "Adding after Heading", say, with the block's name in bold. */
export function placementWords(
  lead: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): React.ReactNode {
  const { where, name } = placeParts(document, candidate);
  return name === undefined ? (
    `${lead} ${where}`
  ) : (
    <>
      {`${lead} ${where} `}
      <b>{name}</b>
    </>
  );
}

/**
 * Start an entry's drag, when the host has a canvas to drop onto.
 *
 * A block or a component. A drag carries ONE node to a drop target, and a
 * pattern is a forest placed as a group — so there is no node to hand the
 * drag, and offering the gesture would start something that cannot finish.
 *
 * A component lands as the instance node a click writes. The canvas judges
 * a drop by the node the drag builds, resolving an instance through the
 * lookup it draws with, so the drop and the tile judge the same roots.
 *
 * An entry the click places refuse is still dragged. Its tile says where it
 * belongs ("drag this into one"), and where a drop may land is the canvas's
 * question, judged at the destination, not the panel's.
 *
 * Shared by every panel that inserts, so a row is dragged the same way
 * wherever it is offered.
 */
export function beginEntryDrag(
  event: Parameters<NonNullable<InsertPanelProps["beginInsertDrag"]>>[0],
  entry: InsertEntry,
  drag: {
    begin: InsertPanelProps["beginInsertDrag"];
    definitions: Parameters<typeof nodeForEntry>[1];
    nesting: NestingSource | undefined;
    onInserted: InsertPanelProps["onInsert"];
    /**
     * The field an Entry content block draws once placed, as a click
     * places it.
     */
    entryField?: string | undefined;
    /**
     * Why the entry cannot go anywhere in this document, which no drop can
     * change: a template's one Entry content block, already placed. Such an
     * entry is not dragged.
     */
    refusedEverywhere?: boolean;
  }
): void {
  if (drag.refusedEverywhere === true) return;
  if (entry.kind === "component") {
    drag.begin?.(event, {
      blockName: COMPONENT_INSTANCE_TYPE,
      makeNode: () => nodeForComponentEntry(entry),
      onInserted: drag.onInserted,
    });
    return;
  }
  if (entry.kind !== "block") return;
  drag.begin?.(event, {
    blockName: entry.blockName,
    makeNode: () =>
      withEntryContentField(
        nodeForEntry(entry, drag.definitions, drag.nesting),
        drag.entryField
      ),
    // The same notification the click path sends, so a host cannot see one
    // kind of insert and miss the other.
    onInserted: drag.onInserted,
  });
}

/**
 * What a tile says before what it is: why it cannot go here, or where it goes
 * when that is past the place the placement line names.
 */
export function tileAside(
  offer: EntryOffer | undefined,
  document: BlockDocument
): string | undefined {
  if (offer?.refusal !== undefined) return offer.refusal;
  return offer?.climbed === true
    ? placementSentence("Goes", document, offer.place)
    : undefined;
}

/** The same place as one plain sentence, for a tile's description. */
function placementSentence(
  lead: string,
  document: BlockDocument,
  candidate: InsertionCandidate
): string {
  const { where, name } = placeParts(document, candidate);
  return name === undefined ? `${lead} ${where}.` : `${lead} ${where} ${name}.`;
}

/**
 * The keys the palette's primitives move the highlight with: the arrows,
 * Home and End, and the Ctrl bindings they also honour. A key outside these
 * leaves the panel at rest.
 */
function movesTheHighlight(event: React.KeyboardEvent): boolean {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return true;
  return event.ctrlKey && ["n", "j", "p", "k"].includes(event.key);
}

/** What {@link useInsertOffers} reads: the panel's own sources of blocks. */
export type InsertOffersInputs = Pick<
  InsertPanelProps,
  | "editor"
  | "definitions"
  | "patterns"
  | "components"
  | "componentDefinitions"
  | "nesting"
  | "inside"
  | "onInsert"
> & {
  /**
   * Whether to judge the offers at all. The editor's search keeps this hook
   * mounted while it is closed, and judging every entry against every place on
   * each edit is work nobody is looking at. `true` when absent.
   */
  enabled?: boolean;
};

/** What can be added, where each would go, and the act of adding one. */
export interface InsertOffers {
  /** Blocks, then saved patterns and components, in one list. */
  readonly catalog: readonly InsertEntry[];
  /** The places a click may use, in the order they are tried. */
  readonly candidates: readonly InsertionCandidate[];
  /** Each entry's offer, by entry id: its place, or why it has none. */
  readonly offers: ReadonlyMap<string, EntryOffer>;
  /** The definitions an insert builds a block's children from. */
  readonly blockSource: Parameters<typeof nodeForEntry>[1];
  /** Add an entry where its offer says, or nothing when it was refused. */
  readonly insert: (offer: EntryOffer | undefined) => void;
}

/**
 * The Add panel's offers and its insert, as a hook.
 *
 * The panel and the editor's search both call this, so a search row says the
 * place a tile would and adds there by the same path: one answer to "what can
 * be added here, and where does it go".
 *
 * @experimental
 */
export function useInsertOffers({
  editor,
  definitions,
  patterns,
  components,
  componentDefinitions,
  nesting,
  inside,
  onInsert,
  enabled = true,
}: InsertOffersInputs): InsertOffers {
  // ONE snapshot, taken per mount, that both the catalog and the default
  // expansion below read. The panel documents its palette as read once per
  // mount rather than subscribed to, and a second reading of the registry
  // taken later is a different list: a plugin registering while the panel is
  // open would leave a row offering one definition's version and props while
  // its children came from another.
  const palette = React.useMemo(
    () => definitions ?? allBlocks(),
    [definitions]
  );
  const source = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );
  // Blocks, then whatever saved patterns and components the host supplied.
  // One list rather than three, because the offer, the tokens and the filter
  // all run across every tier; the tabs then show their share of it. A block
  // only a template may hold is offered only while one is open.
  const documentKind = editor.document.kind;
  const catalog = React.useMemo<InsertEntry[]>(
    () => [
      ...catalogFrom(palette).filter(entry =>
        offeredIn(documentKind, entry.blockName)
      ),
      ...patternEntriesFrom(patterns ?? [], source, componentDefinitions),
      ...componentEntriesFrom(
        components ?? [],
        componentDefinitions ?? NO_DEFINITIONS
      ),
    ],
    [palette, patterns, components, componentDefinitions, source, documentKind]
  );
  // The field an Entry content block draws once placed: the template's
  // collection's first top-level blocks field, so the stored choice is
  // explicit from the start.
  const firstBlocksField = usePreviewedCollection()?.blocksFields?.[0]?.name;

  // Inside a list the canvas shows empty, a block goes to its empty state.
  const showingEmpty = editor.listsShowingEmpty;
  const slotSource = React.useMemo(
    () => slotsShowingEmpty(registrySlotSource(), showingEmpty),
    [showingEmpty]
  );

  // Derived from the SAME snapshot the catalog is, so the row an author sees
  // and the subtree an insert builds cannot come from two different readings.
  // The palette may be a caller-supplied subset holding a definition the
  // registry does not, and the block being inserted is the one whose
  // declaration is read — so resolving only against the registry would offer
  // that block and then insert it without the children it declares.
  const blockSource = React.useMemo(() => blockSourceFor(palette), [palette]);

  // Recomputed from the CURRENT document and selection on every render rather
  // than remembered. A place is only valid against the document it was read
  // from, and an undo or a remote edit can move it without the selection
  // changing — a memo keyed on the selection alone would keep a position whose
  // index no longer names the same place.
  const candidates = insertionCandidates(editor.document, editor.selectedId, {
    slots: slotSource,
    ...(inside === undefined ? {} : { inside }),
  });

  // Remembered by what the verdicts depend on — the document, the places, the
  // catalog, the rule's sources and the locks — and not by the query, so a
  // keystroke asks no rule anything: judging a pattern walks its forest and a
  // component composes its definition, once per entry and place.
  const offerCache = React.useRef<OfferCache | undefined>(undefined);
  const offers = !enabled
    ? NO_OFFERS
    : cachedOffers(offerCache, {
        document: editor.document,
        candidates,
        catalog,
        source,
        components: componentDefinitions,
        expansion: { definitions: blockSource, nesting },
        editor,
      });
  /*
   * Add an entry where its offer says, or nothing when it was refused.
   *
   * The guard is the whole of what a refused tile does on a click or an Enter:
   * it stays reachable so its reason can be read, and choosing it changes
   * nothing.
   */
  const insert = (offer: EntryOffer | undefined) => {
    if (offer?.place === undefined) return;
    const { entry } = offer;
    const at = offer.place.at;
    if (entry.kind === "pattern") {
      insertPattern(entry, at);
      return;
    }
    if (entry.kind === "component") {
      insertComponent(entry, at);
      return;
    }
    // `nesting` rather than `source`. They differ exactly when the caller
    // supplied no rules: `source` has already defaulted to the REGISTRY, which
    // knows nothing about a supplied definition and so reports every one of its
    // types as unrestricted. Passing it defeats the fallback in
    // `expandSlotDefaults`, which derives the rules from these same
    // definitions — the only source that can see a supplied block's `parent`
    // and its slots' `allow`.
    const node = withEntryContentField(
      nodeForEntry(entry, blockSource, nesting),
      firstBlocksField
    );
    // `apply` is the only path a document changes by, so undo covers this
    // insert for free. It answers null when the op is refused, and a refusal
    // must not be reported as an insert — the panel offers only placements the
    // rule permits, so a null here means the document moved underneath it.
    if (editor.apply({ kind: "insert", node, at }) === null) return;
    // Selecting what was just added is what makes a second insert land after
    // it, so repeated inserts build downward instead of stacking at one point.
    editor.select(node.id);
    onInsert?.(node);
  };

  /**
   * Place a component: ONE insert of an instance node.
   *
   * No planner, because there is nothing to plan — a pattern is a forest that
   * has to be re-identified and judged root by root against the destination,
   * while an instance is a single node whose content lives in the definition.
   * The placement was judged when the tile was offered, by the definition's
   * roots, so a refusal here means the document moved underneath the panel.
   */
  const insertComponent = (entry: ComponentInsertEntry, at: OpPosition) => {
    const node = nodeForComponentEntry(entry);
    // Whether the PAGE has room for it — the one refusal the tile could not
    // make, because room moves with every edit — is the editor's own apply's
    // to make: it asks the resolver with the node in place, under the caps it
    // enforces, and tells the host why when it refuses. A null here is that
    // refusal, or a document that moved under the panel.
    if (editor.apply({ kind: "insert", node, at }) === null) return;
    editor.select(node.id);
    onInsert?.(node);
  };

  /**
   * Place a saved pattern: a whole forest, re-identified, as ONE edit.
   *
   * Through `planInsertPattern` rather than by building ops here. The planner
   * is the dry run — it mints ids that do not collide with the page, records
   * where each root was copied from, and refuses everything the apply would —
   * so a second construction in this file would be a second answer to what
   * inserting a pattern means.
   *
   * `applyAll`, so the whole group is one undo step. A pattern placed as
   * several inserts would come back one root at a time, which is not what the
   * author did.
   */
  const insertPattern = (entry: PatternInsertEntry, at: OpPosition) => {
    const plan = planInsertPattern(
      editor.document,
      { id: entry.patternId, document: entry.document },
      at,
      source,
      // The same lookup the catalogue judged the tile's roots by, so the offer
      // and the mutation resolve one forest. Without it the planner reads a
      // nested instance as its own unregistered type: unrestricted under a
      // parent rule, and barred by any slot naming what it admits.
      componentDefinitions
    );
    // A refusal here means the document moved underneath the panel: the
    // catalogue offers only patterns the planner accepts, judged against the
    // same rules. Reported as no insert rather than as a failed one.
    if (plan.pageOps === undefined) return;
    if (editor.applyAll(plan.pageOps) === null) return;

    // The FIRST root, so a second insert lands after the group rather than
    // inside it — the same rule the block path follows by selecting what it
    // just added.
    const first = plan.pageOps.find((op: BuilderOp) => op.kind === "insert");
    if (first === undefined || first.kind !== "insert") return;
    editor.select(first.node.id);
    onInsert?.(first.node);
  };

  return { catalog, candidates, offers, blockSource, insert };
}

export function InsertPanel({
  editor,
  definitions,
  patterns,
  components,
  componentDefinitions,
  library,
  nesting,
  categoryOrder,
  blockOrder,
  onInsert,
  beginInsertDrag,
  inside,
  renderPreview,
}: InsertPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  // Blocks first: what an author adds most. Sections holds the patterns.
  const [tab, setTab] = React.useState<PanelTab>("blocks");
  /*
   * Whether the author has moved through the tiles, and with what.
   *
   * The primitives mark their first item as current the moment the list
   * draws, so the panel paints that mark — and opens the popover — only once
   * an arrow key or a pointer has moved it. Which of the two is kept because
   * a pointer that leaves the list returns the panel to rest, while the
   * keyboard's highlight stays where the author left it.
   */
  const [moved, setMoved] = React.useState<"pointer" | "keyboard" | null>(null);
  /*
   * Whether a TOUCH has pressed a tile in this panel yet.
   *
   * Set from the pointer that was actually used rather than read from a media
   * query, because `(pointer: coarse)` describes the device's PRIMARY pointer:
   * a touchscreen laptop driven by its trackpad reports `fine`, and the
   * guidance would be hidden from an author the moment they reach up and touch
   * the screen. It also appears exactly when it is relevant — after the first
   * press, which is when the question arises — and never for a pointer that
   * reads a tile by hovering it.
   */
  const [touchPressed, setTouchPressed] = React.useState(false);
  // The panel's own element, which the popover anchors inside and treats as
  // "not outside".
  const root = React.useRef<HTMLDivElement | null>(null);
  // What can be added, where, and the act of adding it: shared with the
  // editor's search, so a row there and a tile here are one answer.
  const { catalog, candidates, offers, blockSource, insert } = useInsertOffers({
    editor,
    definitions,
    patterns,
    components,
    componentDefinitions,
    nesting,
    inside,
    onInsert,
  });
  // The field a dragged Entry content block draws, as a click places it.
  const firstBlocksField = usePreviewedCollection()?.blocksFields?.[0]?.name;
  // The tab's share of the catalog, then the query. Refused entries stay, so
  // an empty list means the query matched nothing, or the tab holds nothing.
  const groups = paletteGroups(
    filterEntries(
      catalog.filter(entry => tabOf(entry) === tab),
      query
    ),
    categoryOrder,
    blockOrder
  );

  /*
   * One opaque TOKEN per catalog entry, standing in for it everywhere the DOM
   * needs a string: the command value, and the id `aria-describedby` points at.
   *
   * Opaque rather than the entry's own id, and that is load-bearing twice over.
   *
   * The command primitives TRIM the value they report, so two variation names
   * differing only in trailing space — both valid, since nothing validates a
   * variation name — collapse to one value. Pointing at the second would then
   * describe and insert the first, silently. A token cannot collapse because
   * it carries no author-supplied text at all.
   *
   * `aria-describedby` is a space-separated list of id REFERENCES, so an id
   * built from `block#wide card` names two ids that do not exist and the tile
   * is announced with no description — also silently, since a reference that
   * resolves to nothing is not an error.
   *
   * Prefixed from `useId` because two inserters can be mounted at once — a
   * panel and a palette, or two editors side by side — and duplicate ids would
   * have every tile in one describe itself with the other's sentence.
   *
   * Built from the CATALOG rather than the filtered groups, so a token belongs
   * to an entry for the life of the mount instead of changing as an author
   * types.
   */
  const idPrefix = React.useId();
  /*
   * Allocated ONCE per entry and never reused, rather than taken from the
   * entry's position.
   *
   * A host may replace `definitions` while the panel is mounted, and inserting
   * one definition shifts the position of every entry after it. Positional
   * tokens would then be reassigned underneath a highlight the palette is
   * still holding: the same string would name a different block, so the
   * popover would describe it and Enter would insert it.
   *
   * The allocation lives in a ref because it must survive re-renders without
   * being one — it is DOM identity, not state, and nothing renders differently
   * because a token was issued. Handing out a token for an id already in the
   * store is what makes this idempotent, so a repeated call cannot renumber
   * anything.
   */
  const issued = React.useRef({ next: 0, byEntry: new Map<string, string>() });
  const tokens = React.useMemo(() => {
    const store = issued.current;
    const byEntry = new Map<string, string>();
    for (const entry of catalog) {
      const existing = store.byEntry.get(entry.id);
      const token = existing ?? `${idPrefix}-b${store.next}`;
      if (existing === undefined) {
        store.next += 1;
        store.byEntry.set(entry.id, token);
      }
      byEntry.set(entry.id, token);
    }
    return byEntry;
  }, [catalog, idPrefix]);

  const header = <h2 className="nx-insert-panel__title">{EDITOR_WORDS.add}</h2>;
  const firstPlace = candidates[0];
  if (firstPlace === undefined) {
    // Only an `inside` can leave no place: the container it names is gone
    // from the page, or holds no region a block can be put in.
    return (
      <div className="nx-insert-panel" data-empty="unplaceable">
        {header}
        <p className="nx-insert-panel__note">
          The container chosen to add into is no longer on the page. Select a
          block to add after it, or clear the selection to add at the end of the
          page.
        </p>
      </div>
    );
  }

  /*
   * The palette, drawn inside whichever tab is open.
   *
   * The search, the placement line and the notices belong to it rather than
   * to the frame above, so the tab's panel holds everything a tab switch
   * changes, and the query carries over because it lives in this component.
   */
  const paletteView = (
    <Command
      className="nx-insert-panel__palette"
      shouldFilter={false}
      label="Insert a block"
      onKeyDown={event => {
        if (movesTheHighlight(event)) setMoved("keyboard");
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={SEARCH_PLACEHOLDERS[tab]}
      />
      <PlacementLine
        document={editor.document}
        first={firstPlace}
        shown={moved !== null}
        groups={groups}
        tokens={tokens}
        offers={offers}
      />
      <LibraryNotices library={library} tier={tierOf(tab)} />
      <CommandList
        className="nx-insert-panel__list"
        // A pointer that leaves the tiles returns the panel to rest; a
        // keyboard highlight stays where the author left it.
        onPointerLeave={() => {
          setMoved(current => (current === "pointer" ? null : current));
        }}
      >
        <CommandEmpty>{emptyStateText(tab, query)}</CommandEmpty>
        {groups.map(group => (
          <CommandGroup
            key={group.category}
            heading={groupHeading(group.category, tab)}
          >
            {group.entries.map(entry => {
              const offer = offers.get(entry.id);
              const token = tokens.get(entry.id);
              const refusal = offer?.refusal;
              // What the author needs before what the block is: why it
              // cannot go here, or where it goes when that is past the
              // place the line above names.
              const aside = tileAside(offer, editor.document);
              // The aside's own id, beside the description's, so the tile
              // is described by the aside first, then what it is.
              const why = token === undefined ? undefined : `${token}-why`;
              return (
                <CommandItem
                  // `value` is what cmdk reports on selection. The entry id is
                  // unique across blocks AND their variations, while a label is
                  // not — two plugins may both label a block "Card".
                  key={entry.id}
                  value={token}
                  onSelect={() => insert(offer)}
                  /*
                   * NAMED by the block and DESCRIBED by its sentence, rather
                   * than named by the two run together.
                   *
                   * An element with no label is named from its CONTENTS, and
                   * that computation trims each node and joins them with no
                   * separator — so a label and a description in adjacent spans
                   * are announced as "TextA paragraph of plain text". Whether
                   * any separator appears depends on the elements' `display`,
                   * which makes the spoken name a property of the stylesheet
                   * rather than of the markup.
                   *
                   * Stating both removes the guess: the block's name, then its
                   * sentence, in that order and as two separate things. The
                   * label is exactly the visible text, so a spoken command
                   * still matches what is written on the tile.
                   */
                  aria-label={entry.label}
                  aria-describedby={
                    aside === undefined ? token : `${why} ${token}`
                  }
                  // Greyed by the stylesheet. Not `disabled`: see this
                  // module's documentation on why a refused tile stays
                  // reachable.
                  data-refused={refusal === undefined ? undefined : "true"}
                  // Beside `onSelect`, never instead of it. A press stays a
                  // click until it has travelled far enough to mean a drag, so
                  // this does not consume the row's own activation — and a host
                  // that supplies no drag leaves the row exactly as it was.
                  onPointerDown={event => {
                    /*
                     * The input in hand, recorded before anything else in this
                     * handler can return early.
                     */
                    if (event.pointerType === "touch") setTouchPressed(true);
                    /*
                     * Describe this tile on the PRESS, not only on a hover.
                     *
                     * Replayed through the primitives' OWN handler rather
                     * than by setting the highlight directly. They move it on
                     * `pointermove`, which a touch screen never sends before
                     * contact — so without this the popover on touch would
                     * never open, and the tap that finally moves the
                     * highlight is the same tap that inserts.
                     *
                     * Dispatching the event they already listen for keeps the
                     * announced option and the scroll in step, which setting
                     * the value from outside does not. The panel's own
                     * pointer-move handler sees it too, which is what opens
                     * the popover.
                     */
                    event.currentTarget.dispatchEvent(
                      new PointerEvent("pointermove", { bubbles: true })
                    );
                    beginEntryDrag(event, entry, {
                      begin: beginInsertDrag,
                      definitions: blockSource,
                      nesting,
                      onInserted: onInsert,
                      entryField: firstBlocksField,
                      refusedEverywhere:
                        entry.kind === "block" &&
                        entryContentRefusal(
                          editor.document,
                          entry.blockName
                        ) !== undefined,
                    });
                  }}
                >
                  <BlockIconMark icon={entry.icon} size={20} />
                  <span className="nx-insert-panel__label">{entry.label}</span>
                  {/* Kept in the tile and not drawn: `aria-describedby`
                      needs an element to point at, and keeping it here is what
                      stops a tile and the sentence describing it from being
                      rendered apart. */}
                  {aside === undefined ? null : (
                    <span className="nx-insert-panel__description" id={why}>
                      {aside}
                    </span>
                  )}
                  <span className="nx-insert-panel__description" id={token}>
                    {entry.description}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      <TilePopover
        shown={moved !== null}
        groups={groups}
        tokens={tokens}
        offers={offers}
        root={root}
        renderPreview={renderPreview}
        document={editor.document}
        onDismiss={() => setMoved(null)}
      />
      {/*
        Not drawn while nothing is offered: with the search filtered to no
        matches the panel would show "No blocks match" beside an instruction
        about pressing tiles, and spend scarce panel height doing it.
      */}
      <TouchGestureHint shown={touchPressed && groups.length > 0} />
    </Command>
  );

  return (
    <div
      ref={root}
      className="nx-insert-panel"
      /* The column count, handed to the stylesheet rather than spelled again
         in it, so the layout has one source.

         LAYOUT ONLY. Nothing reads it to move a highlight — arrow keys are the
         command primitives' and step by one option, which is what their
         listbox semantics announce. See this module's documentation.

         On the PANEL rather than on each group, because the primitives own the
         element the grid is applied to — their items container — and a
         property set on a wrapper inside it would be inherited by the tiles
         instead of read by the grid. */
      style={{ "--nx-insert-columns": GRID_COLUMNS } as React.CSSProperties}
      // The current tile is painted once the author has moved through the
      // tiles, or typed a search whose first match Enter would take.
      data-highlight={
        moved !== null || query.trim() !== "" ? "shown" : undefined
      }
      // A pointer moving over a tile is a pointer pointing at it. Read here,
      // where it bubbles, because the primitives own each tile's own
      // pointer-move handler.
      onPointerMove={event => {
        const target = event.target;
        if (isElement(target) && target.closest("[cmdk-item]")) {
          setMoved("pointer");
        }
      }}
    >
      {header}
      <Tabs
        value={tab}
        onValueChange={value =>
          setTab(value === "sections" ? "sections" : "blocks")
        }
        className="nx-insert-panel__tabs"
      >
        <TabsList className="nx-insert-panel__tablist">
          <TabsTrigger value="blocks">{EDITOR_WORDS.blocks}</TabsTrigger>
          <TabsTrigger value="sections">{EDITOR_WORDS.sections}</TabsTrigger>
        </TabsList>
        {/* One tab panel per tab, so each trigger controls an element that
            exists. A closed tab panel renders none of its children, so the
            palette is drawn once, in the open one. */}
        <TabsContent value="blocks" className="nx-insert-panel__tab">
          {paletteView}
        </TabsContent>
        <TabsContent value="sections" className="nx-insert-panel__tab">
          {paletteView}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * A group's heading. Patterns that declared no category are the Sections
 * tab's remainder, so they read as more sections rather than more blocks.
 */
function groupHeading(category: string, tab: PanelTab): string {
  return tab === "sections" && category === UNCATEGORISED
    ? `More ${TAB_WORDS.sections}`
    : categoryHeading(category);
}

/** What the offer was computed from, and the offer. */
interface OfferCache {
  readonly document: unknown;
  readonly candidates: string;
  readonly catalog: unknown;
  readonly source: unknown;
  readonly components: unknown;
  readonly definitions: unknown;
  readonly nesting: unknown;
  readonly editor: unknown;
  readonly offers: ReadonlyMap<string, EntryOffer>;
}

/** What each entry's offer is judged from. */
interface OfferInputs {
  readonly document: BlockDocument;
  readonly candidates: readonly InsertionCandidate[];
  readonly catalog: readonly InsertEntry[];
  readonly source: NestingSource;
  readonly components: ComponentLookup | undefined;
  readonly expansion: EntryPlacement["expansion"];
  /** Asked what the locks say of an insert; its identity changes with the document. */
  readonly editor: Pick<EditorState, "lockRefusalFor">;
}

/**
 * Each entry's offer, judged again only when an input the verdicts read has
 * changed. Every input is compared by identity except the places, which are
 * rebuilt per render and so are compared by value.
 */
function cachedOffers(
  cache: { current: OfferCache | undefined },
  inputs: OfferInputs
): ReadonlyMap<string, EntryOffer> {
  const candidates = JSON.stringify(inputs.candidates);
  const held = cache.current;
  if (
    held !== undefined &&
    held.document === inputs.document &&
    held.candidates === candidates &&
    held.catalog === inputs.catalog &&
    held.source === inputs.source &&
    held.components === inputs.components &&
    held.definitions === inputs.expansion.definitions &&
    held.nesting === inputs.expansion.nesting &&
    held.editor === inputs.editor
  ) {
    return held.offers;
  }
  const offers = offersFor(inputs);
  cache.current = {
    document: inputs.document,
    candidates,
    catalog: inputs.catalog,
    source: inputs.source,
    components: inputs.components,
    definitions: inputs.expansion.definitions,
    nesting: inputs.expansion.nesting,
    editor: inputs.editor,
    offers,
  };
  return offers;
}

/**
 * Each entry's offer: the first place that takes it, by
 * {@link insertionFor} over the places a click may use, or — when none does —
 * the reason the FIRST place refused it, which is the one the placement line
 * names and so the one the author is asking about.
 */
function offersFor(inputs: OfferInputs): ReadonlyMap<string, EntryOffer> {
  // What a place reads for every entry, worked out once per place.
  const places = new Map(
    inputs.candidates.map(candidate => [
      candidate,
      placeContext(inputs, candidate),
    ])
  );
  const offers = new Map<string, EntryOffer>();
  for (const entry of inputs.catalog) {
    // A rule about the whole document refuses the entry wherever it goes: a
    // template's one Entry content block, already placed.
    const anywhere =
      entry.kind === "block"
        ? entryContentRefusal(inputs.document, entry.blockName)
        : undefined;
    if (anywhere !== undefined) {
      offers.set(entry.id, { entry, refusal: anywhere });
      continue;
    }
    const first: { refusal: string | undefined } = { refusal: undefined };
    const taken = insertionFor(inputs.candidates, candidate => {
      const context = places.get(candidate);
      if (context === undefined) return undefined;
      const refusal = refusalAt(inputs, entry, candidate, context);
      if (candidate === inputs.candidates[0]) first.refusal = refusal;
      return refusal === undefined ? candidate : undefined;
    });
    offers.set(
      entry.id,
      taken === undefined
        ? {
            entry,
            refusal:
              first.refusal ?? "This can't be added to the page from here.",
          }
        : {
            entry,
            place: taken.answer,
            climbed: taken.answer !== inputs.candidates[0],
          }
    );
  }
  return offers;
}

/** What judging any entry at one place reads, asked once per place. */
interface PlaceContext {
  readonly placement: EntryPlacement | undefined;
  /**
   * The locks' answer for the catalog's first block here, which a pattern or
   * a component follows: each arrives as a block of its own type, which no
   * lock's starting blocks name. Asked on first use.
   */
  readonly firstBlockLock: () => LockRefusalFacts | undefined;
}

/** {@link PlaceContext} for one place, its lock question asked lazily. */
function placeContext(
  inputs: OfferInputs,
  candidate: InsertionCandidate
): PlaceContext {
  const firstBlock = inputs.catalog.find(
    (entry): entry is BlockInsertEntry => entry.kind === "block"
  );
  const asked: { answer?: LockRefusalFacts; done: boolean } = { done: false };
  return {
    placement: placementAt(inputs, candidate.at),
    firstBlockLock: () => {
      if (!asked.done && firstBlock !== undefined) {
        const answer = lockAt(inputs, firstBlock, candidate.at);
        if (answer !== undefined) asked.answer = answer;
      }
      asked.done = true;
      return asked.answer;
    },
  };
}

/**
 * Why an entry cannot go at a place, in the words the author reads, or
 * nothing when it can: the one placement rule first, then the locks.
 *
 * Each block is judged by its own insert, the store's own question: where a
 * locked slot is already broken, inserting the block it is missing can repair
 * it while any other block breaks it further, so one block's answer is not
 * every block's.
 */
function refusalAt(
  inputs: OfferInputs,
  entry: InsertEntry,
  candidate: InsertionCandidate,
  context: PlaceContext
): string | undefined {
  const verdict = entryVerdictAt(
    entry,
    candidate.target,
    inputs.source,
    inputs.components,
    context.placement
  );
  if (!verdict.allowed) {
    return (
      belongsInsideWording(verdict, entry) ??
      refusalAnnouncement(placementRefusal(verdict, entry, candidate))
    );
  }
  const lock =
    entry.kind === "block"
      ? lockAt(inputs, entry, candidate.at)
      : context.firstBlockLock();
  return lock === undefined
    ? undefined
    : refusalAnnouncement(lockRefusalWording(lock));
}

/** What the locks say of inserting one block at a position. */
function lockAt(
  inputs: OfferInputs,
  entry: BlockInsertEntry,
  at: OpPosition
): LockRefusalFacts | undefined {
  return inputs.editor.lockRefusalFor([
    {
      kind: "insert",
      node: nodeForEntry(
        entry,
        inputs.expansion.definitions,
        inputs.expansion.nesting
      ),
      at,
    },
  ]);
}

/**
 * The placement rule's refusal in the words a drop's refusal uses, so an
 * author reads one sentence for one rule wherever they meet it. A block is
 * the subject, and named beside whatever inside it was refused; a pattern or
 * a component is named by the block of it that was refused.
 */
function placementRefusal(
  verdict: Exclude<NestingVerdict | PlacementVerdict, { allowed: true }>,
  entry: InsertEntry,
  candidate: InsertionCandidate
): RefusalWording {
  const regionType =
    candidate.target.kind === "slot" ? candidate.target.parentType : undefined;
  if ("blockType" in verdict) {
    return placementWording(
      verdict,
      entry.kind === "block" ? entry.blockName : verdict.blockType,
      regionType
    );
  }
  // Judged by the name rules alone, which name no block: the entry's own
  // type, or its first root's.
  return refusalWording(
    { reason: verdict.reason, permitted: verdict.permitted },
    subjectTypeOf(entry),
    regionType
  );
}

/**
 * A refusal whose rule names the containers an entry belongs inside, said as
 * one plain instruction: "Goes inside an Accordion. Select an Accordion
 * first, or drag this into one."
 *
 * Generated from the rule, never per block: the containers are the rule's
 * own permitted list, and the second sentence offers only what the tile can
 * do (a block can be dragged; a pattern or a component cannot). Selecting
 * such a container works because a click falls back to inside the selection.
 * Anything else, or a rule about a block nested within the entry, keeps the
 * shared refusal wording.
 */
function belongsInsideWording(
  verdict: Exclude<NestingVerdict | PlacementVerdict, { allowed: true }>,
  entry: InsertEntry
): string | undefined {
  if (
    verdict.reason !== "restricted-at-root" &&
    verdict.reason !== "wrong-parent"
  ) {
    return undefined;
  }
  if ("blockType" in verdict && verdict.blockType !== subjectTypeOf(entry)) {
    return undefined;
  }
  const containers = verdict.permitted.map(name =>
    withArticle(permittedLabel(name, blockLabel))
  );
  if (containers.length === 0) return undefined;
  const select =
    containers.length === 1
      ? `Select ${containers[0]} first`
      : "Select one first";
  const drag = entry.kind === "block" ? ", or drag this into one." : ".";
  return `Goes inside ${asPermittedList(containers, "or")}. ${select}${drag}`;
}

/** "an Accordion", "a Card"; a namespace's "any acme block" as it is. */
function withArticle(label: string): string {
  if (label.startsWith("any ")) return label;
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

/** The block type an entry is named by in a refusal. */
function subjectTypeOf(entry: InsertEntry): string {
  if (entry.kind === "block") return entry.blockName;
  if (entry.kind === "component") return entry.roots[0] ?? entry.label;
  return entry.document.nodes[0]?.type ?? entry.label;
}

/**
 * A place as the one placement rule sees it, with what its ancestors refuse.
 * Undefined when the position's parent is not in the document, which the
 * name rules then judge alone.
 *
 * The rule reads block declarations from the palette's own source, the one
 * its catalog and its inserts read, so a definition the host supplied is the
 * one judged rather than the registry's under the same name.
 */
function placementAt(
  inputs: OfferInputs,
  at: OpPosition
): EntryPlacement | undefined {
  const sources: PlacementSources = {
    nesting: inputs.source,
    definitions: inputs.expansion.definitions,
    ...(inputs.components === undefined
      ? {}
      : { components: inputs.components }),
  };
  const site = placementSiteIn(
    inputs.document.nodes,
    at.parentId === undefined
      ? { kind: "root" }
      : { kind: "slot", parentId: at.parentId, slot: at.slot ?? "" },
    sources
  );
  return site === undefined
    ? undefined
    : { site, sources, expansion: inputs.expansion };
}

/** What the list says when it shows nothing: the tab is empty, or the query matched nothing. */
function emptyStateText(tab: PanelTab, query: string): string {
  const searched = query.trim();
  const word = TAB_WORDS[tab];
  if (searched !== "") return `No ${word} match "${searched}".`;
  return tab === "sections"
    ? `No ${word} are saved yet.`
    : `No ${word} can be added here.`;
}
