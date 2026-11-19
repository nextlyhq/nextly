"use client";

/**
 * The start area of an empty document: drawn in the page's body, between the
 * Layout's header and footer, in the builder's own look and at the screen's
 * size whatever the zoom.
 *
 * It holds a heading ("Start building About us" on a page, "Add the first
 * block" elsewhere), a primary "＋ Add a block", a secondary "Insert a saved
 * section" where the host offers one, the line "or drag a block here", and a
 * row of starter pages under "or start from a page" when the host passes any.
 *
 * ## In the body, holding it open
 *
 * An empty page's body is as tall as nothing in it, so the footer sits right
 * under the header and a card centred on the screen lands over the footer.
 * The start area is placed near the top of the body instead, centred across
 * the page, and the body is held open for it in the editor alone: the canvas
 * root is given the area's height in the page's own pixels
 * (`--nx-canvas-start-room`), which the frame's sheet adds above the footer. The
 * published page has no such rule, so it draws nothing there.
 *
 * Like the rest of the canvas's add controls, this only REPORTS what was
 * pressed: the host opens the in-place picker, or the Add panel's saved
 * sections.
 *
 * @module page-start-area
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { Plus } from "lucide-react";
import * as React from "react";

import type { Point } from "../geometry";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { useCanvasFrame } from "./canvas-frame-context";
import { REGION_ATTRIBUTE } from "./canvas-regions";
import {
  canvasContentRect,
  overlaySpaceOf,
  type OverlaySpace,
} from "./geometry-dom";
import { startWords } from "./page-start-words";

/** A starter page an empty page can begin from, as the host lists it. */
export interface StarterPage {
  readonly id: string;
  readonly title: string;
  /** A small picture of the page, drawn by the host. */
  readonly picture?: React.ReactNode;
  /**
   * Why the site can't use this starter, in the host's words; absent for one
   * it can. Such a starter is still listed, dimmed, so an author sees it and
   * why rather than wondering where it went, but pressing it starts nothing.
   */
  readonly unavailable?: string | undefined;
}

/**
 * The room left above and below the start area inside the body, in the
 * chrome's pixels, so it sits near the top of the body and clear of the
 * footer.
 */
const START_ROOM_PX = 32;

/** The custom property the frame's sheet holds the empty body open by. */
const START_ROOM_PROPERTY = "--nx-canvas-start-room";

/** The Layout's header drawn on this canvas, or `null`. */
function headerOf(root: HTMLElement): Element | null {
  let found: Element | null = null;
  root.querySelectorAll(`[${REGION_ATTRIBUTE}]`).forEach(region => {
    if (found === null && region.getAttribute(REGION_ATTRIBUTE) === "header") {
      found = region;
    }
  });
  return found;
}

/**
 * Where the start area's top centre goes, in the chrome: centred across the
 * page, near the top of its body (under the header, or the page's top).
 */
export function startPlaceIn(space: OverlaySpace): Point {
  const { root } = space;
  const page = space.place(canvasContentRect(root, root));
  const header = headerOf(root);
  const top =
    header === null
      ? page.y
      : (() => {
          const box = space.place(canvasContentRect(header, root));
          return box.y + box.height;
        })();
  return { x: page.x + page.width / 2, y: top + START_ROOM_PX };
}

/**
 * Holds the empty body open, in the editor only, by the start area's height
 * and its room in the page's own pixels; and lets go when the page has blocks
 * or the area is gone. Written only when it changes, since the write is a
 * change inside the canvas that every geometry watch hears.
 */
function useBodyRoom(
  area: React.RefObject<HTMLDivElement | null>,
  shown: boolean
): void {
  const canvasFrame = useCanvasFrame();
  const held = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const element = area.current;
    const root =
      element === null
        ? null
        : (overlaySpaceOf(element, CANVAS_ROOT_CLASS)?.root ?? null);
    // A root the area moved off of, a page loaded into the frame anew, is let
    // go of as well.
    if (held.current !== root) letGo(held.current);
    held.current = root;
    if (root === null || element === null) return;
    if (!shown) {
      letGo(root);
      return;
    }
    const room = element.offsetHeight + START_ROOM_PX * 2;
    const value = `${String(Math.ceil(room / canvasFrame.scale))}px`;
    if (root.style.getPropertyValue(START_ROOM_PROPERTY) !== value) {
      root.style.setProperty(START_ROOM_PROPERTY, value);
    }
  });
  React.useEffect(() => () => letGo(held.current), []);
}

/** The body let go of, when it was held at all. */
function letGo(root: HTMLElement | null): void {
  if (
    root !== null &&
    root.style.getPropertyValue(START_ROOM_PROPERTY) !== ""
  ) {
    root.style.removeProperty(START_ROOM_PROPERTY);
  }
}

