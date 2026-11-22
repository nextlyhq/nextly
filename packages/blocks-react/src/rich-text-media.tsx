/**
 * The image and gallery nodes of rich text: their sizes, figures and
 * captions, and the gallery's columns.
 *
 * @module rich-text-media
 */
import type { RichTextNode } from "@nextlyhq/blocks-engine";
import type { CSSProperties, ReactNode } from "react";

import { fetchableUrl, oneOf, text } from "./blocks/props";
import type { DrawSettings } from "./rich-text-draw-settings";

/**
 * Dimensions, when the editor recorded usable ones.
 *
 * BOTH or NEITHER. A lone `width` on an `<img>` makes a browser compute the
 * other from the intrinsic size, which is a different number from the one the
 * author saw and moves the layout as the image loads — the reserved space this
 * exists to provide, reserved wrongly.
 */
function boxOf(
  node: Readonly<Record<string, unknown>>
): { width: number; height: number } | undefined {
  const width = usableEdge(node.width);
  const height = usableEdge(node.height);
  return width === undefined || height === undefined
    ? undefined
    : { width, height };
}

/**
 * One edge, judged BEFORE anything clamps it.
 *
 * Clamping first and rejecting zero after cannot work: a stored `0` becomes the
 * minimum on the way in, so the rejection never fires and the page draws a
 * one-pixel image. That makes the picture DISAPPEAR, where dropping the
 * dimension entirely would have let its intrinsic size render normally — the
 * failure is worse than the one the bound was added to prevent.
 */
function usableEdge(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > MAX_IMAGE_EDGE) return undefined;
  // Rounded FIRST, then judged again. A positive edge below a half is inside
  // the range above and rounds to zero, so returning the rounded value straight
  // away reinstates the collapsed image the range check exists to refuse — one
  // step later, where the earlier check can no longer see it.
  const edge = Math.round(value);
  return edge <= 0 ? undefined : edge;
}

/** The largest edge an `<img>` is given a reserved box for. */
const MAX_IMAGE_EDGE = 20000;

/**
 * The `<img>` every image in this file goes through.
 *
 * ONE path rather than one per caller. A gallery entry carries the same fields
 * a standalone image does — a title the author wrote, the intrinsic width and
 * height — and a second, reduced projection beside this one drops them: the
 * gallery loses its titles and reserves no space, so its rows shift as the
 * images load while the standalone path above them does not.
 */
/**
 * The inline margin a rich-media wrapper is owed, because the browser's is wrong.
 *
 * A `<figure>` carries `margin: 1em 40px` from the UA stylesheet, and 40px on
 * each side is an INDENT nobody asked for — it takes 80px out of the column and
 * is plainly visible on a narrow screen. This package ships no stylesheet to
 * neutralise it, so the wrapper carries the reset itself, the same way the
 * gallery's list already resets the markers and padding a `<ul>` arrives with.
 *
 * Horizontal only. The space between a figure and the prose around it belongs
 * to the passage: the rich-text block spaces each element after the first by
 * `space.paragraph`, and the element defaults zero a figure's block margins.
 * An inline vertical margin here would outrank both, since nothing beats an
 * inline style.
 */
const MEDIA_FIGURE_STYLE: CSSProperties = { marginInline: 0 };

function ImageElement({
  src,
  node,
  fills,
}: {
  src: string;
  node: Readonly<Record<string, unknown>>;
  /**
   * Whether the image should FILL its track rather than sit at its own width.
   *
   * True inside a gallery and false on its own, which is not an inconsistency
   * but the editor's two answers: `GalleryNode.exportDOM` writes
   * `img.style.width = "100%"` on every cell, and `ImageNode.exportDOM` writes
   * the author's recorded `width`/`height` as attributes and no width style at
   * all. A gallery cell is a slot in a grid the author sized by choosing a
   * column count; a standalone image is the size it was placed at, and forcing
   * it to the column would UPSCALE a small one past its own pixels.
   */
  fills?: boolean;
}): ReactNode {
  const title = text(node.title);
  const box = boxOf(node);
  return (
    <img
      src={src}
      alt={text(node.altText ?? node.alt)}
      {...(title === "" ? {} : { title })}
      {...(box ?? {})}
      loading="lazy"
      decoding="async"
      // CONTAINED, and inline for the reason everything else here is: this
      // package ships no stylesheet, so an upload wider than the column renders
      // at its intrinsic width and breaks out of the prose — a normal case for
      // anything from a modern camera or a high-DPI screen. The editor draws
      // these with `w-full h-auto`; a published page that did not would show the
      // author something they never saw.
      //
      // `height: auto` is what keeps the pair above honest rather than
      // contradicting it: the width and height attributes still give the
      // browser the aspect ratio to reserve space with, and this lets the
      // rendered height follow the constrained width instead of holding the
      // intrinsic one and squashing the picture.
      style={{
        ...(fills === true ? { width: "100%" } : {}),
        maxWidth: "100%",
        height: "auto",
      }}
    />
  );
}

