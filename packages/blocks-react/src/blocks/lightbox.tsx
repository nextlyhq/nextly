/**
 * The full-size view of a picture, opened over the page with no script.
 *
 * The browser's own popover does all of it. The picture is a button naming
 * the popover (`popovertarget`); the popover (`popover="auto"`) holds a
 * Close button that hides it (`popovertargetaction="hide"`), the full-size
 * file and the caption. An `auto` popover closes on Escape and on a click
 * outside it, and gives focus back to the button that opened it; it adds no
 * history entry, as a `:target` fragment would. The full-size file is the
 * background of an element inside the popover rather than an `img`: with
 * script turned off a browser ignores `loading="lazy"` and fetches every
 * `img` with the page, while a background inside a closed popover, which
 * is not drawn, is fetched only when it opens.
 *
 * Close is the only control: nothing here steps to another picture. With no
 * script, a Next inside one popover opens the next one nested over it rather
 * than in its place, so Close and Escape step back a picture at a time and
 * Previous can't reach a picture still open beneath; a `:target` fragment per
 * picture instead adds a history entry for every step, so Back walks the
 * pictures rather than leaving the page.
 *
 * Shared by the Image block and the pictures of a Gallery, which are Image
 * blocks of their own.
 *
 * @module blocks/lightbox
 */
import type { CSSProperties, ReactElement } from "react";

/**
 * The marker on every lightbox, which the rules below select by: a popover
 * is the block's part, but `:popover-open` and `::backdrop` are not states
 * a part's styles can say.
 */
const LIGHTBOX_ATTRIBUTE = "data-nx-lightbox";

/** The marker on the full-size picture, for its background's fit. */
const PICTURE_ATTRIBUTE = "data-nx-lightbox-picture";

/** The marker on the button that opens one, for its pointer (see below). */
export const ENLARGE_ATTRIBUTE = "data-nx-enlarge";

/**
 * The rules a part's styles can't say, hoisted and deduped to one copy per
 * page (`<style href>` with `precedence`), and carried by every lightbox so
 * none reaches a page without them.
 *
 * `display` only while open: a page's rule outweighs the browser's own
 * `[popover]:not(:popover-open) { display: none }`, so a lightbox given its
 * layout unconditionally would show on every page load. `margin: auto` is
 * the browser's own centring, restated: a site's reset (`* { margin: 0 }`)
 * outweighs it too, and pinned the panel to the window's corner. The
 * backdrop dims the page the same in light and dark: it is a shade over
 * whatever is there, and the panel on it takes the site's colours. The
 * pointers too, and how the full-size picture fills its box, which are no
 * style a part can declare: a picture that enlarges, and a Close button.
 */
const LIGHTBOX_CSS: string = [
  `[${LIGHTBOX_ATTRIBUTE}]:popover-open{display:flex}`,
  `[${LIGHTBOX_ATTRIBUTE}]{margin:auto}`,
  `[${PICTURE_ATTRIBUTE}]{background-size:contain;background-repeat:no-repeat;background-position:center}`,
  `[${LIGHTBOX_ATTRIBUTE}]::backdrop{background:rgb(0 0 0 / 0.8)}`,
  `[${ENLARGE_ATTRIBUTE}]{cursor:zoom-in}`,
  `[${LIGHTBOX_ATTRIBUTE}]>button{cursor:pointer}`,
].join("");

/** The key the lightbox rules are hoisted under, once per page. */
const LIGHTBOX_STYLE_KEY = "nx-lightbox";

/**
 * The lightbox's parts, for the block that draws it to declare among its
 * own, so they take the site's tokens (and its dark values) as any part
 * does, and every size here holds at 320px.
 */