/** What the start area is handed. */
interface StartAreaProps {
  readonly document: BlockDocument;
  /** The page's title, which a page's heading names. */
  readonly title?: string | undefined;
  /** Where its top centre goes, or `null` until measured. */
  readonly place: Point | null;
  /** A block is dragged over the canvas: the area is where it drops. */
  readonly dragging: boolean;
  /** "＋ Add a block" was pressed; `control` is the button. */
  readonly onStart: (control: HTMLElement) => void;
  /** "Insert a saved section" was pressed; absent, the button is too. */
  readonly onSavedSection?: (() => void) | undefined;
  /** Starter pages to begin from; absent or empty, no row is drawn. */
  readonly starters?: readonly StarterPage[] | undefined;
  /** A starter page was chosen. */
  readonly onStarter?: ((id: string) => void) | undefined;
}

/** The row of starter pages, under its heading. */
function StarterRow({
  heading,
  notAvailable,
  starters,
  onStarter,
}: {
  readonly heading: string;
  /** What a starter the site can't use says above its reason. */
  readonly notAvailable: string;
  readonly starters: readonly StarterPage[];
  readonly onStarter: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-page-start__starters">
      <p className="nx-page-start__line">{heading}</p>
      <ul className="nx-page-start__tiles">
        {starters.map((starter, index) => (
          <li key={starter.id}>
            <StarterTile
              id={`${id}-${String(index)}`}
              starter={starter}
              notAvailable={notAvailable}
              onStarter={onStarter}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One starter's tile: its picture and title, pressed to start the page from
 * it. A starter the site can't use is dimmed and says so, with the host's
 * reason, on a panel over its picture, so its tile is as tall as the others
 * and the reason is still there to read; pressing it does nothing. It stays
 * a focusable button (`aria-disabled`, not `disabled`) so a keyboard user can
 * reach it and hear why; its name is its title alone, and the note and
 * reason describe it.
 */
function StarterTile({
  id,
  starter,
  notAvailable,
  onStarter,
}: {
  /** A prefix unique on the page, for the ids its words are read by. */
  readonly id: string;
  readonly starter: StarterPage;
  readonly notAvailable: string;
  readonly onStarter: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const reason = starter.unavailable;
  if (reason === undefined) {
    return (
      <button
        type="button"
        className="nx-page-start__tile"
        onClick={() => onStarter?.(starter.id)}
      >
        {starter.picture}
        <span>{starter.title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="nx-page-start__tile"
      aria-disabled="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-note ${id}-reason`}
      // Reported to nobody: the site can't hold this starter, so there is
      // nothing for the host to start.
      onClick={event => event.preventDefault()}
    >
      {/* The picture's box holds the dimmed picture and, over it, the words
        that say why: the tile stays a picture and a title, as tall as the
        others, and the words keep their contrast on their own panel. */}
      <span className="nx-page-start__tile-picture">
        <span className="nx-page-start__tile-thumb">{starter.picture}</span>
        <span className="nx-page-start__tile-why">
          <span id={`${id}-note`} className="nx-page-start__tile-note">
            {notAvailable}
          </span>
          <span id={`${id}-reason`} className="nx-page-start__tile-reason">
            {reason}
          </span>
        </span>
      </span>
      <span id={`${id}-title`}>{starter.title}</span>
    </button>
  );
}

/**
 * The start area.
 *
 * @experimental
 */
export function StartArea({
  document,
  title,
  place,
  dragging,
  onStart,
  onSavedSection,
  starters = [],
  onStarter,
}: StartAreaProps): React.JSX.Element {
  const area = React.useRef<HTMLDivElement | null>(null);
  useBodyRoom(area, place !== null);
  const words = startWords(document.kind, title);
  return (
    <div
      ref={area}
      className="nx-page-start"
      // While a block is dragged, the area is where it drops: drawn as the
      // target, and taking no pointer so the drag reaches the page.
      data-drop-target={dragging ? "" : undefined}
      // Kept out of sight until it has been placed, rather than drawn at the
      // layer's corner for a frame.
      style={
        place === null
          ? { visibility: "hidden" }
          : { left: place.x, top: place.y }
      }
    >
      <p className="nx-page-start__title" role="heading" aria-level={2}>
        {words.title}
      </p>
      <div className="nx-page-start__actions">
        <button
          type="button"
          className="nx-page-start__add"
          onClick={event => onStart(event.currentTarget)}
        >
          <Plus size={16} aria-hidden="true" />
          {words.start}
        </button>
        {onSavedSection === undefined ? null : (
          <button
            type="button"
            className="nx-page-start__saved"
            onClick={onSavedSection}
          >
            {words.savedSection}
          </button>
        )}
      </div>
      <p className="nx-page-start__line">{words.drag}</p>
      {starters.length === 0 ? null : (
        <StarterRow
          heading={words.starters}
          notAvailable={words.notAvailable}
          starters={starters}
          onStarter={onStarter}
        />
      )}
    </div>
  );
}