/** A caption, when the author wrote one. */
function CaptionView({ value }: { value: unknown }): ReactNode {
  const caption = text(value);
  if (caption === "") return null;
  return (
    <figcaption className="nextly-rich-text-caption">{caption}</figcaption>
  );
}

/**
 * An image an author placed inside their prose.
 *
 * Refused sources render NOTHING rather than a broken element. An `<img>` whose
 * source this page will not load is an alt-text box on the published page and a
 * request the operator said not to make; the prose around it is unaffected
 * either way, which is what makes dropping it the better answer.
 *
 * `alt` is always written, empty when the author gave none. Absent, a screen
 * reader announces the FILENAME, which is worse than silence — and an image
 * inside prose that carries no description is decorative far more often than it
 * is unlabelled.
 *
 * A plain `<img>` rather than `next/image`, and that is the package boundary
 * rather than an oversight: this entry's layering test forbids importing
 * `next/*`, so the root renderer works in any React host.
 *
 * There is no optimised route through this renderer today, and saying otherwise
 * sends a Next.js reader looking for a seam that does not exist: `next.ts` does
 * not import `RichText` and does not replace this element. Optimising it means
 * giving that subpath its own rich-text entry, which is a change to what this
 * package exports rather than a detail of this function.
 */
export function ImageView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  const src = fetchableUrl(node.src, draw.host?.remotePatterns);
  if (src === undefined) return null;
  return (
    <figure className="nextly-rich-text-image" style={MEDIA_FIGURE_STYLE}>
      <ImageElement src={src} node={node} />
      <CaptionView value={node.caption} />
    </figure>
  );
}

/** The column counts the editor offers; anything else is a document it did not write. */
const GALLERY_COLUMNS = ["2", "3", "4"] as const;

/** The custom property {@link GALLERY_NARROW_CSS} lowers on a narrow screen. */
const GALLERY_COLUMN_VAR = "--nx-rich-text-gallery-columns";

/** The dedupe key for the one gallery rule set a page needs. */
const GALLERY_STYLE_KEY = "nextly-rich-text-gallery";

/**
 * Two columns below the editor's `sm`, which is what the editor SHOWS.
 *
 * `GalleryNode` previews three columns as `grid-cols-2 sm:grid-cols-3` and four
 * as `grid-cols-2 sm:grid-cols-4`, so below that breakpoint an author is shown
 * two columns whatever they picked. Published without this, a four-column
 * gallery squeezes four images across a phone — a layout the author was never
 * offered and cannot preview.
 *
 * `not all and (min-width: 40rem)` is the EXACT complement of Tailwind's `sm:`,
 * whose `--breakpoint-sm` is `40rem` and is overridden nowhere in this repo. A
 * `max-width` written beside it leaves a gap or an overlap at the boundary
 * depending on how the value is rounded, and the boundary is the one width
 * where being wrong is visible.
 *
 * Written as a CHILD rather than through `dangerouslySetInnerHTML`, which is
 * safe only because this text contains no character React escapes. A test
 * asserts the rendered bytes to keep that true.
 */
const GALLERY_NARROW_CSS = `@media not all and (min-width: 40rem){.nextly-rich-text-gallery-items{${GALLERY_COLUMN_VAR}:2}}`;

/**
 * A gallery of images, as a list.
 *
 * A LIST rather than a row of figures, because that is what it is: a screen
 * reader announces the count before the first item, which is the one fact a
 * non-visual reader most needs about a gallery and the one a bare sequence of
 * images cannot convey.
 *
 * Each source crosses the same two filters separately, so one image the site
 * will not fetch removes itself rather than the gallery around it. A gallery
 * left with no usable image renders nothing, for the reason a single refused
 * image does.
 */
