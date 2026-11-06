"use client";

/**
 * The badge on a block whose bound value a visitor will not see.
 *
 * The canvas draws a page's bound props from sources read as the person
 * editing, who may read fields a visitor may not. A binding to such a field
 * falls back on the published page, so the author is told on the block itself:
 * a small "Visitors won't see this" badge above its top-right corner, with the
 * field and what a visitor sees instead in a tooltip.
 *
 * Which bindings those are is the host's question, answered by the engine's
 * `visitorUnreadableBindings` (the published page's own binding check, with the
 * field shapes a visitor may read); this only draws the answer.
 *
 * A layer of its own rather than a mark in `canvas-marks.tsx`: the marks are
 * boxes hidden from assistive technology, and this badge is a control a
 * keyboard reaches. Its tooltip shows on focus as well as on hover, and Escape
 * hides it without moving either.
 *
 * Placed as `empty-container-appender.tsx` places its controls: the block's
 * element found by its id, measured through `canvasContentRect` and placed in
 * the chrome's coordinates, so it lands right at any zoom. Above the block's
 * box, never over the page's content; inside the box's top corner only when
 * the block starts at the top of what is on screen, where nothing above it is
 * drawn, as the canvas's other tags do.
 *
 * @module visitor-unreadable-badges
 */

import type { VisitorUnreadableBinding } from "@nextlyhq/blocks-engine";
import { EyeOff } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE, nodeElement } from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor, watchScreenBand } from "./canvas-geometry-watch";
import {
  canvasContentRect,
  clippedByAncestorRect,
  onScreenOf,
  overlaySpaceOf,
} from "./geometry-dom";

/** The badge's words: what the author needs to know, at a glance. */
const VISITOR_UNREADABLE_WORDS = "Visitors won't see this";

/** The badge's height, with the gap between it and the block's box. */
const BADGE_ROOM_PX = 26;
/** The gap between the badge and the block's box. */
const BADGE_GAP_PX = 4;

/** Where one badge is drawn, in the chrome's coordinates. */
interface BadgePlace {
  /** The block box's right edge, which the badge's right edge lines up with. */
  readonly right: number;
  readonly top: number;
  /** Drawn inside the box's top corner: no room above it on screen. */
  readonly inside: boolean;
}

export interface VisitorUnreadableBadgesProps {
  /** The bindings a visitor will not see filled, by the id of the node holding them. */
  readonly marked: ReadonlyMap<string, readonly VisitorUnreadableBinding[]>;
  /** Pressed: the host selects the block, whose inspector says it in full. */
  readonly onSelect?: (nodeId: string) => void;
  /** Hidden while the canvas is mid-drag, as the other controls over it are. */
  readonly hidden?: boolean;
}

/** A fallback as a reader sees it: text quoted, anything else named. */
function fallbackWords(binding: VisitorUnreadableBinding): string {
  if (binding.fallback === undefined) {
    return "They see the block's own value instead.";
  }
  const value = binding.fallback.value;
  return typeof value === "string" && value.trim() !== ""
    ? `They see the fallback: “${value}”.`
    : "They see the fallback instead.";
}

/** One sentence per binding: the field, and what a visitor sees instead. */
export function visitorUnreadableSentence(
  binding: VisitorUnreadableBinding
): string {
  return `Visitors can't read “${binding.path}”. ${fallbackWords(binding)}`;
}

/**
 * The badges over the canvas's blocks whose bound values a visitor will not
 * see.
 *
 * @experimental
 */
export function VisitorUnreadableBadges({
  marked,
  onSelect,
  hidden = false,
}: VisitorUnreadableBadgesProps): ReactElement | null {
  const layer = useRef<HTMLDivElement | null>(null);
  const [places, setPlaces] = useState<ReadonlyMap<string, BadgePlace>>(
    () => new Map()
  );
  // The badge whose tooltip Escape put away, until it is left.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const idPrefix = useId();
  const canvasFrame = useCanvasFrame();

  const measure = useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      setPlaces(current => (current.size === 0 ? current : new Map()));
      return;
    }
    const onScreen = onScreenOf(space);
    const next = new Map<string, BadgePlace>();
    for (const id of marked.keys()) {
      const target = nodeElement(space.root, id);
      // A block the page draws nothing for, or one an ancestor clips, has no
      // place on screen a badge could point at.
      if (target === null || clippedByAncestorRect(target, space.root)) {
        continue;
      }
      const box = space.place(canvasContentRect(target, space.root));
      if (box.width === 0 && box.height === 0) continue;
      const inside = box.y - onScreen.y < BADGE_ROOM_PX;
      next.set(id, {
        right: box.x + box.width,
        top: inside ? box.y + BADGE_GAP_PX : box.y - BADGE_ROOM_PX,
        inside,
      });
    }
    setPlaces(next);
  }, [marked]);

  useLayoutEffect(() => {
    if (hidden) return;
    measure();
  }, [measure, hidden, canvasFrame]);

  useEffect(() => {
    if (hidden || marked.size === 0) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [measure, hidden, marked, canvasFrame]);

  // The scrolls that move what of the canvas is on screen, which decide
  // whether a badge has room above its block.
  useEffect(() => {
    if (hidden || marked.size === 0) return;
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [measure, hidden, marked, canvasFrame]);

  if (hidden || marked.size === 0) return null;

  return (
    <div
      ref={layer}
      className="nx-visitor-unreadable"
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {[...marked].map(([id, bindings], index) => {
        const place = places.get(id);
        if (place === undefined) return null;
        const tipId = `${idPrefix}-tip-${String(index)}`;
        return (
          <div
            key={id}
            className="nx-visitor-unreadable__badge"
            data-inside={place.inside ? "" : undefined}
            data-dismissed={dismissed === id ? "" : undefined}
            style={{ left: place.right, top: place.top }}
            onMouseLeave={() => {
              if (dismissed === id) setDismissed(null);
            }}
          >
            <button
              type="button"
              className="nx-visitor-unreadable__button"
              aria-describedby={tipId}
              onClick={() => onSelect?.(id)}
              onBlur={() => {
                if (dismissed === id) setDismissed(null);
              }}
              onKeyDown={event => {
                // Put the tooltip away without moving focus or the pointer.
                if (event.key === "Escape" && dismissed !== id) {
                  event.stopPropagation();
                  setDismissed(id);
                }
              }}
            >
              <EyeOff size={12} aria-hidden="true" />
              <span>{VISITOR_UNREADABLE_WORDS}</span>
            </button>
            <span
              id={tipId}
              role="tooltip"
              className="nx-visitor-unreadable__tip"
            >
              {bindings.map(binding => (
                <span
                  key={binding.prop}
                  className="nx-visitor-unreadable__line"
                >
                  {visitorUnreadableSentence(binding)}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
