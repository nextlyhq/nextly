"use client";

/**
 * The Search buttons that open the command palette: one at the top of the
 * rail, under the logo, and one at the top of the phone's menu drawer, for
 * the people who never press ⌘K.
 *
 * @module components/shared/command-palette/PaletteSearchButton
 */

import { useRef, type JSX } from "react";

import { Search } from "@admin/components/icons";
import { RailEntry } from "@admin/components/layout/sidebar/RailColumn";

import { openCommandPalette } from "./palette-store";

/** The palette's name on its buttons: what it does, and its keys. */
export const SEARCH_BUTTON_LABEL = "Search (⌘K)";

/**
 * The rail's Search entry, drawn as every rail entry is. Focus returns to it
 * when the palette closes, named outright rather than read from what had
 * focus: a click on Safari or Firefox on macOS leaves focus on the page.
 */
export function RailSearchButton(): JSX.Element {
  // The entry gives its select no element, so a layout-free wrapper finds it.
  const wrapper = useRef<HTMLSpanElement>(null);
  return (
    <span ref={wrapper} className="contents">
      <RailEntry
        label={SEARCH_BUTTON_LABEL}
        icon={Search}
        // A button, not a link: it opens the palette and goes nowhere.
        href=""
        asLink={false}
        selected={false}
        onSelect={() =>
          openCommandPalette(
            wrapper.current?.querySelector<HTMLElement>("button") ?? null
          )
        }
      />
    </span>
  );
}

/**
 * The drawer's Search row. It asks the drawer to close, and the drawer opens
 * the palette once it has closed (`openCommandPalette`, from the drawer's
 * close), so the drawer's focus return can't take focus from the palette.
 */
export function DrawerSearchButton({
  onPress,
}: {
  onPress: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPress}
      // Named by the words it shows (no aria-label over them), so a person
      // using voice control can say what they see; the shortcut is announced
      // as a shortcut, on either platform's modifier.
      aria-keyshortcuts="Meta+K Control+K"
      className="flex h-11 w-full items-center gap-3 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground hover-unified focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd
        aria-hidden="true"
        className="rounded-sm border border-border px-1 font-mono text-xs text-muted-foreground"
      >
        ⌘K
      </kbd>
    </button>
  );
}
