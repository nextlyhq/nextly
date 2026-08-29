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
 * this panel's description strip would follow while the announced option and
 * the scroll position stayed where they were. Owning them instead means owning
 * roving focus and the ARIA wiring — the second implementation of this widget
 * that the paragraphs above exist to refuse.
 *
 * So the grid is a LAYOUT. Reading order is left to right and then down, which
 * is the order the primitives already move in, and search is what makes a long
 * palette reachable without arrowing at all.
 *
 * @module insert-panel
 */

import {
  allBlocks,
  getBlock,
  registryNestingSource,
  type AnyBlockDefinition,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  useCommandHighlight,
} from "@nextlyhq/ui";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { InsertDragEntry } from "./canvas-drag";
import type { EditorState } from "./editor-state";
import {
  allowedEntries,
  blockSourceFor,
  catalogFrom,
  filterEntries,
  groupByCategory,
  insertionPointFor,
  nodeForEntry,
  registrySlotSource,
  type InsertGroup,
  type InsertionPoint,
  type InsertEntry,
} from "./inserter";

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
}

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
 * The strip describing whichever tile the palette has highlighted.
 *
 * A component of its own, and rendered INSIDE the palette, because that is
 * where the highlight lives: `useCommandHighlight` reads the palette's own
 * store,
 * so this follows a pointer, an arrow key and a filter alike without the panel
 * keeping a second copy of which tile is current.
 *
 * Hidden from assistive technology while it shows the whole sentence. That
 * sentence is already the option's own accessible description, so exposing the
 * region as well would have a screen reader read every description twice —
 * once on the tile and once from a region that changed because of it. It
 * becomes a named, focusable region only when it has a tail no pointer-free
 * reader could otherwise reach.
 */
function DescriptionStrip({
  groups,
  tokens,
}: {
  groups: readonly InsertGroup[];
  tokens: ReadonlyMap<string, string>;
}): React.JSX.Element | null {
  // Empty string is the palette's "nothing highlighted", which is a different
  // answer from an entry it does not hold — both fall back, but only one of
  // them would silently match an entry whose token was the empty string.
  const highlighted = useCommandHighlight();
  const described = describedEntry(
    groups,
    tokens,
    highlighted === "" ? undefined : highlighted
  );
  /*
   * Back to the top whenever the subject changes.
   *
   * The strip is scrollable, and React reuses this same element as the
   * highlight moves — so a description that was scrolled leaves the next one
   * opening partway through its own text, with the block's name and first
   * lines above the fold. The reader is then looking at the middle of a
   * sentence about a block they have only just pointed at.
   *
   * Keyed on the entry's id rather than on the element: two entries can carry
   * the same description, and scrolling is about which BLOCK is being read.
   */
  const body = React.useRef<HTMLParagraphElement>(null);
  const subject = described?.id;
  /*
   * Whether this description has text the box is not showing.
   *
   * Measured rather than assumed from length, because whether a sentence
   * overflows depends on the panel's width — which an author drags — and on
   * the reader's own font size. A character count would be wrong at both ends
   * of that range.
   */
  const [clipped, setClipped] = React.useState(false);
  React.useEffect(() => {
    const element = body.current;
    if (element === null) return;
    element.scrollTop = 0;
    setClipped(element.scrollHeight > element.clientHeight);
  }, [subject]);
  if (described === undefined) return null;
  /*
   * Reachable by keyboard ONLY while there is something hidden to reach.
   *
   * The strip is bounded and scrollable, so a description longer than the box
   * has a tail that a pointer can scroll to and a keyboard cannot: focus stays
   * in the search field, and nothing else can direct a scroll here.
   *
   * Made focusable only when it actually overflows, rather than always. A
   * permanent stop between the search field and the tiles costs every author a
   * keystroke on the way to the thing they came for, and buys nothing in the
   * ordinary case where the whole sentence is already visible.
   *
   * `aria-hidden` goes with it, because hiding a focusable element is a
   * contradiction assistive technology has no good answer to. Nothing is lost
   * by that: the same sentence is the option's own description, so a screen
   * reader hears it on the tile whether or not this region exists. What the
   * region adds when it is reachable is a NAME saying what it holds, so
   * arriving here is not arriving at unlabelled prose.
   */
  return (
    <p
      ref={body}
      className="nx-insert-panel__describes"
      {...(clipped
        ? { tabIndex: 0, role: "group", "aria-label": "Block description" }
        : { "aria-hidden": true })}
    >
      <b className="nx-insert-panel__describes-name">{described.label}</b>
      {` ${described.description}`}
    </p>
  );
}

