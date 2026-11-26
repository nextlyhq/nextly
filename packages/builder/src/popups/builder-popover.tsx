/**
 * The popover content every builder popup is built from: placed once when it
 * opens, then held there while the author works in it.
 *
 * The general popover (`@nextlyhq/ui`) slides and flips itself to stay inside
 * the window each time its size changes, so a row appearing in a popup moved
 * the popup, and the next click landed on the wrong control. This one lets
 * the popover put the popup down once, beside its anchor on the side asked
 * for, works out from there where it should open (`planPopup`), and from then
 * on tells the popover exactly that side and place with its own collision
 * moves turned off. What is left moves it only as the author asked:
 *
 * - the anchor scrolling, which the popover follows;
 * - a window resize, after which the place is chosen again.
 *
 * Content taller than the room on its side scrolls inside it: its height is
 * held to that room (`styles/popups.css`), which is measured from the held
 * edge and so does not change as the content does. The top bar counts as
 * part of the window's edge.
 *
 * Admin screens outside the builder keep the general popover as it is.
 *
 * @module popups/builder-popover
 */
import { PopoverContent } from "@nextlyhq/ui";
import * as React from "react";

import { boxAcross, boxInFrameViewport } from "../canvas/geometry-dom";

import {
  type PopupAlign,
  type PopupBox,
  type PopupHold,
  type PopupInsets,
  type PopupSide,
  anchorOf,
  holdFor,
  planPopup,
} from "./popup-placement";

/**
 * The props the general popover content takes, but three it can't honour:
 * `forceMount`, since content kept mounted while closed would keep its old
 * place for the next opening; `collisionBoundary`, since a popup is planned
 * against the window (and the top bar), not a box of the caller's; and
 * `sticky`, since a held popup follows its anchor and nothing else moves it.
 */
export type BuilderPopoverContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof PopoverContent>,
  "forceMount" | "collisionBoundary" | "sticky"
> & {
  /**
   * Which anchor the popup is open beside, for one that stays open while
   * its anchor moves to another control (a preview beside the highlighted
   * row): a change places it again beside the new one. A popup opened from
   * one control leaves it out.
   */
  anchorKey?: string;
};

/** The popover's own default distance from its anchor, stated so it is known. */
const SIDE_OFFSET = 4;
/** The distance from the window's edges where a popup asks for none. */
const EDGE_GAP = 8;
/** The builder's top bar, which a popup keeps clear of. */
const TOP_BAR = ".nx-builder-topbar";

/**
 * A held popup: what the popover is told, the side it was planned on, and
 * the edges it was planned against.
 */
interface Held {
  hold: Told;
  planned: PopupSide;
  insets: PopupInsets;
}

/**
 * What the popover is told: a hold, or before there is one (or where none
 * could be measured) the side and distance asked for.
 */
type Told =
  | PopupHold
  | { side: PopupSide; sideOffset: number; alignOffset: number };

type Padding = BuilderPopoverContentProps["collisionPadding"];

/**
 * The distances a popup keeps from the window's edges, as the popover reads
 * `collisionPadding`: one number for every edge, or an object whose missing
 * edges are none. Only a popup that gives no padding at all gets the gap.
 */
function insetsFrom(padding: Padding): PopupInsets {
  const each = padding ?? EDGE_GAP;
  if (typeof each === "number") {
    return { top: each, right: each, bottom: each, left: each };
  }
  return {
    top: each.top ?? 0,
    right: each.right ?? 0,
    bottom: each.bottom ?? 0,
    left: each.left ?? 0,
  };
}

/** The window's edges for a popup in `doc`, its top moved below the top bar. */
function windowInsets(doc: Document, padding: Padding): PopupInsets {
  const insets = insetsFrom(padding);
  const found = doc.querySelector(TOP_BAR);
  // The bar's client box in its own document's viewport, which is the
  // popup's window too: both are drawn in the editor's document.
  const bar = found === null ? undefined : boxInFrameViewport(found);
  if (bar === undefined || bar.height === 0) return insets;
  return {
    ...insets,
    top: Math.max(insets.top, bar.y + bar.height + insets.top),
  };
}

