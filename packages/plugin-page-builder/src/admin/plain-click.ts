/**
 * Following a link to the builder within the admin, or leaving it to the
 * browser.
 *
 * Every way into the builder from the entry screen is a real link, so it opens
 * in a new tab or window like any link. Only a plain primary click is handled
 * here, moving within the admin so the form and its unsaved work stay mounted.
 *
 * @module @nextlyhq/plugin-page-builder/admin/plain-click
 */
import type { KeyboardEvent, MouseEvent } from "react";

/**
 * Whether a click is the plain primary one this page may handle itself.
 * Anything else — a modifier, or another button — belongs to the browser,
 * which is how an author opens the builder in a new tab or window.
 */
function isPlainClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * The handlers that move to `href` within the admin.
 *
 * Space as well as Enter for a link drawn over the page's own sections: there
 * it stands for a section a person activates, and a control that answers to
 * Enter and not Space reads as broken to a keyboard user. Enter needs nothing
 * here: the browser follows the link, as a click.
 */
export function navigateWithin(
  href: string,
  onNavigate: (href: string) => void
): {
  onClick: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
} {
  return {
    onClick: event => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      onNavigate(href);
    },
    onKeyDown: event => {
      if (event.key !== " ") return;
      // The page would otherwise scroll, which is Space's meaning on a link.
      event.preventDefault();
      onNavigate(href);
    },
  };
}
