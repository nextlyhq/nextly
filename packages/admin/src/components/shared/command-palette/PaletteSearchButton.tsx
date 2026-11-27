"use client";

/**
 * The Search button that opens the command palette, at the top of the rail
 * under the logo, for the people who never press ⌘K. On a phone the menu
 * drawer draws the whole rail, so the same button sits at the drawer's top.
 *
 * @module components/shared/command-palette/PaletteSearchButton
 */

import { detectApplePlatform } from "@nextlyhq/ui";
import { useRef, useSyncExternalStore, type JSX } from "react";

import { Search } from "@admin/components/icons";
import { RailEntry } from "@admin/components/layout/sidebar/RailColumn";

import { openCommandPalette } from "./palette-store";

/**
 * The Search button's name: what it does, and the key that opens the palette
 * where the person is, as the palette's own binding reads `mod+k`: ⌘K on an
 * Apple machine, Ctrl+K on the others, which have no ⌘ key.
 */
function searchButtonLabel(apple: boolean): string {
  return apple ? "Search (⌘K)" : "Search (Ctrl+K)";
}

/** The platform never changes while the page is open. */
const subscribeNever = () => () => {};
const appleSnapshot = () => detectApplePlatform();
// A server render can't know the platform; the first client render corrects it.
const appleOnServer = () => true;

/**
 * The rail's Search entry, drawn as every rail entry is. Focus returns to it
 * when the palette closes, named outright rather than read from what had
 * focus: a click on Safari or Firefox on macOS leaves focus on the page.
 */
export function RailSearchButton(): JSX.Element {
  // The entry gives its select no element, so a layout-free wrapper finds it.
  const wrapper = useRef<HTMLSpanElement>(null);
  const apple = useSyncExternalStore(
    subscribeNever,
    appleSnapshot,
    appleOnServer
  );
  return (
    <span ref={wrapper} className="contents">
      <RailEntry
        label={searchButtonLabel(apple)}
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