export function GalleryView({
  node,
  draw,
}: {
  node: RichTextNode;
  draw: DrawSettings;
}): ReactNode {
  if (!Array.isArray(node.images)) return null;
  const images = node.images
    .map(entry => {
      if (entry === null || typeof entry !== "object") return undefined;
      const item: Readonly<Record<string, unknown>> = entry;
      const src = fetchableUrl(item.src, draw.host?.remotePatterns);
      // The WHOLE entry travels on, not a `{ src, alt }` reduction of it. The
      // shared element below reads the title and the dimensions off it, and a
      // projection that kept two fields is what dropped them here before.
      return src === undefined ? undefined : { src, item };
    })
    .filter(
      (
        entry
      ): entry is { src: string; item: Readonly<Record<string, unknown>> } =>
        entry !== undefined
    );
  if (images.length === 0) return null;

  // Read as a STRING because a stored `3` and a stored `"3"` are the same
  // gallery to an author, and the value reaches an attribute either way.
  const columns = oneOf(String(node.columns), GALLERY_COLUMNS, "3");
  // The grid is written INLINE rather than left to the attribute alone. This
  // package ships no stylesheet — a host styles the emitted classes, as the
  // blog template does for code tokens — so a `data-columns` nobody has written
  // a rule for makes an author's choice of two, three or four do nothing at
  // all, and the list draws as one bulleted column. The count is structural
  // rather than theming: it is what the author selected, not how the site wants
  // galleries to look, so the renderer owes it. The attribute stays beside it so
  // a host can still target the choice, and `textTransform` (in
  // `rich-text-formats`) sets the same precedent for a property the renderer
  // must guarantee.
  const layout: CSSProperties = {
    display: "grid",
    // The count is read through a CUSTOM PROPERTY whose fallback is the
    // author's choice, so the narrow-screen rule can lower it without
    // `!important` and without the inline value having to know that rule
    // exists. If the stylesheet never arrives, the fallback is what applies and
    // the gallery draws exactly the columns the author picked.
    gridTemplateColumns: `repeat(var(${GALLERY_COLUMN_VAR}, ${columns}), minmax(0, 1fr))`,
    // The list's own presentation, reset here for the same reason the columns
    // are set here: a `<ul>` in a grid still carries markers, padding and
    // margins from the browser, so a host with no rule for this class publishes
    // the gallery as a bulleted, indented list. The list SEMANTICS stay — a
    // screen reader announces the count, which is the one fact about a gallery
    // a non-visual reader most needs.
    // The LONGHAND. `list-style` is a shorthand, and a shorthand is the one
    // form a test cannot observe here — jsdom's CSS parser drops it from the
    // serialised style, so asserting it would be asserting something unreadable
    // whether or not it was applied. The marker is the only part being removed
    // anyway.
    listStyleType: "none",
    padding: 0,
    margin: 0,
    gap: "0.5rem",
  };
  return (
    <figure className="nextly-rich-text-gallery" style={MEDIA_FIGURE_STYLE}>
      {/*
       * HOISTED and DEDUPED by React: `href` plus `precedence` lifts this out
       * of the figure and collapses every gallery on the page to one copy —
       * measured, under `renderToStaticMarkup` as well as `renderToString`.
       *
       * A media query is the only reason a rule set exists here at all.
       * Everything else this file guarantees fits in an inline style, but a
       * breakpoint cannot, and `auto-fit` track sizing cannot stand in for one:
       * a jump from two columns to four is unreachable at any basis, because
       * the basis that fits four at the breakpoint also fits three below it.
       */}
      <style href={GALLERY_STYLE_KEY} precedence="default">
        {GALLERY_NARROW_CSS}
      </style>
      <ul
        className="nextly-rich-text-gallery-items"
        data-columns={columns}
        style={layout}
      >
        {images.map((image, i) => (
          <li key={i}>
            <ImageElement src={image.src} node={image.item} fills />
          </li>
        ))}
      </ul>
      <CaptionView value={node.caption} />
    </figure>
  );
}