/**
 * The entry a command value names, or the first one offered.
 *
 * Scoped to the GROUPS rather than to the whole catalog, because a filter can
 * remove the highlighted entry between renders and describing something the
 * author cannot see is worse than describing nothing.
 *
 * The fallback is what keeps the strip from being blank on the pass before
 * anything has been highlighted, and after a search removes the entry that
 * was. It is DERIVED rather than written into state: a fallback that stored
 * itself would be a second writer racing the primitives' own selection.
 */
function describedEntry(
  groups: readonly InsertGroup[],
  tokens: ReadonlyMap<string, string>,
  active: string | undefined
): InsertEntry | undefined {
  if (active !== undefined) {
    for (const group of groups) {
      for (const entry of group.entries) {
        if (tokens.get(entry.id) === active) return entry;
      }
    }
  }
  return groups[0]?.entries[0];
}

/** Sentence describing where the next insert will land. */
function placementLabel(point: InsertionPoint, label?: string): string {
  if (point.kind === "inside-selection") {
    // Names the container, because "inside" is only meaningful if the author
    // knows what it is inside OF — and this is the one placement that differs
    // from what selecting a block usually implies.
    return `Adds inside ${label ?? "the selected block"}`;
  }
  return point.kind === "after-selection"
    ? "Adds after the selected block"
    : "Adds at the end of the page";
}

