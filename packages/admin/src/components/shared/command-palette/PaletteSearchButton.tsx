"use client";

/**
 * The Search button that opens the command palette, at the top of the rail
 * under the logo, for the people who never press ⌘K. On a phone the menu
 * drawer draws the whole rail, so the same button sits at the drawer's top.
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
