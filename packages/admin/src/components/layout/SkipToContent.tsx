"use client";

import type React from "react";

/** The id of the admin shell's one `<main>`, which the skip link moves focus to. */
export const MAIN_CONTENT_ID = "nextly-main-content";

/**
 * The first control in the admin shell: "Skip to content", which moves focus
 * past the rail, the sidebar and the header into the page's main region. The
 * sidebar lists every collection and Single, so without it a keyboard user
 * tabs through all of them on every page before reaching the page itself.
 *
 * Hidden until it has focus, then drawn top-left over the shell as a pill in
 * the admin's tokens, with the same focus ring as its buttons. Focus is moved
 * by script rather than left to the `#` link: the admin's router reads the URL,
 * and a hash change is not a navigation it should see. The `href` keeps it a
 * real link, announced as one.
 */
export function SkipToContent(): React.JSX.Element {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={event => {
        event.preventDefault();
        document.getElementById(MAIN_CONTENT_ID)?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Skip to content
    </a>
  );
}
