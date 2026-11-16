/**
 * Recent colours: the last colours an author typed or picked, newest first,
 * offered by every colour picker in the builder after the site's colour
 * variables. A convenience of the author's own, never part of the site: the
 * host keeps it in its store for that author, provided here once, so a block's
 * picker and a variable's picker read the one list.
 *
 * Kept as the Icon control keeps its recent icons, eight, each once, through
 * the same list: only what is remembered differs.
 *
 * @module recent-colours
 */
import { isRawColour } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useRecentIcons } from "./recent-icons";
import type { PreferenceStore } from "./shell-state";

/**
 * Where the host keeps this author's Recent colours. Absent, the pickers show
 * an empty list and remember nothing.
 */
export const RecentColoursStore: React.Context<PreferenceStore | undefined> =
  React.createContext<PreferenceStore | undefined>(undefined);

/**
 * The colour to remember for a value written, or `undefined` for one that is
 * not a colour of its own: a variable, `var()`, a keyword that borrows a
 * colour, or nothing. Kept as it was written, so a recent colour is stored in
 * the form the author typed it.
 */
function rememberable(value: unknown): string | undefined {
  if (typeof value !== "string" || !isRawColour(value)) return undefined;
  return value.trim();
}

/**
 * The author's Recent colours, newest first, and a way to remember a value
 * just written; anything but a raw colour is ignored.
 */
export function useRecentColours(): readonly [
  readonly string[],
  (value: unknown) => void,
] {
  const store = React.useContext(RecentColoursStore);
  const [colours, remember] = useRecentIcons(store);
  const rememberColour = React.useCallback(
    (value: unknown) => {
      const colour = rememberable(value);
      if (colour !== undefined) remember(colour);
    },
    [remember]
  );
  return [colours, rememberColour] as const;
}
