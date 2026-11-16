"use client";

/**
 * The Add panel's tiles: the touch hint, the highlighted tile, its popover and
 * placement line, the words beside a tile, and a drag that begins on one.
 *
 * @module insert-panel-tiles
 */

import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  useCommandHighlight,
} from "@nextlyhq/ui";
import { CornerDownRight } from "lucide-react";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import { isElement } from "./dom-kind";
import { withEntryContentField } from "./entry-content-rules";
import type { EntryOffer } from "./insert-panel-offers";
import {
  cardAnchor,
  NOWHERE,
  useSummonAnswer,
  type Measurable,
} from "./insert-panel-summon";
import type { InsertPanelProps } from "./insert-panel-types";
import { placementSentence, placementWords } from "./insert-placement-words";
import {
  nodeForComponentEntry,
  nodeForEntry,
  type InsertGroup,
  type InsertionCandidate,
  type InsertEntry,
} from "./inserter";

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
export function TouchGestureHint({
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

export { placementWords }; // For the importers of the panel's words.

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
 * keep working. Anchored beside the panel at the tile's height, so it moves
 * down with the highlight and never covers a tile.
 */
export function TilePopover({
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
    const panel = root.current;
    const tile =
      entry === undefined ? null : tileElement(panel, tokens.get(entry.id));
    anchor.current = cardAnchor(panel, tile);
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
        // Never flipped back over the tiles where the right has no room.
        avoidCollisions={false}
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
 * highlighted tile goes, or at rest where a content block goes ("Adding
 * inside Hero, at the end"), the place an author expects. Following the
 * highlight names a place before the click wherever a tile goes elsewhere: a
 * layout block after a selected Section, or past a region that refuses it.
 *
 * A polite live region at rest, because it changes with every selection and
 * an assertive one would interrupt a screen reader mid-sentence each time.
 * Not while it follows the highlight: the highlighted tile's own description
 * already says where it goes, so announcing the line too would say it twice
 * on every arrow key. The block is named as Layers names it, an author's own
 * name first, so the line agrees with the tree beside it.
 */
export function PlacementLine({
  document,
  root,
  summons,
  first,
  shown,
  groups,
  tokens,
  offers,
}: {
  document: BlockDocument;
  /** The panel, whose search and list a press is answered in. */
  root: React.RefObject<HTMLDivElement | null>;
  /** A canvas press still to answer, and where to say it was answered. */
  summons: Pick<InsertPanelProps, "summoned" | "onSummoned">;
  first: InsertionCandidate;
  shown: boolean;
  groups: readonly InsertGroup<InsertEntry>[];
  tokens: ReadonlyMap<string, string>;
  offers: ReadonlyMap<string, EntryOffer>;
}): React.JSX.Element {
  const highlighted = useCommandHighlight();
  // The line answers a canvas press for the whole panel, highlighted for it.
  const flash = useSummonAnswer(root, summons.summoned, summons.onSummoned);
  const entry = shown
    ? highlightedEntry(groups, tokens, highlighted)
    : undefined;
  const place =
    (entry === undefined ? undefined : offers.get(entry.id)?.place) ?? first;
  return (
    <p
      className="nx-insert-panel__placement"
      data-flash={flash === undefined ? undefined : ""}
      aria-live={entry === undefined ? "polite" : "off"}
    >
      <CornerDownRight aria-hidden="true" size={14} />
      <span>{placementWords("Adding", document, place)}</span>
    </p>
  );
}

/**
 * Where an insert is announced: "Heading added inside Hero, at the end".
 *
 * Polite, so it waits for whatever a screen reader is saying, and hidden from
 * sight, since the block appearing selected on the canvas says it to the eye.
 * No status role: the editor's keyboard region is the one status region an
 * author's moves are read from, and this one speaks only after an insert.
 */
export function InsertAnnouncement({
  text,
  afterClose = false,
}: {
  text: string;
  /**
   * Whether the insert closes a modal dialog this region sits outside (the
   * editor's search). The dialog hides the rest of the page from a screen
   * reader while open, and the insert changes the text in the update that
   * closes it, so the text is set a moment later, once the page is
   * readable again.
   */
  afterClose?: boolean;
}): React.JSX.Element {
  const [shown, setShown] = React.useState(afterClose ? "" : text);
  React.useEffect(() => {
    if (!afterClose) return;
    const timer = setTimeout(() => setShown(text), 0);
    return () => clearTimeout(timer);
  }, [afterClose, text]);
  return (
    <p className="nx-sr-only" aria-live="polite" data-insert-announcement="">
      {afterClose ? shown : text}
    </p>
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
 * What a row says before what it is, where it is drawn: why it cannot go
 * here, or where it goes when that is past the place the placement line
 * names.
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

/**
 * What an Add panel tile tells a screen reader before what it is: why it
 * cannot go here, or where a click puts it ("Goes inside Hero, at the
 * end."). Every tile says its place, not only those past the line's, so an
 * author arrowing through the tiles hears where each one lands.
 */
export function tileWhere(
  offer: EntryOffer | undefined,
  document: BlockDocument
): string | undefined {
  if (offer?.refusal !== undefined) return offer.refusal;
  return offer?.place === undefined
    ? undefined
    : placementSentence("Goes", document, offer.place);
}

/**
 * The keys the palette's primitives move the highlight with: the arrows,
 * Home and End, and the Ctrl bindings they also honour. A key outside these
 * leaves the panel at rest.
 */
export function movesTheHighlight(event: React.KeyboardEvent): boolean {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return true;
  return event.ctrlKey && ["n", "j", "p", "k"].includes(event.key);
}
