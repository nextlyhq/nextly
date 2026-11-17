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
 * ## Where the parts live
 *
 * This module is the panel and the entry for the rest: its props are in
 * `insert-panel-types.ts`, the notices about its libraries in
 * `insert-panel-notices.tsx`, its tiles in `insert-panel-tiles.tsx`, and what
 * it offers at a place in `insert-panel-offers.ts`. Every name it exported, it
 * still exports.
 *
 * @module insert-panel
 */

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { BlockIconMark } from "../../block-icon";
import { isElement } from "../../dom-kind";
import { EDITOR_WORDS } from "../../editor-words";
import { entryContentRefusal } from "../../entry-content-rules";
import { usePreviewedCollection } from "../../previewed-entry";

import { LibraryNotices, type LibraryTier } from "./insert-panel-notices";
import { useInsertOffers } from "./insert-panel-offers";
import { useSummonAnswer } from "./insert-panel-summon";
import {
  beginEntryDrag,
  InsertAnnouncement,
  movesTheHighlight,
  PlacementLine,
  tileWhere,
  TilePopover,
  TouchGestureHint,
} from "./insert-panel-tiles";
import type { InsertPanelProps } from "./insert-panel-types";
import { recordInsert, useInsertUsage } from "./insert-usage";
import {
  categoryHeading,
  filterEntries,
  paletteGroups,
  UNCATEGORISED,
  type InsertEntry,
} from "./inserter";

// The panel's props, its library notices, its tiles and what it offers where
// live in modules of their own beside it; every name this module exported
// still is.
export { LibraryNotices } from "./insert-panel-notices";
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { LibraryTier } from "./insert-panel-notices";
export {
  type EntryOffer,
  type InsertOffers,
  type InsertOffersInputs,
  useInsertOffers,
} from "./insert-panel-offers";
export {
  beginEntryDrag,
  InsertAnnouncement,
  tileAside,
  placementWords,
} from "./insert-panel-tiles";
export type { InsertPanelProps, LibraryTierState } from "./insert-panel-types";

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
 * How many tiles sit in a row where each draws a picture of its saved
 * section: two, so a picture is wide enough to read at the panel's default
 * width. Fixed per tab for the reason {@link GRID_COLUMNS} is.
 */
const PICTURE_COLUMNS = 2;

/**
 * The tier a tab offers: components among the blocks, patterns as sections.
 */
function tierOf(tab: PanelTab): LibraryTier {
  return tab === "sections" ? "patterns" : "components";
}

export function InsertPanel({
  library,
  categoryOrder,
  blockOrder,
  beginInsertDrag,
  renderPreview,
  renderPicture,
  // A canvas press to answer, handed to the line that answers it.
  summoned,
  onSummoned,
  summonedTab,
  // What it offers, and where: the sources the offers are judged from.
  ...offerInputs
}: InsertPanelProps): React.JSX.Element {
  const { editor, nesting, onInsert } = offerInputs;
  // Where a dragged block's insert is counted, as a clicked one's is.
  const usage = useInsertUsage();
  const [query, setQuery] = React.useState("");
  // Blocks first: what an author adds most. Sections holds the patterns.
  const [tab, setTab] = usePanelTab(summoned, summonedTab);
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
  // The panel answers a canvas press once, here, rather than in the line
  // that shows it: the line is drawn again with the tab a press opens, and
  // the highlight has to last through that.
  const flash = useSummonAnswer(root, summoned, onSummoned);
  // What can be added, where, and the act of adding it: shared with the
  // editor's search, so a row there and a tile here are one answer.
  const { catalog, rest, announcement, offers, blockSource, insert } =
    useInsertOffers(offerInputs);
  // The field a dragged Entry content block draws, as a click places it,
  // and whether it can be known yet.
  const blocksFields = usePreviewedCollection()?.blocksFields;
  const firstBlocksField = blocksFields?.[0]?.name;
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
  const firstPlace = rest;
  if (firstPlace === undefined) {
    // Only an explicit place can leave no place: the container an `inside`
    // names is gone from the page, or holds no region a block can be put
    // in. (A gap's `after` lasts only while its block is selected, so it is
    // on the page.)
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
        flash={flash}
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
              // cannot go here, or where a click puts it.
              const aside = tileWhere(offer, editor.document);
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
                      // Counted toward the most used, as a click's is.
                      onInserted: node => {
                        if (entry.kind === "block") {
                          recordInsert(usage, entry.blockName);
                        }
                        onInsert?.(node);
                      },
                      entryField: firstBlocksField,
                      refusedEverywhere:
                        entry.kind === "block" &&
                        entryContentRefusal(
                          editor.document,
                          entry.blockName,
                          blocksFields !== undefined
                        ) !== undefined,
                    });
                  }}
                >
                  {tilePicture(entry, renderPicture) ?? (
                    <BlockIconMark icon={entry.icon} size={20} />
                  )}
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
      style={
        {
          "--nx-insert-columns": picturesIn(tab, renderPicture)
            ? PICTURE_COLUMNS
            : GRID_COLUMNS,
        } as React.CSSProperties
      }
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
      <InsertAnnouncement text={announcement} />
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
 * The tab the panel shows, and the way to change it. A canvas press that
 * names a tab opens it in the very render that answers the press, so the
 * search the answer focuses is that tab's, not one a later render would
 * replace; opened for such a press, the panel starts on that tab.
 */
function usePanelTab(
  summoned: number | undefined,
  summonedTab: PanelTab | undefined
): readonly [PanelTab, (tab: PanelTab) => void] {
  const [tab, setTab] = React.useState<PanelTab>(() =>
    summoned !== undefined && summonedTab !== undefined ? summonedTab : "blocks"
  );
  const [tabbedPress, setTabbedPress] = React.useState(summoned);
  if (tabbedPress !== summoned) {
    setTabbedPress(summoned);
    if (summoned !== undefined && summonedTab !== undefined) {
      setTab(summonedTab);
    }
  }
  return [tab, setTab];
}

/** Whether a tab's tiles draw pictures: the saved sections, given a host's. */
function picturesIn(
  tab: PanelTab,
  renderPicture: InsertPanelProps["renderPicture"]
): boolean {
  return tab === "sections" && renderPicture !== undefined;
}

/**
 * A saved section's picture for its tile, or nothing to keep the mark: only
 * a pattern has a document to draw, and a host may answer none for one.
 */
function tilePicture(
  entry: InsertEntry,
  renderPicture: InsertPanelProps["renderPicture"]
): React.ReactNode {
  if (entry.kind !== "pattern" || renderPicture === undefined) return null;
  const picture = renderPicture(entry);
  // A host writing `has(entry) && <Picture />` hands back `false` for none,
  // which draws nothing; the tile keeps its mark for it, as for `null`.
  return typeof picture === "boolean" ? null : picture;
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

/** What the list says when it shows nothing: the tab is empty, or the query matched nothing. */
function emptyStateText(tab: PanelTab, query: string): string {
  const searched = query.trim();
  const word = TAB_WORDS[tab];
  if (searched !== "") return `No ${word} match "${searched}".`;
  return tab === "sections"
    ? `No ${word} yet.`
    : `No ${word} can be added here.`;
}
