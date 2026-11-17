"use client";

/**
 * The parts every small picture of a document shares: when it is first seen,
 * the scale that fits its composed width into its box, and the inert surface
 * the document is drawn on at that width.
 *
 * Shared by the entry page's miniature and the editor's pictures (a saved
 * section, a header & footer set), so "draw this document small" has one
 * answer. Each surface still decides its own box: the entry page shows the
 * page as tall as it is, a picture fits a fixed frame.
 *
 * ## `transform`, never `zoom`
 *
 * The canvas uses `zoom`, because hit-testing and drag geometry are measured in
 * the scaled box's own coordinates. Nothing in a picture is interactive, so
 * that buys nothing here and costs a reflow of the whole drawn tree on every
 * resize. `transform` alone leaves the element in the layout flow, though, so
 * the scaled element is absolutely positioned: only then is the frame's width
 * the box's width rather than the composed one.
 *
 * ## An unmeasurable box draws UNSCALED
 *
 * A box reports zero width before layout, and in any environment that does
 * not lay out. Scaling by zero would draw nothing, a blank frame that looks
 * like an empty document. Drawn unscaled it is wrong only in how much shows,
 * and visibly so.
 *
 * @module miniature-surface
 */
import {
  createStandaloneContext,
  previewContainerStyle,
  type PageContext,
} from "@nextlyhq/blocks-react";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * The width a document is composed at before it is scaled down: the desktop
 * preview's. Composed narrower, a page draws its MOBILE layout, a true picture
 * of a viewport the author was not looking at.
 */
export const MINIATURE_RENDER_WIDTH = 1280;

/**
 * Margin around the viewport that counts as seen, so a picture starts drawing
 * just before it scrolls on screen rather than after.
 */
const AHEAD = "200px";

/**
 * Whether an element has come into view yet. Drawn the first time it is seen,
 * and kept drawn. Where there is no observer to ask (an older engine, a test
 * without layout) the answer is "seen", so a picture is never left blank.
 *
 * @param target - the element whose view is asked about
 * @param already - seen before, so drawn at once without waiting to be seen
 */
export function useFirstSeen(
  target: RefObject<Element | null>,
  already = false
): boolean {
  const [seen, setSeen] = useState(
    () => already || typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const element = target.current;
    if (seen || already || element === null) return;
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: AHEAD }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, already, target]);

  return seen || already;
}

/**
 * The scale that fits the composed width into the box, kept current as the
 * box resizes. Zero width means "not laid out", never "zero wide", so it
 * scales by one there (see the module's documentation).
 */
export function useWidthScale(
  frame: RefObject<HTMLElement | null>,
  renderWidth: number
): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = (): void => {
      const width = element.clientWidth;
      setScale(width > 0 ? width / renderWidth : 1);
    };
    measure();
    // Guarded: a host without the observer must still draw the document.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame, renderWidth]);
  return scale;
}

/** What {@link MiniatureSurface} draws a document at, and on. */
export interface MiniatureSurfaceProps {
  /** The scaled element, for a surface that measures what it drew. */
  scaledRef?: RefObject<HTMLDivElement | null>;
  /** The width the document is composed at. */
  renderWidth: number;
  scale: number;
  /** The container the sheet's responsive rules resolve against, if any. */
  previewContainer: string | undefined;
  /** Moves the drawn document down inside the box, in on-screen pixels. */
  offsetTop?: number;
  /** The `data-slot` prefix the two elements are named with. */
  slot?: string;
  children: ReactNode;
}

/**
 * The document at its composed width, scaled into the box, and inert.
 *
 * Everything inside is `inert` and `aria-hidden`: a page is full of links,
 * buttons and headings, and left reachable a picture would put a second
 * document into the tab order of whatever holds it.
 *
 * A submit raised anywhere in the document is refused on the way down. A page
 * holding a form block draws a form, and a picture inside the entry screen's
 * own form would nest one: the drawn form's submit must not reach the outer
 * one. Matched by the event rather than by a block's name, so a host's own
 * form-rooted block is refused by the same line.
 */
export function MiniatureSurface({
  scaledRef,
  renderWidth,
  scale,
  previewContainer,
  offsetTop = 0,
  slot = "miniature",
  children,
}: MiniatureSurfaceProps): JSX.Element {
  return (
    <div
      ref={scaledRef}
      data-slot={`${slot}-scaled`}
      style={{
        // Absolute: see the module's documentation.
        position: "absolute",
        left: 0,
        top: offsetTop,
        width: `${renderWidth}px`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        // The container the compiled responsive rules resolve against, on the
        // element whose width they answer for: the COMPOSED width.
        ...previewContainerStyle(previewContainer),
      }}
    >
      <div
        data-slot={`${slot}-surface`}
        inert
        aria-hidden="true"
        onSubmitCapture={event => event.preventDefault()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * What the pictures of one editing session share: one page context, so what
 * an async block drew (an image, a button) is kept between pictures and
 * between openings of a panel instead of blinking out, and which documents
 * have been seen, so a picture shown before is drawn at once when its row
 * comes back.
 *
 * Seen is kept by the document's identity: a document read again unchanged is
 * the same object, and a changed or newly published one is a new object that
 * is drawn anew.
 */
export interface MiniatureSession {
  readonly context: PageContext;
  readonly seen: WeakSet<object>;
}

/** A session of its own, for a host that keeps one for as long as it edits. */
export function createMiniatureSession(): MiniatureSession {
  return { context: createStandaloneContext(), seen: new WeakSet() };
}

/** One session for as long as the calling component is mounted. */
export function useMiniatureSession(): MiniatureSession {
  const [session] = useState(createMiniatureSession);
  return session;
}
