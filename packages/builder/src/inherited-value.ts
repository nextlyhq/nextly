/**
 * The value a style control shows while nothing is set here.
 *
 * @module inherited-value
 */
import * as React from "react";

/**
 * The value reaching a style control from another tier, as it was written
 * there, or `undefined` when nothing does or a value is set here.
 *
 * Carried by context rather than as a prop because every control draws its
 * own empty state, the list, the icon group, the swatch and the font picker
 * among them, and a prop would thread through each for the one line that
 * draws the hint.
 */
export const InheritedValue: React.Context<string | undefined> =
  React.createContext<string | undefined>(undefined);

/**
 * What an unset control says: the inherited value where one reaches it, so
 * the field shows what the canvas draws, and otherwise the control's own hint.
 * Shown as a placeholder, greyed, so it never reads as set here.
 */
export function useUnsetHint(fallback: string): string {
  return React.useContext(InheritedValue) ?? fallback;
}