export function InsertPanel({
  editor,
  definitions,
  nesting,
  categoryOrder,
  onInsert,
  beginInsertDrag,
}: InsertPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");

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
  const catalog = React.useMemo(() => catalogFrom(palette), [palette]);
  const source = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );

  // Recomputed from the CURRENT document and selection on every render rather
  // than remembered. The position is only valid against the document it was
  // read from, and an undo or a remote edit can move it without the selection
  // changing — a memo keyed on the selection alone would keep a position whose
  // index no longer names the same place.
  const slotSource = React.useMemo(registrySlotSource, []);

  // Derived from the SAME snapshot the catalog is, so the row an author sees
  // and the subtree an insert builds cannot come from two different readings.
  // The palette may be a caller-supplied subset holding a definition the
  // registry does not, and the block being inserted is the one whose
  // declaration is read — so resolving only against the registry would offer
  // that block and then insert it without the children it declares.
  const blockSource = React.useMemo(() => blockSourceFor(palette), [palette]);
  const point = insertionPointFor(
    editor.document,
    editor.selectedId,
    slotSource
  );

  // Computed on every render rather than memoised. `insertionPointFor` builds a
  // fresh target each call, so a memo keyed on it could never hit — it would
  // recompute exactly as often while reading as though it cached. The work is a
  // filter and a group over one array, and the render it happens in is already
  // driven by a keystroke.
  const groups =
    point === null
      ? []
      : // Allowed first, then the query. Both orders yield the same set, but
        // this one keeps the empty state honest: "no blocks match" after a
        // search is a different message from "nothing can go here", and
        // filtering first would collapse them into one.
        groupByCategory(
          filterEntries(allowedEntries(catalog, point.target, source), query),
          categoryOrder
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
   * still holding: the same string would name a different block, so the strip
   * would describe it and Enter would insert it.
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

  /*
   * The entry the strip describes, falling back to the first one offered.
   *
   * The fallback is what keeps the strip from being blank on the pass before
   * anything has been highlighted, and after a search removes the entry that
   * was. It is DERIVED rather than written into state: a fallback that stored
   * itself would be a second writer racing the primitives' own selection.
   */

  const insert = (entry: InsertEntry) => {
    if (point === null) return;
    // `nesting` rather than `source`. They differ exactly when the caller
    // supplied no rules: `source` has already defaulted to the REGISTRY, which
    // knows nothing about a supplied definition and so reports every one of its
    // types as unrestricted. Passing it defeats the fallback in
    // `expandSlotDefaults`, which derives the rules from these same
    // definitions — the only source that can see a supplied block's `parent`
    // and its slots' `allow`.
    const node = nodeForEntry(entry, blockSource, nesting);
    // `apply` is the only path a document changes by, so undo covers this
    // insert for free. It answers null when the op is refused, and a refusal
    // must not be reported as an insert — the panel offers only placements the
    // rule permits, so a null here means the document moved underneath it.
    if (editor.apply({ kind: "insert", node, at: point.at }) === null) return;
    // Selecting what was just added is what makes a second insert land after
    // it, so repeated inserts build downward instead of stacking at one point.
    editor.select(node.id);
    onInsert?.(node);
  };

  if (point === null) {
    return (
      <div className="nx-insert-panel" data-empty="unplaceable">
        <p className="nx-insert-panel__note">
          The selected block sits somewhere a new block cannot be addressed.
          Select a different block, or clear the selection to add at the end of
          the page.
        </p>
      </div>
    );
  }

  return (
    <div
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
    >
      <Command shouldFilter={false} label="Insert a block">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search blocks"
        />
        <p className="nx-insert-panel__placement" aria-live="polite">
          {placementLabel(
            point,
            point.kind === "inside-selection"
              ? getBlock(
                  point.target.at === "slot" ? point.target.parentType : ""
                )?.editor?.label
              : undefined
          )}
        </p>
        <CommandList>
          <CommandEmpty>
            {query.trim() === ""
              ? "No blocks can be added here."
              : `No blocks match "${query.trim()}".`}
          </CommandEmpty>
          {groups.map(group => (
            <CommandGroup key={group.category} heading={group.category}>
              {group.entries.map(entry => (
                <CommandItem
                  // `value` is what cmdk reports on selection. The entry id is
                  // unique across blocks AND their variations, while a label is
                  // not — two plugins may both label a block "Card".
                  key={entry.id}
                  value={tokens.get(entry.id)}
                  onSelect={() => insert(entry)}
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
                  aria-describedby={tokens.get(entry.id)}
                  // Beside `onSelect`, never instead of it. A press stays a
                  // click until it has travelled far enough to mean a drag, so
                  // this does not consume the row's own activation — and a host
                  // that supplies no drag leaves the row exactly as it was.
                  onPointerDown={event => {
                    /*
                     * Describe this tile on the PRESS, not only on a hover.
                     *
                     * A touch screen produces no `pointermove` before contact,
                     * and hover is what the primitives report a highlight
                     * from — so on touch the strip would still be describing
                     * whatever was current when the panel opened, and the tap
                     * that finally moved it is the same tap that inserts. A
                     * finger resting on a tile now reads its sentence before
                     * lifting, and a finger dragging across tiles reads each
                     * one it passes.
                     */
                    /*
                     * Replayed through the primitives' OWN handler rather
                     * than by setting the highlight directly. They move it on
                     * `pointermove`, which a touch screen never sends before
                     * contact — so without this the strip on touch describes
                     * whatever was current when the panel opened, and the tap
                     * that finally moves it is the same tap that inserts.
                     *
                     * Dispatching the event they already listen for keeps the
                     * announced option and the scroll in step, which setting
                     * the value from outside does not.
                     */
                    event.currentTarget.dispatchEvent(
                      new PointerEvent("pointermove", { bubbles: true })
                    );
                    beginInsertDrag?.(event, {
                      blockName: entry.blockName,
                      makeNode: () => nodeForEntry(entry, blockSource, nesting),
                      // The same notification the click path sends, so a host
                      // cannot see one kind of insert and miss the other.
                      onInserted: onInsert,
                    });
                  }}
                >
                  <BlockIconMark icon={entry.icon} />
                  <span className="nx-insert-panel__label">{entry.label}</span>
                  {/* Kept in the tile and no longer drawn: `aria-describedby`
                      needs an element to point at, and keeping it here is what
                      stops a tile and the sentence describing it from being
                      rendered apart. */}
                  <span
                    className="nx-insert-panel__description"
                    id={tokens.get(entry.id)}
                  >
                    {entry.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <DescriptionStrip groups={groups} tokens={tokens} />
      </Command>
    </div>
  );
}