const boxOf = (rect: DOMRect): PopupBox => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

/** A length the popover wrote on its wrapper, such as the anchor's width. */
function lengthOn(element: HTMLElement, name: string): number {
  const value = Number.parseFloat(element.style.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

/**
 * The popup's next place, read from where the popover has it now: the
 * popover's wrapper is the box it moves, and the anchor is worked back from
 * it. Its own size is measured as the placing state draws it, with no height
 * limit of the room it had, so the plan sees all of its content.
 */
function nextPlace(
  content: HTMLElement,
  now: Told,
  asked: {
    side: PopupSide;
    align: PopupAlign;
    sideOffset: number;
    alignOffset: number;
    keepSide: boolean;
  },
  padding: Padding
): Held | null {
  const wrapper = content.parentElement;
  if (wrapper?.hasAttribute("data-radix-popper-content-wrapper") !== true) {
    return null;
  }
  const doc = content.ownerDocument;
  const view = doc.defaultView;
  if (view === null) return null;

  // Where the popover has it, and its size drawn as the placing state draws
  // it, with no height limit, put back at once so nothing is painted between.
  const was = content.getAttribute("data-nx-popup");
  const measured = boxAcross(
    wrapper,
    () => content.setAttribute("data-nx-popup", "placing"),
    () => {
      if (was !== null) content.setAttribute("data-nx-popup", was);
    }
  );
  const placed = boxOf(measured.before);
  const natural = measured.after;

  const insets = windowInsets(doc, padding);
  const anchor = anchorOf(placed, now, {
    width: lengthOn(wrapper, "--radix-popper-anchor-width"),
    height: lengthOn(wrapper, "--radix-popper-anchor-height"),
  });
  const plan = planPopup({
    anchor,
    size: { width: natural.width, height: natural.height },
    viewport: { width: view.innerWidth, height: view.innerHeight },
    insets,
    side: asked.side,
    align: asked.align,
    sideOffset: asked.sideOffset,
    keepSide: asked.keepSide,
    alignOffset: asked.alignOffset,
  });
  const size = { width: natural.width, height: natural.height };
  return {
    hold: holdFor(plan, anchor, size, asked.sideOffset, insets),
    planned: plan.side,
    insets,
  };
}

/**
 * The builder's popover content: `PopoverContent`'s props, its `side`,
 * `align`, `sideOffset` and `collisionPadding` read as where to open (and
 * `avoidCollisions={false}` as "on this side, room or not"), after which it
 * holds still. @experimental
 */
export const BuilderPopoverContent: React.ForwardRefExoticComponent<
  BuilderPopoverContentProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<HTMLDivElement, BuilderPopoverContentProps>(
  function BuilderPopoverContent(
    {
      side = "bottom",
      align = "center",
      sideOffset = SIDE_OFFSET,
      collisionPadding = EDGE_GAP,
      // Asked off, the popup stays on its side even without room there.
      avoidCollisions = true,
      alignOffset = 0,
      anchorKey,
      ...props
    },
    forwardedRef
  ) {
    const content = React.useRef<HTMLDivElement | null>(null);
    // Also held as state: the popover's portal mounts the content after this
    // component, so what watches it waits for it to arrive.
    const [node, setNode] = React.useState<HTMLDivElement | null>(null);
    const [held, setHeld] = React.useState<Held | null>(null);
    // The place the popover has the popup at, read by the handlers below.
    const first: Told = { side, sideOffset, alignOffset: 0 };
    const now = React.useRef<Told>(first);
    now.current = held?.hold ?? first;
    const keepSide = !avoidCollisions;
    const where = { side, align, sideOffset, alignOffset, keepSide };
    const asked = React.useRef({ ...where, collisionPadding });
    asked.current = { ...where, collisionPadding };

    // The anchor the popup was last placed beside.
    const placedBeside = React.useRef(anchorKey);
    const askedAnchor = React.useRef(anchorKey);
    askedAnchor.current = anchorKey;

    const place = React.useCallback((): void => {
      const element = content.current;
      if (element === null) return;
      placedBeside.current = askedAnchor.current;
      const { collisionPadding: padding, ...where } = asked.current;
      const next = nextPlace(element, now.current, where, padding);
      // Nothing to measure from: shown where the popover put it.
      setHeld(
        next ?? {
          hold: now.current,
          planned: now.current.side,
          insets: insetsFrom(asked.current.collisionPadding),
        }
      );
    }, []);

    // Closed, the content goes while this stays mounted with its popover:
    // the next opening is placed afresh, from wherever it opens.
    React.useLayoutEffect(() => {
      if (node === null) setHeld(null);
    }, [node]);

    // Once, when the popover first has the popup beside its anchor: until
    // then it keeps the popup off the page with a translate of -200%.
    const isHeld = held !== null;
    React.useLayoutEffect(() => {
      if (isHeld) return;
      const wrapper = node?.parentElement;
      const view = wrapper?.ownerDocument.defaultView;
      if (wrapper === null || wrapper === undefined) return;
      if (view === null || view === undefined) return;
      const placed = (): boolean =>
        wrapper.style.transform !== "" &&
        !wrapper.style.transform.includes("-200%");
      if (placed()) {
        place();
        return;
      }
      const watch = new view.MutationObserver(() => {
        if (!placed()) return;
        watch.disconnect();
        place();
      });
      watch.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
      return () => watch.disconnect();
    }, [isHeld, node, place]);

    // Placed again beside a new anchor, once the popover has moved it there
    // (it keeps the held place against the new anchor until then).
    React.useEffect(() => {
      if (!isHeld || placedBeside.current === anchorKey) return;
      const view = content.current?.ownerDocument.defaultView;
      if (view === null || view === undefined) return;
      const frame = view.requestAnimationFrame(place);
      return () => view.cancelAnimationFrame(frame);
    }, [anchorKey, isHeld, place]);

    // Opened again before its closing animation ended, the content never
    // went, so the opening is placed again here from where it is held.
    React.useEffect(() => {
      if (!isHeld || node === null) return;
      const view = node.ownerDocument.defaultView;
      if (view === null) return;
      let frame = 0;
      const watch = new view.MutationObserver(() => {
        if (node.getAttribute("data-state") !== "open") return;
        view.cancelAnimationFrame(frame);
        frame = view.requestAnimationFrame(place);
      });
      watch.observe(node, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
      return () => {
        view.cancelAnimationFrame(frame);
        watch.disconnect();
      };
    }, [isHeld, node, place]);

    // Placed again only when the window changes size; nothing else moves it.
    React.useEffect(() => {
      if (!isHeld) return;
      const view = content.current?.ownerDocument.defaultView;
      if (view === null || view === undefined) return;
      let frame = 0;
      const onResize = (): void => {
        view.cancelAnimationFrame(frame);
        // After the popover has followed its anchor to the new layout.
        frame = view.requestAnimationFrame(place);
      };
      view.addEventListener("resize", onResize);
      return () => {
        view.cancelAnimationFrame(frame);
        view.removeEventListener("resize", onResize);
      };
    }, [isHeld, place]);

    const ref = React.useCallback(
      (element: HTMLDivElement | null): void => {
        content.current = element;
        setNode(element);
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef !== null) forwardedRef.current = element;
      },
      [forwardedRef]
    );

    return (
      <PopoverContent
        {...props}
        ref={ref}
        // Start alignment and the two offsets say where its top-left corner
        // goes, so a change in the popup's size cannot move it.
        side={now.current.side}
        align="start"
        alignOffset={now.current.alignOffset}
        sideOffset={now.current.sideOffset}
        avoidCollisions={false}
        collisionPadding={held?.insets ?? collisionPadding}
        data-nx-popup={held === null ? "placing" : "held"}
        // The side it was planned on: the popover's own names the side its
        // corner is measured from.
        data-nx-popup-side={held?.planned ?? side}
        // Kept on its side whatever its room, so it keeps its own width too
        // (`styles/popups.css`) rather than being squeezed into that room.
        data-nx-popup-keep-side={keepSide ? "" : undefined}
      />
    );
  }
);
