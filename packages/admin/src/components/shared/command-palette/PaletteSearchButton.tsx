"use client";

/**
 * The Search buttons that open the command palette: one at the top of the
 * rail, under the logo, and one at the top of the phone's menu drawer, for
 * the people who never press ⌘K.
 *
 * @module components/shared/command-palette/PaletteSearchButton
 */

import type { JSX } from "react";

import { Search } from "@admin/components/icons";
import { RailEntry } from "@admin/components/layout/sidebar/RailColumn";

import { openCommandPalette } from "./palette-store";

/** The palette's name on its buttons: what it does, and its keys. */
export const SEARCH_BUTTON_LABEL = "Search (⌘K)";

/**
 * The rail's Search entry, drawn as every rail entry is. Focus returns to it
 * when the palette closes, since it held focus when the palette opened.
 */
export function RailSearchButton(): JSX.Element {
  return (
    <RailEntry
      label={SEARCH_BUTTON_LABEL}
      icon={Search}
      // A button, not a link: it opens the palette and goes nowhere.
      href=""
      asLink={false}
      selected={false}
      onSelect={openCommandPalette}
    />
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
      aria-label={SEARCH_BUTTON_LABEL}
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
