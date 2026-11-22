"use client";

/**
 * What the canvas draws in the page's place for a document that has no page
 * of its own: a grey box with a line of words, between the header and the
 * footer drawn around it, so the author sees how they sit on a page.
 *
 * Drawn by the editor only, never stored and never published: it stands for
 * whichever page will be drawn there. It is not editor chrome either, so a
 * press on it is a press on the page's ground, which clears the selection.
 *
 * @module canvas/page-placeholder
 */
import type { JSX } from "react";

/** The attribute the placeholder carries, which its rules are written on. */
export const PAGE_PLACEHOLDER_ATTRIBUTE = "data-nx-page-placeholder";

/** The placeholder, saying `words`. */
export function PagePlaceholder({ words }: { words: string }): JSX.Element {
  return (
    <div {...{ [PAGE_PLACEHOLDER_ATTRIBUTE]: "" }}>
      <span>{words}</span>
    </div>
  );
}