export const LIGHTBOX_PARTS = {
  // The picture's button on the page: no chrome of its own, the picture's
  // box, and a pointer that says it enlarges.
  enlarge: {
    baseStyles: {
      base: {
        base: {
          display: "inline-block",
          maxWidth: "100%",
          minHeight: "0",
          padding: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
          border: {
            width: {
              blockStart: "0",
              blockEnd: "0",
              inlineStart: "0",
              inlineEnd: "0",
            },
            style: "none",
          },
          backgroundColor: "transparent",
          color: "inherit",
          // Clipped, so nothing the picture draws past its corners shows.
          overflow: "hidden",
        },
      },
    },
  },
  // The open panel: the site's page colours, as large as the window allows
  // with a margin, its contents in a column (`display` is the hoisted
  // rule's, see `LIGHTBOX_CSS`).
  lightbox: {
    baseStyles: {
      base: {
        base: {
          boxSizing: "border-box",
          maxWidth: "90vw",
          maxHeight: "90vh",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          padding: {
            blockStart: "0.5rem",
            blockEnd: "0.75rem",
            inlineStart: "0.75rem",
            inlineEnd: "0.75rem",
          },
          border: {
            width: {
              blockStart: "0",
              blockEnd: "0",
              inlineStart: "0",
              inlineEnd: "0",
            },
            style: "none",
          },
          borderRadius: "8px",
          backgroundColor: { $token: "color.background" },
          color: { $token: "color.text" },
        },
      },
    },
  },
  // Close: a 44px target at the panel's end, in the panel's text colour on
  // its background, with an edge a person can find.
  close: {
    baseStyles: {
      base: {
        base: {
          alignSelf: "flex-end",
          minWidth: "44px",
          minHeight: "44px",
          padding: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0.75rem",
            inlineEnd: "0.75rem",
          },
          border: {
            width: {
              blockStart: "1px",
              blockEnd: "1px",
              inlineStart: "1px",
              inlineEnd: "1px",
            },
            style: "solid",
            color: { $token: "color.border-strong" },
          },
          borderRadius: "8px",
          backgroundColor: "transparent",
          color: "inherit",
          fontFamily: "inherit",
          fontSize: "1rem",
        },
      },
    },
  },
  // The full-size file: never past the window, with room left in the panel
  // for Close and the caption. Its size for its proportion is the picture's
  // own (see `fullSize`).
  full: {
    baseStyles: {
      base: {
        base: {
          display: "block",
          maxWidth: "calc(90vw - 1.5rem)",
          maxHeight: "70vh",
        },
      },
    },
  },
  // The caption under the full-size picture, as wide as the picture allows.
  "lightbox-caption": {
    baseStyles: {
      base: {
        base: {
          margin: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
          fontSize: "0.875em",
          maxWidth: "calc(90vw - 1.5rem)",
        },
      },
    },
  },
} as const;

/**
 * An address as a CSS `url()` string. The address is content, so a quote or
 * a backslash in it is escaped, and a line break written as its code, rather
 * than ending the string and letting the rest read as more CSS.
 */
function cssUrl(address: string): string {
  const escaped = address
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ");
  return `url("${escaped}")`;
}

/**
 * The full-size picture's box: its proportion, and as wide as it can be
 * while it fits the room the part's styles give it and stays no wider than
 * the file. A picture whose size isn't known takes the room as it is, and
 * its background is fitted inside.
 */
function fullSize(
  width: number | undefined,
  height: number | undefined
): CSSProperties {
  if (
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    return { width: "calc(90vw - 1.5rem)", height: "70vh" };
  }
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(calc(90vw - 1.5rem), calc(70vh * ${width} / ${height}), ${width}px)`,
  };
}

/** What the picture's button is called: its alt text, or that it enlarges. */
export function enlargeName(alt: string): string {
  return alt === "" ? "Enlarge picture" : `Enlarge: ${alt}`;
}

/**
 * The id of a picture's lightbox: from its node, and inside a list from the
 * entry's position too, since a list draws one copy of the node per entry.
 */
export function lightboxId(
  nodeId: string,
  itemPosition: string | undefined
): string {
  const stem =
    itemPosition === undefined ? nodeId : `${nodeId}-${itemPosition}`;
  return `nx-lightbox-${stem}`;
}

/**
 * The popover itself, closed until its button opens it. The full-size file
 * has the same alt text as the page's picture.
 */
export function Lightbox({
  id,
  src,
  alt,
  width,
  height,
  caption,
  partClass,
}: {
  id: string;
  /** The full-size file: the original, never a sized copy. */
  src: string;
  alt: string;
  width: number | undefined;
  height: number | undefined;
  caption: string;
  partClass: (part: string) => string;
}): ReactElement {
  return (
    <div
      id={id}
      popover="auto"
      className={partClass("lightbox")}
      {...{ [LIGHTBOX_ATTRIBUTE]: "" }}
    >
      {/* Hoisted and deduped by React: one copy per page. */}
      <style href={LIGHTBOX_STYLE_KEY} precedence="default">
        {LIGHTBOX_CSS}
      </style>
      <button
        type="button"
        className={partClass("close")}
        popoverTarget={id}
        popoverTargetAction="hide"
      >
        Close
      </button>
      <div
        className={partClass("full")}
        // Named as the page's picture is; a decorative one is hidden, as
        // its `alt=""` is.
        {...(alt === ""
          ? { "aria-hidden": "true" }
          : { role: "img", "aria-label": alt })}
        style={{ backgroundImage: cssUrl(src), ...fullSize(width, height) }}
        {...{ [PICTURE_ATTRIBUTE]: "" }}
      />
      {caption === "" ? null : (
        <p className={partClass("lightbox-caption")}>{caption}</p>
      )}
    </div>
  );
}
