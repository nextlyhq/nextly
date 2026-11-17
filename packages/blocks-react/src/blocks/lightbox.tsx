/**
 * The full-size view of a picture, opened over the page with no script.
 *
 * The browser's own popover does all of it. The picture is a button naming
 * the popover (`popovertarget`); the popover (`popover="auto"`) holds a
 * Close button that hides it (`popovertargetaction="hide"`), the full-size
 * file and the caption. An `auto` popover closes on Escape and on a click
 * outside it, and gives focus back to the button that opened it; it adds no
 * history entry, as a `:target` fragment would. A closed popover is not
 * drawn, so its `loading="lazy"` file is fetched only when it opens.
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
import type { ReactElement } from "react";

/**
 * The marker on every lightbox, which the rules below select by: a popover
 * is the block's part, but `:popover-open` and `::backdrop` are not states
 * a part's styles can say.
 */
const LIGHTBOX_ATTRIBUTE = "data-nx-lightbox";

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
 * pointers too, which are no style a part can declare: a picture that
 * enlarges, and a Close button.
 */
const LIGHTBOX_CSS: string = [
  `[${LIGHTBOX_ATTRIBUTE}]:popover-open{display:flex}`,
  `[${LIGHTBOX_ATTRIBUTE}]{margin:auto}`,
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
  // The full-size file: never past the window, its proportion kept, with
  // room left in the panel for Close and the caption.
  full: {
    baseStyles: {
      base: {
        base: {
          display: "block",
          width: "auto",
          height: "auto",
          maxWidth: "calc(90vw - 1.5rem)",
          maxHeight: "70vh",
          minHeight: "0",
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
      <img
        className={partClass("full")}
        src={src}
        alt={alt}
        loading="lazy"
        {...(width === undefined ? {} : { width })}
        {...(height === undefined ? {} : { height })}
      />
      {caption === "" ? null : (
        <p className={partClass("lightbox-caption")}>{caption}</p>
      )}
    </div>
  );
}
